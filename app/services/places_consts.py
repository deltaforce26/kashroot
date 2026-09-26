"""Constants for the Google Places (New) enrichment service.

STANDARDS.md: no plain strings/magic numbers in service or router code — URLs, field
masks, cache TTLs, photo widths and error/log strings live here with informative
names.
"""

from __future__ import annotations

#: Places (New) Place Details endpoint. ``{place_id}`` is interpolated by the caller.
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

#: Places (New) Photo Media endpoint. ``{photo_name}`` is the ``photos[].name`` value
#: returned by Place Details (already shaped ``places/{place_id}/photos/{photo_id}``).
PLACES_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

#: Only what the enrichment endpoint uses — never a broader mask (cost + PRD scope:
#: Google Places is never called from search lists, only a single restaurant's page).
PLACES_FIELD_MASK = "photos,regularOpeningHours,currentOpeningHours"

#: Hebrew results, matching the rest of the public API's Israel-first locale default.
PLACES_LANGUAGE_CODE = "he"

REQUEST_HEADER_API_KEY = "X-Goog-Api-Key"
REQUEST_HEADER_FIELD_MASK = "X-Goog-FieldMask"

DEFAULT_TIMEOUT_SECONDS = 10.0

#: Photo widths for ``GET /v1/restaurants/{id}/photos/{index}``.
DEFAULT_PHOTO_WIDTH_PX = 800
MIN_PHOTO_WIDTH_PX = 100
MAX_PHOTO_WIDTH_PX = 1600

#: Hard cap on photos returned by the enrichment endpoint (cost + payload size).
MAX_PHOTOS = 10

#: Cache TTL for both the place-details response and each resolved photo URI. Short
#: enough to keep ``currentOpeningHours.openNow`` fresh, well under Google's 30-day
#: cache cap on Places content, and — for photo URIs — inside the short lifetime of
#: the signed ``photoUri`` itself.
CACHE_TTL_SECONDS = 600

CACHE_KEY_PREFIX = "places"
CACHE_KEY_DETAILS_TEMPLATE = f"{CACHE_KEY_PREFIX}:details:{{place_id}}"
CACHE_KEY_PHOTO_TEMPLATE = f"{CACHE_KEY_PREFIX}:photo:{{place_id}}:{{index}}:{{width_px}}"

PROVIDER_GOOGLE = "google"

ERROR_RESTAURANT_NOT_FOUND = "restaurant not found"
ERROR_PHOTO_NOT_FOUND = "photo not found"

LOG_PLACES_REDIS_UNAVAILABLE = (
    "Places cache Redis backend unavailable at construction (%s); "
    "falling back to the in-process in-memory cache."
)
LOG_PLACES_REDIS_ERROR = (
    "Places cache Redis backend errored at runtime (%s); "
    "falling back to the in-process in-memory cache for this call."
)
LOG_PLACES_API_ERROR = "Google Places API call failed for restaurant %s (%s): %s"

#: Google weekday indices are 0=Sunday..6=Saturday, matching this app's Israel-first
#: Sunday-first convention (app.api.admin.consts.ISRAEL_TZ) — no reindexing needed.
DAYS_PER_WEEK = 7
MINUTES_PER_HOUR = 60
HOURS_PER_DAY = 24
