"""Certificate hand-entry API tests (SQLite) — ``POST
/api/admin/restaurants/{id}/certificates`` and ``GET /api/admin/certifiers``.

Same harness as ``test_restaurant_directory_api``: ``get_session`` is overridden with
the test session and the override commits after each request.

The load-bearing case is ``test_active_with_no_evidence_is_accepted`` — it pins a
locked product decision (plan decision 1: ``state`` is the moderator's free choice,
with no server-side evidence gate) so a future reader does not "fix" it.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.db.session import get_session
from app.main import create_app
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    Certifier,
    CertifierType,
    RecordState,
    Restaurant,
    RestaurantStatus,
)

TOKENS = {"tok-alice": "alice"}
ALICE = {"Authorization": "Bearer tok-alice"}

CERTIFIERS = "/api/admin/certifiers"


@pytest.fixture
def client(session, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_tokens", dict(TOKENS))
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    with TestClient(app) as test_client:
        yield test_client


def make_restaurant(session) -> Restaurant:
    restaurant = Restaurant(
        dedupe_key=f"test:{uuid.uuid4().hex}",
        name_he="מסעדת בדיקה",
        city_he="ירושלים",
        city_slug="jerusalem",
        record_state=RecordState.LIST_VERIFIED,
        needs_review=False,
        corroboration_count=1,
        status=RestaurantStatus.OPEN,
        amenities={},
    )
    session.add(restaurant)
    session.flush()

    return restaurant


def make_certifier(
    session,
    *,
    name_he: str = 'בד"ץ בדיקה',
    name_en: str | None = "Badatz Test",
    is_active: bool = True,
) -> Certifier:
    certifier = Certifier(
        slug=f"certifier_{uuid.uuid4().hex[:8]}",
        name_he=name_he,
        name_en=name_en,
        type=CertifierType.BADATZ,
        is_active=is_active,
    )
    session.add(certifier)
    session.flush()

    return certifier


def certificates_url(restaurant_id: uuid.UUID) -> str:
    return f"/api/admin/restaurants/{restaurant_id}/certificates"


def certificate_payload(certifier_id: uuid.UUID, **overrides) -> dict:
    """
    A minimal, valid create-certificate request body.

    Parameters:
        certifier_id (uuid.UUID): The certifier to attach.
        **overrides: Fields to override in the default payload.

    Return:
        dict: The request body.
    """
    payload = {"certifier_id": str(certifier_id), "state": "active"}
    payload.update(overrides)

    return payload


def audit_rows(session, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == "certificate", AuditLog.entity_id == entity_id)
            .order_by(AuditLog.seq)
        )
    )


# ----------------------------------------------------------------------------- auth


def test_create_requires_a_moderator_token(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(certificates_url(restaurant.id), json=certificate_payload(certifier.id))

    assert response.status_code == 401


def test_certifiers_requires_a_moderator_token(client) -> None:
    response = client.get(CERTIFIERS)

    assert response.status_code == 401


# --------------------------------------------------------------------------- states


@pytest.mark.parametrize("state", list(CertificateState))
def test_every_certificate_state_is_accepted_verbatim(client, session, state) -> None:
    """Every ``CertificateState`` value is accepted with no server-side gate.

    ``ACTIVE`` in particular is included here on purpose: this is a locked product
    decision (plan decision 1), raised explicitly with the user and chosen anyway —
    a certificate can be hand-entered as ``active`` with zero evidence attached. The
    compensating control is the full audit row, not a validation gate. Do not add an
    evidence requirement here without a product conversation; that would silently
    reopen a decision the user already made.
    """
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(certifier.id, state=state.value),
    )

    assert response.status_code == 201
    assert response.json()["state"] == state.value


# ----------------------------------------------------------------------- provenance


def test_provenance_is_stamped_by_the_server(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id), headers=ALICE, json=certificate_payload(certifier.id)
    )

    body = response.json()
    assert body["source"] == CertificateSource.MODERATOR_VERIFIED.value
    assert body["verified_by_label"] == "moderator:alice"
    assert body["verified_at"] is not None
    assert body["corroboration_count"] == 1

    row = session.get(Certificate, uuid.UUID(body["id"]))
    assert row.is_demo_seed is False
    assert row.import_key is None


def test_client_supplied_provenance_fields_are_ignored(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(
            certifier.id,
            source="certifier_portal",
            verified_by_label="moderator:someone-else",
            corroboration_count=99,
            is_demo_seed=True,
        ),
    )

    body = response.json()
    assert body["source"] == CertificateSource.MODERATOR_VERIFIED.value
    assert body["verified_by_label"] == "moderator:alice"
    assert body["corroboration_count"] == 1


# --------------------------------------------------------------------------- attributes


def test_only_sent_attributes_are_stored(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(certifier.id, attributes={"glatt": True}),
    )

    assert response.json()["attributes"] == {"glatt": True}
    assert "pas_yisrael" not in response.json()["attributes"]


def test_unknown_attribute_key_is_422(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(certifier.id, attributes={"wifi": True}),
    )

    assert response.status_code == 422


def test_non_boolean_attribute_value_is_422(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(certifier.id, attributes={"glatt": "yes"}),
    )

    assert response.status_code == 422


def test_valid_until_before_valid_from_is_422(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(
            certifier.id,
            valid_from=dt.date(2026, 6, 1).isoformat(),
            valid_until=dt.date(2026, 1, 1).isoformat(),
        ),
    )

    assert response.status_code == 422


# --------------------------------------------------------------------------- 404s


def test_unknown_certifier_id_is_404_not_500(client, session) -> None:
    restaurant = make_restaurant(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(uuid.uuid4()),
    )

    assert response.status_code == 404


def test_unknown_restaurant_id_is_404(client, session) -> None:
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(uuid.uuid4()), headers=ALICE, json=certificate_payload(certifier.id)
    )

    assert response.status_code == 404


# ------------------------------------------------------------------------- audit row


def test_the_audit_row_records_the_create(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id),
        headers=ALICE,
        json=certificate_payload(certifier.id, note="תעודה על הקיר"),
    )

    certificate_id = uuid.UUID(response.json()["id"])
    rows = audit_rows(session, certificate_id)
    assert len(rows) == 1
    row = rows[0]
    assert row.action is AuditAction.CREATE
    assert row.actor == "alice"
    assert row.changes["state"] == {"before": None, "after": "active"}
    assert row.evidence["note"] == "תעודה על הקיר"
    assert row.evidence["certifier_slug"] == certifier.slug
    assert row.evidence["restaurant_id"] == str(restaurant.id)
    assert "tok-alice" not in str(row.evidence)
    assert "tok-alice" not in str(row.changes)


# ---------------------------------------------------------------------------- output


def test_response_carries_a_non_null_certifier(client, session) -> None:
    restaurant = make_restaurant(session)
    certifier = make_certifier(session)

    response = client.post(
        certificates_url(restaurant.id), headers=ALICE, json=certificate_payload(certifier.id)
    )

    assert response.json()["certifier"] is not None
    assert response.json()["certifier"]["name_he"] == certifier.name_he


# --------------------------------------------------------------------------- picker


def test_picker_is_active_only_by_default(client, session) -> None:
    active = make_certifier(session, name_he="פעיל")
    make_certifier(session, name_he="לא פעיל", is_active=False)

    body = client.get(CERTIFIERS, headers=ALICE).json()

    assert [item["id"] for item in body["items"]] == [str(active.id)]


def test_picker_include_inactive_returns_both(client, session) -> None:
    active = make_certifier(session, name_he="פעיל")
    inactive = make_certifier(session, name_he="לא פעיל", is_active=False)

    body = client.get(CERTIFIERS, headers=ALICE, params={"include_inactive": "true"}).json()

    assert {item["id"] for item in body["items"]} == {str(active.id), str(inactive.id)}


def test_picker_query_matches_name_he_name_en_and_slug(client, session) -> None:
    by_name_he = make_certifier(session, name_he="בית יוסף מיוחד", name_en="Other")
    by_name_en = make_certifier(session, name_he="אחר", name_en="Special House")
    make_certifier(session, name_he="שלישי", name_en="Third")

    hits = client.get(CERTIFIERS, headers=ALICE, params={"q": "special"}).json()
    hits_he = client.get(CERTIFIERS, headers=ALICE, params={"q": "מיוחד"}).json()
    hits_slug = client.get(CERTIFIERS, headers=ALICE, params={"q": by_name_he.slug}).json()

    assert {item["id"] for item in hits["items"]} == {str(by_name_en.id)}
    assert {item["id"] for item in hits_he["items"]} == {str(by_name_he.id)}
    assert {item["id"] for item in hits_slug["items"]} == {str(by_name_he.id)}


def test_picker_never_returns_a_level_or_ranking_field(client, session) -> None:
    make_certifier(session)

    item = client.get(CERTIFIERS, headers=ALICE).json()["items"][0]

    assert "level" not in item
    assert "levels" not in item
    assert "rank" not in item
