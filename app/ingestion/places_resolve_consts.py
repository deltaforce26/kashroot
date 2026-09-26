"""Constants for :mod:`app.ingestion.places_resolve`.

STANDARDS.md: no plain strings/magic numbers in pipeline code — everything the
resolver needs by name lives here.
"""

from __future__ import annotations

PIPELINE = "places_resolve"
PIPELINE_VERSION = "1.0.0"
SOURCE = "google_places_text_search"

#: Candidates farther than this from the restaurant's own geocoded point are
#: rejected outright — a same-address neighbor is a different business, and
#: guessing which one this certifier listing means would violate the fail-safe
#: rule (doubt -> UNKNOWN / no write, never a guess).
MAX_DISTANCE_M = 150.0

#: How wide a net Text Search itself casts before we apply MAX_DISTANCE_M.
LOCATION_BIAS_RADIUS_M = 300.0

#: Google Places (New) closes a location; a candidate we would otherwise accept but
#: that Google itself marks closed is still recorded, just not silently treated as
#: equivalent to an open business — surfaced as a decision reason, not blocked.
BUSINESS_STATUS_OPERATIONAL = "OPERATIONAL"

MAX_RESULT_COUNT = 3
LANGUAGE_CODE = "he"
REGION_CODE = "IL"

#: decision reason -> human string for the dry-run table / CLI summary.
REASON_ACCEPTED = "accepted"
REASON_NO_GEO = "no_geo"
REASON_ALREADY_RESOLVED = "already_resolved"
REASON_NO_CANDIDATES = "no_candidates"
REASON_TOO_FAR = "too_far"
REASON_MISSING_LOCATION = "missing_location"
REASON_SKIPPED_CONCURRENT = "skipped_concurrent"
