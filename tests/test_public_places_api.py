"""Tests for ``GET /v1/restaurants/{id}/places`` and
``GET /v1/restaurants/{id}/photos/{index}`` — mirrors
``tests/test_public_restaurant_get_api.py``'s ``TestClient`` + ``get_session``
override pattern, with ``get_places_service`` overridden by a fake in place of a
real Google client.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.schemas_places import PlacePhotoOut, PlacesEnrichmentOut
from app.db.session import get_session
from app.main import create_app
from app.models import RecordState, Restaurant, RestaurantStatus
from app.services.places import get_places_service

# ------------------------------------------------------------------------ fixtures


class FakePlacesService:
    """Records calls and returns canned results — no Google, no network."""

    def __init__(self, enrichment: PlacesEnrichmentOut | None = None, photo_uri: str | None = None):
        self._enrichment = enrichment or PlacesEnrichmentOut(
            place_id_known=False, photos=[], hours=None
        )
        self._photo_uri = photo_uri
        self.enrichment_calls: list[tuple] = []
        self.photo_calls: list[tuple] = []

    def enrichment(self, restaurant_id, place_id):
        self.enrichment_calls.append((restaurant_id, place_id))
        return self._enrichment

    def photo_redirect_uri(self, place_id, index, width_px):
        self.photo_calls.append((place_id, index, width_px))
        return self._photo_uri


@pytest.fixture
def fake_places_service():
    return FakePlacesService()


@pytest.fixture
def client(session, fake_places_service):
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_places_service] = lambda: fake_places_service
    with TestClient(app, follow_redirects=False) as test_client:
        yield test_client


def make_restaurant(session, **overrides) -> Restaurant:
    defaults: dict = {
        "dedupe_key": f"test:{uuid.uuid4().hex}",
        "name_he": "מסעדת בדיקה",
        "city_he": "ירושלים",
        "city_slug": "jerusalem",
        "record_state": RecordState.LIST_VERIFIED,
        "needs_review": False,
        "corroboration_count": 1,
        "status": RestaurantStatus.OPEN,
        "amenities": {},
    }
    defaults.update(overrides)
    restaurant = Restaurant(**defaults)
    session.add(restaurant)
    session.flush()

    return restaurant


# --------------------------------------------------------------------- /places


def test_places_404_for_unknown_restaurant(client) -> None:
    response = client.get(f"/v1/restaurants/{uuid.uuid4()}/places")

    assert response.status_code == 404
    assert response.json()["detail"] == "restaurant not found"


def test_places_no_place_id_returns_place_id_known_false(
    client, session, fake_places_service
) -> None:
    restaurant = make_restaurant(session, google_place_id=None)
    session.commit()
    fake_places_service._enrichment = PlacesEnrichmentOut(
        place_id_known=False, photos=[], hours=None
    )

    response = client.get(f"/v1/restaurants/{restaurant.id}/places")

    assert response.status_code == 200
    body = response.json()
    assert body["place_id_known"] is False
    assert body["photos"] == []
    assert body["hours"] is None
    assert fake_places_service.enrichment_calls == [(restaurant.id, None)]


def test_places_full_shape(client, session, fake_places_service) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()
    fake_places_service._enrichment = PlacesEnrichmentOut(
        place_id_known=True,
        provider="google",
        photos=[
            PlacePhotoOut(
                index=0,
                width_px=1600,
                height_px=900,
                url=f"/v1/restaurants/{restaurant.id}/photos/0?w=800",
                attributions=[],
            )
        ],
        hours=None,
    )

    response = client.get(f"/v1/restaurants/{restaurant.id}/places")

    assert response.status_code == 200
    body = response.json()
    assert body["place_id_known"] is True
    assert body["provider"] == "google"
    assert body["photos"][0]["index"] == 0
    assert body["photos"][0]["url"] == f"/v1/restaurants/{restaurant.id}/photos/0?w=800"
    assert fake_places_service.enrichment_calls == [(restaurant.id, "place123")]


def test_places_prefers_business_place_id_over_address_place_id(
    client, session, fake_places_service
) -> None:
    restaurant = make_restaurant(
        session,
        google_place_id="address-place-id",
        google_business_place_id="business-place-id",
    )
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}/places")

    assert response.status_code == 200
    assert fake_places_service.enrichment_calls == [(restaurant.id, "business-place-id")]


def test_places_falls_back_to_address_place_id_when_no_business_id(
    client, session, fake_places_service
) -> None:
    restaurant = make_restaurant(
        session, google_place_id="address-place-id", google_business_place_id=None
    )
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}/places")

    assert response.status_code == 200
    assert fake_places_service.enrichment_calls == [(restaurant.id, "address-place-id")]


def test_places_sets_cache_control_header(client, session) -> None:
    restaurant = make_restaurant(session, google_place_id=None)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}/places")

    assert response.headers["cache-control"] == "private, max-age=300"


# --------------------------------------------------------------------- /photos


def test_photo_redirects_with_no_key_in_location(client, session, fake_places_service) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()
    fake_places_service._photo_uri = "https://lh3.example/some-photo.jpg?sig=abc"

    response = client.get(f"/v1/restaurants/{restaurant.id}/photos/0")

    assert response.status_code == 302
    assert response.headers["location"] == "https://lh3.example/some-photo.jpg?sig=abc"
    assert fake_places_service.photo_calls == [("place123", 0, 800)]


def test_photo_404_for_unknown_restaurant(client) -> None:
    response = client.get(f"/v1/restaurants/{uuid.uuid4()}/photos/0")

    assert response.status_code == 404


def test_photo_404_when_service_cannot_resolve_it(client, session, fake_places_service) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()
    fake_places_service._photo_uri = None

    response = client.get(f"/v1/restaurants/{restaurant.id}/photos/0")

    assert response.status_code == 404
    assert response.json()["detail"] == "photo not found"


def test_photo_width_query_param_is_forwarded(client, session, fake_places_service) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()
    fake_places_service._photo_uri = "https://lh3.example/photo.jpg"

    client.get(f"/v1/restaurants/{restaurant.id}/photos/0?w=1200")

    assert fake_places_service.photo_calls == [("place123", 0, 1200)]


def test_photo_width_over_max_is_rejected(client, session) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}/photos/0?w=99999")

    assert response.status_code == 422


def test_photo_width_below_min_is_rejected(client, session) -> None:
    restaurant = make_restaurant(session, google_place_id="place123")
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}/photos/0?w=1")

    assert response.status_code == 422
