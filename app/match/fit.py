"""Layer 2 — Fit Score, 0–100, soft preferences only. Never blended with Layer 1.

PRD §14/§17: FitScore = weighted(distance decay, open-now, price fit, amenity fit,
diet preference), weights per context. This module knows nothing about kashrut: its
inputs carry no certifier, no certificate, no verdict, and :func:`compute_fit_score`
neither reads nor alters the Layer 1 result. A restaurant whose kashrut verdict is
UNKNOWN gets exactly the same fit score as an identical MATCH restaurant — the two
layers are combined only in the UI, visually distinct, so "92 fit" can never be read
as "92% kosher".

Weights (PRD gives the component list but no numbers; these are the documented MVP
defaults, normalized before use so custom contexts may pass any positive weights):

* distance 0.35 — dominant but deliberately not overwhelming (§14: a slightly farther
  restaurant that fits much better should win).
* open_now 0.25 — the "hard-boost" component; lunch-hour contexts raise it.
* price 0.15, amenities 0.15, diet 0.10.

Missing data scores the *neutral* 0.5 for that component: soft data gaps must not
zero a restaurant out of the ranking (they are not evidence of poor fit), and must
not reward it either.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class FitWeights:
    """Per-context component weights. Any positive numbers; normalized before use."""

    distance: float = 0.35
    open_now: float = 0.25
    price: float = 0.15
    amenities: float = 0.15
    diet: float = 0.10

    def total(self) -> float:
        return self.distance + self.open_now + self.price + self.amenities + self.diet


DEFAULT_FIT_WEIGHTS = FitWeights()


@dataclass(frozen=True)
class FitCandidate:
    """Soft facts about one restaurant. Deliberately contains nothing kashrut-shaped."""

    distance_km: float | None = None
    is_open_now: bool | None = None
    #: 1–4, as in Restaurant.price_level.
    price_level: int | None = None
    #: AmenityKey → bool, as in Restaurant.amenities.
    amenities: Mapping[str, bool] = field(default_factory=dict)
    #: DietType value (meat / dairy / …), or None when unknown.
    diet_type: str | None = None


@dataclass(frozen=True)
class FitPreferences:
    """The user's soft preferences (UserProfile.diet_prefs + session filters)."""

    #: Distance at which the distance component halves (walking context ≈ 0.75,
    #: driving ≈ 3.0). Exponential decay: score = 0.5 ** (distance / half_distance).
    half_distance_km: float = 1.5
    preferred_price_level: int | None = None
    #: AmenityKey values the user cares about; component = fraction explicitly True.
    wanted_amenities: frozenset[str] = frozenset()
    #: DietType values the user prefers; empty = no preference (component neutral).
    preferred_diets: frozenset[str] = frozenset()


@dataclass(frozen=True, slots=True)
class FitComponent:
    """One scored component, for ranking explanations ("close by · open now")."""

    name: str
    #: Raw component score in [0, 1].
    value: float
    #: Normalized weight applied to it.
    weight: float


@dataclass(frozen=True, slots=True)
class FitScoreResult:
    """Fit score 0–100 with its component breakdown. Soft preferences only — this is
    a ranking aid, categorically separate from the kashrut verdict."""

    score: int
    components: tuple[FitComponent, ...]


def compute_fit_score(
    candidate: FitCandidate,
    preferences: FitPreferences,
    weights: FitWeights = DEFAULT_FIT_WEIGHTS,
) -> FitScoreResult:
    """Score one restaurant's soft fit, 0–100. Pure and deterministic.

    Takes no kashrut input by construction: the Layer 1 verdict cannot influence this
    number, and this number cannot influence the verdict.
    """
    values = (weights.distance, weights.open_now, weights.price, weights.amenities, weights.diet)
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("fit weights must be finite and non-negative")
    total = weights.total()
    if total <= 0:
        raise ValueError("at least one fit weight must be positive")

    raw = (
        ("distance", _distance_component(candidate.distance_km, preferences.half_distance_km)),
        ("open_now", _open_now_component(candidate.is_open_now)),
        ("price", _price_component(candidate.price_level, preferences.preferred_price_level)),
        ("amenities", _amenity_component(candidate.amenities, preferences.wanted_amenities)),
        ("diet", _diet_component(candidate.diet_type, preferences.preferred_diets)),
    )
    normalized = {
        "distance": weights.distance / total,
        "open_now": weights.open_now / total,
        "price": weights.price / total,
        "amenities": weights.amenities / total,
        "diet": weights.diet / total,
    }
    components = tuple(
        FitComponent(name=name, value=value, weight=normalized[name]) for name, value in raw
    )
    weighted = sum(component.value * component.weight for component in components)
    score = min(100, max(0, round(weighted * 100)))
    return FitScoreResult(score=score, components=components)


def _distance_component(distance_km: float | None, half_distance_km: float) -> float:
    """Exponential decay, halving every ``half_distance_km``. §14: deliberately not a
    hard cutoff, so distance never single-handedly buries a great fit.

    A negative distance is invalid input and scores neutral (like missing data) —
    never the perfect 1.0 a garbage value would otherwise earn.
    """
    if distance_km is None or distance_km < 0:
        return 0.5
    if distance_km == 0:
        return 1.0
    if half_distance_km <= 0:
        return 0.0
    return _clamp01(math.pow(0.5, distance_km / half_distance_km))


def _open_now_component(is_open_now: bool | None) -> float:
    if is_open_now is None:
        return 0.5
    return 1.0 if is_open_now else 0.0


def _price_component(price_level: int | None, preferred: int | None) -> float:
    """1.0 at the preferred band, linear falloff over the 1–4 range."""
    if price_level is None or preferred is None:
        return 0.5
    return _clamp01(1.0 - abs(price_level - preferred) / 3.0)


def _amenity_component(amenities: Mapping[str, bool], wanted: frozenset[str]) -> float:
    """Fraction of wanted amenities explicitly present. Tri-state like everything
    else: an amenity that is absent or False simply does not count."""
    if not wanted:
        return 0.5
    present = sum(1 for key in wanted if amenities.get(key) is True)
    return present / len(wanted)


def _diet_component(diet_type: str | None, preferred: frozenset[str]) -> float:
    if not preferred:
        return 0.5
    if diet_type is None:
        return 0.5
    return 1.0 if diet_type in preferred else 0.0


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))
