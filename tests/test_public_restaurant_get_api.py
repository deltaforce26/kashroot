"""Tests for ``GET /v1/restaurants/{id}`` (SEO: profile-free facts, no verdict).

Unlike ``POST /v1/restaurants/{id}`` (tests/test_public_restaurant_detail_api.py),
this endpoint takes no profile and must never compute or expose a Layer 1 verdict,
reason code, or Layer 2 fit score — see app/api/public_seo.py's module docstring for
why (fail-safe rule: a verdict needs a profile; a crawler supplies none).
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


# --------------------------------------------------------------------------- tests


def test_get_404_for_unknown_restaurant(client) -> None:
    response = client.get(f"/v1/restaurants/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["detail"] == "restaurant not found"


def test_get_returns_facts_with_no_verdict_keys(client, session) -> None:
    """The core contract: certificate facts are present, but nothing verdict-shaped
    (kashrut, fit score, per-certificate outcome/reasons/confidence) ever appears.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(
        session,
        restaurant,
        certifier,
        attributes={"glatt": True},
        valid_until=dt.date(2030, 1, 1),
    )
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    assert response.status_code == 200
    body = response.json()

    assert body["restaurant_id"] == str(restaurant.id)
    assert body["name_he"] == restaurant.name_he
    assert body["updated_at"] is not None

    for forbidden_key in (
        "kashrut",
        "verdict",
        "status_reason",
        "fit",
        "fit_score",
        "reasons",
        "confidence",
    ):
        assert forbidden_key not in body

    assert len(body["certificates"]) == 1
    fact = body["certificates"][0]
    assert set(fact.keys()) == {"certifier", "status", "valid_until", "attributes"}
    assert fact["certifier"] == {
        "id": str(certifier.id),
        "name_he": certifier.name_he,
        "name_en": certifier.name_en,
    }
    assert fact["status"] == "active"
    assert fact["valid_until"] == "2030-01-01"
    assert fact["attributes"] == {"glatt": True}
    assert "outcome" not in fact
    assert "reasons" not in fact
    assert "confidence" not in fact


def test_get_returns_expired_and_revoked_certificates_with_their_stored_status(
    client, session
) -> None:
    """Fail-safe rule (CLAUDE.md): an expired/revoked certificate is still a fact
    about the restaurant, so it is still returned — with its own stored ``state`` and
    still no verdict keys — rather than degraded or filtered out. Degrading a stale
    certificate to UNKNOWN is the match engine's job against a profile, not this
    profile-free path's.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)
    make_certificate(session, restaurant, certifier, state=CertificateState.REVOKED)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    assert response.status_code == 200
    body = response.json()

    statuses = {fact["status"] for fact in body["certificates"]}
    assert statuses == {"expired", "revoked"}

    for fact in body["certificates"]:
        assert "outcome" not in fact
        assert "reasons" not in fact
        assert "confidence" not in fact


def test_get_omits_certificates_from_inactive_certifier(client, session) -> None:
    active_certifier = make_certifier(session)
    inactive_certifier = make_certifier(session, is_active=False)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, active_certifier)
    make_certificate(session, restaurant, inactive_certifier)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    body = response.json()
    assert len(body["certificates"]) == 1
    assert body["certificates"][0]["certifier"]["id"] == str(active_certifier.id)


def test_get_restaurant_with_no_certificates_returns_empty_list(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    assert response.status_code == 200
    assert response.json()["certificates"] == []


def test_get_sets_cache_control_header(client, session) -> None:
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    assert response.headers["cache-control"] == "public, max-age=300"


def test_get_does_not_require_a_request_body(client, session) -> None:
    """Unlike POST /v1/restaurants/{id}, a plain GET with no body succeeds."""
    restaurant = make_restaurant(session)
    session.commit()

    response = client.get(f"/v1/restaurants/{restaurant.id}")

    assert response.status_code == 200
