"""Tests for ``GET /v1/certifiers`` and ``POST /v1/search`` (POC_PLAN.md B2, B3, B8).

SQLite-backed (see tests/conftest.py). Requests that supply ``center`` execute a real
PostGIS geography query (``ST_DWithin`` / ``ST_Distance``) which SQLite cannot run —
those requests are covered by the compile-only checks in
``tests/test_search_geo_query.py`` instead. Everything here uses ``city`` search,
which never touches a geography function and so runs for real against SQLite.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_session
from app.main import create_app
from app.models import (
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    DietType,
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


def make_restaurant(session, *, city_slug: str = "jerusalem", **overrides) -> Restaurant:
    defaults: dict = {
        "dedupe_key": f"test:{uuid.uuid4().hex}",
        "name_he": "מסעדת בדיקה",
        "city_he": "ירושלים",
        "city_slug": city_slug,
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


# --------------------------------------------------------------------- certifiers


def test_list_certifiers_returns_only_active(client, session) -> None:
    active = make_certifier(session, name_he="פעיל")
    make_certifier(session, name_he="לא פעיל", is_active=False)
    session.commit()

    response = client.get("/v1/certifiers")

    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(active.id) in ids
    assert len(response.json()) == 1


def test_list_certifiers_reports_published_levels_excluding_unknown(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier, level=CertificationLevel.MEHADRIN)
    make_certificate(session, restaurant, certifier, level=CertificationLevel.UNKNOWN)
    session.commit()

    response = client.get("/v1/certifiers")

    row = next(r for r in response.json() if r["id"] == str(certifier.id))
    assert row["levels"] == ["mehadrin"]


# ------------------------------------------------------------------------- search


def test_search_requires_center_or_city(client) -> None:
    response = client.post("/v1/search", json={"profile": {}})

    assert response.status_code == 422


def test_search_rejects_duplicate_whitelist_certifier(client) -> None:
    certifier_id = str(uuid.uuid4())
    response = client.post(
        "/v1/search",
        json={
            "profile": {
                "whitelist": [
                    {"certifier_id": certifier_id},
                    {"certifier_id": certifier_id},
                ]
            },
            "city": "jerusalem",
        },
    )

    assert response.status_code == 422


def test_search_match_when_certifier_whitelisted_and_fresh(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, name_he="כשרה")
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["restaurant_id"] == str(restaurant.id)
    assert item["kashrut"]["verdict"] == "match"
    assert item["distance_km"] is None
    assert 0 <= item["fit"]["score"] <= 100
    assert item["certifiers"][0]["id"] == str(certifier.id)


def test_search_no_match_when_certifier_not_whitelisted(client, session) -> None:
    """Fail-safe: a certificate whose certifier the profile does not accept is a
    definitive NO_MATCH, not UNKNOWN — the app never implies it might count later.
    """
    certifier = make_certifier(session)
    other_certifier_id = uuid.uuid4()
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(other_certifier_id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["kashrut"]["verdict"] == "no_match"
    assert "certifier_not_in_whitelist" in {r["code"] for r in item["kashrut"]["reasons"]}


def test_search_unknown_when_restaurant_has_no_certificate(client, session) -> None:
    """Fail-safe: no certificate at all is UNKNOWN, never MATCH or NO_MATCH."""
    certifier = make_certifier(session)
    make_restaurant(session, name_he="בלי תעודה")
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["kashrut"]["verdict"] == "unknown"
    assert item["kashrut"]["reasons"] == [{"code": "no_certificate", "attribute": None}]


def test_search_unknown_when_verified_at_is_stale(client, session) -> None:
    """Fail-safe: the staleness clock runs from ``verified_at`` regardless of an
    unexpired ``valid_until`` — stale evidence degrades to UNKNOWN, never MATCH.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(
        session,
        restaurant,
        certifier,
        valid_until=(dt.datetime.now(dt.UTC) + dt.timedelta(days=730)).date(),
        verified_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=400),
    )
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["kashrut"]["verdict"] == "unknown"
    assert "evidence_stale" in {r["code"] for r in item["kashrut"]["reasons"]}


def test_search_city_filter_excludes_other_cities(client, session) -> None:
    certifier = make_certifier(session)
    jerusalem = make_restaurant(session, city_slug="jerusalem", name_he="ירושלים")
    haifa = make_restaurant(session, city_slug="haifa", name_he="חיפה")
    make_certificate(session, jerusalem, certifier)
    make_certificate(session, haifa, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["restaurant_id"] == str(jerusalem.id)


def test_search_ranks_by_fit_score_descending(client, session) -> None:
    certifier = make_certifier(session)
    low_fit = make_restaurant(session, name_he="א", price_level=1)
    high_fit = make_restaurant(session, name_he="ב", price_level=4)
    make_certificate(session, low_fit, certifier)
    make_certificate(session, high_fit, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {
                "whitelist": [{"certifier_id": str(certifier.id)}],
                "preferred_price_level": 4,
            },
            "city": "jerusalem",
        },
    )

    items = response.json()["items"]
    assert items[0]["restaurant_id"] == str(high_fit.id)
    assert items[0]["fit"]["score"] >= items[1]["fit"]["score"]


def test_search_ranks_verdict_before_fit_score(client, session) -> None:
    """PRD FR3 / AGENTS.md locked decision: the Layer 1 verdict is the PRIMARY sort
    key across restaurants, fit score only breaks ties within a verdict class. Pins
    the exact bug a naive fit-score-only sort allowed: a low-fit-score MATCH must
    still outrank a high-fit-score NO_MATCH.
    """
    whitelisted = make_certifier(session)
    other_certifier = make_certifier(session)
    low_fit_match = make_restaurant(session, name_he="א", price_level=1)
    high_fit_no_match = make_restaurant(session, name_he="ב", price_level=4)
    make_certificate(session, low_fit_match, whitelisted)
    make_certificate(session, high_fit_no_match, other_certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {
                "whitelist": [{"certifier_id": str(whitelisted.id)}],
                "preferred_price_level": 4,
            },
            "city": "jerusalem",
        },
    )

    items = response.json()["items"]
    # High-fit NO_MATCH truly outscores low-fit MATCH on fit alone, so ordering by
    # verdict first is the only thing that can put the MATCH first.
    assert items[0]["fit"]["score"] < items[1]["fit"]["score"]
    assert items[0]["restaurant_id"] == str(low_fit_match.id)
    assert items[0]["kashrut"]["verdict"] == "match"
    assert items[1]["restaurant_id"] == str(high_fit_no_match.id)
    assert items[1]["kashrut"]["verdict"] == "no_match"


def test_search_ranks_unknown_between_match_and_no_match(client, session) -> None:
    """PRD FR3: UNKNOWN sits strictly between MATCH and NO_MATCH in search result
    order — never above a MATCH, never below a NO_MATCH.
    """
    whitelisted = make_certifier(session)
    other_certifier = make_certifier(session)
    match_restaurant = make_restaurant(session, name_he="א")
    unknown_restaurant = make_restaurant(session, name_he="ב")
    no_match_restaurant = make_restaurant(session, name_he="ג")
    make_certificate(session, match_restaurant, whitelisted)
    make_certificate(session, no_match_restaurant, other_certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(whitelisted.id)}]},
            "city": "jerusalem",
        },
    )

    items = response.json()["items"]
    assert [item["restaurant_id"] for item in items] == [
        str(match_restaurant.id),
        str(unknown_restaurant.id),
        str(no_match_restaurant.id),
    ]
    assert [item["kashrut"]["verdict"] for item in items] == ["match", "unknown", "no_match"]


def test_search_amenities_filter_excludes_non_matching(client, session) -> None:
    """``filters.amenities`` is a hard search facet, not a kashrut condition — a
    restaurant missing a wanted amenity is dropped from the results entirely rather
    than surfaced with a degraded verdict.
    """
    certifier = make_certifier(session)
    with_parking = make_restaurant(session, name_he="עם חניה", amenities={"parking": True})
    without_parking = make_restaurant(session, name_he="בלי חניה", amenities={})
    make_certificate(session, with_parking, certifier)
    make_certificate(session, without_parking, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "filters": {"amenities": ["parking"]},
        },
    )

    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["restaurant_id"] == str(with_parking.id)


def test_search_result_item_surfaces_diet_type(client, session) -> None:
    """Change 1: ``diet_type`` on a search result item is the same field/value the
    detail endpoint already returns for the restaurant, just surfaced on the list row
    too — not derived or recomputed here.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, diet_type=DietType.DAIRY)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["diet_type"] == "dairy"


def test_search_result_item_diet_type_none_when_unset(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["diet_type"] is None


def test_search_result_item_names_deciding_certificate(client, session) -> None:
    """Change 2: ``deciding_certificate`` identifies the certificate the Layer 1 gate
    resolved on, matching ``kashrut.deciding_certificate_id``, without duplicating the
    full evidence payload the detail endpoint carries.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(
        session, restaurant, certifier, level=CertificationLevel.MEHADRIN
    )
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
        },
    )

    item = response.json()["items"][0]
    assert item["kashrut"]["deciding_certificate_id"] == str(certificate.id)
    deciding = item["deciding_certificate"]
    assert deciding["certificate_id"] == str(certificate.id)
    assert deciding["certifier"]["id"] == str(certifier.id)
    assert deciding["level"] == "mehadrin"
    assert set(deciding.keys()) == {"certificate_id", "certifier", "level"}


def test_search_result_item_deciding_certificate_none_when_no_certificate(client, session) -> None:
    """Fail-safe consistency: when the gate has no certificate to decide on
    (``deciding_certificate_id`` is None), the search row's ``deciding_certificate``
    is also None rather than fabricating a certificate.
    """
    make_certifier(session)
    make_restaurant(session, name_he="בלי תעודה")
    session.commit()

    response = client.post(
        "/v1/search",
        json={"profile": {"whitelist": []}, "city": "jerusalem"},
    )

    item = response.json()["items"][0]
    assert item["kashrut"]["deciding_certificate_id"] is None
    assert item["deciding_certificate"] is None


def test_search_query_filters_by_name_substring(client, session) -> None:
    """Change 3: ``query`` is an exact, case-insensitive substring match over
    name_he/name_en/address_he — not fuzzy, not tokenized on word boundaries.
    """
    certifier = make_certifier(session)
    pizza = make_restaurant(session, name_he="פיצה טובה")
    other = make_restaurant(session, name_he="מסעדת בשרים")
    make_certificate(session, pizza, certifier)
    make_certificate(session, other, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "פיצה",
        },
    )

    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["restaurant_id"] == str(pizza.id)


def test_search_query_matches_mid_word_substring_not_tokenized(client, session) -> None:
    """A substring occurring mid-word must still match — this is plain SQL substring
    matching, not word-boundary/token search.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, name_he="פיצה טובה")
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "יצה",
        },
    )

    assert response.json()["total"] == 1


def test_search_query_matches_address(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, name_he="מסעדה", address_he="אגריפס 8")
    other = make_restaurant(session, name_he="אחרת", address_he="יפו 1")
    make_certificate(session, restaurant, certifier)
    make_certificate(session, other, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "אגריפס",
        },
    )

    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["restaurant_id"] == str(restaurant.id)


def test_search_query_is_case_insensitive_for_english_text(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, name_he="MEAT CHOICE")
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "meat",
        },
    )

    assert response.json()["total"] == 1


def test_search_query_no_match_returns_empty_results(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "zzznonexistentxyz",
        },
    )

    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []


def test_search_blank_query_is_treated_as_absent(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "query": "   ",
        },
    )

    assert response.json()["total"] == 1


def test_search_query_does_not_change_ordering(client, session) -> None:
    """``query`` only narrows the candidate set — the verdict-then-fit ordering
    contract (PRD FR3) must hold identically among the filtered rows.
    """
    whitelisted = make_certifier(session)
    other_certifier = make_certifier(session)
    match_restaurant = make_restaurant(session, name_he="פיצה א")
    no_match_restaurant = make_restaurant(session, name_he="פיצה ב")
    make_certificate(session, match_restaurant, whitelisted)
    make_certificate(session, no_match_restaurant, other_certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(whitelisted.id)}]},
            "city": "jerusalem",
            "query": "פיצה",
        },
    )

    items = response.json()["items"]
    assert [item["restaurant_id"] for item in items] == [
        str(match_restaurant.id),
        str(no_match_restaurant.id),
    ]
    assert [item["kashrut"]["verdict"] for item in items] == ["match", "no_match"]


def test_search_pagination(client, session) -> None:
    certifier = make_certifier(session)
    for i in range(3):
        restaurant = make_restaurant(session, name_he=f"מסעדה {i}")
        make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        "/v1/search",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "city": "jerusalem",
            "page": 1,
            "page_size": 2,
        },
    )

    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
