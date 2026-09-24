"""Public (anonymous) certificate photo upload + flag flow.

Modeled on ``tests/test_photo_flow.py``: same fixtures, same in-memory storage, same
"the upload changes nothing on the certificate" fail-safe assertions. These endpoints
have no auth — anyone can call them — so the tests exercise the extra guards that
protect a certificate from being spammed or silently reassigned: at most one pending
public upload per certificate, no upload at all once one has been accepted, and a
``certificate_id`` that must actually belong to the named restaurant.
"""

from __future__ import annotations

import datetime as dt
import uuid
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_media_storage
from app.core.config import settings
from app.db.session import get_session
from app.main import create_app
from app.models import (
    AuditLog,
    Certificate,
    CertificateEvidencePhoto,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    EvidencePhotoStatus,
    Flag,
    FlagState,
    RecordState,
    Restaurant,
    RestaurantStatus,
)
from app.services.rate_limit import InMemoryRateLimitBackend, get_rate_limit_backend
from app.storage import InMemoryMediaStorage

TOKENS = {"tok-alice": "alice"}
ALICE = {"Authorization": "Bearer tok-alice"}

JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 128
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n" + b"0" * 128


def israel_today() -> dt.date:
    return dt.datetime.now(ZoneInfo("Asia/Jerusalem")).date()


# ------------------------------------------------------------------------ fixtures


@pytest.fixture
def storage() -> InMemoryMediaStorage:
    return InMemoryMediaStorage()


@pytest.fixture
def client(session, monkeypatch, storage):
    monkeypatch.setattr(settings, "admin_api_tokens", dict(TOKENS))
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_media_storage] = lambda: storage
    # A fresh, unshared backend per test — these tests exercise the upload endpoint
    # many times each, well past the real per-IP defaults, and share a TestClient
    # host across the whole suite; this isolates each test from every other's count
    # instead of loosening the limiter itself. See tests/test_rate_limit.py for
    # dedicated coverage of the limiter's own behavior.
    rate_limit_backend = InMemoryRateLimitBackend()
    app.dependency_overrides[get_rate_limit_backend] = lambda: rate_limit_backend
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


def make_certificate(
    session,
    restaurant: Restaurant,
    certifier: Certifier,
    *,
    state: CertificateState = CertificateState.ACTIVE,
    source: CertificateSource = CertificateSource.OFFICIAL_LIST,
) -> Certificate:
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=CertificationLevel.UNKNOWN,
        attributes={},
        state=state,
        source=source,
        corroboration_count=1,
    )
    session.add(certificate)
    session.flush()
    return certificate


def make_cert_chain(session, **cert_kwargs):
    certifier = make_certifier(session)
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant, certifier, **cert_kwargs)
    return restaurant, certificate


def upload(
    client,
    restaurant_id,
    certificate_id,
    *,
    data: bytes = JPEG_BYTES,
    content_type: str = "image/jpeg",
    filename: str = "certificate.jpg",
):
    return client.post(
        f"/v1/restaurants/{restaurant_id}/certificate-photo",
        data={"certificate_id": str(certificate_id)},
        files={"file": (filename, data, content_type)},
    )


def accept_via_admin(client, certificate_id, photo_id) -> None:
    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={"decision": "accept", "note": "looks legit"},
    )
    assert response.status_code == 200


def detail(client, restaurant_id):
    return client.post(
        f"/v1/restaurants/{restaurant_id}",
        json={"profile": {"whitelist": [], "required_attributes": []}},
    )


def audit_rows_for(session, entity_type: str, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id
            )
        )
    )


# -------------------------------------------------------------------- photo upload


def test_public_upload_happy_path_pending_and_certificate_unchanged(
    client, session, storage
) -> None:
    restaurant, certificate = make_cert_chain(session)

    response = upload(client, restaurant.id, certificate.id)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"
    photo_id = uuid.UUID(body["photo_id"])

    photo = session.get(CertificateEvidencePhoto, photo_id)
    assert photo.status is EvidencePhotoStatus.PENDING_REVIEW
    assert photo.uploaded_by == "public:anonymous"
    assert photo.certificate_id == certificate.id
    assert storage.objects[photo.storage_key] == JPEG_BYTES

    assert certificate.evidence_photo_key is None
    assert certificate.attributes == {}
    assert certificate.source is CertificateSource.OFFICIAL_LIST
    assert certificate.verified_at is None

    (entry,) = audit_rows_for(session, "certificate_evidence_photo", photo_id)
    assert entry.actor == "public:anonymous"


def test_public_upload_second_while_pending_409(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)

    first = upload(client, restaurant.id, certificate.id)
    assert first.status_code == 201

    second = upload(client, restaurant.id, certificate.id, filename="other.jpg")
    assert second.status_code == 409
    assert second.json()["detail"] == "photo_pending"


def test_public_upload_after_accept_409(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)

    first = upload(client, restaurant.id, certificate.id)
    photo_id = first.json()["photo_id"]
    accept_via_admin(client, certificate.id, photo_id)

    response = upload(client, restaurant.id, certificate.id, filename="another.jpg")
    assert response.status_code == 409
    assert response.json()["detail"] == "photo_exists"


def test_public_upload_pdf_rejected_415(client, session, storage) -> None:
    restaurant, certificate = make_cert_chain(session)

    response = upload(
        client,
        restaurant.id,
        certificate.id,
        data=PDF_BYTES,
        content_type="application/pdf",
        filename="scan.pdf",
    )
    assert response.status_code == 415
    assert storage.objects == {}


def test_public_upload_oversize_413(client, session, storage) -> None:
    from app.api.admin.consts import MAX_PHOTO_BYTES

    restaurant, certificate = make_cert_chain(session)
    oversize = b"\xff\xd8\xff\xe0" + b"\x00" * (MAX_PHOTO_BYTES + 1)

    response = upload(client, restaurant.id, certificate.id, data=oversize)
    assert response.status_code == 413
    assert storage.objects == {}


def test_public_upload_unknown_restaurant_404(client, session) -> None:
    _, certificate = make_cert_chain(session)
    response = upload(client, uuid.uuid4(), certificate.id)
    assert response.status_code == 404


def test_public_upload_unknown_certificate_404(client, session) -> None:
    restaurant = make_restaurant(session)
    response = upload(client, restaurant.id, uuid.uuid4())
    assert response.status_code == 404


def test_public_upload_certificate_from_another_restaurant_404(client, session) -> None:
    restaurant, _ = make_cert_chain(session)
    _, other_certificate = make_cert_chain(session)

    response = upload(client, restaurant.id, other_certificate.id)
    assert response.status_code == 404


def test_public_upload_missing_certificate_id_422(client, session) -> None:
    restaurant, _ = make_cert_chain(session)
    response = client.post(
        f"/v1/restaurants/{restaurant.id}/certificate-photo",
        files={"file": ("certificate.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 422


def test_public_upload_png_accepted(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)
    response = upload(
        client, restaurant.id, certificate.id, data=PNG_BYTES, content_type="image/png"
    )
    assert response.status_code == 201


# -------------------------------------------------------------------------- detail


def test_detail_photo_status_none(client, session) -> None:
    restaurant, _ = make_cert_chain(session)

    response = detail(client, restaurant.id)
    assert response.status_code == 200
    (evidence,) = response.json()["certificates"]
    assert evidence["photo_status"] == "none"
    assert evidence["photo_url"] is None


def test_detail_photo_status_pending(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)
    upload(client, restaurant.id, certificate.id)

    response = detail(client, restaurant.id)
    (evidence,) = response.json()["certificates"]
    assert evidence["photo_status"] == "pending"
    assert evidence["photo_url"] is None


def test_detail_photo_status_accepted(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)
    photo_id = upload(client, restaurant.id, certificate.id).json()["photo_id"]
    accept_via_admin(client, certificate.id, photo_id)

    response = detail(client, restaurant.id)
    (evidence,) = response.json()["certificates"]
    assert evidence["photo_status"] == "accepted"
    assert evidence["photo_url"] is not None
    assert evidence["photo_url"].startswith("https://fake-storage.test/")


# ------------------------------------------------------------------------------ flags


def test_public_flag_creates_open_flag_and_leaves_status_unchanged(client, session) -> None:
    restaurant, certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={
            "type": "no_certificate_displayed",
            "certificate_id": str(certificate.id),
            "message": "couldn't find the sign",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["state"] == "open"
    flag_id = uuid.UUID(body["flag_id"])

    flag = session.get(Flag, flag_id)
    assert flag.state is FlagState.OPEN
    assert flag.restaurant_id == restaurant.id
    assert flag.certificate_id == certificate.id
    assert flag.user_id is None
    assert flag.message == "couldn't find the sign"

    assert certificate.state is CertificateState.ACTIVE

    (entry,) = audit_rows_for(session, "flag", flag_id)
    assert entry.actor == "public:anonymous"
    assert entry.evidence["action"] == "create_flag"


def test_public_flag_without_certificate_id_leaves_it_null(client, session) -> None:
    restaurant, _ = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other"},
    )
    assert response.status_code == 201
    flag = session.get(Flag, uuid.UUID(response.json()["flag_id"]))
    assert flag.certificate_id is None


def test_public_flag_unknown_restaurant_404(client, session) -> None:
    response = client.post(
        f"/v1/restaurants/{uuid.uuid4()}/flags",
        json={"type": "other"},
    )
    assert response.status_code == 404


def test_public_flag_certificate_from_another_restaurant_404(client, session) -> None:
    restaurant, _ = make_cert_chain(session)
    _, other_certificate = make_cert_chain(session)

    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other", "certificate_id": str(other_certificate.id)},
    )
    assert response.status_code == 404


def test_public_flag_message_too_long_422(client, session) -> None:
    restaurant, _ = make_cert_chain(session)
    response = client.post(
        f"/v1/restaurants/{restaurant.id}/flags",
        json={"type": "other", "message": "x" * 1001},
    )
    assert response.status_code == 422
