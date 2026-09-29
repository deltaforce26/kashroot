"""Pure matching helpers for :mod:`app.ingestion.places_resolve` — distance scoring
and address-based acceptance over a raw Places (New) Text Search response. No I/O;
split out of ``places_resolve`` to keep that module within STANDARDS.md's file-size
guidance as its decision surface grew (a same-radius chain branch needs a second,
address-based acceptance path — see module docstring there).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

from app.ingestion.places_resolve_consts import (
    MAX_DISTANCE_M,
    REASON_ACCEPTED,
    REASON_ACCEPTED_STREET_MATCH,
    REASON_MISSING_LOCATION,
    REASON_NO_CANDIDATES,
    REASON_TOO_FAR,
)

#: Mean Earth radius (m), for the haversine distance used to score candidates.
_EARTH_RADIUS_M = 6_371_000.0

#: Street-name prefixes stripped before comparison — they carry no identity
#: information and one side of a comparison often omits them.
_STREET_PREFIXES = ("רח'", "רחוב", "שד'", "שדרות")

#: Gershayim/quote characters dropped before comparison (they render an abbreviation
#: like פלמ"ח, not a distinct character).
_QUOTE_TRANSLATION = str.maketrans("", "", "\"״'")

#: The first digit run in an address — its house number.
_HOUSE_NUMBER_PATTERN = re.compile(r"\d+")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Great-circle distance between two WGS-84 points, in meters.

    Parameters:
        lat1 (float): First point's latitude, degrees.
        lon1 (float): First point's longitude, degrees.
        lat2 (float): Second point's latitude, degrees.
        lon2 (float): Second point's longitude, degrees.

    Return:
        float: Distance in meters (spherical-Earth approximation).
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = phi2 - phi1
    delta_lambda = math.radians(lon2 - lon1)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )

    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(haversine))


def _strip_prefix(text: str) -> str:
    """
    Drop one leading street-type prefix (``רח'``, ``רחוב``, ``שד'``, ``שדרות``).

    Parameters:
        text (str): Address text, already stripped of surrounding whitespace.

    Return:
        str: ``text`` with a matched leading prefix (and the whitespace after it)
            removed; unchanged when no prefix matches.
    """
    for prefix in _STREET_PREFIXES:
        if text.startswith(prefix):
            return text[len(prefix) :].lstrip()

    return text


def _normalize_for_match(text: str) -> str:
    """
    Normalize address text for comparison: strip a leading street-type prefix, drop
    gershayim/quote characters, strip a leading ``ה`` from every word, and collapse
    whitespace.

    Parameters:
        text (str): Raw address (or address fragment) text.

    Return:
        str: The normalized text.
    """
    stripped = _strip_prefix(text.strip())
    without_quotes = stripped.translate(_QUOTE_TRANSLATION)
    words = [w[1:] if len(w) > 1 and w.startswith("ה") else w for w in without_quotes.split()]

    return " ".join(words)


def _parse_street_and_number(address_he: str) -> tuple[str, str] | None:
    """
    Split an address into its normalized street name and house number.

    Parameters:
        address_he (str): The restaurant's Hebrew street address.

    Return:
        tuple[str, str] | None: ``(normalized_street, number)``, or ``None`` when the
            address has no digit (a mall/complex name — house-number-based street
            matching never applies to it) or normalizes to an empty street.
    """
    match = _HOUSE_NUMBER_PATTERN.search(address_he)
    if match is None:
        return None
    street = _normalize_for_match(address_he[: match.start()])
    if not street:
        return None

    return street, match.group()


def address_matches(address_he: str | None, formatted_address: str | None) -> bool:
    """
    Whether a Text Search candidate's ``formattedAddress`` names the same street and
    house number as our own address — used to accept a same-name chain branch that
    Google's location bias placed outside the search radius.

    Known limits (intentional — doubt must fall back to the radius check, never
    guess): an address with no house number never matches (malls/complexes), and a
    wrong house number never matches even when the street name is right, so a
    Hebrew street-name spelling variant paired with the wrong number is rejected.

    Parameters:
        address_he (str | None): Our restaurant's Hebrew street address.
        formatted_address (str | None): The candidate's ``formattedAddress`` from
            Places (New) Text Search.

    Return:
        bool: ``True`` when the same house number and normalized street both appear
            in ``formatted_address``; ``False`` otherwise, including when either
            input is missing or our address has no house number.
    """
    if not address_he or not formatted_address:
        return False

    parsed = _parse_street_and_number(address_he)
    if parsed is None:
        return False
    street, number = parsed

    normalized_target = _normalize_for_match(formatted_address)
    if re.search(rf"(?<!\d){re.escape(number)}(?!\d)", normalized_target) is None:
        return False

    return street in normalized_target


@dataclass(frozen=True)
class ResolveDecision:
    """What one raw Text Search response means for one restaurant. Pure — no I/O."""

    accept: bool
    reason: str
    place_id: str | None = None
    display_name: str | None = None
    distance_m: float | None = None
    business_status: str | None = None


def classify_candidates(
    response: dict[str, Any],
    origin_lat: float,
    origin_lon: float,
    our_address_he: str | None = None,
    *,
    max_distance_m: float = MAX_DISTANCE_M,
) -> ResolveDecision:
    """
    Accept the first candidate within ``max_distance_m`` of the restaurant's own
    geocoded point, or — failing that — the first candidate whose ``formattedAddress``
    names the same street and house number as ``our_address_he`` (a same-name chain
    branch Google's search box placed outside the radius); reject (and write nothing)
    otherwise. Pure function over (raw response x origin point x our address x radius).

    Parameters:
        response (dict[str, Any]): The raw Text Search JSON.
        origin_lat (float): The restaurant's own geocoded latitude.
        origin_lon (float): The restaurant's own geocoded longitude.
        our_address_he (str | None): The restaurant's Hebrew street address, for the
            street-match acceptance path.
        max_distance_m (float): The acceptance radius — ``MAX_DISTANCE_M`` by
            default, or ``MAX_DISTANCE_NO_HOUSE_NUMBER_M`` for a house-number-less
            address; the caller picks based on ``_has_house_number``.

    Return:
        ResolveDecision: The accept/reject decision, with evidence either way.
    """
    places = response.get("places") or []
    if not places:
        return ResolveDecision(accept=False, reason=REASON_NO_CANDIDATES)

    nearest_distance: float | None = None
    nearest_name: str | None = None
    for place in places:
        location = place.get("location") or {}
        lat, lng = location.get("latitude"), location.get("longitude")
        display_name = ((place.get("displayName") or {}).get("text")) or None
        if lat is None or lng is None:
            continue
        distance = haversine_m(origin_lat, origin_lon, float(lat), float(lng))
        if nearest_distance is None or distance < nearest_distance:
            nearest_distance = distance
            nearest_name = display_name
        if distance <= max_distance_m:
            return ResolveDecision(
                accept=True,
                reason=REASON_ACCEPTED,
                place_id=place.get("id"),
                display_name=display_name,
                distance_m=distance,
                business_status=place.get("businessStatus"),
            )
        if address_matches(our_address_he, place.get("formattedAddress")):
            return ResolveDecision(
                accept=True,
                reason=REASON_ACCEPTED_STREET_MATCH,
                place_id=place.get("id"),
                display_name=display_name,
                distance_m=distance,
                business_status=place.get("businessStatus"),
            )

    if nearest_distance is None:
        return ResolveDecision(accept=False, reason=REASON_MISSING_LOCATION)

    return ResolveDecision(
        accept=False,
        reason=REASON_TOO_FAR,
        display_name=nearest_name,
        distance_m=nearest_distance,
    )
