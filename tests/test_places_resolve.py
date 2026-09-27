"""Tests for ``app.ingestion.places_resolve`` — offline via ``httpx.MockTransport``
and the SQLite-backed ``session`` pytest fixture from conftest, wrapped in
``unittest.TestCase`` per STANDARDS.md via an autouse fixture-injection method,
matching the pattern in tests/test_seed_prune.py.
"""

from __future__ import annotations

import unittest
from typing import Any

import httpx
import pytest

from app.ingestion.normalize import restaurant_dedupe_key, slugify_city
from app.ingestion.places_resolve import (
    build_search_text_body,
    build_text_query,
    classify_candidates,
    resolve_places,
)
from app.models import RecordState, Restaurant
from app.services.places import GooglePlacesClient
from app.services.places_consts import PLACES_TEXT_SEARCH_URL

FAKE_API_KEY = "test-places-key-should-never-leak"

#: A restaurant geocoded at (32.0868, 34.8338) — Rabi Akiva 15, Bnei Brak.
ORIGIN_LAT = 32.0868
ORIGIN_LNG = 34.8338


def search_text_response(
    *,
    place_id: str = "ChIJbusiness123",
    display_name: str = "מסעדת הבדיקה",
    lat: float = ORIGIN_LAT,
    lng: float = ORIGIN_LNG,
    business_status: str = "OPERATIONAL",
) -> dict[str, Any]:
    return {
        "places": [
            {
                "id": place_id,
                "displayName": {"text": display_name, "languageCode": "he"},
                "location": {"latitude": lat, "longitude": lng},
                "businessStatus": business_status,
            }
        ]
    }


def make_restaurant(
    session,
    *,
    name_he: str = "מסעדת הבדיקה",
    address_he: str | None = "רבי עקיבא 15",
    city_he: str | None = "בני ברק",
    city_en: str | None = "Bnei Brak",
    geo: str | None = f"SRID=4326;POINT({ORIGIN_LNG} {ORIGIN_LAT})",
    **overrides: Any,
) -> Restaurant:
    values: dict[str, Any] = {
        "dedupe_key": restaurant_dedupe_key(name_he, city_he, address_he),
        "name_he": name_he,
        "address_he": address_he,
        "city_he": city_he,
        "city_en": city_en,
        "city_slug": slugify_city(city_en, city_he),
        "record_state": RecordState.LIST_VERIFIED,
        "needs_review": False,
        "geo": geo,
        **overrides,
    }
    restaurant = Restaurant(**values)
    session.add(restaurant)
    session.commit()

    return restaurant


class StubSearcher:
    """Canned Text Search responses, one per call, in order. Counts calls."""

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def search_text(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(body)
        if not self.responses:
            raise AssertionError("unexpected search_text call")

        return self.responses.pop(0)


# --------------------------------------------------------------------------------------
# Pure helpers
# --------------------------------------------------------------------------------------


class TestPureHelpers(unittest.TestCase):
    def test_build_text_query_joins_non_empty_parts(self) -> None:
        query = build_text_query("מסעדת הבדיקה", "רבי עקיבא 15", "בני ברק")
        self.assertEqual(query, "מסעדת הבדיקה רבי עקיבא 15 בני ברק")

    def test_build_text_query_skips_missing_parts(self) -> None:
        query = build_text_query("מסעדת הבדיקה", None, "בני ברק")
        self.assertEqual(query, "מסעדת הבדיקה בני ברק")

    def test_build_search_text_body_shape(self) -> None:
        body = build_search_text_body("query text", ORIGIN_LAT, ORIGIN_LNG)
        self.assertEqual(body["textQuery"], "query text")
        self.assertEqual(body["languageCode"], "he")
        self.assertEqual(body["regionCode"], "IL")
        self.assertEqual(body["maxResultCount"], 3)
        self.assertEqual(
            body["locationBias"]["circle"]["center"],
            {"latitude": ORIGIN_LAT, "longitude": ORIGIN_LNG},
        )

    def test_candidate_accepted_within_150_meters(self) -> None:
        # ~0.0009 degrees lat ~= 100m.
        response = search_text_response(lat=ORIGIN_LAT + 0.0009, lng=ORIGIN_LNG)
        decision = classify_candidates(response, ORIGIN_LAT, ORIGIN_LNG)
        self.assertTrue(decision.accept)
        self.assertEqual(decision.reason, "accepted")
        self.assertEqual(decision.place_id, "ChIJbusiness123")
        self.assertLess(decision.distance_m, 150.0)

    def test_candidate_rejected_beyond_150_meters(self) -> None:
        # ~0.003 degrees lat ~= 333m.
        response = search_text_response(lat=ORIGIN_LAT + 0.003, lng=ORIGIN_LNG)
        decision = classify_candidates(response, ORIGIN_LAT, ORIGIN_LNG)
        self.assertFalse(decision.accept)
        self.assertEqual(decision.reason, "too_far")
        self.assertIsNone(decision.place_id)
        self.assertGreater(decision.distance_m, 150.0)

    def test_no_candidates_is_rejected(self) -> None:
        decision = classify_candidates({"places": []}, ORIGIN_LAT, ORIGIN_LNG)
        self.assertFalse(decision.accept)
        self.assertEqual(decision.reason, "no_candidates")

    def test_first_candidate_within_radius_wins_over_later_closer_one(self) -> None:
        response = {
            "places": [
                {
                    "id": "far-but-first",
                    "displayName": {"text": "A"},
                    "location": {"latitude": ORIGIN_LAT + 0.0009, "longitude": ORIGIN_LNG},
                },
                {
                    "id": "closer-but-second",
                    "displayName": {"text": "B"},
                    "location": {"latitude": ORIGIN_LAT, "longitude": ORIGIN_LNG},
                },
            ]
        }
        decision = classify_candidates(response, ORIGIN_LAT, ORIGIN_LNG)
        self.assertTrue(decision.accept)
        self.assertEqual(decision.place_id, "far-but-first")


# --------------------------------------------------------------------------------------
# GooglePlacesClient.search_text — transport-level
# --------------------------------------------------------------------------------------


class TestSearchTextTransport(unittest.TestCase):
    def test_sends_key_header_and_field_mask_never_key_in_url(self) -> None:
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["headers"] = request.headers
            captured["url"] = str(request.url)

            return httpx.Response(200, json=search_text_response())

        client = GooglePlacesClient(FAKE_API_KEY, transport=httpx.MockTransport(handler))
        result = client.search_text(build_search_text_body("q", ORIGIN_LAT, ORIGIN_LNG))

        self.assertEqual(captured["headers"]["X-Goog-Api-Key"], FAKE_API_KEY)
        self.assertIn("places.id", captured["headers"]["X-Goog-FieldMask"])
        self.assertNotIn(FAKE_API_KEY, captured["url"])
        self.assertEqual(str(httpx.URL(captured["url"])), PLACES_TEXT_SEARCH_URL)
        self.assertEqual(result["places"][0]["id"], "ChIJbusiness123")


# --------------------------------------------------------------------------------------
# Pipeline — DB-backed
# --------------------------------------------------------------------------------------


class TestResolvePlacesPipeline(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _inject_session(self, session):
        self.session = session

    def test_no_geo_is_skipped(self) -> None:
        make_restaurant(self.session, geo=None)
        searcher = StubSearcher([])

        stats = resolve_places(self.session, searcher, dry_run=False)

        self.assertEqual(stats.candidates, 0)
        self.assertEqual(stats.excluded_no_geo, 1)
        self.assertEqual(searcher.calls, [])

    def test_already_resolved_is_skipped_unless_forced(self) -> None:
        make_restaurant(self.session, google_business_place_id="ChIJexisting")
        searcher = StubSearcher([])

        stats = resolve_places(self.session, searcher, dry_run=False)

        self.assertEqual(stats.candidates, 0)
        self.assertEqual(stats.already_resolved, 1)
        self.assertEqual(searcher.calls, [])

    def test_force_re_resolves_already_resolved_restaurant(self) -> None:
        restaurant = make_restaurant(self.session, google_business_place_id="ChIJold")
        searcher = StubSearcher([search_text_response(place_id="ChIJnew")])

        stats = resolve_places(self.session, searcher, dry_run=False, force=True)

        self.assertEqual(stats.candidates, 1)
        self.assertEqual(stats.accepted, 1)
        refreshed = self.session.get(Restaurant, restaurant.id)
        self.assertEqual(refreshed.google_business_place_id, "ChIJnew")

    def test_dry_run_writes_nothing(self) -> None:
        restaurant = make_restaurant(self.session)
        searcher = StubSearcher([search_text_response()])

        stats = resolve_places(self.session, searcher, dry_run=True)

        self.assertEqual(stats.accepted, 1)
        refreshed = self.session.get(Restaurant, restaurant.id)
        self.assertIsNone(refreshed.google_business_place_id)
        self.assertIsNone(refreshed.business_place_resolved_at)

    def test_apply_writes_place_id_and_resolved_at(self) -> None:
        restaurant = make_restaurant(self.session)
        searcher = StubSearcher([search_text_response(place_id="ChIJbusiness123")])

        stats = resolve_places(self.session, searcher, dry_run=False, actor="pytest")

        self.assertEqual(stats.accepted, 1)
        refreshed = self.session.get(Restaurant, restaurant.id)
        self.assertEqual(refreshed.google_business_place_id, "ChIJbusiness123")
        self.assertIsNotNone(refreshed.business_place_resolved_at)

    def test_apply_rejects_candidate_too_far_and_writes_nothing(self) -> None:
        restaurant = make_restaurant(self.session)
        far_response = search_text_response(lat=ORIGIN_LAT + 0.01, lng=ORIGIN_LNG)
        searcher = StubSearcher([far_response])

        stats = resolve_places(self.session, searcher, dry_run=False)

        self.assertEqual(stats.rejected, 1)
        self.assertEqual(stats.accepted, 0)
        refreshed = self.session.get(Restaurant, restaurant.id)
        self.assertIsNone(refreshed.google_business_place_id)

    def test_city_and_limit_filters(self) -> None:
        make_restaurant(self.session, city_he="בני ברק", city_en="Bnei Brak")
        make_restaurant(
            self.session,
            name_he="מסעדה אחרת",
            address_he="הרצל 1",
            city_he="חיפה",
            city_en="Haifa",
        )
        searcher = StubSearcher([search_text_response()])

        stats = resolve_places(self.session, searcher, dry_run=False, city="bnei-brak")

        self.assertEqual(stats.candidates, 1)
        self.assertEqual(len(searcher.calls), 1)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
