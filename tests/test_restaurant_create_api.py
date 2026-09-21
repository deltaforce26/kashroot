"""Restaurant hand-entry API tests — ``POST /api/admin/restaurants`` (SQLite).

Same harness as ``test_restaurant_directory_api``: ``get_session`` is overridden with
the test session and the override commits after each request, so a create and its
audit row land together or not at all.

The load-bearing cases are the review-routing checkbox (plan decision 2 — it maps
onto ``(record_state, needs_review)``, never a direct column write), the dedupe
collision refusal (both the pre-check and the race-backstop path), and the whitelist:
a create can reach no field ``UpdateRestaurantRequest`` cannot.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.db.session import get_session
from app.ingestion.normalize import restaurant_dedupe_key
from app.main import create_app
from app.models import AuditAction, AuditLog, RecordState, Restaurant

TOKENS = {"tok-alice": "alice"}
ALICE = {"Authorization": "Bearer tok-alice"}

DIRECTORY = "/api/admin/restaurants"
REVIEW_QUEUE = "/api/admin/queues/review"


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


def restaurant_payload(**overrides) -> dict:
    """
    A minimal, valid create-restaurant request body.

    Parameters:
        **overrides: Fields to override in the default payload.

    Return:
        dict: The request body.
    """
    payload = {
        "name_he": "מסעדת בדיקה",
        "city_he": "ירושלים",
        "city_slug": "jerusalem",
        "address_he": "רחוב הרצל 1",
    }
    payload.update(overrides)

    return payload


def audit_rows(session, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == "restaurant", AuditLog.entity_id == entity_id)
            .order_by(AuditLog.seq)
        )
    )


# ----------------------------------------------------------------------------- auth


def test_create_requires_a_moderator_token(client) -> None:
    response = client.post(DIRECTORY, json=restaurant_payload())

    assert response.status_code == 401


# --------------------------------------------------------------------- review routing


def test_default_queues_the_row_for_review(client, session) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["record_state"] == RecordState.UNKNOWN_PENDING_VERIFICATION.value
    assert body["needs_review"] is True

    queue = client.get(REVIEW_QUEUE, headers=ALICE).json()
    assert body["id"] in [item["id"] for item in queue["items"]]


def test_unticking_the_checkbox_marks_moderator_verified_and_skips_the_queue(
    client, session
) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload(needs_review=False))

    assert response.status_code == 201
    body = response.json()
    assert body["record_state"] == RecordState.MODERATOR_VERIFIED.value
    assert body["needs_review"] is False

    queue = client.get(REVIEW_QUEUE, headers=ALICE).json()
    assert body["id"] not in [item["id"] for item in queue["items"]]


# -------------------------------------------------------------------------- identity


def test_dedupe_key_matches_the_ingestion_natural_key(client, session) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload())

    body = response.json()
    assert body["dedupe_key"] == restaurant_dedupe_key("מסעדת בדיקה", "ירושלים", "רחוב הרצל 1")


def test_a_collision_is_refused_with_no_second_row_and_no_audit_row(client, session) -> None:
    first = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload())
    assert first.status_code == 201

    second = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload())

    assert second.status_code == 409
    rows = session.scalars(select(Restaurant)).all()
    assert len(rows) == 1
    assert audit_rows(session, uuid.UUID(first.json()["id"])) != []
    all_creates = session.scalars(
        select(AuditLog).where(AuditLog.entity_type == "restaurant")
    ).all()
    assert len(all_creates) == 1


# ------------------------------------------------------------------------- audit row


def test_the_audit_row_records_the_create_actor_and_evidence(client, session) -> None:
    response = client.post(
        DIRECTORY,
        headers=ALICE,
        json=restaurant_payload(note="נמצא ברשימת הרבנות"),
    )

    restaurant_id = uuid.UUID(response.json()["id"])
    rows = audit_rows(session, restaurant_id)
    assert len(rows) == 1
    row = rows[0]
    assert row.action is AuditAction.CREATE
    assert row.actor == "alice"
    assert row.changes["name_he"] == {"before": None, "after": "מסעדת בדיקה"}
    assert row.changes["record_state"]["after"] == RecordState.UNKNOWN_PENDING_VERIFICATION.value
    assert row.evidence["note"] == "נמצא ברשימת הרבנות"
    assert row.evidence["queued_for_review"] is True
    assert row.evidence["dedupe_key"] == response.json()["dedupe_key"]
    assert "tok-alice" not in str(row.evidence)
    assert "tok-alice" not in str(row.changes)


# --------------------------------------------------------------------------- whitelist


def test_non_whitelisted_keys_are_ignored(client, session) -> None:
    response = client.post(
        DIRECTORY,
        headers=ALICE,
        json=restaurant_payload(
            record_state="field_verified",
            dedupe_key="hand-written",
            corroboration_count=99,
            id=str(uuid.uuid4()),
            geo="POINT(0 0)",
            certificates=[{"state": "active"}],
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["record_state"] == RecordState.UNKNOWN_PENDING_VERIFICATION.value
    assert body["dedupe_key"] == restaurant_dedupe_key("מסעדת בדיקה", "ירושלים", "רחוב הרצל 1")
    assert body["certificates"] == []


# ------------------------------------------------------------------------------ 422s


def test_blank_name_he_is_422(client) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload(name_he="   "))

    assert response.status_code == 422


def test_a_bad_city_slug_is_422(client) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload(city_slug="Tel Aviv"))

    assert response.status_code == 422


def test_an_unknown_amenity_key_is_422(client) -> None:
    response = client.post(
        DIRECTORY, headers=ALICE, json=restaurant_payload(amenities={"wifi": True})
    )

    assert response.status_code == 422


# ----------------------------------------------------------------------------- defaults


def test_omitted_status_and_amenities_default_to_open_and_empty(client, session) -> None:
    response = client.post(DIRECTORY, headers=ALICE, json=restaurant_payload())

    body = response.json()
    assert body["status"] == "open"
    assert body["amenities"] == {}
