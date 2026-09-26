"""Tests for ``app.services.places`` — offline via ``httpx.MockTransport``, mirroring
``tests/test_geocode.py``'s style for ``app.ingestion.geocode.GoogleGeocoder``.
"""

from __future__ import annotations

import datetime as dt
import unittest
import uuid

import httpx

from app.services.places import GooglePlacesClient, PlacesError, PlacesService
from app.services.places_cache import InMemoryPlacesCache
from app.services.places_consts import MAX_PHOTOS

FAKE_API_KEY = "test-places-key-should-never-leak"


def place_details_response(
    *,
    photo_count: int = 1,
    with_hours: bool = True,
) -> dict:
    photos = [
        {
            "name": f"places/abc123/photos/photo{i}",
            "widthPx": 1600,
            "heightPx": 900,
            "authorAttributions": [
                {"displayName": f"Author {i}", "uri": f"https://example.com/author{i}"}
            ],
        }
        for i in range(photo_count)
    ]
    result: dict = {"photos": photos}
    if with_hours:
        result["regularOpeningHours"] = {
            "periods": [
                {
                    "open": {"day": 0, "hour": 9, "minute": 0},
                    "close": {"day": 0, "hour": 17, "minute": 0},
                }
            ],
            "weekdayDescriptions": ["Sunday: 9:00 AM - 5:00 PM"],
        }
    return result


class RecordingTransportTests(unittest.TestCase):
    """``GooglePlacesClient`` itself: headers, key never in the URL, error mapping."""

    def _client(self, handler) -> GooglePlacesClient:
        transport = httpx.MockTransport(handler)
        return GooglePlacesClient(FAKE_API_KEY, transport=transport)

    def test_place_details_sends_key_header_and_field_mask(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["headers"] = request.headers
            captured["url"] = str(request.url)
            return httpx.Response(200, json=place_details_response())

        client = self._client(handler)
        client.place_details("place123")

        self.assertEqual(captured["headers"]["X-Goog-Api-Key"], FAKE_API_KEY)
        self.assertIn(
            "photos,regularOpeningHours,currentOpeningHours",
            captured["headers"]["X-Goog-FieldMask"],
        )
        self.assertNotIn(FAKE_API_KEY, captured["url"])
        self.assertIn("languageCode=he", captured["url"])

    def test_photo_uri_sends_skip_http_redirect(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(
                200, json={"name": "x", "photoUri": "https://lh3.example/photo.jpg"}
            )

        client = self._client(handler)
        uri = client.photo_uri("places/abc/photos/p1", 800)

        self.assertEqual(uri, "https://lh3.example/photo.jpg")
        self.assertIn("skipHttpRedirect=true", captured["url"])
        self.assertIn("maxWidthPx=800", captured["url"])

    def test_place_details_403_raises_places_error_without_key(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, json={"error": "denied"})

        client = self._client(handler)
        with self.assertRaises(PlacesError) as ctx:
            client.place_details("place123")
        self.assertNotIn(FAKE_API_KEY, str(ctx.exception))

    def test_place_details_500_raises_places_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "boom"})

        client = self._client(handler)
        with self.assertRaises(PlacesError):
            client.place_details("place123")

    def test_network_error_raises_places_error_without_key(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom", request=request)

        client = self._client(handler)
        with self.assertRaises(PlacesError) as ctx:
            client.place_details("place123")
        self.assertNotIn(FAKE_API_KEY, str(ctx.exception))

    def test_photo_media_missing_photo_uri_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"name": "x"})

        client = self._client(handler)
        with self.assertRaises(PlacesError):
            client.photo_uri("places/abc/photos/p1", 800)


class FakeClient:
    def __init__(self, details=None, photo_uri="https://lh3.example/photo.jpg", error=None):
        self.details = details or place_details_response()
        self._photo_uri = photo_uri
        self.error = error
        self.details_calls: list[str] = []
        self.photo_calls: list[tuple[str, int]] = []

    def place_details(self, place_id: str) -> dict:
        self.details_calls.append(place_id)
        if self.error:
            raise self.error
        return self.details

    def photo_uri(self, photo_name: str, max_width_px: int) -> str:
        self.photo_calls.append((photo_name, max_width_px))
        if self.error:
            raise self.error
        return self._photo_uri


class PlacesServiceTests(unittest.TestCase):
    def _service(self, client=None, cache=None, clock=None) -> PlacesService:
        return PlacesService(
            client=client,
            cache=cache if cache is not None else InMemoryPlacesCache(),
            clock=clock or (lambda: dt.datetime(2026, 9, 27, 10, 0, tzinfo=dt.UTC)),
        )

    def test_enrichment_degrades_when_place_id_is_none(self) -> None:
        service = self._service(client=FakeClient())
        result = service.enrichment(uuid.uuid4(), None)
        self.assertFalse(result.place_id_known)
        self.assertEqual(result.photos, [])
        self.assertIsNone(result.hours)

    def test_enrichment_full_shape_and_photo_url(self) -> None:
        restaurant_id = uuid.uuid4()
        client = FakeClient()
        service = self._service(client=client)
        result = service.enrichment(restaurant_id, "place123")

        self.assertTrue(result.place_id_known)
        self.assertEqual(result.provider, "google")
        self.assertEqual(len(result.photos), 1)
        photo = result.photos[0]
        self.assertEqual(photo.index, 0)
        self.assertEqual(photo.url, f"/v1/restaurants/{restaurant_id}/photos/0?w=800")
        self.assertEqual(photo.attributions[0].display_name, "Author 0")
        self.assertIsNotNone(result.hours)
        self.assertEqual(result.hours.today, 0)

    def test_photos_capped_at_max_photos(self) -> None:
        client = FakeClient(details=place_details_response(photo_count=MAX_PHOTOS + 5))
        service = self._service(client=client)
        result = service.enrichment(uuid.uuid4(), "place123")
        self.assertEqual(len(result.photos), MAX_PHOTOS)

    def test_second_call_is_served_from_cache_not_client(self) -> None:
        client = FakeClient()
        cache = InMemoryPlacesCache()
        service = self._service(client=client, cache=cache)
        service.enrichment(uuid.uuid4(), "place123")
        service.enrichment(uuid.uuid4(), "place123")
        self.assertEqual(len(client.details_calls), 1)

    def test_enrichment_degrades_on_client_error(self) -> None:
        client = FakeClient(error=PlacesError("boom"))
        service = self._service(client=client)
        result = service.enrichment(uuid.uuid4(), "place123")
        self.assertTrue(result.place_id_known)
        self.assertEqual(result.photos, [])
        self.assertIsNone(result.hours)

    def test_enrichment_degrades_when_no_client_configured(self) -> None:
        service = self._service(client=None)
        result = service.enrichment(uuid.uuid4(), "place123")
        self.assertTrue(result.place_id_known)
        self.assertEqual(result.photos, [])
        self.assertIsNone(result.hours)

    def test_hours_is_none_when_google_returns_no_hours_fields(self) -> None:
        client = FakeClient(details=place_details_response(with_hours=False))
        service = self._service(client=client)
        result = service.enrichment(uuid.uuid4(), "place123")
        self.assertIsNone(result.hours)

    def test_photo_redirect_uri_returns_google_uri(self) -> None:
        client = FakeClient()
        service = self._service(client=client)
        uri = service.photo_redirect_uri("place123", 0, 800)
        self.assertEqual(uri, "https://lh3.example/photo.jpg")

    def test_photo_redirect_uri_none_when_place_id_none(self) -> None:
        service = self._service(client=FakeClient())
        self.assertIsNone(service.photo_redirect_uri(None, 0, 800))

    def test_photo_redirect_uri_none_when_index_out_of_range(self) -> None:
        client = FakeClient()
        service = self._service(client=client)
        self.assertIsNone(service.photo_redirect_uri("place123", 99, 800))

    def test_photo_redirect_uri_second_call_served_from_cache(self) -> None:
        client = FakeClient()
        cache = InMemoryPlacesCache()
        service = self._service(client=client, cache=cache)
        service.photo_redirect_uri("place123", 0, 800)
        service.photo_redirect_uri("place123", 0, 800)
        self.assertEqual(len(client.photo_calls), 1)

    def test_photo_redirect_uri_none_on_client_error(self) -> None:
        client = FakeClient(error=PlacesError("boom"))
        service = self._service(client=client)
        self.assertIsNone(service.photo_redirect_uri("place123", 0, 800))


if __name__ == "__main__":
    unittest.main()
