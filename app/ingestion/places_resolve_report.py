"""Request building, point extraction and result-reporting types for
:mod:`app.ingestion.places_resolve`. Pure — no I/O; split out to keep that module
within STANDARDS.md's 500-line cap.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from app.ingestion.places_resolve_consts import (
    LANGUAGE_CODE,
    LOCATION_RESTRICTION_HALF_SIDE_M,
    MAX_RESULT_COUNT,
    REGION_CODE,
)

#: Matches app.api.public._POINT_TEXT_PATTERN — the raw EWKT/WKT text
#: tests/conftest.py stores Restaurant.geo as (Geography is compiled to TEXT for
#: SQLite there; real PostGIS returns a geoalchemy2 WKBElement instead).
_POINT_TEXT_PATTERN = re.compile(r"POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)", re.IGNORECASE)

#: Meters per degree of latitude (WGS-84, spherical approximation) — used to convert
#: LOCATION_RESTRICTION_HALF_SIDE_M into the locationRestriction box's degree spans.
_METERS_PER_DEGREE_LAT = 111_320.0

#: Any ASCII or Hebrew digit — a house number. Malls and shopping centers
#: ("קניון רמות", "מרכז מסחרי נווה יעקב") are published with no street number at
#: all, so their geocoded point is the whole complex's centroid, not one storefront.
_DIGIT_PATTERN = re.compile(r"\d")


def _has_house_number(address_he: str | None) -> bool:
    """
    Whether an address cites a house number. Pure — no I/O.

    Parameters:
        address_he (str | None): The restaurant's Hebrew street address.

    Return:
        bool: ``True`` when the address contains at least one digit; ``False`` for a
            number-less address (a mall/complex name) or a missing address.
    """
    if not address_he:
        return False

    return bool(_DIGIT_PATTERN.search(address_he))


def extract_lat_lng(geo: Any) -> tuple[float, float] | None:
    """
    Extract (lat, lng) from a ``Restaurant.geo`` value.

    Handles both the real driver's value (a geoalchemy2 ``WKBElement`` against real
    PostGIS) and the raw EWKT/WKT string SQLite tests store, matching
    ``app.api.public._geo_point_out``.

    Parameters:
        geo (Any): The raw ``Restaurant.geo`` attribute value, or ``None``.

    Return:
        tuple[float, float] | None: ``(lat, lng)``, or ``None`` when there is no
            point.
    """
    if geo is None:
        return None
    if isinstance(geo, str):
        match = _POINT_TEXT_PATTERN.search(geo)
        if match is None:
            return None
        lon, lat = float(match.group(1)), float(match.group(2))

        return lat, lon

    from geoalchemy2.shape import to_shape

    shapely_point = to_shape(geo)

    return shapely_point.y, shapely_point.x


def build_text_query(name_he: str | None, address_he: str | None, city_he: str | None) -> str:
    """
    Build the Text Search ``textQuery`` (and its logging key): business name,
    street address, city — whichever parts exist.

    Parameters:
        name_he (str | None): The restaurant's Hebrew name.
        address_he (str | None): The restaurant's Hebrew street address.
        city_he (str | None): The restaurant's Hebrew city name.

    Return:
        str: The space-joined query text.
    """
    parts = [p for p in (name_he, address_he, city_he) if p]

    return " ".join(parts)


def _restriction_box(
    origin_lat: float, origin_lon: float, half_side_m: float
) -> tuple[dict[str, float], dict[str, float]]:
    """
    Compute the ``locationRestriction`` rectangle's ``low``/``high`` corners around a
    point, converting a metre half-side to degrees (longitude scaled by
    ``cos(latitude)``).

    Parameters:
        origin_lat (float): Box center latitude, degrees.
        origin_lon (float): Box center longitude, degrees.
        half_side_m (float): Half the box's side length, in meters.

    Return:
        tuple[dict[str, float], dict[str, float]]: ``(low, high)``, each
            ``{"latitude": ..., "longitude": ...}``.
    """
    lat_delta = half_side_m / _METERS_PER_DEGREE_LAT
    lon_delta = half_side_m / (_METERS_PER_DEGREE_LAT * math.cos(math.radians(origin_lat)))
    low = {"latitude": origin_lat - lat_delta, "longitude": origin_lon - lon_delta}
    high = {"latitude": origin_lat + lat_delta, "longitude": origin_lon + lon_delta}

    return low, high


def build_search_text_body(query: str, origin_lat: float, origin_lon: float) -> dict[str, Any]:
    """
    Build the Places (New) Text Search request body.

    Parameters:
        query (str): ``build_text_query``'s result.
        origin_lat (float): The restaurant's own geocoded latitude (the
            ``locationRestriction`` box's center).
        origin_lon (float): The restaurant's own geocoded longitude.

    Return:
        dict[str, Any]: The JSON request body. ``locationRestriction`` is a hard
            ``LOCATION_RESTRICTION_HALF_SIDE_M``-metre box, not the soft bias circle
            this used before — a chain business's nearby branch is kept in scope even
            when it would never rank in Google's own top results for a bias-only
            query.
    """
    low, high = _restriction_box(origin_lat, origin_lon, LOCATION_RESTRICTION_HALF_SIDE_M)

    return {
        "textQuery": query,
        "languageCode": LANGUAGE_CODE,
        "regionCode": REGION_CODE,
        "locationRestriction": {"rectangle": {"low": low, "high": high}},
        "maxResultCount": MAX_RESULT_COUNT,
    }


@dataclass
class ResolveRow:
    """One restaurant's outcome — what the CLI's dry-run table prints."""

    restaurant_id: str
    name_he: str
    candidate_name: str | None
    distance_m: float | None
    decision: str
    radius_m: float | None = None
    address_he: str | None = None
    lat: float | None = None
    lng: float | None = None


@dataclass
class ResolveStats:
    candidates: int = 0
    already_resolved: int = 0
    excluded_no_geo: int = 0
    api_calls: int = 0
    accepted: int = 0
    rejected: int = 0
    skipped_concurrent: int = 0
    #: Seed-CSV-sourced ids ``--force`` declined to re-search (never re-searched).
    protected_seed: int = 0
    reasons: dict[str, int] = field(default_factory=dict)
    rows: list[ResolveRow] = field(default_factory=list)

    def note_reason(self, reason: str) -> None:
        self.reasons[reason] = self.reasons.get(reason, 0) + 1

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result.pop("rows")

        return result
