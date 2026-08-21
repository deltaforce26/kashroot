"""DB / API -> match-engine adapter (POC_PLAN.md B1, keystone).

Maps ``Certificate``/``Restaurant`` ORM rows and the public API's ``ProfileRequest``
onto the pure engine types in ``app.match``. This module is the ONLY place in the
codebase allowed to bridge the two: ``app.match`` stays pure — no DB, no settings, no
clock (see its package docstring and the deliberate lazy import in
``app/db/__init__.py``) — and this adapter lives outside it by design. Every function
here is a plain, deterministic mapping; the one exception is the caller-supplied
``now``, threaded straight through to :func:`app.match.evaluate_kashrut` exactly as
that function requires it (no hidden clock here either).
"""

from __future__ import annotations

import datetime as dt

from app.api.consts import DEFAULT_HALF_DISTANCE_KM
from app.api.schemas_public import ProfileRequest
from app.match import (
    CertificateInput,
    FitCandidate,
    FitPreferences,
    MatchResult,
    ProfileInput,
    WhitelistEntry,
    evaluate_kashrut,
)
from app.models import Certificate, Restaurant


def certificate_input_from_orm(certificate: Certificate) -> CertificateInput:
    """Map one ``Certificate`` row to the engine's ``CertificateInput``.

    Parameters:
        certificate (Certificate): the ORM row, as loaded from the database.

    Return:
        CertificateInput: the pure-engine fact set for this certificate.
    """
    return CertificateInput(
        certificate_id=str(certificate.id),
        certifier_id=str(certificate.certifier_id),
        state=certificate.state,
        level=certificate.level,
        attributes=dict(certificate.attributes),
        valid_from=certificate.valid_from,
        valid_until=certificate.valid_until,
        verified_at=certificate.verified_at,
        source=certificate.source,
        corroboration_count=certificate.corroboration_count,
    )


def profile_input_from_request(profile: ProfileRequest) -> ProfileInput:
    """Map the public API's ``ProfileRequest`` to the engine's ``ProfileInput``.

    Parameters:
        profile (ProfileRequest): the profile carried in the request body.

    Return:
        ProfileInput: the pure-engine whitelist + required attributes.
    """
    whitelist = tuple(
        WhitelistEntry(certifier_id=str(entry.certifier_id), min_level=entry.min_level)
        for entry in profile.whitelist
    )
    required_attributes = frozenset(attribute.value for attribute in profile.required_attributes)

    return ProfileInput(whitelist=whitelist, required_attributes=required_attributes)


def evaluate_restaurant_kashrut(
    restaurant: Restaurant, profile: ProfileInput, *, now: dt.datetime
) -> MatchResult:
    """Run the Layer 1 kashrut gate for one restaurant's certificates.

    ``restaurant.certificates`` must already be loaded (e.g. via ``selectinload``) by
    the caller — this function performs no database I/O of its own.

    Parameters:
        restaurant (Restaurant): the restaurant, with certificates eager-loaded.
        profile (ProfileInput): the evaluated profile.
        now (dt.datetime): evaluation instant, threaded through to the pure engine.

    Return:
        MatchResult: the Layer 1 verdict, reasons, confidence and per-certificate
            evidence.
    """
    certificates = tuple(
        certificate_input_from_orm(certificate) for certificate in restaurant.certificates
    )

    return evaluate_kashrut(certificates, profile, now=now)


def fit_candidate_from_restaurant(
    restaurant: Restaurant, *, distance_km: float | None
) -> FitCandidate:
    """Map a restaurant's soft facts to the Layer 2 engine's ``FitCandidate``.

    Deliberately carries nothing kashrut-shaped — ``app.match.fit`` cannot see the
    verdict. ``is_open_now`` is always None for the POC: Israel hours logic (Shabbat,
    chagim) is out of scope (POC_PLAN.md §6), so that component always scores neutral.

    Parameters:
        restaurant (Restaurant): the restaurant.
        distance_km (float | None): straight-line distance from the search center, or
            None when no center was supplied.

    Return:
        FitCandidate: the pure-engine soft-fact set for this restaurant.
    """
    return FitCandidate(
        distance_km=distance_km,
        is_open_now=None,
        price_level=restaurant.price_level,
        amenities=dict(restaurant.amenities),
        diet_type=restaurant.diet_type.value if restaurant.diet_type else None,
    )


def fit_preferences_from_profile(profile: ProfileRequest) -> FitPreferences:
    """Map the profile's soft-preference fields to the engine's ``FitPreferences``.

    Parameters:
        profile (ProfileRequest): the profile carried in the request body.

    Return:
        FitPreferences: the pure-engine soft-preference set.
    """
    return FitPreferences(
        half_distance_km=DEFAULT_HALF_DISTANCE_KM,
        preferred_price_level=profile.preferred_price_level,
        wanted_amenities=frozenset(amenity.value for amenity in profile.wanted_amenities),
        preferred_diets=frozenset(diet.value for diet in profile.preferred_diets),
    )
