"""Constants for per-IP rate limiting (``app.services.rate_limit``).

STANDARDS.md: no plain strings/magic values in code — window lengths, key prefixes,
log messages and defaults live here with informative names.
"""

from __future__ import annotations

RATE_LIMIT_WINDOW_HOUR_SECONDS = 3600
RATE_LIMIT_WINDOW_DAY_SECONDS = 86400

#: Defaults for ``KASHROOT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR`` / ``_PER_DAY`` (see
#: app.core.config.Settings and .env.example). Chosen to allow a handful of genuine
#: photo uploads from one IP without opening the endpoint to scripted abuse.
DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR = 5
DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY = 20

#: Defaults for ``KASHROOT_FLAG_REPORT_RATE_LIMIT_PER_HOUR`` / ``_PER_DAY`` (see
#: app.core.config.Settings and .env.example). Same shape as the photo-upload
#: limiter but a separate scope ("flag_report"), so the two endpoints keep
#: independent counters against the same client IP.
DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_HOUR = 5
DEFAULT_FLAG_REPORT_RATE_LIMIT_PER_DAY = 20

#: Identifies a request whose ``request.client`` is ``None`` (e.g. some test
#: clients/ASGI transports). All such requests share one bucket rather than bypassing
#: the limiter entirely.
UNKNOWN_CLIENT_IDENTIFIER = "unknown"

#: Redis socket timeouts for the rate-limit backend only. Short on purpose: a slow or
#: unreachable Redis must fall back to the in-memory backend quickly rather than
#: stalling the request (fail-open for availability; see module docstring).
RATE_LIMIT_REDIS_SOCKET_TIMEOUT_SECONDS = 1.0
RATE_LIMIT_REDIS_CONNECT_TIMEOUT_SECONDS = 1.0

RATE_LIMIT_KEY_PREFIX = "ratelimit"

LOG_RATE_LIMIT_REDIS_UNAVAILABLE = (
    "Rate-limit Redis backend unavailable at construction (%s); "
    "falling back to the in-process in-memory backend."
)
LOG_RATE_LIMIT_REDIS_ERROR = (
    "Rate-limit Redis backend errored at runtime (%s); "
    "falling back to the in-process in-memory backend for this request."
)
