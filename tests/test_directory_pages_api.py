"""Tests for ``GET /v1/directory/cities/{city_slug}`` and
``GET /v1/directory/certifiers/{certifier_slug}`` (app/api/public_directory.py).

Facts-only city and certifier landing-page data: no verdict, reason code, fit score or
certificate state anywhere in the tree, every ordering alphabetical (or a count with an
alphabetical tie-break), never certifier-type driven (CLAUDE.md).
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
    """Recursively assert no verdict-shaped key appears anywhere in a JSON body.

    Parameters:
        value (object): a JSON-decoded value (dict, list, or scalar) to walk.

    Return:
        None: raises via ``assert`` if a forbidden key is found.
    """
    forbidden = {"kashrut", "verdict", "fit", "reasons", "status", "state", "attributes"}
    if isinstance(value, dict):
        for key, nested in value.items():
            assert key not in forbidden, f"forbidden key {key!r} found in directory response"
            assert_no_verdict_keys(nested)
    elif isinstance(value, list):
        for item in value:
            assert_no_verdict_keys(item)


# ------------------------------------------------------------------ city endpoint


def test_city_page_happy_path(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a", name_he="בד א", name_en="Bet A")
    first = make_restaurant(session, name_he="א מסעדה", city_en="Jerusalem")
    second = make_restaurant(session, name_he="ב מסעדה", city_en="Jerusalem")
    make_certificate(session, first, certifier)
    make_certificate(session, second, certifier)
    make_restaurant(session, name_he="תל", city_he="תל אביב", city_slug="tel-aviv")
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem")

    assert response.status_code == 200
    body = response.json()
    assert body["city_slug"] == "jerusalem"
    assert body["city_he"] == "ירושלים"
    assert body["city_en"] == "Jerusalem"
    assert body["restaurant_count"] == 2
    assert body["selected_certifier"] is None
    assert body["certifiers"] == [
        {"slug": "badatz_a", "name_he": "בד א", "name_en": "Bet A", "restaurant_count": 2}
    ]
    assert [r["restaurant_id"] for r in body["restaurants"]] == [str(first.id), str(second.id)]
    assert body["restaurants"][0]["certifier_slugs"] == ["badatz_a"]
    assert_no_verdict_keys(body)


def test_city_page_unknown_slug_is_404(client, session) -> None:
    make_restaurant(session)
    session.commit()

    assert client.get("/v1/directory/cities/nowhere").status_code == 404


def test_city_page_with_only_closed_restaurants_is_404(client, session) -> None:
    make_restaurant(session, status=RestaurantStatus.CLOSED_PERM)
    session.commit()

    assert client.get("/v1/directory/cities/jerusalem").status_code == 404


def test_city_page_lists_all_restaurants_not_sampled_sorted_by_name(client, session) -> None:
    names = [f"מסעדה {i:02d}" for i in range(DIRECTORY_SAMPLE_PER_CITY + 5)]
    for name in reversed(names):
        make_restaurant(session, name_he=name)
    session.commit()

    body = client.get("/v1/directory/cities/jerusalem").json()

    assert body["restaurant_count"] == len(names)
    assert [r["name_he"] for r in body["restaurants"]] == sorted(names)


def test_city_page_excludes_closed_and_other_cities(client, session) -> None:
    open_restaurant = make_restaurant(session)
    make_restaurant(session, status=RestaurantStatus.CLOSED_PERM)
    make_restaurant(session, city_he="חיפה", city_slug="haifa")
    session.commit()

    body = client.get("/v1/directory/cities/jerusalem").json()

    assert body["restaurant_count"] == 1
    assert [r["restaurant_id"] for r in body["restaurants"]] == [str(open_restaurant.id)]


def test_city_page_excludes_restaurant_without_city_slug(client, session) -> None:
    make_restaurant(session, name_he="עם סלאג")
    make_restaurant(session, name_he="בלי סלאג", city_slug=None)
    session.commit()

    body = client.get("/v1/directory/cities/jerusalem").json()

    assert [r["name_he"] for r in body["restaurants"]] == ["עם סלאג"]
    assert body["restaurant_count"] == 1


def test_city_page_labels_use_majority_with_alphabetical_ties(client, session) -> None:
    make_restaurant(session, city_he="ירושלים", city_en="Jerusalem")
    make_restaurant(session, city_he="ירושלים", city_en="Jerusalem")
    make_restaurant(session, city_he="י-ם", city_en="Yerushalayim")
    make_restaurant(session, city_slug="tel-aviv", city_he="תל אביב", city_en="Tel Aviv")
    make_restaurant(session, city_slug="tel-aviv", city_he="יפו", city_en="Jaffa")
    make_restaurant(session, city_slug="haifa", city_he="חיפה", city_en=None)
    session.commit()

    jerusalem = client.get("/v1/directory/cities/jerusalem").json()
    tel_aviv = client.get("/v1/directory/cities/tel-aviv").json()
    haifa = client.get("/v1/directory/cities/haifa").json()

    assert (jerusalem["city_he"], jerusalem["city_en"]) == ("ירושלים", "Jerusalem")
    assert (tel_aviv["city_he"], tel_aviv["city_en"]) == ("יפו", "Jaffa")
    assert (haifa["city_he"], haifa["city_en"]) == ("חיפה", None)


def test_city_page_city_he_falls_back_to_slug_when_all_null(client, session) -> None:
    make_restaurant(session, city_he=None, city_slug="eilat")
    session.commit()

    assert client.get("/v1/directory/cities/eilat").json()["city_he"] == "eilat"


def test_city_page_certifier_facets_sorted_by_name_and_exclude_inactive(client, session) -> None:
    bet = make_certifier(session, slug="bet", name_he="בד ב")
    alef = make_certifier(session, slug="alef", name_he="בד א")
    inactive = make_certifier(session, slug="old", name_he="א ישן", is_active=False)
    unused = make_certifier(session, slug="unused", name_he="לא בשימוש")
    first = make_restaurant(session, name_he="א")
    second = make_restaurant(session, name_he="ב")
    make_certificate(session, first, bet)
    make_certificate(session, first, alef)
    make_certificate(session, first, inactive)
    make_certificate(session, second, bet)
    make_certificate(session, second, bet)
    session.commit()

    facets = client.get("/v1/directory/cities/jerusalem").json()["certifiers"]

    assert [(f["slug"], f["restaurant_count"]) for f in facets] == [("alef", 1), ("bet", 2)]
    assert unused.slug not in {f["slug"] for f in facets}


def test_city_page_certifier_filter_narrows_restaurants_only(client, session) -> None:
    alef = make_certifier(session, slug="alef", name_he="בד א", name_en="Alef")
    bet = make_certifier(session, slug="bet", name_he="בד ב")
    covered = make_restaurant(session, name_he="א")
    other = make_restaurant(session, name_he="ב")
    make_restaurant(session, name_he="ג")
    make_certificate(session, covered, alef)
    make_certificate(session, covered, bet)
    make_certificate(session, other, bet)
    session.commit()

    body = client.get("/v1/directory/cities/jerusalem", params={"certifier": "alef"}).json()

    assert body["restaurant_count"] == 3
    assert [f["slug"] for f in body["certifiers"]] == ["alef", "bet"]
    assert body["selected_certifier"] == {
        "slug": "alef",
        "name_he": "בד א",
        "name_en": "Alef",
        "restaurant_count": 1,
    }
    assert [r["restaurant_id"] for r in body["restaurants"]] == [str(covered.id)]
    assert body["restaurants"][0]["certifier_slugs"] == ["alef", "bet"]


def test_city_page_unknown_certifier_filter_is_404(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem", params={"certifier": "ghost"})

    assert response.status_code == 404


def test_city_page_inactive_certifier_filter_is_404(client, session) -> None:
    inactive = make_certifier(session, slug="old", is_active=False)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, inactive)
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem", params={"certifier": "old"})

    assert response.status_code == 404


def test_city_page_certifier_with_no_restaurants_in_city_is_404(client, session) -> None:
    elsewhere = make_certifier(session, slug="elsewhere")
    make_restaurant(session)
    make_certificate(
        session, make_restaurant(session, city_he="חיפה", city_slug="haifa"), elsewhere
    )
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem", params={"certifier": "elsewhere"})

    assert response.status_code == 404


def test_city_page_cache_control_header(client, session) -> None:
    make_restaurant(session)
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem")

    assert response.headers["cache-control"] == "public, max-age=3600"
    assert "vary" not in response.headers


# ------------------------------------------------------------- certifier endpoint


def test_certifier_page_happy_path(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a", name_he="בד א", name_en="Bet A")
    restaurant = make_restaurant(session, name_he="א", city_en="Jerusalem")
    make_certificate(session, restaurant, certifier)
    make_restaurant(session, name_he="לא מוסמך")
    session.commit()

    response = client.get("/v1/directory/certifiers/badatz_a")

    assert response.status_code == 200
    body = response.json()
    assert (body["slug"], body["name_he"], body["name_en"]) == ("badatz_a", "בד א", "Bet A")
    assert body["restaurant_count"] == 1
    assert body["cities"] == [
        {
            "city_slug": "jerusalem",
            "city_he": "ירושלים",
            "city_en": "Jerusalem",
            "restaurant_count": 1,
        }
    ]
    entry = body["restaurants"][0]
    assert entry["restaurant_id"] == str(restaurant.id)
    assert entry["certifier_slugs"] == ["badatz_a"]
    assert (entry["city_he"], entry["city_en"], entry["city_slug"]) == (
        "ירושלים",
        "Jerusalem",
        "jerusalem",
    )
    assert_no_verdict_keys(body)


@pytest.mark.parametrize("slug", ["ghost", "inactive", "empty", "closed_only"])
def test_certifier_page_404_cases(client, session, slug) -> None:
    inactive = make_certifier(session, slug="inactive", is_active=False)
    make_certifier(session, slug="empty")
    closed_only = make_certifier(session, slug="closed_only")
    make_certificate(session, make_restaurant(session), inactive)
    make_certificate(
        session, make_restaurant(session, status=RestaurantStatus.CLOSED_PERM), closed_only
    )
    session.commit()

    assert client.get(f"/v1/directory/certifiers/{slug}").status_code == 404


def test_certifier_page_cities_ordered_by_count_desc_then_city_he(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a")
    layout = [("haifa", "חיפה", 1), ("tel-aviv", "תל אביב", 2), ("jerusalem", "ירושלים", 2)]
    for city_slug, city_he, count in layout:
        for index in range(count):
            restaurant = make_restaurant(
                session, name_he=f"{city_slug} {index}", city_he=city_he, city_slug=city_slug
            )
            make_certificate(session, restaurant, certifier)
    session.commit()

    cities = client.get("/v1/directory/certifiers/badatz_a").json()["cities"]

    assert [(c["city_slug"], c["restaurant_count"]) for c in cities] == [
        ("jerusalem", 2),
        ("tel-aviv", 2),
        ("haifa", 1),
    ]


def test_certifier_page_restaurants_sorted_by_name(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a")
    for name in ("ג", "א", "ב"):
        make_certificate(session, make_restaurant(session, name_he=name), certifier)
    session.commit()

    body = client.get("/v1/directory/certifiers/badatz_a").json()

    assert [r["name_he"] for r in body["restaurants"]] == ["א", "ב", "ג"]


def test_certifier_page_keeps_restaurant_without_city_slug_out_of_cities(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a")
    slugless = make_restaurant(session, name_he="בלי סלאג", city_slug=None)
    make_certificate(session, slugless, certifier)
    make_certificate(session, make_restaurant(session, name_he="עם סלאג"), certifier)
    session.commit()

    body = client.get("/v1/directory/certifiers/badatz_a").json()

    assert body["restaurant_count"] == 2
    assert [c["restaurant_count"] for c in body["cities"]] == [1]
    by_name = {r["name_he"]: r for r in body["restaurants"]}
    assert by_name["בלי סלאג"]["city_slug"] is None


def test_certifier_page_excludes_closed_restaurants(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a")
    open_restaurant = make_restaurant(session)
    make_certificate(session, open_restaurant, certifier)
    make_certificate(
        session, make_restaurant(session, status=RestaurantStatus.CLOSED_PERM), certifier
    )
    session.commit()

    body = client.get("/v1/directory/certifiers/badatz_a").json()

    assert body["restaurant_count"] == 1
    assert [r["restaurant_id"] for r in body["restaurants"]] == [str(open_restaurant.id)]


def test_certifier_page_cache_control_header(client, session) -> None:
    certifier = make_certifier(session, slug="badatz_a")
    make_certificate(session, make_restaurant(session), certifier)
    session.commit()

    response = client.get("/v1/directory/certifiers/badatz_a")

    assert response.headers["cache-control"] == "public, max-age=3600"
    assert "vary" not in response.headers
