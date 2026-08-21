"""Pydantic schemas for the public (consumer-facing) API — ``/v1/*``.

This is the contract the PWA (Track C, POC_PLAN.md) builds against. The kashrut
profile travels in the request body on every call — there is no auth, no accounts, no
sessions (a deliberate POC shortcut around the still-open PRD §21.4 user-auth
decision; see ``POC_PLAN.md`` B3).

Layer 1 (kashrut verdict) and Layer 2 (fit score) are kept in visibly separate
response objects everywhere (AGENTS.md, locked): :class:`KashrutVerdictOut` carries a
categorical verdict plus reason codes and is never a number; :class:`FitScoreOut`
carries a 0-100 ranking aid over soft preferences only. Neither is derived from the
other and a client must never combine them into one figure.
"""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

from app.api.consts import (
    DEFAULT_PAGE_SIZE,
    DEFAULT_RADIUS_KM,
    ERROR_CENTER_OR_CITY_REQUIRED,
    ERROR_DUPLICATE_WHITELIST_CERTIFIER,
    MAX_PAGE_SIZE,
    MAX_RADIUS_KM,
    MAX_SEARCH_QUERY_LENGTH,
    MIN_RADIUS_KM,
)
from app.api.schemas import UTCDateTime
from app.match import Confidence, ReasonCode, Verdict
from app.models.enums import (
    AmenityKey,
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    CertifierType,
    DietType,
)

# --------------------------------------------------------------------------- profile


class WhitelistEntryRequest(BaseModel):
    """One (certifier, min_level) pair the user accepts.

    ``min_level`` REGULAR (the default) means "any certificate from this certifier" —
    it is the base published level, required so certifier-published lists with no
    stated level (level UNKNOWN) can still match (``app.match.engine`` semantics).
    """

    certifier_id: uuid.UUID
    min_level: CertificationLevel = CertificationLevel.REGULAR


class ProfileRequest(BaseModel):
    """The user's kashrut profile: whitelist + required attributes, plus soft
    preferences for Layer 2 ranking. Carried in full on every request — there is no
    server-side profile storage in the POC.
    """

    whitelist: list[WhitelistEntryRequest] = Field(default_factory=list)
    #: Every one of these must be explicitly ``true`` on a certificate for MATCH. An
    #: attribute a certificate does not mention is unknown, not false, and blocks
    #: MATCH without proving NO_MATCH (fail-safe: doubt -> UNKNOWN).
    required_attributes: list[CertificateAttribute] = Field(default_factory=list)
    #: Soft preferences only — feed Layer 2 (``FitPreferences``) and never the
    #: kashrut verdict.
    preferred_diets: list[DietType] = Field(default_factory=list)
    preferred_price_level: int | None = Field(default=None, ge=1, le=4)
    wanted_amenities: list[AmenityKey] = Field(default_factory=list)

    @field_validator("whitelist")
    @classmethod
    def _whitelist_no_duplicate_certifiers(
        cls, value: list[WhitelistEntryRequest]
    ) -> list[WhitelistEntryRequest]:
        """Reject a whitelist that names the same certifier twice — the client should
        send one entry per certifier with the minimum level it wants to accept.
        """
        seen: set[uuid.UUID] = set()
        for entry in value:
            if entry.certifier_id in seen:
                raise ValueError(
                    ERROR_DUPLICATE_WHITELIST_CERTIFIER.format(certifier_id=entry.certifier_id)
                )
            seen.add(entry.certifier_id)

        return value


# ------------------------------------------------------------------------------ geo


class GeoPoint(BaseModel):
    """A WGS-84 coordinate, as sent by the client."""

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class GeoPointOut(BaseModel):
    """A WGS-84 coordinate, as returned to the client."""

    lat: float
    lon: float


# --------------------------------------------------------------------------- search


class SearchFilters(BaseModel):
    """Hard restaurant filters — ordinary search facets, not kashrut conditions.
    Restaurants failing these are excluded from the response entirely (unlike
    ``required_attributes``, which is evaluated by the kashrut gate and never removes
    a restaurant from the list).
    """

    diet_type: DietType | None = None
    price_level: int | None = Field(default=None, ge=1, le=4)
    #: Accepted for forward compatibility. Israel hours logic (Shabbat/chagim) is out
    #: of scope for the POC (POC_PLAN.md §6) — every restaurant's open-now Layer 2
    #: component scores neutral regardless of this filter.
    open_now: bool | None = None
    amenities: list[AmenityKey] = Field(default_factory=list)


class SearchRequest(BaseModel):
    """Request body for ``POST /v1/search``. Exactly the fields POC_PLAN.md B3
    specifies: profile, center|city, radius_km, filters, page — plus an optional
    free-text ``query`` (Change 3): a case-insensitive SQL substring match over
    ``name_he`` / ``name_en`` / ``address_he`` that only narrows the candidate set. It
    never changes result ordering (still gate-then-fit, PRD FR3) and never influences
    the kashrut verdict.
    """

    profile: ProfileRequest
    center: GeoPoint | None = None
    #: ``Restaurant.city_slug`` (e.g. ``"jerusalem"``).
    city: str | None = None
    radius_km: float = Field(default=DEFAULT_RADIUS_KM, ge=MIN_RADIUS_KM, le=MAX_RADIUS_KM)
    filters: SearchFilters = Field(default_factory=SearchFilters)
    #: Free-text filter. Exact, case-insensitive substring match only — no fuzzy or
    #: niqqud/plene-defective-spelling normalization (see app.api.public).
    query: str | None = Field(default=None, max_length=MAX_SEARCH_QUERY_LENGTH)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE)

    @field_validator("city")
    @classmethod
    def _blank_city_is_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()

        return value or None

    @field_validator("query")
    @classmethod
    def _blank_query_is_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()

        return value or None

    @model_validator(mode="after")
    def _center_or_city_required(self) -> SearchRequest:
        if self.center is None and self.city is None:
            raise ValueError(ERROR_CENTER_OR_CITY_REQUIRED)

        return self


# --------------------------------------------------------- Layer 1 / Layer 2 output


class ReasonOut(BaseModel):
    """One machine-readable reason code, powering the "why?" UI."""

    code: ReasonCode
    #: Set for per-attribute codes (e.g. ATTRIBUTE_UNKNOWN), else None.
    attribute: str | None = None


class FreshnessOut(BaseModel):
    """Evidence freshness — day counts, never a score."""

    verified_at: UTCDateTime | None
    evidence_age_days: int | None
    valid_until: dt.date | None
    days_until_expiry: int | None
    is_stale: bool
    expires_soon: bool


class KashrutVerdictOut(BaseModel):
    """Layer 1 — categorical, explainable, never a percentage (AGENTS.md locked
    decision). This is the only field a client may render as a kashrut judgement.
    """

    verdict: Verdict
    reasons: list[ReasonOut]
    confidence: Confidence
    freshness: FreshnessOut | None
    deciding_certificate_id: uuid.UUID | None


class FitComponentOut(BaseModel):
    name: str
    value: float
    weight: float


class FitScoreOut(BaseModel):
    """Layer 2 — a 0-100 ranking aid over soft preferences only (distance, open-now,
    price, amenities, diet). Cannot see and is never blended with the kashrut verdict
    (AGENTS.md locked decision).
    """

    score: int = Field(ge=0, le=100)
    components: list[FitComponentOut]


class CertifierChip(BaseModel):
    """Display identity only — the app never ranks certifiers against each other."""

    id: uuid.UUID
    name_he: str
    name_en: str | None
    type: CertifierType


class DecidingCertificateOut(BaseModel):
    """Names which certificate produced this row's Layer 1 verdict (Change 2).

    Reads ``MatchResult.deciding_certificate_id`` — already computed by
    ``app.match.engine.evaluate_kashrut`` — and exposes only display identity (which
    certifier, which published level) plus the certificate id. Deliberately does not
    carry the certificate's full evidence (attributes, provenance, reasons); that
    stays on ``CertificateEvidenceOut`` (the detail endpoint) so this object cannot be
    mistaken for the "why?" payload. Naming a certificate as "deciding" is not a
    ranking of it against the restaurant's other certificates in ``certifiers[]`` — it
    is simply the one the gate happened to resolve on (PRD §13 source hierarchy).
    """

    certificate_id: uuid.UUID
    certifier: CertifierChip
    level: CertificationLevel


# ---------------------------------------------------------------- /v1/certifiers


class CertifierListItem(BaseModel):
    """One row for the client's whitelist picker."""

    id: uuid.UUID
    name_he: str
    name_en: str | None
    type: CertifierType
    #: Certification levels this certifier has actually published on at least one of
    #: its certificates (excluding UNKNOWN, which means "not published" rather than a
    #: selectable level), for the picker's per-certifier level control.
    levels: list[CertificationLevel]


# -------------------------------------------------------------------- /v1/search


class SearchResultItem(BaseModel):
    restaurant_id: uuid.UUID
    name_he: str
    name_en: str | None
    city_he: str | None
    address_he: str | None
    geo: GeoPointOut | None
    #: None when the search had no ``center`` (city-only search).
    distance_km: float | None
    #: Same field/semantics as ``RestaurantDetailResponse.diet_type`` (Change 1).
    diet_type: DietType | None
    kashrut: KashrutVerdictOut
    fit: FitScoreOut
    certifiers: list[CertifierChip]
    #: Which of ``certifiers[]`` (by certificate, not just certifier) the Layer 1 gate
    #: resolved on; None only when the gate had no certificate to decide on at all
    #: (Change 2 — see ``DecidingCertificateOut``).
    deciding_certificate: DecidingCertificateOut | None


class SearchResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[SearchResultItem]


# ----------------------------------------------------------- /v1/restaurants/{id}


class RestaurantDetailRequest(BaseModel):
    """Same profile-in-body model as ``/v1/search`` — no auth, no session."""

    profile: ProfileRequest
    center: GeoPoint | None = None


class ProvenanceOut(BaseModel):
    """Provenance the product's core claim depends on (AGENTS.md: every
    kashrut-relevant field carries provenance).
    """

    source: CertificateSource
    verified_by_label: str | None
    verified_at: UTCDateTime | None
    corroboration_count: int
    #: True only for fabricated POC demo rows (scripts/seed_demo_attributes.py).
    #: Orthogonal to ``source`` — a demo row can carry MODERATOR_VERIFIED the same as
    #: a genuine photo-reviewed row, so this is the honest, structured tell apart.
    is_demo_seed: bool


class CertificateEvidenceOut(BaseModel):
    """One certificate's full evidence — enough on its own for the client to render
    "why am I seeing this answer" (POC_PLAN.md B4).
    """

    certificate_id: uuid.UUID
    certifier: CertifierChip
    level: CertificationLevel
    #: Tri-state: a present key is the published true/false fact; an absent key is
    #: unknown (never rendered as false).
    attributes: dict[str, bool]
    state: CertificateState
    valid_from: dt.date | None
    valid_until: dt.date | None
    provenance: ProvenanceOut
    outcome: Verdict
    reasons: list[ReasonOut]
    confidence: Confidence
    freshness: FreshnessOut


class RestaurantDetailResponse(BaseModel):
    restaurant_id: uuid.UUID
    name_he: str
    name_en: str | None
    address_he: str | None
    city_he: str | None
    phone: str | None
    website: str | None
    diet_type: DietType | None
    price_level: int | None
    amenities: dict[str, bool]
    geo: GeoPointOut | None
    distance_km: float | None
    #: The deciding verdict/fit for this restaurant against the request profile —
    #: same shape as one ``SearchResultItem`` entry, so list and detail screens share
    #: rendering code on the client.
    kashrut: KashrutVerdictOut
    fit: FitScoreOut
    #: Every certificate's full evidence, not just the deciding one.
    certificates: list[CertificateEvidenceOut]
