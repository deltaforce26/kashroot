"""Certificate evidence photos — upload, listing, and moderator review.

This is the entry point for source-hierarchy level 2 facts (PRD §13): a moderator
reads the physical certificate off a photo and records what it *says*. Nothing is
inferred, and an accepted review still cannot restore an expired certificate — that
stays the exclusive job of ``actions.verify_renewal`` (fail-safe).

Upload validation is deliberately paranoid: the declared Content-Type must agree
with the file's magic bytes, because the header alone is client-controlled.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.audit import apply_changes, jsonable, write_audit
from app.api.admin.consts import (
    AUDITED_UPLOAD_FIELDS,
    MAX_PHOTO_BYTES,
    MULTIPART_OVERHEAD_ALLOWANCE,
    PHOTO_EXTENSIONS,
    PHOTO_VERIFIED_SOURCE,
)
from app.api.admin.helpers import get_or_404, photo_out, today
from app.api.deps import get_media_storage, require_moderator
from app.api.schemas import EvidencePhotoOut, ReviewPhotoRequest
from app.db.session import get_session
from app.models import (
    SOURCE_AUTHORITY,
    AuditAction,
    Certificate,
    CertificateEvidencePhoto,
    EvidencePhotoStatus,
)
from app.storage import MediaStorage

router = APIRouter()


def content_length_exceeds_cap(content_length: str | None) -> bool:
    """
    Judge whether a declared request Content-Length can only mean an oversize file.

    Absent or malformed headers return False — those requests fall through to the
    post-read size check (chunked transfer has no Content-Length at all).

    Parameters:
        content_length (str | None): The raw header value.

    Return:
        bool: True when the request cannot possibly carry a valid file.
    """
    if content_length is None:
        return False
    try:
        declared = int(content_length)
    except ValueError:
        return False

    return declared > MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_ALLOWANCE


def magic_bytes_match(content_type: str, head: bytes) -> bool:
    """
    Sniff the file signature and require it to agree with the declared type.

    Parameters:
        content_type (str): The normalized declared Content-Type.
        head (bytes): The first bytes of the uploaded file.

    Return:
        bool: True when the signature matches the declared type.
    """
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if content_type == "application/pdf":
        return head.startswith(b"%PDF-")

    return False


@router.post(
    "/certificates/{certificate_id}/photos",
    response_model=EvidencePhotoOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_certificate_photo(
    certificate_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
    storage: MediaStorage = Depends(get_media_storage),
) -> EvidencePhotoOut:
    """Upload a photo (or PDF scan) of the physical certificate as evidence.

    The upload lands PENDING_REVIEW and changes **nothing** on the certificate —
    attributes, expiry and source can only move via an accepted review
    (``POST /photos/{id}/review``). Validation: declared Content-Type must be an
    accepted type AND agree with the file's magic bytes (the header alone is
    untrusted), ≤ 15 MB, and not a byte-identical duplicate of an existing photo of
    the same certificate (409).
    """
    # Cheapest rejection first: a declared Content-Length that cannot possibly carry a
    # valid file dies on the header, before this handler touches the (spooled) body.
    # Chunked/absent/malformed Content-Length falls through to the post-read check.
    if content_length_exceeds_cap(request.headers.get("content-length")):
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"request exceeds the {MAX_PHOTO_BYTES // (1024 * 1024)} MB upload limit",
        )

    certificate = get_or_404(session, Certificate, certificate_id, "certificate")

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    extension = PHOTO_EXTENSIONS.get(content_type)
    if extension is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"unsupported content type {content_type or '(none)'}; accepted: "
                + ", ".join(sorted(PHOTO_EXTENSIONS))
            ),
        )

    data = file.file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"file exceeds the {MAX_PHOTO_BYTES // (1024 * 1024)} MB limit",
        )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="empty file")
    if not magic_bytes_match(content_type, data[:16]):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"file signature does not match declared content type {content_type}; "
                "the header alone is not trusted"
            ),
        )

    sha256 = hashlib.sha256(data).hexdigest()
    duplicate = session.scalar(
        select(CertificateEvidencePhoto.id).where(
            CertificateEvidencePhoto.certificate_id == certificate.id,
            CertificateEvidencePhoto.sha256 == sha256,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"an identical file is already uploaded for this certificate ({duplicate})",
        )

    storage_key = f"cert-evidence/{certificate.id}/{uuid.uuid4()}.{extension}"
    photo = CertificateEvidencePhoto(
        certificate_id=certificate.id,
        storage_key=storage_key,
        content_type=content_type,
        size_bytes=len(data),
        sha256=sha256,
        uploaded_by=f"moderator:{actor}",
        uploaded_at=dt.datetime.now(dt.UTC),
        status=EvidencePhotoStatus.PENDING_REVIEW,
    )
    session.add(photo)
    try:
        session.flush()  # assign the id before auditing; a DB failure aborts pre-upload
    except IntegrityError:
        # Dedupe race: a concurrent identical upload won between our pre-check and the
        # flush. The unique (certificate_id, sha256) constraint is the backstop —
        # surface it as the same 409 the pre-check gives, not a 500.
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="an identical file is already uploaded for this certificate",
        ) from None
    storage.put(storage_key, data, content_type)

    try:
        write_audit(
            session,
            "certificate_evidence_photo",
            photo.id,
            AuditAction.CREATE,
            {
                field: {"before": None, "after": jsonable(getattr(photo, field))}
                for field in AUDITED_UPLOAD_FIELDS
            },
            actor,
            {
                "action": "upload_photo",
                "certificate_id": certificate.id,
                "filename": file.filename,
            },
        )

        return photo_out(photo, storage)
    except Exception:
        # The object is already in storage but this request will not commit its DB
        # row — best-effort cleanup so it does not become an orphan. (Commit failures
        # after this handler returns, and cascade deletes, can still orphan objects;
        # accepted ops debt — see NOTES.md, orphan sweep.)
        try:
            storage.delete(storage_key)
        except Exception:  # noqa: BLE001 - cleanup must never mask the real error
            pass
        raise


@router.get("/certificates/{certificate_id}/photos", response_model=list[EvidencePhotoOut])
def list_certificate_photos(
    certificate_id: uuid.UUID,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
    storage: MediaStorage = Depends(get_media_storage),
) -> list[EvidencePhotoOut]:
    """All evidence photos of a certificate (any status), oldest first, each with a
    short-lived presigned view URL.
    """
    get_or_404(session, Certificate, certificate_id, "certificate")
    photos = session.scalars(
        select(CertificateEvidencePhoto)
        .where(CertificateEvidencePhoto.certificate_id == certificate_id)
        .order_by(CertificateEvidencePhoto.uploaded_at.asc(), CertificateEvidencePhoto.id.asc())
    ).all()

    return [photo_out(p, storage) for p in photos]


@router.post("/photos/{photo_id}/review", response_model=EvidencePhotoOut)
def review_photo(
    photo_id: uuid.UUID,
    body: ReviewPhotoRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
    storage: MediaStorage = Depends(get_media_storage),
) -> EvidencePhotoOut:
    """Moderator review of an evidence photo — the entry point for source-hierarchy
    level 2 facts (PRD §13). The moderator records what the certificate *actually
    says*; nothing is inferred.

    * ``accept`` — the photo genuinely shows this certificate. Optionally writes onto
      the certificate exactly the facts the photo shows: ``attributes`` (tri-state —
      a sent key overrides the previous value because the photo is fresher evidence,
      an explicit null clears the key back to unknown per doubt → UNKNOWN, and absent
      keys are untouched) and ``valid_until``
      (strictly future civil date in Israel). The certificate's ``source`` is upgraded
      to the photo-verified level ONLY when that is a strict upgrade per
      SOURCE_AUTHORITY — provenance is never downgraded. ``verified_at`` /
      ``verified_by_label`` / ``evidence_photo_key`` are stamped. The certificate
      ``state`` is deliberately untouched: restoring an expired certificate remains
      the exclusive job of ``verify-renewal`` (fail-safe).
    * ``reject`` — the photo is unusable/mismatched: the photo is marked and the
      certificate is not touched in any way (the schema already refuses
      attributes/valid_until on reject).

    Concurrency: photo and certificate rows are read FOR UPDATE and the photo status
    is re-checked, so a double review 409s instead of double-writing.
    """
    photo = get_or_404(session, CertificateEvidencePhoto, photo_id, "photo", for_update=True)
    if photo.status is not EvidencePhotoStatus.PENDING_REVIEW:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"photo is already {photo.status.value}"
        )
    certificate = session.get(Certificate, photo.certificate_id, with_for_update=True)
    if certificate is None:  # pragma: no cover - FK guarantees existence
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="certificate not found")

    now = dt.datetime.now(dt.UTC)
    evidence: dict[str, Any] = {
        "action": "review_photo",
        "photo_id": photo.id,
        "decision": body.decision,
        "note": body.note,
    }

    if body.decision == "accept":
        if body.valid_until is not None and body.valid_until <= today():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=(
                    "valid_until must be strictly in the future (civil date in "
                    "Israel); an expired date is not a renewal"
                ),
            )
        values: dict[str, Any] = {
            "verified_at": now,
            "verified_by_label": f"moderator:{actor}",
            "evidence_photo_key": photo.storage_key,
        }
        if body.attributes:
            # Tri-state merge: true/false records the fact, explicit null CLEARS the
            # key back to unknown (doubt → UNKNOWN), absent keys are untouched.
            merged = dict(certificate.attributes)
            for key, value in body.attributes.items():
                if value is None:
                    merged.pop(key, None)
                else:
                    merged[key] = value
            values["attributes"] = merged
        if body.valid_until is not None:
            values["valid_until"] = body.valid_until
        if SOURCE_AUTHORITY[PHOTO_VERIFIED_SOURCE] > SOURCE_AUTHORITY[certificate.source]:
            values["source"] = PHOTO_VERIFIED_SOURCE
        cert_changes = apply_changes(certificate, values)
        write_audit(
            session,
            "certificate",
            certificate.id,
            AuditAction.UPDATE,
            cert_changes,
            actor,
            evidence,
        )

    photo_changes = apply_changes(
        photo,
        {
            "status": (
                EvidencePhotoStatus.ACCEPTED
                if body.decision == "accept"
                else EvidencePhotoStatus.REJECTED
            ),
            "reviewed_by": f"moderator:{actor}",
            "reviewed_at": now,
            "review_note": body.note,
        },
    )
    write_audit(
        session,
        "certificate_evidence_photo",
        photo.id,
        AuditAction.STATE_CHANGE,
        photo_changes,
        actor,
        evidence,
    )

    return photo_out(photo, storage)
