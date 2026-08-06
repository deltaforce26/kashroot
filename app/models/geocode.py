"""Geocode response cache.

One row per normalized geocode query string, storing the **raw** provider response as
returned (JSONB). Two jobs:

* **Billing guard** — re-runs of the geocoding pipeline resolve from this table and
  never re-bill Google for a query already answered.
* **Evidence** — an accepted point's audit entry references the cache row holding the
  exact API response it was derived from (no-silent-guessing NFR: the raw material for
  every automated decision stays inspectable).

Rows are written even for ZERO_RESULTS — "Google could not find it" is itself a cached,
billable answer. Abort statuses (OVER_QUERY_LIMIT / REQUEST_DENIED) are never cached:
they describe the run, not the query.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class GeocodeCache(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "geocode_cache"

    #: Normalized query string (address + city as sent to the provider) — the cache key.
    query: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    #: Which provider answered (only google_geocoding today; the column keeps the cache
    #: honest if a second provider ever appears).
    provider: Mapped[str] = mapped_column(
        String(60), nullable=False, server_default="google_geocoding"
    )
    #: Provider status verbatim (OK, ZERO_RESULTS, …).
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    #: The raw response body, untouched.
    response: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)


__all__ = ["GeocodeCache"]
