"""Constants for the public (consumer-facing) API — ``/v1/*``.

STANDARDS.md: no plain strings/magic numbers in router or schema code — paging,
radius and error-message literals live here with informative names.
"""

from __future__ import annotations

#: Search paging.
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100

#: Search radius (kilometres) when a ``center`` is supplied.
DEFAULT_RADIUS_KM = 5.0
MIN_RADIUS_KM = 0.1
MAX_RADIUS_KM = 50.0

METERS_PER_KM = 1000.0

#: Mean Earth radius (km), for the haversine fallback distance used only when the DB
#: session is not bound to PostgreSQL, e.g. the SQLite-backed test suite (see
#: app.api.public._restaurant_distance_km / _haversine_km).
EARTH_RADIUS_KM = 6371.0088

#: Matches ``app.match.fit.FitPreferences``' own default half-distance (a walking-ish
#: context). The public API has no "mode" concept yet (POC scope), so every search
#: uses this single constant rather than importing the engine's dataclass default.
DEFAULT_HALF_DISTANCE_KM = 1.5

#: Safety cap on rows pulled from the database for one search before Layer 1/Layer 2
#: evaluation and pagination happen in Python. The full corpus is ~500 restaurants
#: (POC_PLAN.md), so this is generous headroom, not a real limit.
MAX_QUERY_ROWS = 1000

#: Free-text search (``SearchRequest.query``). Exact, case-insensitive SQL substring
#: match over name_he / name_en / address_he only — no fuzzy matching, no niqqud or
#: plene/defective spelling normalization. See app.api.public._escape_like_value.
MAX_SEARCH_QUERY_LENGTH = 200
LIKE_ESCAPE_CHAR = "\\"

ERROR_CENTER_OR_CITY_REQUIRED = "at least one of 'center' or 'city' must be provided"
ERROR_DUPLICATE_WHITELIST_CERTIFIER = "duplicate whitelist entry for certifier_id {certifier_id}"
ERROR_RESTAURANT_NOT_FOUND = "restaurant not found"
