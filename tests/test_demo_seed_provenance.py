"""``Certificate.is_demo_seed`` provenance (pre-commit fix, POC demo Thu 20 Aug 2026).

``scripts/seed_demo_attributes.py`` fabricates certificates and, like the real photo
review flow, may set ``source = CertificateSource.MODERATOR_VERIFIED`` on them. Without
a structured flag, a fabricated row and a genuinely moderator-verified row are
indistinguishable by ``source`` alone — this violates AGENTS.md's "every
kashrut-relevant field carries provenance" rule. ``is_demo_seed`` is that flag; these
tests assert it actually distinguishes the two cases, both at the DB layer and in the
public API's provenance output.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

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


def make_certifier(session) -> Certifier:
    certifier = Certifier(
        slug=f"certifier_{uuid.uuid4().hex[:8]}",
        name_he='בד"ץ בדיקה',
        name_en="Badatz Test",
        type=CertifierType.BADATZ,
        is_active=True,
    )
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


def test_is_demo_seed_defaults_false(session) -> None:
    """A certificate that never goes through the demo seed script is not demo data."""
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)

    assert certificate.is_demo_seed is False


def test_demo_and_genuine_moderator_verified_are_distinguishable_by_query(session) -> None:
    """Same ``source`` value, different ``is_demo_seed`` — a DB query must be able to
    tell the fabricated row from the genuine one; ``source`` alone cannot.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    genuine = make_certificate(
        session,
        restaurant,
        certifier,
        source=CertificateSource.MODERATOR_VERIFIED,
        verified_by_label="moderator:alice",
    )
    demo = make_certificate(
        session,
        restaurant,
        certifier,
        source=CertificateSource.MODERATOR_VERIFIED,
        verified_by_label="DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        is_demo_seed=True,
    )
    session.commit()

    assert genuine.source == demo.source

    demo_ids = set(
        session.execute(select(Certificate.id).where(Certificate.is_demo_seed.is_(True))).scalars()
    )

    assert demo_ids == {demo.id}
    assert genuine.id not in demo_ids


def test_provenance_api_surfaces_is_demo_seed(client, session) -> None:
    """The public detail API must expose ``is_demo_seed`` and it must actually differ
    between a genuine moderator-verified certificate and a demo-seeded one, even
    though both report the identical ``source``.
    """
    certifier = make_certifier(session)
    genuine_restaurant = make_restaurant(session)
    make_certificate(
        session,
        genuine_restaurant,
        certifier,
        source=CertificateSource.MODERATOR_VERIFIED,
        verified_by_label="moderator:alice",
    )
    demo_restaurant = make_restaurant(session)
    make_certificate(
        session,
        demo_restaurant,
        certifier,
        source=CertificateSource.MODERATOR_VERIFIED,
        verified_by_label="DEMO-SEED (POC 2026-08-20, not a real moderator review)",
        is_demo_seed=True,
    )
    session.commit()

    genuine_response = client.post(
        f"/v1/restaurants/{genuine_restaurant.id}",
        json={"profile": {"whitelist": [{"certifier_id": str(certifier.id)}]}},
    )
    demo_response = client.post(
        f"/v1/restaurants/{demo_restaurant.id}",
        json={"profile": {"whitelist": [{"certifier_id": str(certifier.id)}]}},
    )

    genuine_provenance = genuine_response.json()["certificates"][0]["provenance"]
    demo_provenance = demo_response.json()["certificates"][0]["provenance"]

    assert genuine_provenance["source"] == demo_provenance["source"] == "moderator_verified"
    assert genuine_provenance["is_demo_seed"] is False
    assert demo_provenance["is_demo_seed"] is True
