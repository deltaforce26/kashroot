"""Constants for :mod:`app.ingestion.places_resolve`.

STANDARDS.md: no plain strings/magic numbers in pipeline code — everything the
resolver needs by name lives here.
"""

from __future__ import annotations

PIPELINE = "places_resolve"
PIPELINE_VERSION = "1.0.0"
SOURCE = "google_places_text_search"

#: ``Restaurant.business_place_source`` values (app.models.restaurant). The seed CSV
#: value is never overwritten by ``--force`` re-searches; see ``BUSINESS_PLACE_SOURCE_TEXT_SEARCH``,
#: which reuses ``SOURCE`` so the two names always agree.
BUSINESS_PLACE_SOURCE_SEED_CSV = "seed_csv"
BUSINESS_PLACE_SOURCE_TEXT_SEARCH = SOURCE

#: Candidates farther than this from the restaurant's own geocoded point are
#: rejected outright — a same-address neighbor is a different business, and
#: guessing which one this certifier listing means would violate the fail-safe
#: rule (doubt -> UNKNOWN / no write, never a guess).
MAX_DISTANCE_M = 150.0

#: Wider acceptance radius for addresses with no house number (malls, shopping
#: centers: "קניון רמות", "מרכז מסחרי נווה יעקב") — the restaurant's own geocoded
#: point there is the whole complex's centroid, so a business inside it legitimately
#: sits farther than MAX_DISTANCE_M away. See ``_has_house_number``.
MAX_DISTANCE_NO_HOUSE_NUMBER_M = 400.0

#: Half the side length of the ``locationRestriction`` search box Text Search is
#: confined to, around the restaurant's own geocoded point — a *hard* box (unlike the
#: old soft ``locationBias`` circle), so a same-name chain branch a few streets away
#: is still in scope even though it never makes Google's top results for a bias-only
#: query. See ``address_matches``/``classify_candidates`` for the acceptance check
#: once candidates in this box come back.
LOCATION_RESTRICTION_HALF_SIDE_M = 1000.0

#: Google Places (New) closes a location; a candidate we would otherwise accept but
#: that Google itself marks closed is still recorded, just not silently treated as
#: equivalent to an open business — surfaced as a decision reason, not blocked.
BUSINESS_STATUS_OPERATIONAL = "OPERATIONAL"

#: Widened from 3: a chain bakery's nearby branch competes with every other branch in
#: the 1km restriction box for Google's ranking, so a low top-N cuts it before we ever
#: see it to classify.
MAX_RESULT_COUNT = 10
LANGUAGE_CODE = "he"
REGION_CODE = "IL"

#: decision reason -> human string for the dry-run table / CLI summary.
REASON_ACCEPTED = "accepted"
#: Accepted beyond the radius because formattedAddress named the same street +
#: house number as our own address — a same-name chain branch, not a guess.
REASON_ACCEPTED_STREET_MATCH = "accepted_street_match"
REASON_NO_GEO = "no_geo"
REASON_ALREADY_RESOLVED = "already_resolved"
REASON_NO_CANDIDATES = "no_candidates"
REASON_TOO_FAR = "too_far"
REASON_MISSING_LOCATION = "missing_location"
REASON_SKIPPED_CONCURRENT = "skipped_concurrent"
