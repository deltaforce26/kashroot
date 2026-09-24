"""Pydantic schemas for the public SEO endpoints — ``GET /v1/restaurants/{id}`` and
``GET /v1/sitemap.xml`` (``app.api.public_seo``).

Kept out of ``app.api.schemas_public``, purely for STANDARDS.md's 500-line file cap —
that module already sits near it.

Both endpoints are profile-free: Googlebot carries no kashrut profile, so neither
model here may ever carry a Layer 1 verdict, a Layer 2 fit score, or a per-certificate
evaluation outcome (CLAUDE.md — a verdict is only ever computed against a profile; a
fact is not). ``RestaurantPublicOut`` mirrors ``RestaurantDetailResponse``'s own
restaurant-level field names field-for-field (``app.api.schemas_public``) so the web
client's existing TypeScript type (``RestaurantDetailResponseOut`` in
web/src/api/types.ts, the type this task calls ``RestaurantOut``) needs only to drop
``kashrut``/``fit``/``distance_km`` to describe this response too.
"""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel

from app.api.schemas import UTCDateTime
from app.api.schemas_public import GeoPointOut
from app.models.enums import CertificateState, DietType


class CertifierFactOut(BaseModel):
    """Certifier display identity only — the same minimal chip every public response
    exposes; the app never ranks certifiers against each other (CLAUDE.md).
    """

    id: uuid.UUID
    name_he: str
    name_en: str | None


class CertificateFactOut(BaseModel):
    """One certificate's facts exactly as stored, with no evaluation against any
    profile — there is no profile on this profile-free path. ``status`` is the
    certificate's own stored state (active/expired/revoked/pending), never a kashrut
    verdict.
    """

    certifier: CertifierFactOut
    status: CertificateState
    valid_until: dt.date | None
    #: Tri-state, same semantics as ``CertificateEvidenceOut.attributes``: a present
    #: key is the published true/false fact; an absent key is unknown and must never
    #: be rendered as false.
    attributes: dict[str, bool]


class RestaurantPublicOut(BaseModel):
    """``GET /v1/restaurants/{id}`` (200) — facts only, never a verdict.

    See ``app.api.public_seo.get_restaurant_public_facts`` for why: the fail-safe
    rule is doubt -> UNKNOWN, and a verdict needs a profile to evaluate against; an
    anonymous crawler (or any caller with no profile) supplies none, so this response
    carries the underlying facts and leaves the verdict to a client that does have a
    profile.
    """

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
    #: Every certificate's facts, not just one a gate happened to resolve on — there
    #: is no gate here.
    certificates: list[CertificateFactOut]
    updated_at: UTCDateTime


class DirectoryRestaurantOut(BaseModel):
    """One restaurant's identity-only facts within a ``GET /v1/directory`` city group
    — enough for a landing-page chip and a link through to the full profile-free
    detail (``GET /v1/restaurants/{id}``). No certificate state, no attributes, no
    verdict: see ``app.api.public_seo.get_directory`` for why.
    """

    restaurant_id: uuid.UUID
    name_he: str
    name_en: str | None
    address_he: str | None
    #: Active certifiers only (``Certifier.is_active``), de-duplicated, sorted
    #: alphabetically by ``name_he`` — never by certifier type. Certificate state is
    #: deliberately not exposed here; that is evaluation-shaped, and this path is
    #: facts-only.
    certifier_names_he: list[str]
    #: Parallel to ``certifier_names_he`` (same order, same length); an entry is
    #: ``None`` when that certifier has no English name.
    certifier_names_en: list[str | None]


class DirectoryCityOut(BaseModel):
    """One city's group within the ``GET /v1/directory`` landing-page response."""

    city_he: str
    #: The full count of public restaurants in this city — independent of how many
    #: of them ``restaurants`` samples.
    restaurant_count: int
    #: A sample of at most ``DIRECTORY_SAMPLE_PER_CITY``, ordered alphabetically by
    #: ``name_he`` — never by certifier or certificate state.
    restaurants: list[DirectoryRestaurantOut]


class DirectoryResponse(BaseModel):
    """``GET /v1/directory`` (200) — the web app's landing-page directory: every
    public restaurant grouped by city, facts only, no verdict anywhere in the tree.

    See ``app.api.public_seo.get_directory`` for why it carries no verdict and why
    every ordering in this response (cities on a ``restaurant_count`` tie,
    restaurants within a city, certifiers per restaurant) is alphabetical rather than
    ranked.
    """

    #: Every public restaurant, including ones with no ``city_he`` (those appear in
    #: no city group below).
    total_restaurants: int
    #: One entry per distinct non-null ``city_he``, ordered by ``restaurant_count``
    #: descending, ties broken alphabetically by ``city_he``.
    cities: list[DirectoryCityOut]
