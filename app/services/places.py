"""Google Places (New) enrichment — photos and opening hours for one restaurant's
detail page.

Sibling of :mod:`app.ingestion.geocode`: same shape of Google client (``httpx.Client``,
an injectable ``transport`` for tests, sanitized errors that never leak the API key),
but this is a read path called from the public API on every restaurant-detail page
view, not a batch ingestion pipeline — so nothing here writes to the database.
Photos and hours are cached (:mod:`app.services.places_cache`) and never persisted;
Google Places is never called from a search/list endpoint (cost + PRD scope).

Fail-open by design: an unset key, an unknown ``place_id``, or any Google/network
failure all degrade to an empty enrichment (``photos=[]``, ``hours=None``) rather
than raising past this module — the caller's own kashrut verdict must never wait on,
or fail because of, Google Places.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from functools import lru_cache
from typing import Any, Protocol

import httpx

from app.api.schemas_places import (
    HoursRangeOut,
    PhotoAttributionOut,
    PlaceHoursDayOut,
    PlaceHoursOut,
    PlacePhotoOut,
    PlacesEnrichmentOut,
)
from app.core.config import settings
from app.services.places_cache import PlacesCache, get_places_cache
from app.services.places_consts import (
    CACHE_KEY_DETAILS_TEMPLATE,
    CACHE_KEY_PHOTO_TEMPLATE,
    CACHE_TTL_SECONDS,
    DEFAULT_PHOTO_WIDTH_PX,
    DEFAULT_TIMEOUT_SECONDS,
    LOG_PLACES_API_ERROR,
    MAX_PHOTOS,
    PLACES_DETAILS_URL,
    PLACES_FIELD_MASK,
    PLACES_LANGUAGE_CODE,
    PLACES_PHOTO_MEDIA_URL,
    PLACES_TEXT_SEARCH_FIELD_MASK,
    PLACES_TEXT_SEARCH_URL,
    REQUEST_HEADER_API_KEY,
    REQUEST_HEADER_FIELD_MASK,
)
from app.services.places_hours import day_rows, open_state, parse_periods, today_index

logger = logging.getLogger(__name__)


class PlacesError(RuntimeError):
    """Raised by :class:`GooglePlacesClient` on any failed call. Always sanitized —
    never carries the API key, even via a chained exception (every raise uses
    ``from None``, matching ``app.ingestion.geocode.GoogleGeocoder``).
    """


class PlacesClient(Protocol):
    """Anything that can answer the two Google Places (New) calls this service
    needs. :class:`GooglePlacesClient` is the real implementation; tests may supply
    a fake instead.
    """

    def place_details(self, place_id: str) -> dict[str, Any]:  # pragma: no cover - protocol
        ...

    def photo_uri(self, photo_name: str, max_width_px: int) -> str:  # pragma: no cover - protocol
        ...

    def search_text(self, body: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover - protocol
        ...


class GooglePlacesClient:
    """Google Places (New) HTTP client: Place Details + Photo Media, Hebrew results
    (``languageCode=he``), field-masked to exactly what this service uses.
    """

    def __init__(
        self,
        api_key: str,
        *,
        timeout_s: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """
        Build the client.

        Parameters:
            api_key (str): The server-side Places API key.
            timeout_s (float): Per-request timeout, in seconds.
            transport (httpx.BaseTransport | None): Injectable transport (tests use
                ``httpx.MockTransport``); ``None`` uses the real network.

        Return:
            None
        """
        if not api_key:
            raise PlacesError("GooglePlacesClient requires an API key")
        self._api_key = api_key
        self._client = httpx.Client(timeout=timeout_s, transport=transport)

    def place_details(self, place_id: str) -> dict[str, Any]:
        """
        Fetch Place Details for ``place_id``, field-masked to photos and hours.

        Never lets an httpx exception escape unsanitized: transport-level errors
        can embed the request (headers included, in some httpx versions) and are
        re-raised with only the exception type name.

        Parameters:
            place_id (str): The Google place id.

        Return:
            dict[str, Any]: The raw Place Details JSON.
        """
        url = PLACES_DETAILS_URL.format(place_id=place_id)
        headers = {
            REQUEST_HEADER_API_KEY: self._api_key,
            REQUEST_HEADER_FIELD_MASK: PLACES_FIELD_MASK,
        }
        params = {"languageCode": PLACES_LANGUAGE_CODE}
        try:
            response = self._client.get(url, params=params, headers=headers)
        except httpx.RequestError as exc:
            # ``from None``: the chained httpx exception may carry the request.
            raise PlacesError(
                f"network error ({type(exc).__name__}) fetching place details {place_id!r}"
            ) from None
        if response.is_error:
            raise PlacesError(
                f"Google Places API returned HTTP {response.status_code} "
                f"for place details {place_id!r}"
            )

        return response.json()

    def photo_uri(self, photo_name: str, max_width_px: int) -> str:
        """
        Resolve one photo's short-lived ``photoUri`` via Photo Media.

        Parameters:
            photo_name (str): The ``photos[].name`` value from Place Details
                (``places/{place_id}/photos/{photo_id}``).
            max_width_px (int): The ``maxWidthPx`` to request.

        Return:
            str: The ``photoUri`` to redirect the client to.
        """
        url = PLACES_PHOTO_MEDIA_URL.format(photo_name=photo_name)
        headers = {REQUEST_HEADER_API_KEY: self._api_key}
        params = {"maxWidthPx": max_width_px, "skipHttpRedirect": "true"}
        try:
            response = self._client.get(url, params=params, headers=headers)
        except httpx.RequestError as exc:
            raise PlacesError(
                f"network error ({type(exc).__name__}) fetching photo media {photo_name!r}"
            ) from None
        if response.is_error:
            raise PlacesError(
                f"Google Places API returned HTTP {response.status_code} "
                f"for photo media {photo_name!r}"
            )
        data = response.json()
        photo_uri = data.get("photoUri")
        if not photo_uri:
            raise PlacesError(f"Google Places API photo media had no photoUri for {photo_name!r}")

        return photo_uri

    def search_text(self, body: dict[str, Any]) -> dict[str, Any]:
        """
        Call Places (New) Text Search, field-masked to id/name/location/status.

        Used only by ``app.ingestion.places_resolve`` to find a restaurant's
        *business* place id — never from a request-serving path.

        Parameters:
            body (dict[str, Any]): The request JSON (``textQuery``, ``languageCode``,
                ``regionCode``, ``locationBias``, ``maxResultCount``).

        Return:
            dict[str, Any]: The raw Text Search JSON (``places``: a list).
        """
        headers = {
            REQUEST_HEADER_API_KEY: self._api_key,
            REQUEST_HEADER_FIELD_MASK: PLACES_TEXT_SEARCH_FIELD_MASK,
        }
        try:
            response = self._client.post(PLACES_TEXT_SEARCH_URL, json=body, headers=headers)
        except httpx.RequestError as exc:
            raise PlacesError(
                f"network error ({type(exc).__name__}) calling Places Text Search"
            ) from None
        if response.is_error:
            raise PlacesError(
                f"Google Places API returned HTTP {response.status_code} for Text Search"
            )

        return response.json()


class PlacesService:
    """Turns raw Google Places responses into the API's response schemas, with
    caching in front of every Google call.
    """

    def __init__(
        self,
        client: PlacesClient | None,
        cache: PlacesCache,
        clock: Any = lambda: dt.datetime.now(dt.UTC),
    ) -> None:
        """
        Build the service.

        Parameters:
            client (PlacesClient | None): The Google client, or ``None`` when no API
                key is configured — every call then degrades without ever reaching
                the network.
            cache (PlacesCache): The response/photo cache.
            clock (Callable[[], dt.datetime]): Returns "now"; overridable so tests
                can fix "open now" at a specific instant.

        Return:
            None
        """
        self._client = client
        self._cache = cache
        self._clock = clock

    def enrichment(self, restaurant_id: uuid.UUID, place_id: str | None) -> PlacesEnrichmentOut:
        """
        Build the full ``/places`` response for one restaurant.

        Parameters:
            restaurant_id (uuid.UUID): The restaurant, only used to build each
                photo's own redirect ``url``.
            place_id (str | None): ``Restaurant.google_place_id``.

        Return:
            PlacesEnrichmentOut: ``place_id_known=False`` with no photos/hours when
                ``place_id`` is ``None``; otherwise the resolved (possibly degraded)
                enrichment.
        """
        if place_id is None:
            return PlacesEnrichmentOut(place_id_known=False, photos=[], hours=None)

        details = self._get_details(place_id)
        if details is None:
            return PlacesEnrichmentOut(place_id_known=True, photos=[], hours=None)

        photos = self._build_photos(restaurant_id, details.get("photos") or [])
        hours = self._build_hours(details)

        return PlacesEnrichmentOut(place_id_known=True, photos=photos, hours=hours)

    def photo_redirect_uri(self, place_id: str | None, index: int, width_px: int) -> str | None:
        """
        Resolve the short-lived Google ``photoUri`` to redirect one photo request to.

        Parameters:
            place_id (str | None): ``Restaurant.google_place_id``.
            index (int): The photo's position, as returned by :meth:`enrichment`.
            width_px (int): The requested max width.

        Return:
            str | None: The Google ``photoUri``, or ``None`` when the restaurant has
                no place id, the index is out of range, or the call failed.
        """
        if place_id is None:
            return None

        details = self._get_details(place_id)
        if details is None:
            return None

        raw_photos = (details.get("photos") or [])[:MAX_PHOTOS]
        if index < 0 or index >= len(raw_photos):
            return None

        cache_key = CACHE_KEY_PHOTO_TEMPLATE.format(
            place_id=place_id, index=index, width_px=width_px
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        if self._client is None:
            return None

        photo_name = raw_photos[index]["name"]
        try:
            photo_uri = self._client.photo_uri(photo_name, width_px)
        except PlacesError as exc:
            logger.warning(LOG_PLACES_API_ERROR, place_id, "photo_media", exc)

            return None

        self._cache.set(cache_key, photo_uri, CACHE_TTL_SECONDS)

        return photo_uri

    def _get_details(self, place_id: str) -> dict[str, Any] | None:
        """
        Fetch Place Details for ``place_id``, cache-first.

        Parameters:
            place_id (str): The Google place id.

        Return:
            dict[str, Any] | None: The raw details, or ``None`` when there is no
                client (no key configured) or the call failed.
        """
        cache_key = CACHE_KEY_DETAILS_TEMPLATE.format(place_id=place_id)
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        if self._client is None:
            return None

        try:
            details = self._client.place_details(place_id)
        except PlacesError as exc:
            logger.warning(LOG_PLACES_API_ERROR, place_id, "place_details", exc)

            return None

        self._cache.set(cache_key, details, CACHE_TTL_SECONDS)

        return details

    def _build_photos(
        self, restaurant_id: uuid.UUID, raw_photos: list[dict[str, Any]]
    ) -> list[PlacePhotoOut]:
        """
        Convert raw ``photos[]`` metadata into this API's photo slots.

        Parameters:
            restaurant_id (uuid.UUID): The restaurant, for each photo's redirect url.
            raw_photos (list[dict[str, Any]]): Raw Place Details ``photos``.

        Return:
            list[PlacePhotoOut]: At most :data:`MAX_PHOTOS` slots.
        """
        photos: list[PlacePhotoOut] = []
        for index, raw_photo in enumerate(raw_photos[:MAX_PHOTOS]):
            attributions = [
                PhotoAttributionOut(
                    display_name=attribution.get("displayName", ""),
                    uri=attribution.get("uri"),
                )
                for attribution in raw_photo.get("authorAttributions") or []
            ]
            photos.append(
                PlacePhotoOut(
                    index=index,
                    width_px=raw_photo.get("widthPx"),
                    height_px=raw_photo.get("heightPx"),
                    url=(
                        f"/v1/restaurants/{restaurant_id}/photos/{index}?w={DEFAULT_PHOTO_WIDTH_PX}"
                    ),
                    attributions=attributions,
                )
            )

        return photos

    def _build_hours(self, details: dict[str, Any]) -> PlaceHoursOut | None:
        """
        Convert raw Place Details opening-hours fields into :class:`PlaceHoursOut`.

        Prefers ``currentOpeningHours`` (reflects near-term exceptions) over
        ``regularOpeningHours``; either shape carries the same ``periods`` /
        ``weekdayDescriptions`` fields.

        Parameters:
            details (dict[str, Any]): The raw Place Details JSON.

        Return:
            PlaceHoursOut | None: ``None`` when Google returned no hours at all.
        """
        raw_hours = details.get("currentOpeningHours") or details.get("regularOpeningHours")
        if raw_hours is None:
            return None

        periods = parse_periods(raw_hours.get("periods") or [])
        now = self._clock()
        state = open_state(periods, now)
        rows = [
            PlaceHoursDayOut(
                day=row.day,
                ranges=[HoursRangeOut(open=r.open, close=r.close) for r in row.ranges],
                closed=row.closed,
                always_open=row.always_open,
            )
            for row in day_rows(periods)
        ]

        return PlaceHoursOut(
            open_now=state.open_now,
            closes_at=state.closes_at,
            opens_at=state.opens_at,
            today=today_index(now),
            days=rows,
            weekday_descriptions=list(raw_hours.get("weekdayDescriptions") or []),
        )


@lru_cache
def _default_places_service() -> PlacesService:
    """
    Build the process-lifetime default :class:`PlacesService`.

    Reads ``settings.places_api_key`` lazily (only here, at construction), so
    importing this module never requires a key or opens an HTTP client.

    Parameters:
        None

    Return:
        PlacesService: The shared service instance.
    """
    api_key = settings.places_api_key
    client = GooglePlacesClient(api_key) if api_key else None

    return PlacesService(client=client, cache=get_places_cache())


def get_places_service() -> PlacesService:
    """FastAPI dependency for the Places enrichment service. Tests override this
    with a service built around a fake client/cache
    (``app.dependency_overrides[get_places_service]``).
    """
    return _default_places_service()
