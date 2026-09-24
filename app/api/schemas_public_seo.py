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
