"""Tests for ``POST /v1/restaurants/{id}`` (POC_PLAN.md B4, B8).

This is the product's core claim: the client must be able to render "why am I seeing
this answer" from this response alone. Tests assert the full-evidence shape (every
certificate, its certifier, its attributes with provenance, its own reason codes) and
the fail-safe paths, end to end through the real adapter + engine.
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


def test_detail_404_for_unknown_restaurant(client) -> None:
    response = client.post(f"/v1/restaurants/{uuid.uuid4()}", json={"profile": {}})

    assert response.status_code == 404


def test_detail_returns_full_evidence_per_certificate(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(
        session,
        restaurant,
        certifier,
        attributes={"glatt": True},
        source=CertificateSource.MODERATOR_VERIFIED,
        verified_by_label="moderator:alice",
    )
    session.commit()

    response = client.post(
        f"/v1/restaurants/{restaurant.id}",
        json={
            "profile": {
                "whitelist": [{"certifier_id": str(certifier.id)}],
                "required_attributes": ["glatt"],
            }
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["restaurant_id"] == str(restaurant.id)
    assert body["kashrut"]["verdict"] == "match"
    assert len(body["certificates"]) == 1

    evidence = body["certificates"][0]
    assert evidence["certifier"]["id"] == str(certifier.id)
    assert evidence["attributes"] == {"glatt": True}
    assert evidence["outcome"] == "match"
    assert evidence["provenance"]["source"] == "moderator_verified"
    assert evidence["provenance"]["verified_by_label"] == "moderator:alice"
    assert evidence["provenance"]["verified_at"] is not None


def test_detail_layer1_and_layer2_are_separate_objects(client, session) -> None:
    """AGENTS.md locked decision: the two layers are never blended. Assert the
    contract shape directly — kashrut.verdict is a string enum with no numeric
    field alongside it, fit.score is a plain 0-100 int in its own object.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        f"/v1/restaurants/{restaurant.id}",
        json={"profile": {"whitelist": [{"certifier_id": str(certifier.id)}]}},
    )

    body = response.json()
    assert set(body["kashrut"].keys()) == {
        "verdict",
        "reasons",
        "confidence",
        "freshness",
        "deciding_certificate_id",
    }
    assert isinstance(body["kashrut"]["verdict"], str)
    assert "score" not in body["kashrut"]
    assert isinstance(body["fit"]["score"], int)
    assert 0 <= body["fit"]["score"] <= 100
    assert "verdict" not in body["fit"]


def test_detail_unknown_when_certificate_missing_attribute_evidence(client, session) -> None:
    """Fail-safe: a required attribute the certificate does not mention is unknown,
    not false — it blocks MATCH but must not be reported as a definitive NO_MATCH.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    make_certificate(session, restaurant, certifier, attributes={})
    session.commit()

    response = client.post(
        f"/v1/restaurants/{restaurant.id}",
        json={
            "profile": {
                "whitelist": [{"certifier_id": str(certifier.id)}],
                "required_attributes": ["glatt"],
            }
        },
    )

    body = response.json()
    assert body["kashrut"]["verdict"] == "unknown"
    reason_codes = {r["code"] for r in body["kashrut"]["reasons"]}
    assert "attribute_unknown" in reason_codes


def test_detail_distance_km_computed_from_center(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, geo="SRID=4326;POINT(35.2137 31.7683)")
    make_certificate(session, restaurant, certifier)
    session.commit()

    response = client.post(
        f"/v1/restaurants/{restaurant.id}",
        json={
            "profile": {"whitelist": [{"certifier_id": str(certifier.id)}]},
            "center": {"lat": 31.7683, "lon": 35.2137},
        },
    )

    body = response.json()
    assert body["geo"] == {"lat": 31.7683, "lon": 35.2137}
    assert body["distance_km"] == pytest.approx(0.0, abs=0.01)
