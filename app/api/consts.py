"""Constants for the public (consumer-facing) API — ``/v1/*``.

STANDARDS.md: no plain strings/magic numbers in router or schema code — paging,
radius and error-message literals live here with informative names.
"""

from __future__ import annotations

from app.api.admin.consts import PHOTO_EXTENSIONS

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

#: ``SearchFilters.diet_types`` (multi-select kitchen filter). Bounded to the number
#: of ``DietType`` members — a longer list can only contain duplicates.
MAX_DIET_TYPES = 6

#: ``SearchFilters.certifier_ids`` (filter on certificate identity, not verdict).
#: Generous headroom over the certifier corpus so a legitimate "select most of them"
#: whitelist-style filter never hits the cap, while still rejecting a pathological
#: payload.
MAX_CERTIFIER_IDS = 200

#: ``SearchFilters.min_rating``. Bounds only — there is no restaurant rating data
#: anywhere in the corpus or schema, so the field is accepted and ignored (see the
#: field's own docstring and ``app.api.public.build_search_statement``).
MIN_RATING = 0.0
MAX_RATING = 5.0

ERROR_DUPLICATE_WHITELIST_CERTIFIER = "duplicate whitelist entry for certifier_id {certifier_id}"
ERROR_RESTAURANT_NOT_FOUND = "restaurant not found"

#: ``CertificateEvidenceOut.photo_status`` — the public detail response's tri-state
#: view of ``CertificateEvidencePhoto``: an accepted photo (``evidence_photo_key`` set
#: on the certificate), a photo awaiting moderator review, or neither.
PHOTO_STATUS_NONE = "none"
PHOTO_STATUS_PENDING = "pending"
PHOTO_STATUS_ACCEPTED = "accepted"

#: Actor label stamped on every write an anonymous public-API caller makes (evidence
#: photo uploads, flags) — there are no accounts yet (see ``app.api.deps`` docstring),
#: so this is the one actor name every such AuditLog / photo row carries.
PUBLIC_ANONYMOUS_ACTOR = "public:anonymous"

#: ``POST /v1/restaurants/{id}/certificate-photo`` only accepts images — unlike the
#: admin path (``app.api.admin.consts.PHOTO_EXTENSIONS``), PDF scans stay admin-only.
#: Derived from the admin allow-list so the two paths cannot silently drift apart.
IMAGE_ONLY_PHOTO_EXTENSIONS: dict[str, str] = {
    content_type: extension
    for content_type, extension in PHOTO_EXTENSIONS.items()
    if content_type != "application/pdf"
}

ERROR_PHOTO_EXISTS = "photo_exists"
ERROR_PHOTO_PENDING = "photo_pending"

#: ``POST /v1/restaurants/{id}/certificate-photo`` and ``.../flags`` both take an
#: explicit ``certificate_id`` — the client already knows which certificate card the
#: user is looking at (chosen by their own profile), so the server never re-derives
#: it. This is the 404 for one that does not belong to the named restaurant.
ERROR_CERTIFICATE_NOT_FOUND_FOR_RESTAURANT = "certificate not found for this restaurant"

#: ``FlagCreateRequest.message`` (POST /v1/restaurants/{id}/flags) — a short free-text
#: report, not a certificate-evidence document.
MAX_FLAG_MESSAGE_LENGTH = 1000

#: SEO endpoints (``app.api.public_seo``) — ``GET /v1/restaurants/{id}`` and
#: ``GET /v1/sitemap.xml``. Both are public, unauthenticated and profile-free
#: (Googlebot carries no kashrut profile).
CACHE_CONTROL_HEADER = "Cache-Control"
RESTAURANT_PUBLIC_CACHE_CONTROL = "public, max-age=300"
SITEMAP_CACHE_CONTROL = "public, max-age=3600"
SITEMAP_CONTENT_TYPE = "application/xml"
SITEMAP_XML_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"

#: sitemaps.org caps a single sitemap file at 50,000 URLs; the corpus is ~375
#: restaurants today so one file is enough. A larger corpus later needs a sitemap
#: *index* file instead (out of scope here — see app.api.public_seo.build_sitemap_xml).
SITEMAP_MAX_URLS = 50000

#: The web app's (Vite SPA) own client-side routes the sitemap points at — not this
#: API's paths.
WEB_ROUTE_HOME = "/"
WEB_ROUTE_RESTAURANT_TEMPLATE = "/r/{restaurant_id}"

#: Vercel sets these on an external rewrite — how the web app proxies /v1/* to this
#: API — used to recover the web app's own origin for absolute sitemap URLs when
#: ``settings.public_web_origin`` is unset. See
#: app.api.public_seo.resolve_public_web_origin.
FORWARDED_HOST_HEADER = "x-forwarded-host"
FORWARDED_PROTO_HEADER = "x-forwarded-proto"
DEFAULT_FORWARDED_PROTO = "https"
