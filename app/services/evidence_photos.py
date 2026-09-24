"""Shared certificate evidence-photo upload pipeline.

Both moderator uploads (``app.api.admin.photos``) and anonymous public uploads
(``app.api.public_photos``) land photos through :func:`store_evidence_photo`, so the
validation rules — declared Content-Type must be on an allow-list AND agree with the
file's magic bytes, a hard size cap, and sha256 dedupe against the same certificate —
are enforced exactly once. Callers differ only in which content types they allow and
what actor/uploader label they stamp; the fail-safe contract (the row lands
PENDING_REVIEW and nothing on the certificate changes) is identical for both paths.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from collections.abc import Callable, Mapping
from typing import TypeVar

from fastapi import HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.admin.audit import jsonable, write_audit
from app.api.admin.consts import (
    AUDITED_UPLOAD_FIELDS,
    MAX_PHOTO_BYTES,
    MULTIPART_OVERHEAD_ALLOWANCE,
    PHOTO_EXTENSIONS,
)
from app.models import AuditAction, Certificate, CertificateEvidencePhoto, EvidencePhotoStatus
from app.storage import MediaStorage

T = TypeVar("T")


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


def store_evidence_photo(
    session: Session,
    storage: MediaStorage,
    certificate: Certificate,
    request: Request,
    file: UploadFile,
    *,
    uploaded_by: str,
    actor: str,
    audit_evidence: dict[str, object],
    finalize: Callable[[CertificateEvidencePhoto], T],
    allowed_types: Mapping[str, str] = PHOTO_EXTENSIONS,
) -> T:
    """
    Validate, store and record one certificate evidence-photo upload.

    The row lands PENDING_REVIEW and this function never touches the certificate
    itself — only an accepted moderator review may write facts onto it. Validation,
    in order: a declared Content-Length that cannot possibly fit under
    ``MAX_PHOTO_BYTES`` (413, cheapest, before the body is read), an unsupported or
    mismatched Content-Type (415), an oversize or empty body (413/400), a magic-bytes
    mismatch with the declared type (400), and a byte-identical duplicate for the same
    certificate (409, both pre-check and unique-constraint backstop).

    Parameters:
        session (Session): The open session; the photo row and audit row join its
            transaction.
        storage (MediaStorage): Backend the accepted bytes are written to.
        certificate (Certificate): The certificate this photo is evidence for.
        request (Request): The inbound request, read only for its Content-Length
            header.
        file (UploadFile): The uploaded multipart file.
        uploaded_by (str): Actor label stamped on the photo row (e.g.
            ``"moderator:alice"`` or ``"public:anonymous"``).
        actor (str): Actor name written into the audit row.
        audit_evidence (dict[str, object]): Extra evidence fields merged into the
            audit row's evidence JSON (``action`` and ``certificate_id`` are added by
            this function).
        finalize (Callable[[CertificateEvidencePhoto], T]): Called with the newly
            created photo row, in the same failure-cleanup scope as the audit write —
            a caller that serializes the response here (e.g. minting a presigned URL)
            gets the same best-effort storage cleanup on failure as an audit-write
            failure would.
        allowed_types (Mapping[str, str]): Accepted Content-Type -> object-key
            extension. Defaults to every type the admin path accepts; the public path
            passes an image-only subset.

    Return:
        T: Whatever ``finalize`` returns for the newly created, PENDING_REVIEW photo
            row.
    """
    if content_length_exceeds_cap(request.headers.get("content-length")):
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"request exceeds the {MAX_PHOTO_BYTES // (1024 * 1024)} MB upload limit",
        )

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    extension = allowed_types.get(content_type)
    if extension is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"unsupported content type {content_type or '(none)'}; accepted: "
                + ", ".join(sorted(allowed_types))
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
        uploaded_by=uploaded_by,
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
            {"action": "upload_photo", "certificate_id": certificate.id, **audit_evidence},
        )

        return finalize(photo)
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
