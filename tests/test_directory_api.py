"""Tests for ``GET /v1/directory`` (app/api/public_seo.py).

Profile-free, facts-only directory grouped by city — must never carry a Layer 1
verdict, reason code, or Layer 2 fit score (see app/api/public_seo.py's module
docstring), and every ordering must be alphabetical, never certifier-type or
certificate-state driven (CLAUDE.md — the app never ranks certifiers or restaurants
by kashrut).
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.consts import DIRECTORY_SAMPLE_PER_CITY
from app.db.session import get_session
from app.main import create_app
from app.models import (
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    RecordState,
    Restaurant,
    RestaurantStatus,
)

# ------------------------------------------------------------------------ fixtures


@pytest.fixture
def client(session):
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    with TestClient(app) as test_client:
        yield test_client


def make_certifier(session, **overrides) -> Certifier:
    defaults: dict = {
        "slug": f"certifier_{uuid.uuid4().hex[:8]}",
        "name_he": 'בד"ץ בדיקה',
        "name_en": "Badatz Test",
        "type": CertifierType.BADATZ,
        "is_active": True,
    }
    defaults.update(overrides)
    certifier = Certifier(**defaults)
    session.add(certifier)
    session.flush()

    return certifier


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


def make_certificate(
    session, restaurant: Restaurant, certifier: Certifier, **overrides
) -> Certificate:
    defaults: dict = {
        "restaurant_id": restaurant.id,
        "certifier_id": certifier.id,
        "level": CertificationLevel.UNKNOWN,
        "attributes": {},
        "state": CertificateState.ACTIVE,
        "source": CertificateSource.OFFICIAL_LIST,
        "corroboration_count": 1,
        "verified_at": dt.datetime.now(dt.UTC),
    }
    defaults.update(overrides)
    certificate = Certificate(**defaults)
    session.add(certificate)
    session.flush()

    return certificate


def assert_no_verdict_keys(value: object) -> None:
    """Recursively assert none of the forbidden verdict-shaped keys appear anywhere
    in a decoded JSON body.

    Parameters:
        value (object): a JSON-decoded value (dict, list, or scalar) to walk.

    Return:
        None: raises via ``assert`` if a forbidden key is found.
    """
    forbidden = {"kashrut", "verdict", "fit", "reasons", "status"}
    if isinstance(value, dict):
        for key, nested in value.items():
            assert key not in forbidden, f"forbidden key {key!r} found in directory response"
            assert_no_verdict_keys(nested)
    elif isinstance(value, list):
        for item in value:
            assert_no_verdict_keys(item)


# --------------------------------------------------------------------------- tests


def test_directory_groups_by_city_with_counts(client, session) -> None:
    make_restaurant(session, name_he="א מסעדה", city_he="ירושלים")
    make_restaurant(session, name_he="ב מסעדה", city_he="ירושלים")
    make_restaurant(session, name_he="ג מסעדה", city_he="תל אביב")
    session.commit()

    response = client.get("/v1/directory")

    assert response.status_code == 200
    body = response.json()

    assert body["total_restaurants"] == 3
    cities_by_name = {city["city_he"]: city for city in body["cities"]}
    assert cities_by_name["ירושלים"]["restaurant_count"] == 2
    assert cities_by_name["תל אביב"]["restaurant_count"] == 1


def test_directory_orders_cities_by_count_desc_then_name(client, session) -> None:
    make_restaurant(session, name_he="א", city_he="חיפה")
    for name in ("א", "ב", "ג"):
        make_restaurant(session, name_he=f"{name} ירושלים", city_he="ירושלים")
    for name in ("א", "ב", "ג"):
        make_restaurant(session, name_he=f"{name} תל אביב", city_he="תל אביב")
    session.commit()

    response = client.get("/v1/directory")

    city_names = [city["city_he"] for city in response.json()["cities"]]

    assert city_names[0] in ("ירושלים", "תל אביב")
    assert city_names[1] in ("ירושלים", "תל אביב")
    assert city_names[0] < city_names[1]
    assert city_names[-1] == "חיפה"


def test_directory_sample_capped_and_alphabetical(client, session) -> None:
    names = [f"מסעדה {i:02d}" for i in range(DIRECTORY_SAMPLE_PER_CITY + 5)]
    for name in reversed(names):
        make_restaurant(session, name_he=name, city_he="ירושלים")
    session.commit()

    response = client.get("/v1/directory")

    city = response.json()["cities"][0]
    assert city["restaurant_count"] == DIRECTORY_SAMPLE_PER_CITY + 5
    assert len(city["restaurants"]) == DIRECTORY_SAMPLE_PER_CITY

    sampled_names = [r["name_he"] for r in city["restaurants"]]
    assert sampled_names == sorted(names)[:DIRECTORY_SAMPLE_PER_CITY]


def test_directory_certifier_names_deduped_sorted_and_en_parallel(client, session) -> None:
    certifier_bet = make_certifier(session, name_he="בד ב", name_en="Bet")
    certifier_alef = make_certifier(session, name_he="בד א", name_en=None)
    restaurant = make_restaurant(session, city_he="ירושלים")
    make_certificate(session, restaurant, certifier_bet)
    make_certificate(session, restaurant, certifier_bet)  # duplicate certifier
    make_certificate(session, restaurant, certifier_alef)
    session.commit()

    response = client.get("/v1/directory")

    entry = response.json()["cities"][0]["restaurants"][0]
    assert entry["certifier_names_he"] == ["בד א", "בד ב"]
    assert entry["certifier_names_en"] == [None, "Bet"]


def test_directory_omits_inactive_certifier(client, session) -> None:
    active = make_certifier(session, name_he="פעיל", is_active=True)
    inactive = make_certifier(session, name_he="לא פעיל", is_active=False)
    restaurant = make_restaurant(session, city_he="ירושלים")
    make_certificate(session, restaurant, active)
    make_certificate(session, restaurant, inactive)
    session.commit()

    response = client.get("/v1/directory")

    entry = response.json()["cities"][0]["restaurants"][0]
    assert entry["certifier_names_he"] == ["פעיל"]
    assert entry["certifier_names_en"] == [active.name_en]


def test_directory_null_city_excluded_from_cities_but_counted(client, session) -> None:
    make_restaurant(session, city_he="ירושלים")
    make_restaurant(session, city_he=None)
    session.commit()

    response = client.get("/v1/directory")
    body = response.json()

    assert body["total_restaurants"] == 2
    assert len(body["cities"]) == 1
    assert body["cities"][0]["city_he"] == "ירושלים"
    assert body["cities"][0]["restaurant_count"] == 1


def test_directory_excludes_closed_restaurant(client, session) -> None:
    open_restaurant = make_restaurant(session, city_he="ירושלים", status=RestaurantStatus.OPEN)
    make_restaurant(session, city_he="ירושלים", status=RestaurantStatus.CLOSED_PERM)
    session.commit()

    response = client.get("/v1/directory")
    body = response.json()

    assert body["total_restaurants"] == 1
    restaurant_ids = {r["restaurant_id"] for r in body["cities"][0]["restaurants"]}
    assert restaurant_ids == {str(open_restaurant.id)}


def test_directory_has_no_verdict_keys(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, city_he="ירושלים")
    make_certificate(session, restaurant, certifier, attributes={"glatt": True})
    session.commit()

    response = client.get("/v1/directory")

    assert_no_verdict_keys(response.json())


def test_directory_cache_control_header(client, session) -> None:
    make_restaurant(session, city_he="ירושלים")
    session.commit()

    response = client.get("/v1/directory")

    assert response.headers["cache-control"] == "public, max-age=3600"
