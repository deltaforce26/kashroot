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
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.audit import apply_changes, write_audit
from app.api.admin.consts import PHOTO_VERIFIED_SOURCE
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
from app.services.evidence_photos import (
    content_length_exceeds_cap,  # noqa: F401
    magic_bytes_match,  # noqa: F401
    store_evidence_photo,
)
from app.storage import MediaStorage

router = APIRouter()


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
    certificate = get_or_404(session, Certificate, certificate_id, "certificate")

    return store_evidence_photo(
        session,
        storage,
        certificate,
        request,
        file,
        uploaded_by=f"moderator:{actor}",
        actor=actor,
        audit_evidence={"filename": file.filename},
        finalize=lambda photo: photo_out(photo, storage),
    )


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
