"""Cache for Google Places (New) responses — mirrors ``app.services.rate_limit``'s
Redis-primary, in-memory-fallback shape.

Nothing here is ever persisted to the database (locked decision, see the plan this
implements): every entry is a short-TTL cache row only, keyed by place id (and, for
photos, index + width), never by restaurant id — several restaurants sharing one
Google place would share its cache entry, which is correct since the underlying
Google data is identical.
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from typing import Any, Protocol

from app.core.config import settings
from app.services.places_consts import (
    CACHE_TTL_SECONDS,
    LOG_PLACES_REDIS_ERROR,
    LOG_PLACES_REDIS_UNAVAILABLE,
)

logger = logging.getLogger(__name__)


class PlacesCache(Protocol):
    """Anything that can get/set a JSON-serializable value under a string key."""

    def get(self, key: str) -> Any | None:  # pragma: no cover - protocol
        ...

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:  # pragma: no cover - protocol
        ...


class InMemoryPlacesCache:
    """Single-process TTL cache. Dev/test fallback and the always-available part of
    :class:`HybridPlacesCache`; entries past their TTL are dropped lazily, on read.
    """

    def __init__(self, clock: Any = time.time) -> None:
        """
        Build the cache.

        Parameters:
            clock (Callable[[], float]): Returns the current time, as ``time.time()``
                would. Overridable so tests can move the clock deterministically.

        Return:
            None
        """
        self._clock = clock
        self._entries: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        """
        Fetch ``key``, or ``None`` when absent or expired.

        Parameters:
            key (str): The cache key.

        Return:
            Any | None: The cached value, or ``None``.
        """
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if self._clock() >= expires_at:
            del self._entries[key]

            return None

        return value

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        """
        Store ``value`` under ``key`` for ``ttl_seconds``.

        Parameters:
            key (str): The cache key.
            value (Any): The value to store.
            ttl_seconds (int): How long the entry stays valid.

        Return:
            None
        """
        self._entries[key] = (self._clock() + ttl_seconds, value)


class RedisPlacesCache:
    """JSON-serialized cache backed by Redis ``SETEX`` / ``GET``, shared across every
    worker process.
    """

    def __init__(self, client: object) -> None:
        """
        Wrap an already-constructed ``redis.Redis`` client.

        Parameters:
            client (object): A ``redis.Redis``-compatible synchronous client. Typed
                ``object`` so this module has no hard import-time dependency on the
                ``redis`` package's types.

        Return:
            None
        """
        self._client = client

    def get(self, key: str) -> Any | None:
        """
        Fetch and JSON-decode ``key`` from Redis.

        Parameters:
            key (str): The cache key.

        Return:
            Any | None: The decoded value, or ``None`` when absent.
        """
        raw = self._client.get(key)
        if raw is None:
            return None

        return json.loads(raw)

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        """
        JSON-encode ``value`` and store it under ``key`` with a Redis expiry.

        Parameters:
            key (str): The cache key.
            value (Any): The value to store; must be JSON-serializable.
            ttl_seconds (int): The Redis key expiry, in seconds.

        Return:
            None
        """
        self._client.setex(key, ttl_seconds, json.dumps(value))


class HybridPlacesCache:
    """Tries ``primary`` (Redis) first; any exception on either ``get`` or ``set``
    falls back to ``fallback`` (in-memory) for that one call, fail-open (a Places
    cache miss costs a Google call, never correctness).
    """

    def __init__(self, primary: PlacesCache | None, fallback: PlacesCache) -> None:
        """
        Build the hybrid cache.

        Parameters:
            primary (PlacesCache | None): The preferred cache, or ``None`` when
                Redis could not be constructed at all — every call then goes
                straight to ``fallback``.
            fallback (PlacesCache): The always-available cache.

        Return:
            None
        """
        self._primary = primary
        self._fallback = fallback

    def get(self, key: str) -> Any | None:
        """
        Read via ``primary``, falling back to ``fallback`` on any error.

        Parameters:
            key (str): The cache key.

        Return:
            Any | None: The cached value, or ``None``.
        """
        if self._primary is not None:
            try:
                return self._primary.get(key)
            except Exception as exc:  # noqa: BLE001 - fail-open by design, see class docstring
                logger.warning(LOG_PLACES_REDIS_ERROR, exc)

        return self._fallback.get(key)

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        """
        Write via ``primary`` and ``fallback`` alike, so a later Redis outage does
        not orphan a value only ``primary`` ever received.

        Parameters:
            key (str): The cache key.
            value (Any): The value to store.
            ttl_seconds (int): How long the entry stays valid.

        Return:
            None
        """
        if self._primary is not None:
            try:
                self._primary.set(key, value, ttl_seconds)
            except Exception as exc:  # noqa: BLE001 - fail-open by design, see class docstring
                logger.warning(LOG_PLACES_REDIS_ERROR, exc)
        self._fallback.set(key, value, ttl_seconds)


def _build_redis_cache() -> PlacesCache | None:
    """
    Construct a :class:`RedisPlacesCache` from ``settings.redis_url``.

    Parameters:
        None

    Return:
        PlacesCache | None: The cache, or ``None`` when the ``redis`` package is
            unavailable, no URL is configured, or the client cannot be built.
    """
    if not settings.redis_url:
        return None

    try:
        import redis as redis_module

        client = redis_module.Redis.from_url(settings.redis_url)

        return RedisPlacesCache(client)
    except Exception as exc:  # noqa: BLE001 - fail-open by design, see module docstring
        logger.warning(LOG_PLACES_REDIS_UNAVAILABLE, exc)

        return None


@lru_cache
def _default_cache() -> HybridPlacesCache:
    """
    Build the process-lifetime default cache (Redis-primary, memory-fallback).

    Parameters:
        None

    Return:
        HybridPlacesCache: The shared cache instance.
    """
    return HybridPlacesCache(primary=_build_redis_cache(), fallback=InMemoryPlacesCache())


def get_places_cache() -> PlacesCache:
    """FastAPI-dependency-shaped accessor for the shared Places cache. Tests override
    it directly by constructing their own :class:`InMemoryPlacesCache` and passing it
    to :class:`app.services.places.PlacesService`.
    """
    return _default_cache()


__all__ = [
    "CACHE_TTL_SECONDS",
    "HybridPlacesCache",
    "InMemoryPlacesCache",
    "PlacesCache",
    "RedisPlacesCache",
    "get_places_cache",
]
