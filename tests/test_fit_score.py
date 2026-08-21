"""Layer 2 fit score — the executable spec.

Soft preferences only: distance decay, open-now, price fit, amenity fit, diet fit.
The fit score must be structurally incapable of touching the kashrut verdict — its
input types carry nothing kashrut-shaped, and Layer 1's output carries no fit score.
"""

from __future__ import annotations

import dataclasses
import inspect
import math

import pytest

from app.match import (
    DEFAULT_FIT_WEIGHTS,
    FitCandidate,
    FitPreferences,
    FitScoreResult,
    FitWeights,
    MatchResult,
    compute_fit_score,
)

PERFECT = FitCandidate(
    distance_km=0.0,
    is_open_now=True,
    price_level=2,
    amenities={"parking": True, "family": True},
    diet_type="dairy",
)
PICKY = FitPreferences(
    preferred_price_level=2,
    wanted_amenities=frozenset({"parking", "family"}),
    preferred_diets=frozenset({"dairy"}),
)


def component(result: FitScoreResult, name: str) -> float:
    return next(c.value for c in result.components if c.name == name)


class TestBoundaries:
    def test_perfect_fit_scores_100(self):
        assert compute_fit_score(PERFECT, PICKY).score == 100

    def test_worst_fit_scores_0(self):
        worst = FitCandidate(
            distance_km=500.0,
            is_open_now=False,
            price_level=4,
            amenities={},
            diet_type="meat",
        )
        prefs = FitPreferences(
            preferred_price_level=1,
            wanted_amenities=frozenset({"parking"}),
            preferred_diets=frozenset({"dairy"}),
        )
        assert compute_fit_score(worst, prefs).score == 0

    def test_score_is_an_int_between_0_and_100(self):
        for distance in (None, 0.0, 0.3, 1.5, 7.0, 42.0):
            result = compute_fit_score(FitCandidate(distance_km=distance), FitPreferences())
            assert isinstance(result.score, int)
            assert 0 <= result.score <= 100


class TestDistanceDecay:
    def test_zero_distance_is_full_score(self):
        result = compute_fit_score(FitCandidate(distance_km=0.0), FitPreferences())
        assert component(result, "distance") == 1.0

    def test_half_distance_halves_the_component(self):
        result = compute_fit_score(
            FitCandidate(distance_km=1.5), FitPreferences(half_distance_km=1.5)
        )
        assert component(result, "distance") == pytest.approx(0.5)

    def test_decay_is_monotonic(self):
        prefs = FitPreferences()
        values = [
            component(compute_fit_score(FitCandidate(distance_km=d), prefs), "distance")
            for d in (0.0, 0.5, 1.0, 2.0, 5.0, 20.0)
        ]
        assert values == sorted(values, reverse=True)

    def test_unknown_distance_is_neutral(self):
        result = compute_fit_score(FitCandidate(distance_km=None), FitPreferences())
        assert component(result, "distance") == 0.5

    def test_negative_distance_is_invalid_and_scores_neutral(self):
        # Garbage input must not earn the perfect score reserved for distance 0.
        result = compute_fit_score(FitCandidate(distance_km=-2.0), FitPreferences())
        assert component(result, "distance") == 0.5

    def test_walking_context_decays_faster_than_driving(self):
        candidate = FitCandidate(distance_km=2.0)
        walking = compute_fit_score(candidate, FitPreferences(half_distance_km=0.75))
        driving = compute_fit_score(candidate, FitPreferences(half_distance_km=3.0))
        assert component(walking, "distance") < component(driving, "distance")


class TestOpenNow:
    @pytest.mark.parametrize(
        ("is_open", "expected"), [(True, 1.0), (False, 0.0), (None, 0.5)]
    )
    def test_open_now_component(self, is_open, expected):
        result = compute_fit_score(FitCandidate(is_open_now=is_open), FitPreferences())
        assert component(result, "open_now") == expected


class TestPriceFit:
    @pytest.mark.parametrize(
        ("price", "preferred", "expected"),
        [
            (2, 2, 1.0),
            (3, 2, pytest.approx(2 / 3)),
            (4, 2, pytest.approx(1 / 3)),
            (4, 1, 0.0),
            (None, 2, 0.5),
            (2, None, 0.5),
        ],
    )
    def test_price_component(self, price, preferred, expected):
        result = compute_fit_score(
            FitCandidate(price_level=price), FitPreferences(preferred_price_level=preferred)
        )
        assert component(result, "price") == expected


class TestAmenityFit:
    def test_fraction_of_wanted_amenities_present(self):
        result = compute_fit_score(
            FitCandidate(amenities={"parking": True, "family": False}),
            FitPreferences(wanted_amenities=frozenset({"parking", "family", "delivery"})),
        )
        assert component(result, "amenities") == pytest.approx(1 / 3)

    def test_amenity_false_or_absent_does_not_count(self):
        result = compute_fit_score(
            FitCandidate(amenities={"parking": False}),
            FitPreferences(wanted_amenities=frozenset({"parking"})),
        )
        assert component(result, "amenities") == 0.0

    def test_no_wanted_amenities_is_neutral(self):
        result = compute_fit_score(
            FitCandidate(amenities={"parking": True}), FitPreferences()
        )
        assert component(result, "amenities") == 0.5


class TestDietFit:
    @pytest.mark.parametrize(
        ("diet", "preferred", "expected"),
        [
            ("dairy", frozenset({"dairy", "pareve"}), 1.0),
            ("meat", frozenset({"dairy", "pareve"}), 0.0),
            (None, frozenset({"dairy"}), 0.5),
            ("meat", frozenset(), 0.5),
        ],
        ids=["preferred", "not-preferred", "diet-unknown", "no-preference"],
    )
    def test_diet_component(self, diet, preferred, expected):
        result = compute_fit_score(
            FitCandidate(diet_type=diet), FitPreferences(preferred_diets=preferred)
        )
        assert component(result, "diet") == expected


class TestWeights:
    def test_default_weights_are_documented_mvp_weights(self):
        assert DEFAULT_FIT_WEIGHTS == FitWeights(
            distance=0.35, open_now=0.25, price=0.15, amenities=0.15, diet=0.10
        )
        assert DEFAULT_FIT_WEIGHTS.total() == pytest.approx(1.0)

    def test_each_component_moves_the_score_by_its_weight(self):
        # Flipping one component from perfect to worst drops the score by ~weight×100.
        base = compute_fit_score(PERFECT, PICKY).score
        closed = dataclasses.replace(PERFECT, is_open_now=False)
        assert base - compute_fit_score(closed, PICKY).score == round(
            DEFAULT_FIT_WEIGHTS.open_now * 100
        )
        wrong_diet = dataclasses.replace(PERFECT, diet_type="meat")
        assert base - compute_fit_score(wrong_diet, PICKY).score == round(
            DEFAULT_FIT_WEIGHTS.diet * 100
        )

    def test_custom_weights_are_normalized(self):
        # Same ratios, different scale → identical score.
        a = compute_fit_score(PERFECT, PICKY, FitWeights(0.35, 0.25, 0.15, 0.15, 0.10))
        b = compute_fit_score(PERFECT, PICKY, FitWeights(35, 25, 15, 15, 10))
        assert a.score == b.score

    def test_lunch_context_boosts_open_now(self):
        # §14: weights per context — lunch hours boost open-now.
        lunch = FitWeights(distance=0.30, open_now=0.45, price=0.10, amenities=0.10, diet=0.05)
        closed = dataclasses.replace(PERFECT, is_open_now=False)
        default_penalty = 100 - compute_fit_score(closed, PICKY).score
        lunch_penalty = 100 - compute_fit_score(closed, PICKY, lunch).score
        assert lunch_penalty > default_penalty

    def test_zero_total_weights_raise(self):
        with pytest.raises(ValueError):
            compute_fit_score(PERFECT, PICKY, FitWeights(0, 0, 0, 0, 0))

    def test_negative_weight_raises(self):
        with pytest.raises(ValueError, match="non-negative"):
            compute_fit_score(PERFECT, PICKY, FitWeights(distance=-0.1))

    def test_nan_or_infinite_weight_raises(self):
        with pytest.raises(ValueError, match="finite"):
            compute_fit_score(PERFECT, PICKY, FitWeights(open_now=math.nan))
        with pytest.raises(ValueError, match="finite"):
            compute_fit_score(PERFECT, PICKY, FitWeights(diet=math.inf))


class TestDeterminism:
    def test_same_input_same_output(self):
        assert compute_fit_score(PERFECT, PICKY) == compute_fit_score(PERFECT, PICKY)

    def test_result_is_frozen(self):
        result = compute_fit_score(PERFECT, PICKY)
        with pytest.raises(dataclasses.FrozenInstanceError):
            result.score = 0  # type: ignore[misc]


class TestLayerSeparation:
    """The two layers are never blended — structurally, not just by convention."""

    def test_fit_score_takes_no_kashrut_input(self):
        # Neither the signature nor the input types mention verdicts or certificates.
        params = inspect.signature(compute_fit_score).parameters
        assert set(params) == {"candidate", "preferences", "weights"}
        forbidden = ("verdict", "kashrut", "certif", "match", "attribute", "whitelist")
        for cls in (FitCandidate, FitPreferences, FitWeights):
            for field in dataclasses.fields(cls):
                assert not any(word in field.name for word in forbidden), field.name

    def test_layer1_output_carries_no_fit_score(self):
        for field in dataclasses.fields(MatchResult):
            assert "fit" not in field.name and "score" not in field.name
