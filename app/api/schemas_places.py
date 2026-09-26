"""Pydantic schemas for the Google Places enrichment endpoints — ``/v1/restaurants/{id}/places``
and ``/v1/restaurants/{id}/photos/{index}``.

This is the response contract the web frontend builds against concurrently; field
names here are load-bearing and must not drift from it. Photos are never kashrut
evidence (CLAUDE.md, locked) — nothing in this module is written to, or read from,
``CertificatePhotoSlot`` or any certificate table.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.services.places_consts import PROVIDER_GOOGLE


class PhotoAttributionOut(BaseModel):
    """One required Google Places attribution for a single photo."""

    display_name: str
    uri: str | None = None


class PlacePhotoOut(BaseModel):
    """One photo slot. ``url`` is this API's own redirecting endpoint, never a raw
    Google URL — the client never sees a ``photoUri`` or an API key.
    """

    index: int
    width_px: int | None = None
    height_px: int | None = None
    url: str
    attributions: list[PhotoAttributionOut] = Field(default_factory=list)


class HoursRangeOut(BaseModel):
    """One open/close clock-time pair within a day row."""

    open: str
    close: str


class PlaceHoursDayOut(BaseModel):
    """One Sunday-first day row (``day`` 0=Sunday..6=Saturday)."""

    day: int
    ranges: list[HoursRangeOut] = Field(default_factory=list)
    closed: bool
    always_open: bool


class PlaceHoursOut(BaseModel):
    """ "Right now" plus the full week, all in Israel local time."""

    open_now: bool | None = None
    closes_at: str | None = None
    opens_at: str | None = None
    today: int
    days: list[PlaceHoursDayOut]
    weekday_descriptions: list[str] = Field(default_factory=list)


class PlacesEnrichmentOut(BaseModel):
    """Response for ``GET /v1/restaurants/{id}/places``.

    ``place_id_known=False`` and ``hours=None``/``photos=[]`` are all degraded-but-
    successful shapes (fail-open for availability, never an error) — a restaurant
    with no ``google_place_id``, or a Google/network failure, still returns 200 so
    the caller's own kashrut verdict is never blocked on this endpoint.
    """

    place_id_known: bool
    provider: str = PROVIDER_GOOGLE
    photos: list[PlacePhotoOut] = Field(default_factory=list)
    hours: PlaceHoursOut | None = None
