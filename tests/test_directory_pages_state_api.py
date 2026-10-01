"""Tests that a non-ACTIVE certificate (revoked, expired, pending) never counts as a
certifier covering a restaurant on ``/v1/directory/cities/{city_slug}`` or
``/v1/directory/certifiers/{certifier_slug}`` (app/api/public_directory.py) — the
fail-safe rule: doubt -> UNKNOWN, never doubt -> MATCH (CLAUDE.md).
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


NON_ACTIVE_STATES = [CertificateState.REVOKED, CertificateState.EXPIRED, CertificateState.PENDING]


@pytest.mark.parametrize("state", NON_ACTIVE_STATES)
def test_non_active_certificate_excluded_from_city_facets_and_filter(
    client, session, state
) -> None:
    certifier = make_certifier(session, slug="alef", name_he="בד א")
    live = make_certifier(session, slug="live", name_he="בד ב")
    lapsed = make_restaurant(session, name_he="א")
    covered = make_restaurant(session, name_he="ב")
    make_certificate(session, lapsed, certifier, state=state)
    make_certificate(session, lapsed, live)
    make_certificate(session, covered, certifier)
    session.commit()

    body = client.get("/v1/directory/cities/jerusalem").json()

    assert {f["slug"]: f["restaurant_count"] for f in body["certifiers"]} == {
        "alef": 1,
        "live": 1,
    }
    assert body["restaurant_count"] == 2
    by_name = {r["name_he"]: r for r in body["restaurants"]}
    assert by_name["א"]["certifier_slugs"] == ["live"]

    filtered = client.get("/v1/directory/cities/jerusalem", params={"certifier": "alef"}).json()

    assert [r["name_he"] for r in filtered["restaurants"]] == ["ב"]


@pytest.mark.parametrize("state", NON_ACTIVE_STATES)
def test_city_filter_404_when_certifier_only_has_non_active_certificates(
    client, session, state
) -> None:
    certifier = make_certifier(session, slug="alef")
    make_certificate(session, make_restaurant(session), certifier, state=state)
    session.commit()

    response = client.get("/v1/directory/cities/jerusalem", params={"certifier": "alef"})

    assert response.status_code == 404


@pytest.mark.parametrize("state", NON_ACTIVE_STATES)
def test_non_active_certificate_excluded_from_certifier_page(client, session, state) -> None:
    certifier = make_certifier(session, slug="alef")
    lapsed = make_restaurant(session, name_he="א")
    covered = make_restaurant(session, name_he="ב")
    make_certificate(session, lapsed, certifier, state=state)
    make_certificate(session, covered, certifier)
    session.commit()

    body = client.get("/v1/directory/certifiers/alef").json()

    assert body["restaurant_count"] == 1
    assert [r["restaurant_id"] for r in body["restaurants"]] == [str(covered.id)]
    assert body["cities"][0]["restaurant_count"] == 1


@pytest.mark.parametrize("state", NON_ACTIVE_STATES)
def test_certifier_page_404_when_only_non_active_certificates(client, session, state) -> None:
    certifier = make_certifier(session, slug="alef")
    make_certificate(session, make_restaurant(session), certifier, state=state)
    session.commit()

    assert client.get("/v1/directory/certifiers/alef").status_code == 404
