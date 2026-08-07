"""Moderation console API tests (SQLite-backed — see conftest).

The FastAPI dependency ``get_session`` is overridden with the test session; the
override commits after each request, mirroring production's ``session_scope``.
Auth uses the TEMPORARY bearer-token scheme with tokens patched into settings.
"""

from __future__ import annotations

import datetime as dt
import uuid
from zoneinfo import ZoneInfo

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
    CertificationLevel,
    Certifier,
    CertifierType,
    Flag,
    FlagState,
    FlagType,
    RecordState,
    Restaurant,
    RestaurantStatus,
)

TOKENS = {"tok-alice": "alice", "tok-bob": "bob"}
ALICE = {"Authorization": "Bearer tok-alice"}
BOB = {"Authorization": "Bearer tok-bob"}


def israel_today() -> dt.date:
    """Expiry/renewal date boundaries are civil dates in Israel (see app.api.admin)."""
    return dt.datetime.now(ZoneInfo("Asia/Jerusalem")).date()


# ------------------------------------------------------------------------ fixtures


@pytest.fixture
def client(session, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_tokens", dict(TOKENS))
    app = create_app()

    def _override_session():
        yield session
        session.commit()  # mirror session_scope: mutations + audit land together

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


def make_restaurant(
    session,
    *,
    name_he: str = "מסעדת בדיקה",
    city_slug: str = "jerusalem",
    city_he: str = "ירושלים",
    needs_review: bool = False,
    record_state: RecordState = RecordState.LIST_VERIFIED,
) -> Restaurant:
    restaurant = Restaurant(
        dedupe_key=f"test:{uuid.uuid4().hex}",
        name_he=name_he,
        city_he=city_he,
        city_slug=city_slug,
        record_state=record_state,
        needs_review=needs_review,
        corroboration_count=1,
        status=RestaurantStatus.OPEN,
        amenities={},
    )
    session.add(restaurant)
    session.flush()
    return restaurant


def make_certificate(
    session,
    restaurant: Restaurant,
    certifier: Certifier,
    *,
    state: CertificateState = CertificateState.ACTIVE,
    valid_until: dt.date | None = None,
) -> Certificate:
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=CertificationLevel.UNKNOWN,
        attributes={},
        valid_until=valid_until,
        state=state,
        source=CertificateSource.OFFICIAL_LIST,
        corroboration_count=1,
    )
    session.add(certificate)
    session.flush()
    return certificate


def make_flag(
    session,
    restaurant: Restaurant,
    certificate: Certificate | None = None,
    *,
    state: FlagState = FlagState.OPEN,
    flag_type: FlagType = FlagType.EXPIRED_CERTIFICATE,
) -> Flag:
    flag = Flag(
        restaurant_id=restaurant.id,
        certificate_id=certificate.id if certificate is not None else None,
        type=flag_type,
        state=state,
        message="דיווח קהילה",
    )
    session.add(flag)
    session.flush()
    return flag


def audit_rows(session, entity_type: str, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id)
            .order_by(AuditLog.created_at)
        )
    )


# ---------------------------------------------------------------------------- auth


def test_missing_token_is_401(client) -> None:
    for path in ["/api/admin/queues/review", "/api/admin/queues/flags", "/api/admin/audit"]:
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == "Bearer"


def test_bad_token_is_401(client) -> None:
    response = client.get("/api/admin/queues/review", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_wrong_scheme_is_401(client) -> None:
    response = client.get("/api/admin/queues/review", headers={"Authorization": "Basic tok-alice"})
    assert response.status_code == 401


def test_actor_resolution_flows_into_audit(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=BOB,
        json={"reason": "poster shows a different certifier"},
    )
    assert response.status_code == 200

    (entry,) = audit_rows(session, "certificate", certificate.id)
    assert entry.actor == "bob"


def test_health_endpoints_require_no_auth(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# -------------------------------------------------------------------------- queues


def test_review_queue_returns_flagged_restaurants_with_certificates(client, session) -> None:
    certifier = make_certifier(session)
    flagged = make_restaurant(session, needs_review=True, city_slug="jerusalem")
    make_certificate(session, flagged, certifier, state=CertificateState.PENDING)
    clean = make_restaurant(session, needs_review=False)
    make_certificate(session, clean, certifier)

    response = client.get("/api/admin/queues/review", headers=ALICE)
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 1
    (item,) = page["items"]
    assert item["id"] == str(flagged.id)
    assert item["needs_review"] is True
    # Provenance fields ride along.
    assert item["record_state"] == "list_verified"
    assert item["corroboration_count"] == 1
    (cert,) = item["certificates"]
    assert cert["state"] == "pending"
    assert cert["source"] == "official_list"
    # Frontend contract: certifier display identity rides along with each certificate.
    assert cert["certifier"] == {"name_he": 'בד"ץ בדיקה', "name_en": "Badatz Test"}


def test_review_queue_city_filter(client, session) -> None:
    make_restaurant(session, needs_review=True, city_slug="jerusalem")
    make_restaurant(session, needs_review=True, city_slug="tel-aviv")

    response = client.get("/api/admin/queues/review", headers=ALICE, params={"city": "tel-aviv"})
    page = response.json()
    assert page["total"] == 1
    assert page["items"][0]["city_slug"] == "tel-aviv"


def test_pagination_limit_and_offset(client, session) -> None:
    for _ in range(3):
        make_restaurant(session, needs_review=True)

    first = client.get(
        "/api/admin/queues/review", headers=ALICE, params={"limit": 1, "offset": 0}
    ).json()
    second = client.get(
        "/api/admin/queues/review", headers=ALICE, params={"limit": 1, "offset": 1}
    ).json()
    assert first["total"] == 3
    assert len(first["items"]) == 1
    assert len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]


def test_pagination_limit_capped_at_200(client) -> None:
    response = client.get("/api/admin/queues/review", headers=ALICE, params={"limit": 500})
    assert response.status_code == 422
    response = client.get("/api/admin/queues/review", headers=ALICE, params={"limit": 200})
    assert response.status_code == 200


def test_flag_queue_returns_unresolved_flags_joined(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, city_slug="haifa")
    certificate = make_certificate(session, restaurant, certifier)
    open_flag = make_flag(session, restaurant, certificate)
    in_review_flag = make_flag(session, restaurant, certificate, state=FlagState.IN_REVIEW)
    make_flag(session, restaurant, certificate, state=FlagState.RESOLVED)
    make_flag(session, restaurant, certificate, state=FlagState.REJECTED)

    response = client.get("/api/admin/queues/flags", headers=ALICE)
    page = response.json()
    # IN_REVIEW is not resolved — it stays listed (badged by `state`), no black hole.
    assert page["total"] == 2
    by_id = {item["id"]: item for item in page["items"]}
    assert by_id[str(open_flag.id)]["state"] == "open"
    assert by_id[str(in_review_flag.id)]["state"] == "in_review"
    item = by_id[str(open_flag.id)]
    assert item["restaurant"]["id"] == str(restaurant.id)
    assert item["certificate"]["id"] == str(certificate.id)
    assert item["certificate"]["certifier"]["name_he"] == 'בד"ץ בדיקה'

    filtered = client.get(
        "/api/admin/queues/flags", headers=ALICE, params={"city": "jerusalem"}
    ).json()
    assert filtered["total"] == 0


def test_expiry_queue_window_and_degraded_exclusion(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    today = israel_today()
    soon = make_certificate(session, restaurant, certifier, valid_until=today + dt.timedelta(days=7))
    make_certificate(session, restaurant, certifier, valid_until=today + dt.timedelta(days=30))
    overdue = make_certificate(session, restaurant, certifier, valid_until=today - dt.timedelta(days=3))
    # Already degraded — must not resurface in the queue.
    make_certificate(
        session,
        restaurant,
        certifier,
        state=CertificateState.EXPIRED,
        valid_until=today - dt.timedelta(days=3),
    )
    # No expiry known: freshness governs, not this queue.
    make_certificate(session, restaurant, certifier, valid_until=None)

    page = client.get("/api/admin/queues/expiry", headers=ALICE).json()
    assert page["total"] == 2
    ids = [item["certificate"]["id"] for item in page["items"]]
    assert ids == [str(overdue.id), str(soon.id)]  # most overdue first
    assert page["items"][0]["days_until_expiry"] == -3
    assert page["items"][1]["days_until_expiry"] == 7
    assert page["items"][0]["certificate"]["certifier"]["name_en"] == "Badatz Test"

    widened = client.get("/api/admin/queues/expiry", headers=ALICE, params={"days": 60}).json()
    assert widened["total"] == 3


def test_audit_endpoint_filters_and_orders_newest_first(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, needs_review=True)
    certificate = make_certificate(session, restaurant, certifier)

    client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "expired on site"},
    )
    client.post(
        f"/api/admin/restaurants/{restaurant.id}/resolve-review",
        headers=ALICE,
        json={"resolution": "approve", "note": "checked"},
    )

    page = client.get("/api/admin/audit", headers=ALICE).json()
    assert page["total"] == 2
    # seq is the authoritative order — strictly decreasing even when created_at ties.
    seqs = [item["seq"] for item in page["items"]]
    assert seqs == sorted(seqs, reverse=True)
    assert len(set(seqs)) == len(seqs)
    assert page["items"][0]["entity_type"] == "restaurant"  # the later action first

    filtered = client.get(
        "/api/admin/audit",
        headers=ALICE,
        params={"entity_type": "certificate", "entity_id": str(certificate.id)},
    ).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["entity_id"] == str(certificate.id)
    assert filtered["items"][0]["action"] == "state_change"


def test_audit_has_no_write_endpoint(client) -> None:
    response = client.post("/api/admin/audit", headers=ALICE, json={})
    assert response.status_code == 405


# ------------------------------------------------------------------ resolve-review


def test_resolve_review_approve_clears_needs_review_and_audits(client, session) -> None:
    restaurant = make_restaurant(session, needs_review=True)

    response = client.post(
        f"/api/admin/restaurants/{restaurant.id}/resolve-review",
        headers=ALICE,
        json={"resolution": "approve", "note": "poster matches, address confirmed"},
    )
    assert response.status_code == 200
    assert response.json()["needs_review"] is False
    assert restaurant.needs_review is False

    (entry,) = audit_rows(session, "restaurant", restaurant.id)
    assert entry.actor == "alice"
    assert entry.action is AuditAction.UPDATE
    assert entry.changes["needs_review"] == {"before": True, "after": False}
    assert entry.evidence["resolution"] == "approve"
    assert entry.evidence["note"] == "poster matches, address confirmed"


def test_resolve_review_reject_degrades_record_state(client, session) -> None:
    restaurant = make_restaurant(session, needs_review=True)

    response = client.post(
        f"/api/admin/restaurants/{restaurant.id}/resolve-review",
        headers=ALICE,
        json={"resolution": "reject", "note": "cannot locate the business"},
    )
    assert response.status_code == 200
    assert restaurant.needs_review is False
    assert restaurant.record_state is RecordState.UNKNOWN_PENDING_VERIFICATION

    (entry,) = audit_rows(session, "restaurant", restaurant.id)
    assert entry.changes["record_state"]["after"] == "unknown_pending_verification"


def test_resolve_review_needs_more_info_keeps_item_queued(client, session) -> None:
    restaurant = make_restaurant(session, needs_review=True)

    response = client.post(
        f"/api/admin/restaurants/{restaurant.id}/resolve-review",
        headers=ALICE,
        json={"resolution": "needs_more_info", "note": "send a runner for a photo"},
    )
    assert response.status_code == 200
    assert restaurant.needs_review is True

    (entry,) = audit_rows(session, "restaurant", restaurant.id)
    assert entry.changes == {}  # no transition, but the decision is on the record
    assert entry.evidence["note"] == "send a runner for a photo"


def test_resolve_review_unknown_restaurant_404(client, session) -> None:
    response = client.post(
        f"/api/admin/restaurants/{uuid.uuid4()}/resolve-review",
        headers=ALICE,
        json={"resolution": "approve", "note": None},
    )
    assert response.status_code == 404


# -------------------------------------------------------------------- resolve-flag


def test_resolve_flag_dismissed_closes_flag_and_touches_nothing_else(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)
    flag = make_flag(session, restaurant, certificate)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "dismissed", "note": "photo shows a current certificate"},
    )
    assert response.status_code == 200
    assert flag.state is FlagState.REJECTED
    assert flag.resolved_at is not None
    assert certificate.state is CertificateState.ACTIVE  # untouched

    (entry,) = audit_rows(session, "flag", flag.id)
    assert entry.action is AuditAction.STATE_CHANGE
    assert entry.changes["state"] == {"before": "open", "after": "rejected"}
    assert audit_rows(session, "certificate", certificate.id) == []


def test_resolve_flag_confirmed_degrade_degrades_certificate(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)
    flag = make_flag(session, restaurant, certificate)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=BOB,
        json={"outcome": "confirmed_degrade", "note": "certificate on wall is from 5784"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "resolved"
    assert body["certificate"]["state"] == "expired"
    assert certificate.state is CertificateState.EXPIRED
    assert flag.state is FlagState.RESOLVED

    (cert_entry,) = audit_rows(session, "certificate", certificate.id)
    assert cert_entry.actor == "bob"
    assert cert_entry.action is AuditAction.STATE_CHANGE
    assert cert_entry.changes["state"] == {"before": "active", "after": "expired"}
    assert cert_entry.evidence["flag_id"] == str(flag.id)
    (flag_entry,) = audit_rows(session, "flag", flag.id)
    assert flag_entry.changes["state"] == {"before": "open", "after": "resolved"}


def test_resolve_flag_needs_field_check_queues_restaurant(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, needs_review=False)
    certificate = make_certificate(session, restaurant, certifier)
    flag = make_flag(session, restaurant, certificate)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "needs_field_check", "note": "conflicting reports"},
    )
    assert response.status_code == 200
    assert flag.state is FlagState.IN_REVIEW
    assert restaurant.needs_review is True
    assert certificate.state is CertificateState.ACTIVE  # never touched by this path

    (entry,) = audit_rows(session, "restaurant", restaurant.id)
    assert entry.changes["needs_review"] == {"before": False, "after": True}
    (flag_entry,) = audit_rows(session, "flag", flag.id)
    assert flag_entry.action is AuditAction.STATE_CHANGE
    assert flag_entry.changes["state"] == {"before": "open", "after": "in_review"}
    assert flag_entry.evidence["note"] == "conflicting reports"

    # No black hole: the IN_REVIEW flag is still listed and still resolvable.
    queue = client.get("/api/admin/queues/flags", headers=ALICE).json()
    assert str(flag.id) in [item["id"] for item in queue["items"]]
    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "dismissed", "note": "field check found a valid certificate"},
    )
    assert response.status_code == 200
    assert flag.state is FlagState.REJECTED


def test_resolve_flag_rejects_unknown_outcome(client, session) -> None:
    """The invariant, at the boundary: there is no expressible outcome that raises a
    kashrut status — anything outside the closed set is a validation error.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)
    flag = make_flag(session, restaurant, certificate)

    for outcome in ["confirmed_restore", "reinstate", "activate", "approve"]:
        response = client.post(
            f"/api/admin/flags/{flag.id}/resolve",
            headers=ALICE,
            json={"outcome": outcome, "note": "trying to raise status"},
        )
        assert response.status_code == 422
    assert certificate.state is CertificateState.EXPIRED
    assert flag.state is FlagState.OPEN


def test_resolve_flag_degrade_cannot_raise_a_revoked_certificate(client, session) -> None:
    """REVOKED ranks below EXPIRED — 'degrading' it would actually raise it. Refused."""
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.REVOKED)
    flag = make_flag(session, restaurant, certificate)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "confirmed_degrade", "note": "runner photo confirms closure"},
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.REVOKED
    assert flag.state is FlagState.OPEN
    assert audit_rows(session, "certificate", certificate.id) == []


def test_resolve_flag_without_certificate_cannot_degrade(client, session) -> None:
    restaurant = make_restaurant(session)
    flag = make_flag(session, restaurant, None, flag_type=FlagType.CLOSED)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "confirmed_degrade", "note": "place reported closed for good"},
    )
    assert response.status_code == 409
    assert flag.state is FlagState.OPEN


def test_resolve_flag_already_resolved_conflicts(client, session) -> None:
    restaurant = make_restaurant(session)
    flag = make_flag(session, restaurant, None, state=FlagState.RESOLVED)

    response = client.post(
        f"/api/admin/flags/{flag.id}/resolve",
        headers=ALICE,
        json={"outcome": "dismissed", "note": "duplicate of an earlier report"},
    )
    assert response.status_code == 409


# ------------------------------------------------------------------------ degrade


def test_degrade_certificate_is_audited(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "certifier hotline says supervision ended"},
    )
    assert response.status_code == 200
    assert response.json()["state"] == "expired"
    assert certificate.state is CertificateState.EXPIRED

    (entry,) = audit_rows(session, "certificate", certificate.id)
    assert entry.actor == "alice"
    assert entry.action is AuditAction.STATE_CHANGE
    assert entry.changes["state"] == {"before": "active", "after": "expired"}
    assert entry.evidence["reason"] == "certifier hotline says supervision ended"


def test_degrade_twice_conflicts(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "again"},
    )
    assert response.status_code == 409
    assert audit_rows(session, "certificate", certificate.id) == []


def test_degrade_blank_reason_rejected(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "   "},
    )
    assert response.status_code == 422
    assert certificate.state is CertificateState.ACTIVE


# ----------------------------------------------------------------- verify-renewal


def test_verify_renewal_without_evidence_is_400_and_no_change(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    old_until = dt.date.today() - dt.timedelta(days=10)
    certificate = make_certificate(
        session, restaurant, certifier, state=CertificateState.EXPIRED, valid_until=old_until
    )

    for payload in [
        {"valid_until": str(dt.date.today() + dt.timedelta(days=365))},
        {
            "valid_until": str(dt.date.today() + dt.timedelta(days=365)),
            "evidence_note": "   ",
            "evidence_url": "",
        },
    ]:
        response = client.post(
            f"/api/admin/certificates/{certificate.id}/verify-renewal",
            headers=ALICE,
            json=payload,
        )
        assert response.status_code == 400
        assert "evidence" in response.json()["detail"]

    assert certificate.state is CertificateState.EXPIRED
    assert certificate.valid_until == old_until
    assert audit_rows(session, "certificate", certificate.id) == []


def test_verify_renewal_restores_expired_certificate(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(
        session,
        restaurant,
        certifier,
        state=CertificateState.EXPIRED,
        valid_until=dt.date.today() - dt.timedelta(days=5),
    )
    new_until = dt.date.today() + dt.timedelta(days=365)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={
            "valid_until": str(new_until),
            "evidence_note": "renewal certificate photographed on site",
            "evidence_photo_key": "evidence/2026/renewal-123.jpg",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "active"
    assert body["valid_until"] == str(new_until)
    assert body["source"] == "moderator_verified"
    assert body["verified_by_label"] == "moderator:alice"
    assert certificate.state is CertificateState.ACTIVE
    assert certificate.verified_at is not None

    (entry,) = audit_rows(session, "certificate", certificate.id)
    assert entry.actor == "alice"
    assert entry.action is AuditAction.STATE_CHANGE
    assert entry.changes["state"] == {"before": "expired", "after": "active"}
    assert entry.changes["valid_until"]["after"] == str(new_until)
    assert entry.evidence["evidence_note"] == "renewal certificate photographed on site"
    assert entry.evidence["evidence_photo_key"] == "evidence/2026/renewal-123.jpg"


def test_verify_renewal_cannot_restore_revoked(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.REVOKED)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={
            "valid_until": str(dt.date.today() + dt.timedelta(days=365)),
            "evidence_note": "owner insists it is fine",
        },
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.REVOKED
    assert audit_rows(session, "certificate", certificate.id) == []


def test_verify_renewal_rejects_past_or_today_valid_until(client, session) -> None:
    """Strictly future (civil date in Israel): a valid_until of today would re-enter
    the expiry queue immediately.
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)

    for bad_date in [israel_today() - dt.timedelta(days=1), israel_today()]:
        response = client.post(
            f"/api/admin/certificates/{certificate.id}/verify-renewal",
            headers=ALICE,
            json={"valid_until": str(bad_date), "evidence_note": "renewal photo from site visit"},
        )
        assert response.status_code == 400
    assert certificate.state is CertificateState.EXPIRED
    assert audit_rows(session, "certificate", certificate.id) == []


def test_verify_renewal_validates_evidence_quality(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)
    future = str(israel_today() + dt.timedelta(days=365))

    # A provided note must carry substance (>= 10 chars after strip).
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={"valid_until": future, "evidence_note": "ok"},
    )
    assert response.status_code == 422

    # A provided URL must actually be a URL.
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={"valid_until": future, "evidence_url": "not a url"},
    )
    assert response.status_code == 422

    assert certificate.state is CertificateState.EXPIRED
    assert audit_rows(session, "certificate", certificate.id) == []


def test_verify_renewal_url_evidence_alone_suffices(client, session) -> None:
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.EXPIRED)
    new_until = israel_today() + dt.timedelta(days=180)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={
            "valid_until": str(new_until),
            "evidence_url": "https://certifier.example/renewals/123",
        },
    )
    assert response.status_code == 200
    assert certificate.state is CertificateState.ACTIVE
    (entry,) = audit_rows(session, "certificate", certificate.id)
    assert entry.evidence["evidence_url"] == "https://certifier.example/renewals/123"


def test_verify_renewal_pending_certificate_conflicts(client, session) -> None:
    """Renewal evidence must not activate a PENDING certificate — the restore path
    exists for ACTIVE (extend) and EXPIRED (restore) only; a pending record goes
    through review first (fail-safe).
    """
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, needs_review=True)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.PENDING)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={
            "valid_until": str(israel_today() + dt.timedelta(days=365)),
            "evidence_note": "owner sent a renewal photo",
        },
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.PENDING
    assert audit_rows(session, "certificate", certificate.id) == []


def test_degrade_pending_certificate_is_allowed_and_audited(client, session) -> None:
    """PENDING outranks EXPIRED in the severity order, so degrading it is a lowering
    move and permitted."""
    certifier = make_certifier(session)
    restaurant = make_restaurant(session, needs_review=True)
    certificate = make_certificate(session, restaurant, certifier, state=CertificateState.PENDING)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "source document was withdrawn by the certifier"},
    )
    assert response.status_code == 200
    assert certificate.state is CertificateState.EXPIRED
    (entry,) = audit_rows(session, "certificate", certificate.id)
    assert entry.changes["state"] == {"before": "pending", "after": "expired"}


def test_degrade_state_recheck_guards_concurrent_revocation(client, session, monkeypatch) -> None:
    """The no-raise guard re-checks state on the row read under lock, not a stale
    read. SQLite cannot exercise the FOR UPDATE lock itself, so simulate a concurrent
    revocation landing between the read and the action: the re-check must 409 rather
    than overwrite REVOKED with EXPIRED (which would be a raise).
    """
    import app.api.admin as admin_module

    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier)  # ACTIVE at read time
    real_get = admin_module._get_or_404

    def get_then_race(session_, model, entity_id, label, *, for_update=False):
        obj = real_get(session_, model, entity_id, label, for_update=for_update)
        if model is Certificate:
            obj.state = CertificateState.REVOKED  # concurrent revocation commits here
        return obj

    monkeypatch.setattr(admin_module, "_get_or_404", get_then_race)
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/degrade",
        headers=ALICE,
        json={"reason": "kashrut hotline reports supervision ended"},
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.REVOKED  # not overwritten to EXPIRED
    assert audit_rows(session, "certificate", certificate.id) == []


# ------------------------------------------------------------------ note enforcement


def test_resolve_review_note_required_except_approve(client, session) -> None:
    restaurant = make_restaurant(session, needs_review=True)

    for payload in [
        {"resolution": "reject"},
        {"resolution": "reject", "note": "  no  "},  # < 5 chars after strip
        {"resolution": "needs_more_info"},
    ]:
        response = client.post(
            f"/api/admin/restaurants/{restaurant.id}/resolve-review",
            headers=ALICE,
            json=payload,
        )
        assert response.status_code == 422
    assert restaurant.needs_review is True
    assert audit_rows(session, "restaurant", restaurant.id) == []

    # approve may omit the note.
    response = client.post(
        f"/api/admin/restaurants/{restaurant.id}/resolve-review",
        headers=ALICE,
        json={"resolution": "approve"},
    )
    assert response.status_code == 200
    assert restaurant.needs_review is False


def test_resolve_flag_note_required_for_every_outcome(client, session) -> None:
    restaurant = make_restaurant(session)
    flag = make_flag(session, restaurant, None, flag_type=FlagType.CLOSED)

    for outcome in ["dismissed", "confirmed_degrade", "needs_field_check"]:
        for payload in [{"outcome": outcome}, {"outcome": outcome, "note": " abc "}]:
            response = client.post(
                f"/api/admin/flags/{flag.id}/resolve", headers=ALICE, json=payload
            )
            assert response.status_code == 422
    assert flag.state is FlagState.OPEN
    assert audit_rows(session, "flag", flag.id) == []
