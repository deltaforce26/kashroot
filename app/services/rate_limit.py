"""Reusable per-client-IP fixed-window rate limiting for anonymous public endpoints.

Applied for now only to the anonymous certificate-photo upload
(``app.api.public_photos.upload_public_certificate_photo``); built as a generic
FastAPI dependency factory (:func:`rate_limiter`) so the community-flag endpoint can
adopt the same mechanism later without duplicating it.

Backend: a fixed-window counter, keyed ``{prefix}:{scope}:{window_seconds}:{ip}``.
Redis (``settings.redis_url``) is the primary backend so counts are shared across
worker processes; an in-process, in-memory backend is the fallback used when Redis is
unreachable or when a runtime call to it errors, so dev and tests need no Redis
daemon at all. Falling back on a Redis error is a deliberate fail-open: kashrut
fail-safe (PRD §13) governs match *results*, not endpoint availability, and the
upload endpoint's own guards (one pending photo per certificate, image-only,
size cap) still apply regardless of which counter backend served the request.

The backend is resolved through a FastAPI dependency (:func:`get_rate_limit_backend`)
so tests can override it with a fake, and every backend takes an injectable clock (or,
for Redis, the wall clock) so a test can advance time deterministically without
sleeping.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from fastapi import Depends, HTTPException, Request, status

from app.api.consts import ERROR_RATE_LIMITED
from app.core.config import settings
from app.services.rate_limit_consts import (
    DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY,
    DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR,
    LOG_RATE_LIMIT_REDIS_ERROR,
    LOG_RATE_LIMIT_REDIS_UNAVAILABLE,
    RATE_LIMIT_KEY_PREFIX,
    RATE_LIMIT_REDIS_CONNECT_TIMEOUT_SECONDS,
    RATE_LIMIT_REDIS_SOCKET_TIMEOUT_SECONDS,
    RATE_LIMIT_WINDOW_DAY_SECONDS,
    RATE_LIMIT_WINDOW_HOUR_SECONDS,
    UNKNOWN_CLIENT_IDENTIFIER,
)

logger = logging.getLogger(__name__)


class RateLimitBackend(Protocol):
    """A fixed-window request counter shared by every caller of one ``key``."""

    def incr(self, key: str, window_seconds: int) -> tuple[int, int]:
        """
        Increment ``key``'s counter for the current fixed window and return it.

        Parameters:
            key (str): The counter's identity (already scoped to endpoint + client).
            window_seconds (int): The fixed-window length, in seconds.

        Return:
            tuple[int, int]: ``(count, retry_after_seconds)`` — the counter's value
                after this increment, and the number of seconds remaining until the
                current window resets.
        """
        ...


class InMemoryRateLimitBackend:
    """Single-process fixed-window counter, keyed by ``(key, window_start)``.

    Counters are never evicted, so this is a dev/test fallback only — a long-running
    process backed solely by this class would grow its counter dict without bound.
    Production always prefers Redis; see :func:`get_rate_limit_backend`.
    """

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        """
        Build the backend.

        Parameters:
            clock (Callable[[], float]): Returns the current time, as
                ``time.time()`` would. Overridable so tests can move the window
                deterministically.

        Return:
            None
        """
        self._clock = clock
        self._counters: dict[tuple[str, int], int] = {}

    def incr(self, key: str, window_seconds: int) -> tuple[int, int]:
        """
        Increment ``key``'s counter for the window containing ``self._clock()``.

        Parameters:
            key (str): The counter's identity.
            window_seconds (int): The fixed-window length, in seconds.

        Return:
            tuple[int, int]: ``(count, retry_after_seconds)``.
        """
        now = self._clock()
        window_start = int(now // window_seconds) * window_seconds
        counter_key = (key, window_start)
        count = self._counters.get(counter_key, 0) + 1
        self._counters[counter_key] = count
        retry_after = int(window_start + window_seconds - now) + 1

        return count, retry_after


class RedisRateLimitBackend:
    """Fixed-window counter backed by Redis (``INCR`` + ``EXPIRE``), shared across
    every worker process. Never constructed eagerly at import time — see
    :func:`_build_redis_backend`.
    """

    def __init__(self, client: object) -> None:
        """
        Wrap an already-constructed ``redis.Redis`` client.

        Parameters:
            client (object): A ``redis.Redis``-compatible synchronous client. Typed
                ``object`` here so this module has no hard import-time dependency on
                the ``redis`` package's types.

        Return:
            None
        """
        self._client = client

    def incr(self, key: str, window_seconds: int) -> tuple[int, int]:
        """
        Increment ``key``'s counter for the current wall-clock window in Redis.

        Parameters:
            key (str): The counter's identity.
            window_seconds (int): The fixed-window length, in seconds.

        Return:
            tuple[int, int]: ``(count, retry_after_seconds)``.
        """
        now = time.time()
        window_start = int(now // window_seconds) * window_seconds
        redis_key = f"{key}:{window_start}"
        pipeline = self._client.pipeline()
        pipeline.incr(redis_key)
        pipeline.expire(redis_key, window_seconds)
        count, _ = pipeline.execute()
        retry_after = int(window_start + window_seconds - now) + 1

        return int(count), retry_after


class HybridRateLimitBackend:
    """Tries ``primary`` (Redis) first; any exception falls back to ``fallback``
    (in-memory) for that one call, logging the error rather than failing the request.
    """

    def __init__(self, primary: RateLimitBackend | None, fallback: RateLimitBackend) -> None:
        """
        Build the hybrid backend.

        Parameters:
            primary (RateLimitBackend | None): The preferred backend, or ``None``
                when Redis could not be constructed at all (unset/unreachable at
                startup) — every call then goes straight to ``fallback``.
            fallback (RateLimitBackend): The always-available backend.

        Return:
            None
        """
        self._primary = primary
        self._fallback = fallback

    def incr(self, key: str, window_seconds: int) -> tuple[int, int]:
        """
        Increment via ``primary``, falling back to ``fallback`` on any error.

        Parameters:
            key (str): The counter's identity.
            window_seconds (int): The fixed-window length, in seconds.

        Return:
            tuple[int, int]: ``(count, retry_after_seconds)``.
        """
        if self._primary is not None:
            try:
                return self._primary.incr(key, window_seconds)
            except Exception as exc:  # noqa: BLE001 - fail-open by design, see module docstring
                logger.warning(LOG_RATE_LIMIT_REDIS_ERROR, exc)

        return self._fallback.incr(key, window_seconds)


def _build_redis_backend() -> RateLimitBackend | None:
    """
    Construct a :class:`RedisRateLimitBackend` from ``settings.redis_url``.

    Parameters:
        None

    Return:
        RateLimitBackend | None: The backend, or ``None`` when the ``redis`` package
            is unavailable, no URL is configured, or the client cannot be built —
            callers treat ``None`` the same as a Redis that always errors.
    """
    if not settings.redis_url:
        return None

    try:
        import redis as redis_module

        client = redis_module.Redis.from_url(
            settings.redis_url,
            socket_timeout=RATE_LIMIT_REDIS_SOCKET_TIMEOUT_SECONDS,
            socket_connect_timeout=RATE_LIMIT_REDIS_CONNECT_TIMEOUT_SECONDS,
        )

        return RedisRateLimitBackend(client)
    except Exception as exc:  # noqa: BLE001 - fail-open by design, see module docstring
        logger.warning(LOG_RATE_LIMIT_REDIS_UNAVAILABLE, exc)

        return None


@lru_cache
def _default_backend() -> HybridRateLimitBackend:
    """
    Build the process-lifetime default backend (Redis-primary, memory-fallback).

    Parameters:
        None

    Return:
        HybridRateLimitBackend: The shared backend instance.
    """
    return HybridRateLimitBackend(
        primary=_build_redis_backend(), fallback=InMemoryRateLimitBackend()
    )


def get_rate_limit_backend() -> RateLimitBackend:
    """FastAPI dependency for the rate-limit counter backend. Tests override this
    with a fake (``app.dependency_overrides[get_rate_limit_backend]``) to control
    limits and simulate a clock or a Redis failure deterministically.
    """
    return _default_backend()


def get_client_identifier(request: Request) -> str:
    """
    Resolve the identifier a rate limit is keyed on for one request.

    Reads the first hop of ``X-Forwarded-For`` only when
    ``settings.trust_proxy_headers`` is true (the app sits behind a proxy that sets
    it) — otherwise a client can spoof its rate-limit identity by sending its own
    forged header. With nothing usable, every such request shares one bucket rather
    than bypassing the limit.

    Parameters:
        request (Request): The incoming request.

    Return:
        str: The client identifier to key rate-limit counters on.
    """
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            first_hop = forwarded_for.split(",")[0].strip()
            if first_hop:
                return first_hop

    if request.client is not None and request.client.host:
        return request.client.host

    return UNKNOWN_CLIENT_IDENTIFIER


@dataclass(frozen=True)
class RateLimitRule:
    """One fixed-window limit: at most ``limit`` requests per ``window_seconds``."""

    limit: int
    window_seconds: int


def photo_upload_rate_limit_rules() -> list[RateLimitRule]:
    """
    Build the current rate-limit rules for the anonymous photo-upload endpoint.

    Read from ``settings`` on every call (not cached) so tests can lower the limits
    via ``monkeypatch.setattr(settings, ...)`` per test.

    Parameters:
        None

    Return:
        list[RateLimitRule]: The per-hour and per-day rules to enforce, in that order.
    """
    return [
        RateLimitRule(settings.photo_upload_rate_limit_per_hour, RATE_LIMIT_WINDOW_HOUR_SECONDS),
        RateLimitRule(settings.photo_upload_rate_limit_per_day, RATE_LIMIT_WINDOW_DAY_SECONDS),
    ]


def rate_limiter(
    scope: str, rules: Callable[[], list[RateLimitRule]]
) -> Callable[[Request, RateLimitBackend], None]:
    """
    Build a FastAPI dependency enforcing every rule in ``rules()`` for one scope.

    The attempt is counted against every rule before any rule is checked, so a
    request that trips the per-day limit still increments the per-hour counter (and
    vice versa) exactly once each — matching "count the attempt" regardless of which
    limit ultimately rejects it.

    Parameters:
        scope (str): Names this dependency's endpoint in the counter key (e.g.
            ``"photo_upload"``), so it cannot collide with another endpoint's limiter
            sharing the same backend.
        rules (Callable[[], list[RateLimitRule]]): Returns the rules to enforce,
            called once per request (not at decoration time) so live settings changes
            and test monkeypatches take effect immediately.

    Return:
        Callable[[Request, RateLimitBackend], None]: A FastAPI dependency function
            that raises ``HTTPException(429)`` when any rule is exceeded.
    """

    def _check_rate_limit(
        request: Request,
        backend: RateLimitBackend = Depends(get_rate_limit_backend),
    ) -> None:
        """
        Count this request against every configured rule and enforce all of them.

        Parameters:
            request (Request): The incoming request, used to key the counter.
            backend (RateLimitBackend): The counter backend (injected).

        Return:
            None
        """
        identifier = get_client_identifier(request)
        violations: list[tuple[RateLimitRule, int]] = []
        for rule in rules():
            key = f"{RATE_LIMIT_KEY_PREFIX}:{scope}:{rule.window_seconds}:{identifier}"
            count, retry_after = backend.incr(key, rule.window_seconds)
            if count > rule.limit:
                violations.append((rule, retry_after))

        if violations:
            retry_after = max(retry_after for _, retry_after in violations)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail=ERROR_RATE_LIMITED,
                headers={"Retry-After": str(retry_after)},
            )

    return _check_rate_limit


require_photo_upload_rate_limit = rate_limiter("photo_upload", photo_upload_rate_limit_rules)

__all__ = [
    "DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY",
    "DEFAULT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR",
    "HybridRateLimitBackend",
    "InMemoryRateLimitBackend",
    "RateLimitBackend",
    "RateLimitRule",
    "RedisRateLimitBackend",
    "get_client_identifier",
    "get_rate_limit_backend",
    "photo_upload_rate_limit_rules",
    "rate_limiter",
    "require_photo_upload_rate_limit",
]
