"""Certificate evidence photo flow (upload → review → certificate facts).

This is the entry point for source-hierarchy level 2 data (PRD §13): attributes and
expiry dates may ONLY reach a certificate through an ACCEPTED photo review. Storage is
the in-memory fake — no test may ever touch S3.
"""

from __future__ import annotations

import datetime as dt
import hashlib
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
    AuditAction,
    AuditLog,
    Certificate,
    CertificateEvidencePhoto,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    EvidencePhotoStatus,
    RecordState,
    Restaurant,
    RestaurantStatus,
)
from app.storage import InMemoryMediaStorage

TOKENS = {"tok-alice": "alice", "tok-bob": "bob"}
ALICE = {"Authorization": "Bearer tok-alice"}
BOB = {"Authorization": "Bearer tok-bob"}

# Real file signatures with junk bodies — magic-byte sniffing only reads the head.
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 128
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
WEBP_BYTES = b"RIFF\x00\x01\x00\x00WEBP" + b"\x00" * 128
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
        session.commit()  # mirror session_scope: mutations + audit land together

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_media_storage] = lambda: storage
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


def make_restaurant(session, *, city_slug: str = "jerusalem") -> Restaurant:
    restaurant = Restaurant(
        dedupe_key=f"test:{uuid.uuid4().hex}",
        name_he="מסעדת בדיקה",
        city_he="ירושלים",
        city_slug=city_slug,
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
    attributes: dict | None = None,
    valid_until: dt.date | None = None,
) -> Certificate:
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=CertificationLevel.UNKNOWN,
        attributes=attributes or {},
        valid_until=valid_until,
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
    certificate_id,
    *,
    data: bytes = JPEG_BYTES,
    content_type: str = "image/jpeg",
    filename: str = "certificate.jpg",
    headers: dict = ALICE,
):
    return client.post(
        f"/api/admin/certificates/{certificate_id}/photos",
        headers=headers,
        files={"file": (filename, data, content_type)},
    )


def audit_rows(session, entity_type: str, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id)
            .order_by(AuditLog.seq)
        )
    )


# ---------------------------------------------------------------------------- auth


def test_photo_endpoints_require_auth(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)
    some_id = uuid.uuid4()

    unauthenticated = [
        ("post", f"/api/admin/certificates/{certificate.id}/photos", {}),
        ("get", f"/api/admin/certificates/{certificate.id}/photos", {}),
        ("post", f"/api/admin/photos/{some_id}/review", {}),
        ("get", "/api/admin/queues/photos", {}),
    ]
    for method, path, _ in unauthenticated:
        response = getattr(client, method)(path)
        assert response.status_code == 401, (method, path)
        assert response.headers["WWW-Authenticate"] == "Bearer"

    # And a bad token is just as dead.
    response = client.get(
        "/api/admin/queues/photos", headers={"Authorization": "Bearer nope"}
    )
    assert response.status_code == 401
    assert storage.objects == {}  # nothing ever reached storage


# -------------------------------------------------------------------------- upload


def test_upload_happy_path_stores_and_audits(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)

    response = upload(client, certificate.id)
    assert response.status_code == 201
    body = response.json()
    assert body["certificate_id"] == str(certificate.id)
    assert body["status"] == "pending_review"
    assert body["content_type"] == "image/jpeg"
    assert body["size_bytes"] == len(JPEG_BYTES)
    assert body["sha256"] == hashlib.sha256(JPEG_BYTES).hexdigest()
    assert body["uploaded_by"] == "moderator:alice"
    assert body["storage_key"].startswith(f"cert-evidence/{certificate.id}/")
    assert body["storage_key"].endswith(".jpg")
    assert body["view_url"].startswith("https://fake-storage.test/")

    # Bytes really landed in (fake) storage under the returned key.
    assert storage.objects[body["storage_key"]] == JPEG_BYTES
    assert storage.content_types[body["storage_key"]] == "image/jpeg"

    # The upload changed NOTHING on the certificate (fail-safe).
    assert certificate.attributes == {}
    assert certificate.source is CertificateSource.OFFICIAL_LIST
    assert certificate.verified_at is None
    assert audit_rows(session, "certificate", certificate.id) == []

    (entry,) = audit_rows(session, "certificate_evidence_photo", uuid.UUID(body["id"]))
    assert entry.actor == "alice"
    assert entry.action is AuditAction.CREATE
    assert entry.changes["sha256"]["after"] == body["sha256"]
    assert entry.changes["status"]["after"] == "pending_review"
    assert entry.evidence["action"] == "upload_photo"
    assert entry.evidence["certificate_id"] == str(certificate.id)
    assert entry.evidence["filename"] == "certificate.jpg"


def test_upload_pdf_and_webp_accepted(client, session) -> None:
    _, certificate = make_cert_chain(session)

    response = upload(
        client, certificate.id, data=PDF_BYTES, content_type="application/pdf", filename="scan.pdf"
    )
    assert response.status_code == 201
    assert response.json()["storage_key"].endswith(".pdf")

    response = upload(
        client, certificate.id, data=WEBP_BYTES, content_type="image/webp", filename="photo.webp"
    )
    assert response.status_code == 201
    assert response.json()["storage_key"].endswith(".webp")


def test_upload_unknown_certificate_404(client, session) -> None:
    response = upload(client, uuid.uuid4())
    assert response.status_code == 404


def test_upload_unsupported_content_type_415(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)
    response = upload(
        client, certificate.id, data=b"GIF89a" + b"\x00" * 32, content_type="image/gif"
    )
    assert response.status_code == 415
    assert storage.objects == {}
    assert session.scalars(select(CertificateEvidencePhoto)).all() == []


def test_upload_wrong_magic_bytes_400(client, session, storage) -> None:
    """The declared header alone is never trusted: PNG bytes declared as JPEG die."""
    _, certificate = make_cert_chain(session)

    response = upload(client, certificate.id, data=PNG_BYTES, content_type="image/jpeg")
    assert response.status_code == 400
    assert "signature" in response.json()["detail"]

    # A PDF pretending to be an image dies too.
    response = upload(client, certificate.id, data=PDF_BYTES, content_type="image/png")
    assert response.status_code == 400

    assert storage.objects == {}
    assert session.scalars(select(CertificateEvidencePhoto)).all() == []
    assert audit_rows(session, "certificate", certificate.id) == []


def test_upload_oversize_413(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)
    oversize = b"\xff\xd8\xff\xe0" + b"\x00" * (15 * 1024 * 1024)  # 15 MB + 4 bytes

    response = upload(client, certificate.id, data=oversize)
    assert response.status_code == 413
    assert storage.objects == {}
    assert session.scalars(select(CertificateEvidencePhoto)).all() == []


def test_upload_content_length_header_precheck() -> None:
    """The declared Content-Length is judged before the body is touched; absent or
    malformed headers fall through to the post-read check instead of erroring."""
    from app.api.admin.consts import MAX_PHOTO_BYTES, MULTIPART_OVERHEAD_ALLOWANCE
    from app.api.admin.photos import content_length_exceeds_cap

    cap = MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_ALLOWANCE
    assert content_length_exceeds_cap(str(cap + 1)) is True
    assert content_length_exceeds_cap(str(cap)) is False
    assert content_length_exceeds_cap(str(MAX_PHOTO_BYTES)) is False
    assert content_length_exceeds_cap("123") is False
    assert content_length_exceeds_cap(None) is False
    assert content_length_exceeds_cap("not-a-number") is False


def test_upload_oversize_content_length_rejected_before_body_read(
    client, session, storage
) -> None:
    """A forged/huge Content-Length dies on the header alone: the tiny (valid) body
    would otherwise upload fine, so a 413 proves the pre-read check fired."""
    _, certificate = make_cert_chain(session)

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/photos",
        headers={**ALICE, "Content-Length": str(16 * 1024 * 1024 + 50_000)},
        files={"file": ("certificate.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert response.status_code == 413
    assert storage.objects == {}
    assert session.scalars(select(CertificateEvidencePhoto)).all() == []


def test_upload_oversize_chunked_without_content_length_413(client, session, storage) -> None:
    """Chunked transfer carries no Content-Length — the post-read size check must
    still refuse the oversize body."""
    _, certificate = make_cert_chain(session)
    boundary = "kashroot-test-boundary"
    body = (
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="file"; filename="big.jpg"\r\n'
            "Content-Type: image/jpeg\r\n\r\n"
        ).encode()
        + b"\xff\xd8\xff\xe0"
        + b"\x00" * (15 * 1024 * 1024)
        + f"\r\n--{boundary}--\r\n".encode()
    )

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/photos",
        headers={**ALICE, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        content=iter([body]),  # iterator body => chunked, no Content-Length
    )
    assert response.status_code == 413
    assert storage.objects == {}
    assert session.scalars(select(CertificateEvidencePhoto)).all() == []


def test_upload_duplicate_sha256_same_certificate_409(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)

    assert upload(client, certificate.id).status_code == 201
    response = upload(client, certificate.id, filename="same-bytes-again.jpg")
    assert response.status_code == 409
    assert len(storage.objects) == 1  # second copy never stored

    # The same bytes for a DIFFERENT certificate are fine — dedupe is per certificate.
    _, other = make_cert_chain(session)
    assert upload(client, other.id).status_code == 201


def test_upload_duplicate_race_surfaces_db_constraint_as_409(
    client, session, storage, monkeypatch
) -> None:
    """Two identical uploads racing: the loser's pre-check misses the winner's row,
    the unique (certificate_id, sha256) constraint fires on flush, and the API turns
    that IntegrityError into the same 409 — never a 500."""
    _, certificate = make_cert_chain(session)
    assert upload(client, certificate.id).status_code == 201  # the race winner

    # Simulate the loser's stale read: its duplicate pre-check sees nothing.
    monkeypatch.setattr(session, "scalar", lambda *args, **kwargs: None)
    response = upload(client, certificate.id)
    assert response.status_code == 409
    assert "identical" in response.json()["detail"]
    assert len(storage.objects) == 1  # loser never stored its copy


# ---------------------------------------------------------------------------- list


def test_list_photos_returns_presigned_urls(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)
    first = upload(client, certificate.id).json()
    second = upload(client, certificate.id, data=PNG_BYTES, content_type="image/png").json()

    response = client.get(f"/api/admin/certificates/{certificate.id}/photos", headers=ALICE)
    assert response.status_code == 200
    photos = response.json()
    assert [p["id"] for p in photos] == [first["id"], second["id"]]  # oldest first
    for photo, extension in zip(photos, ["jpg", "png"], strict=True):
        # Presigned by the (fake) storage backend: short expiry + forced disposition.
        assert photo["view_url"] == (
            f"https://fake-storage.test/{photo['storage_key']}?expires_in=900"
            f'&disposition=inline; filename="evidence.{extension}"'
        )

    assert client.get(f"/api/admin/certificates/{uuid.uuid4()}/photos", headers=ALICE).status_code == 404


def test_presigned_urls_force_pdf_download(client, session, storage) -> None:
    """Images view inline; PDFs are forced to attachment so a PDF-polyglot can never
    run script in the browser viewer (mirrored by the fake from the S3 params)."""
    _, certificate = make_cert_chain(session)
    upload(client, certificate.id, data=PDF_BYTES, content_type="application/pdf")

    (photo,) = client.get(
        f"/api/admin/certificates/{certificate.id}/photos", headers=ALICE
    ).json()
    assert 'disposition=attachment; filename="evidence.pdf"' in photo["view_url"]
    assert "inline" not in photo["view_url"]


def test_upload_cleans_up_stored_object_when_request_fails_after_put(
    client, session, storage, monkeypatch
) -> None:
    """If the request dies after the object landed in storage but before the response,
    the object is deleted best-effort — no orphan for a row that will never commit."""
    import app.api.admin.photos as photos_module

    _, certificate = make_cert_chain(session)

    def explode(photo, storage_):
        raise RuntimeError("presign exploded")

    monkeypatch.setattr(photos_module, "photo_out", explode)
    with pytest.raises(RuntimeError):
        upload(client, certificate.id)
    assert storage.objects == {}  # the stored object was cleaned up


# -------------------------------------------------------------------------- review


def test_review_accept_writes_facts_and_audits(client, session) -> None:
    _, certificate = make_cert_chain(session, attributes={"glatt": True})
    photo_id = upload(client, certificate.id).json()["id"]
    new_until = israel_today() + dt.timedelta(days=365)

    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=BOB,
        json={
            "decision": "accept",
            "note": "certificate clearly legible, details match",
            "attributes": {"chalav_yisrael": True, "pas_yisrael": False},
            "valid_until": str(new_until),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "accepted"
    assert body["reviewed_by"] == "moderator:bob"
    assert body["review_note"] == "certificate clearly legible, details match"

    # Tri-state merge: sent keys written, pre-existing key untouched, unsent unknown.
    assert certificate.attributes == {
        "glatt": True,
        "chalav_yisrael": True,
        "pas_yisrael": False,
    }
    assert certificate.valid_until == new_until
    assert certificate.source is CertificateSource.MODERATOR_VERIFIED  # upgraded
    assert certificate.verified_at is not None
    assert certificate.verified_by_label == "moderator:bob"
    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert certificate.evidence_photo_key == photo.storage_key
    assert certificate.state is CertificateState.ACTIVE  # state never moves here

    (cert_entry,) = audit_rows(session, "certificate", certificate.id)
    assert cert_entry.actor == "bob"
    assert cert_entry.action is AuditAction.UPDATE
    assert cert_entry.changes["source"] == {"before": "official_list", "after": "moderator_verified"}
    assert cert_entry.changes["attributes"]["before"] == {"glatt": True}
    assert cert_entry.changes["attributes"]["after"] == certificate.attributes
    assert cert_entry.changes["valid_until"]["after"] == str(new_until)
    assert cert_entry.evidence["photo_id"] == photo_id
    assert cert_entry.evidence["decision"] == "accept"

    upload_entry, review_entry = audit_rows(
        session, "certificate_evidence_photo", uuid.UUID(photo_id)
    )
    assert review_entry.action is AuditAction.STATE_CHANGE
    assert review_entry.changes["status"] == {"before": "pending_review", "after": "accepted"}


def test_review_accept_never_downgrades_higher_source(client, session) -> None:
    """A certificate already sourced above the photo-verified level (certifier portal)
    keeps its provenance — an accepted photo corroborates, it never downgrades."""
    _, certificate = make_cert_chain(session, source=CertificateSource.CERTIFIER_PORTAL)
    photo_id = upload(client, certificate.id).json()["id"]

    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={
            "decision": "accept",
            "note": "photo matches the portal record",
            "attributes": {"glatt": True},
        },
    )
    assert response.status_code == 200
    assert certificate.source is CertificateSource.CERTIFIER_PORTAL  # NOT downgraded
    assert certificate.attributes == {"glatt": True}  # facts still land
    assert certificate.verified_at is not None

    (cert_entry,) = audit_rows(session, "certificate", certificate.id)
    assert "source" not in cert_entry.changes


def test_review_accept_upgrades_from_lower_authority_sources(client, session) -> None:
    for source in (CertificateSource.OWNER_SUBMITTED, CertificateSource.FIELD_VERIFICATION):
        _, certificate = make_cert_chain(session, source=source)
        photo_id = upload(client, certificate.id).json()["id"]
        response = client.post(
            f"/api/admin/photos/{photo_id}/review",
            headers=ALICE,
            json={"decision": "accept", "note": "verified against the photo"},
        )
        assert response.status_code == 200
        assert certificate.source is CertificateSource.MODERATOR_VERIFIED, source


def test_review_reject_changes_nothing_on_certificate(client, session) -> None:
    _, certificate = make_cert_chain(
        session, attributes={"glatt": True}, valid_until=israel_today() + dt.timedelta(days=30)
    )
    before_attributes = dict(certificate.attributes)
    before_until = certificate.valid_until
    photo_id = upload(client, certificate.id).json()["id"]

    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={"decision": "reject", "note": "photo is blurry, certifier illegible"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"

    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert photo.status is EvidencePhotoStatus.REJECTED
    assert photo.reviewed_by == "moderator:alice"
    # The certificate is untouched in every way (fail-safe).
    assert certificate.attributes == before_attributes
    assert certificate.valid_until == before_until
    assert certificate.source is CertificateSource.OFFICIAL_LIST
    assert certificate.verified_at is None
    assert certificate.evidence_photo_key is None
    assert audit_rows(session, "certificate", certificate.id) == []

    # The rejection itself is on the record.
    entries = audit_rows(session, "certificate_evidence_photo", uuid.UUID(photo_id))
    assert entries[-1].changes["status"] == {"before": "pending_review", "after": "rejected"}


def test_review_attributes_on_reject_422(client, session) -> None:
    _, certificate = make_cert_chain(session)
    photo_id = upload(client, certificate.id).json()["id"]

    for extra in [
        {"attributes": {"glatt": True}},
        {"valid_until": str(israel_today() + dt.timedelta(days=30))},
    ]:
        response = client.post(
            f"/api/admin/photos/{photo_id}/review",
            headers=ALICE,
            json={"decision": "reject", "note": "bad photo but sneaky payload", **extra},
        )
        assert response.status_code == 422
    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert photo.status is EvidencePhotoStatus.PENDING_REVIEW
    assert certificate.attributes == {}


def test_review_invalid_attribute_key_422(client, session) -> None:
    _, certificate = make_cert_chain(session)
    photo_id = upload(client, certificate.id).json()["id"]

    # Unknown keys and non-strict-boolean values (coercible truthiness like 1/"true"/
    # "yes" included — a kashrut fact is a literal boolean, null, or absent).
    for attributes in [{"treif": True}, {"glatt": "yes"}, {"glatt": 1}, {"glatt": "true"}]:
        response = client.post(
            f"/api/admin/photos/{photo_id}/review",
            headers=ALICE,
            json={"decision": "accept", "note": "looks fine to me", "attributes": attributes},
        )
        assert response.status_code == 422
    assert certificate.attributes == {}
    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert photo.status is EvidencePhotoStatus.PENDING_REVIEW


def test_review_accept_null_clears_attribute_to_unknown(client, session) -> None:
    """Explicit null on accept clears the key back to unknown (doubt → UNKNOWN):
    the photo shows the certificate no longer rules on that attribute."""
    _, certificate = make_cert_chain(
        session, attributes={"glatt": True, "chalav_yisrael": True}
    )
    photo_id = upload(client, certificate.id).json()["id"]

    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={
            "decision": "accept",
            "note": "new certificate no longer lists glatt",
            "attributes": {"glatt": None},
        },
    )
    assert response.status_code == 200
    # glatt is gone (unknown), the untouched key survives.
    assert certificate.attributes == {"chalav_yisrael": True}

    (cert_entry,) = audit_rows(session, "certificate", certificate.id)
    assert cert_entry.changes["attributes"] == {
        "before": {"glatt": True, "chalav_yisrael": True},
        "after": {"chalav_yisrael": True},
    }


def test_review_accept_null_on_unset_key_is_noop(client, session) -> None:
    _, certificate = make_cert_chain(session, attributes={"glatt": True})
    photo_id = upload(client, certificate.id).json()["id"]

    response = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={
            "decision": "accept",
            "note": "photo says nothing new about pas yisrael",
            "attributes": {"pas_yisrael": None},
        },
    )
    assert response.status_code == 200
    assert certificate.attributes == {"glatt": True}  # untouched

    # The accept itself is audited (verified_at etc.) but no attributes change is
    # recorded — clearing an already-unknown key is a no-op.
    (cert_entry,) = audit_rows(session, "certificate", certificate.id)
    assert "attributes" not in cert_entry.changes
    assert "verified_at" in cert_entry.changes


def test_review_accept_past_valid_until_400(client, session) -> None:
    _, certificate = make_cert_chain(session)
    photo_id = upload(client, certificate.id).json()["id"]

    for bad_date in [israel_today(), israel_today() - dt.timedelta(days=1)]:
        response = client.post(
            f"/api/admin/photos/{photo_id}/review",
            headers=ALICE,
            json={"decision": "accept", "note": "date on certificate", "valid_until": str(bad_date)},
        )
        assert response.status_code == 400
    assert certificate.valid_until is None
    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert photo.status is EvidencePhotoStatus.PENDING_REVIEW
    assert audit_rows(session, "certificate", certificate.id) == []


def test_review_twice_409(client, session) -> None:
    _, certificate = make_cert_chain(session)
    photo_id = upload(client, certificate.id).json()["id"]

    first = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=ALICE,
        json={"decision": "reject", "note": "photo shows a different address"},
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/admin/photos/{photo_id}/review",
        headers=BOB,
        json={"decision": "accept", "note": "second look says accept"},
    )
    assert second.status_code == 409
    photo = session.get(CertificateEvidencePhoto, uuid.UUID(photo_id))
    assert photo.status is EvidencePhotoStatus.REJECTED  # first decision stands
    assert audit_rows(session, "certificate", certificate.id) == []


def test_review_unknown_photo_404(client, session) -> None:
    response = client.post(
        f"/api/admin/photos/{uuid.uuid4()}/review",
        headers=ALICE,
        json={"decision": "reject", "note": "does not exist"},
    )
    assert response.status_code == 404


# ------------------------------------------------------- verify-renewal photo keys


def test_verify_renewal_with_unaccepted_photo_key_409(client, session) -> None:
    _, certificate = make_cert_chain(session, state=CertificateState.EXPIRED)
    pending_key = upload(client, certificate.id).json()["storage_key"]

    payload = {
        "valid_until": str(israel_today() + dt.timedelta(days=365)),
        "evidence_photo_key": pending_key,
    }
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal", headers=ALICE, json=payload
    )
    assert response.status_code == 409
    assert "accepted" in response.json()["detail"]
    assert certificate.state is CertificateState.EXPIRED

    # A key that references nothing at all is just as dead.
    payload["evidence_photo_key"] = "cert-evidence/nowhere/nothing.jpg"
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal", headers=ALICE, json=payload
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.EXPIRED


def test_verify_renewal_with_foreign_photo_key_409(client, session) -> None:
    """An accepted photo of a DIFFERENT certificate is not evidence for this one."""
    _, certificate = make_cert_chain(session, state=CertificateState.EXPIRED)
    _, other = make_cert_chain(session)
    other_photo = upload(client, other.id).json()
    accepted = client.post(
        f"/api/admin/photos/{other_photo['id']}/review",
        headers=ALICE,
        json={"decision": "accept", "note": "fine for the other certificate"},
    )
    assert accepted.status_code == 200

    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={
            "valid_until": str(israel_today() + dt.timedelta(days=365)),
            "evidence_photo_key": other_photo["storage_key"],
        },
    )
    assert response.status_code == 409
    assert certificate.state is CertificateState.EXPIRED
    assert audit_rows(session, "certificate", certificate.id) == []


def test_verify_renewal_with_accepted_photo_key_ok(client, session) -> None:
    _, certificate = make_cert_chain(session, state=CertificateState.EXPIRED)
    photo = upload(client, certificate.id).json()
    accepted = client.post(
        f"/api/admin/photos/{photo['id']}/review",
        headers=ALICE,
        json={"decision": "accept", "note": "renewal certificate photographed on site"},
    )
    assert accepted.status_code == 200

    new_until = israel_today() + dt.timedelta(days=365)
    response = client.post(
        f"/api/admin/certificates/{certificate.id}/verify-renewal",
        headers=ALICE,
        json={"valid_until": str(new_until), "evidence_photo_key": photo["storage_key"]},
    )
    assert response.status_code == 200
    assert certificate.state is CertificateState.ACTIVE
    assert certificate.valid_until == new_until
    assert certificate.evidence_photo_key == photo["storage_key"]


# --------------------------------------------------------------------------- queue


def test_photo_queue_lists_pending_only(client, session, storage) -> None:
    _, certificate = make_cert_chain(session)
    pending_first = upload(client, certificate.id).json()
    pending_second = upload(
        client, certificate.id, data=PNG_BYTES, content_type="image/png"
    ).json()
    reviewed = upload(client, certificate.id, data=PDF_BYTES, content_type="application/pdf").json()
    client.post(
        f"/api/admin/photos/{reviewed['id']}/review",
        headers=ALICE,
        json={"decision": "reject", "note": "not this restaurant"},
    )

    page = client.get("/api/admin/queues/photos", headers=ALICE).json()
    assert page["total"] == 2
    ids = [item["photo"]["id"] for item in page["items"]]
    assert ids == [pending_first["id"], pending_second["id"]]  # oldest first
    for item in page["items"]:
        assert item["photo"]["status"] == "pending_review"
        assert item["photo"]["view_url"].startswith("https://fake-storage.test/")
        assert item["certificate"]["id"] == str(certificate.id)
        assert item["certificate"]["certifier"]["name_en"] == "Badatz Test"
        assert item["restaurant"]["city_slug"] == "jerusalem"

    # City filter.
    empty = client.get(
        "/api/admin/queues/photos", headers=ALICE, params={"city": "tel-aviv"}
    ).json()
    assert empty["total"] == 0

    # Accepting the remaining two empties the queue.
    for photo_id in ids:
        client.post(
            f"/api/admin/photos/{photo_id}/review",
            headers=ALICE,
            json={"decision": "accept", "note": "certificate checks out"},
        )
    assert client.get("/api/admin/queues/photos", headers=ALICE).json()["total"] == 0


# ---------------------------------------------------------- migration consistency


def test_migration_0004_matches_model_structurally():
    """Column-by-column parity between the 0004 migration and the
    CertificateEvidencePhoto model — offline, no live DB (same harness as 0002)."""
    import importlib.util
    from pathlib import Path

    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    from app.db.base import Base

    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0004_certificate_evidence_photo.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0004", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    class CaptureOp:
        def __init__(self):
            self.tables = {}
            self.indexes = []
            self.statements = []

        def f(self, name):
            return name

        def execute(self, sql):
            self.statements.append(sql)

        def create_table(self, name, *args, **kwargs):
            table = sa.Table(name, sa.MetaData(), *args, **kwargs)
            self.tables[name] = table
            return table

        def create_index(self, name, table_name, columns, **kwargs):
            self.indexes.append((name, table_name, tuple(columns)))

    capture = CaptureOp()
    migration.op = capture
    migration.upgrade()

    # The enum type is created before the table references it.
    assert any("evidence_photo_status" in s for s in capture.statements)

    migrated = capture.tables["certificate_evidence_photo"]
    model = Base.metadata.tables["certificate_evidence_photo"]
    dialect = postgresql.dialect()

    assert [c.name for c in migrated.columns] == [c.name for c in model.columns]
    for name in (c.name for c in model.columns):
        migrated_col, model_col = migrated.columns[name], model.columns[name]
        assert migrated_col.type.compile(dialect) == model_col.type.compile(dialect), name
        assert migrated_col.nullable == model_col.nullable, name

    def unique_sets(table):
        return {
            tuple(c.name for c in constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }

    assert (
        unique_sets(migrated)
        == unique_sets(model)
        == {("certificate_id", "sha256"), ("storage_key",)}
    )
    assert {c.name for c in migrated.primary_key.columns} == {"id"}
    # Both indexes the model declares are created by the migration.
    index_columns = {cols for (_, _, cols) in capture.indexes}
    assert index_columns == {("certificate_id",), ("status",)}
