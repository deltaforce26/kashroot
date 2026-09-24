"""Public (anonymous) certificate photo uploads and restaurant flags — ``/v1/*``.

No auth, no accounts (see ``app.api.public`` — same POC shortcut). Both endpoints
here mirror an existing moderator-only capability with the same fail-safe contract:
neither ever changes a certificate's kashrut-relevant facts. An uploaded photo lands
PENDING_REVIEW and is only ever attached to a certificate's provenance through an
accepted moderator review (``app.api.admin.photos.review_photo``); a flag only ever
opens a community report for the moderation console's flag queue
(``app.api.admin.queues.flag_queue``) — it can trigger review or a degrade later, but
this endpoint itself writes no status anywhere (PRD §13 fail-safe).

Neither endpoint resolves "the" certificate itself. The certificate card the user
sees is chosen by their own kashrut profile on the client (the detail endpoint's
Layer 1 gate), and this router has no profile to re-derive that choice from — so the
client passes ``certificate_id`` explicitly, and the server only checks it actually
belongs to the named restaurant.
"""

from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.audit import jsonable, write_audit
from app.api.consts import (
    ERROR_CERTIFICATE_NOT_FOUND_FOR_RESTAURANT,
    ERROR_PHOTO_EXISTS,
    ERROR_PHOTO_PENDING,
    ERROR_RESTAURANT_NOT_FOUND,
    IMAGE_ONLY_PHOTO_EXTENSIONS,
    PUBLIC_ANONYMOUS_ACTOR,
)
from app.api.deps import get_media_storage
from app.api.schemas_public import FlagCreateRequest, FlagCreateResponse, PublicPhotoUploadResponse
from app.core.config import settings
from app.db.session import get_session
from app.models import (
    AuditAction,
    Certificate,
    CertificateEvidencePhoto,
    EvidencePhotoStatus,
    Flag,
    FlagState,
    Restaurant,
)
from app.services.evidence_photos import store_evidence_photo
from app.services.notifications import (
    EmailSender,
    get_email_sender,
    notify_flag_created,
    parse_recipients,
)
from app.services.rate_limit import require_photo_upload_rate_limit
from app.storage import MediaStorage

router = APIRouter(prefix="/v1", tags=["public"])


def _restaurant_exists(session: Session, restaurant_id: uuid.UUID) -> bool:
    """
    Check a restaurant id resolves to a row, with no further loading.

    Parameters:
        session (Session): The open session.
        restaurant_id (uuid.UUID): The restaurant's primary key.

    Return:
        bool: True when the restaurant exists.
    """
    return session.scalar(select(Restaurant.id).where(Restaurant.id == restaurant_id)) is not None


def _get_owned_certificate_or_404(
    session: Session,
    restaurant_id: uuid.UUID,
    certificate_id: uuid.UUID,
    *,
    for_update: bool = False,
) -> Certificate:
    """
    Load a certificate, requiring both the restaurant and the certificate-on-that-
    restaurant to exist.

    ``for_update=True`` takes a row lock (``SELECT ... FOR UPDATE``) so a concurrent
    call for the same certificate serializes on this row instead of racing it — see
    the upload endpoint, which is the only caller that needs it: the flag endpoint
    writes a brand-new row and has nothing to race on the certificate itself.

    Parameters:
        session (Session): The open session.
        restaurant_id (uuid.UUID): The restaurant the certificate must belong to.
        certificate_id (uuid.UUID): The certificate's primary key.
        for_update (bool): Whether to take a row lock. SQLite (tests) ignores it,
            which is why the accepted/pending guards downstream are re-checks against
            the read, not lock-only.

    Return:
        Certificate: The certificate, confirmed to belong to that restaurant.
    """
    if not _restaurant_exists(session, restaurant_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_RESTAURANT_NOT_FOUND)

    certificate = session.get(
        Certificate, certificate_id, with_for_update=True if for_update else None
    )
    if certificate is None or certificate.restaurant_id != restaurant_id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=ERROR_CERTIFICATE_NOT_FOUND_FOR_RESTAURANT
        )

    return certificate


@router.post(
    "/restaurants/{restaurant_id}/certificate-photo",
    response_model=PublicPhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_public_certificate_photo(
    restaurant_id: uuid.UUID,
    request: Request,
    certificate_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    storage: MediaStorage = Depends(get_media_storage),
    _rate_limit: None = Depends(require_photo_upload_rate_limit),
) -> PublicPhotoUploadResponse:
    """Anonymous upload of a photo of one of a restaurant's certificates.

    ``certificate_id`` is the certificate card the client is showing the user (their
    own profile already chose it) — this endpoint only verifies it belongs to
    ``restaurant_id`` (404 otherwise). Images only (jpeg/png/webp) — PDF scans stay
    admin-only. The upload lands PENDING_REVIEW and never touches the certificate;
    only an accepted moderator review does that. Refuses with 409 ``photo_exists``
    when the certificate already has an accepted photo (``evidence_photo_key`` set)
    and with 409 ``photo_pending`` when one is already awaiting review — at most one
    pending public upload per certificate, so the same certificate cannot be spammed.
    Rate-limited per client IP (``app.services.rate_limit``): the attempt is counted
    before this function's body runs at all, so a rejected oversized file still
    counts against the caller's limit.

    Concurrency: the certificate row is read ``FOR UPDATE`` before the accepted/
    pending checks, so two concurrent anonymous uploads for the same certificate
    serialize on this row in Postgres — the second waits for the first's transaction
    to commit and then re-reads a certificate/photo state that already reflects it,
    rather than both passing the checks and both landing a photo. No unique index
    backs this (unlike the admin path's sha256 dedupe): several PENDING_REVIEW photos
    on one certificate are legitimate when a moderator uploads them, so uniqueness
    can only be "at most one *public* pending upload", which is a query, not a
    constraint — the lock is what makes that query race-free.
    """
    certificate = _get_owned_certificate_or_404(
        session, restaurant_id, certificate_id, for_update=True
    )

    if certificate.evidence_photo_key is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=ERROR_PHOTO_EXISTS)

    pending_photo_id = session.scalar(
        select(CertificateEvidencePhoto.id).where(
            CertificateEvidencePhoto.certificate_id == certificate.id,
            CertificateEvidencePhoto.status == EvidencePhotoStatus.PENDING_REVIEW,
        )
    )
    if pending_photo_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=ERROR_PHOTO_PENDING)

    return store_evidence_photo(
        session,
        storage,
        certificate,
        request,
        file,
        uploaded_by=PUBLIC_ANONYMOUS_ACTOR,
        actor=PUBLIC_ANONYMOUS_ACTOR,
        audit_evidence={"filename": file.filename, "restaurant_id": restaurant_id},
        finalize=lambda photo: PublicPhotoUploadResponse(photo_id=photo.id, status="pending"),
        allowed_types=IMAGE_ONLY_PHOTO_EXTENSIONS,
    )


@router.post(
    "/restaurants/{restaurant_id}/flags",
    response_model=FlagCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_public_flag(
    restaurant_id: uuid.UUID,
    body: FlagCreateRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    email_sender: EmailSender = Depends(get_email_sender),
) -> FlagCreateResponse:
    """Anonymous community report. Opens an OPEN flag in the moderation console's
    flag queue and writes an audit row; it never changes a restaurant's or
    certificate's status itself (PRD §13 fail-safe) — only a moderator resolving the
    flag can do that (``app.api.admin.actions.resolve_flag``).

    ``body.certificate_id`` is optional — the client passes the certificate card it
    was showing when it has one; a report with none is still a valid restaurant-level
    flag (``certificate_id`` null). When given, it must belong to the restaurant
    (404 otherwise).

    An email notification (``app.services.notifications``) is queued via
    ``BackgroundTasks`` after the flag is committed, so a slow or failing send never
    delays or fails this response.
    """
    certificate: Certificate | None = None
    if body.certificate_id is not None:
        certificate = _get_owned_certificate_or_404(session, restaurant_id, body.certificate_id)
        certificate_id = certificate.id
    else:
        if not _restaurant_exists(session, restaurant_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_RESTAURANT_NOT_FOUND)
        certificate_id = None

    restaurant = session.get(Restaurant, restaurant_id)
    assert restaurant is not None  # existence already confirmed above

    flag = Flag(
        restaurant_id=restaurant_id,
        certificate_id=certificate_id,
        user_id=None,
        type=body.type,
        state=FlagState.OPEN,
        message=body.message,
    )
    session.add(flag)
    session.flush()  # assign the id before auditing

    write_audit(
        session,
        "flag",
        flag.id,
        AuditAction.CREATE,
        {
            field: {"before": None, "after": jsonable(getattr(flag, field))}
            for field in ("restaurant_id", "certificate_id", "type", "state", "message")
        },
        PUBLIC_ANONYMOUS_ACTOR,
        {"action": "create_flag", "restaurant_id": restaurant_id, "flag_type": body.type},
    )

    background_tasks.add_task(
        notify_flag_created,
        email_sender,
        to=parse_recipients(settings.report_email_to),
        restaurant_id=restaurant_id,
        restaurant_name=restaurant.name_he or restaurant.name_en or str(restaurant_id),
        flag_id=flag.id,
        flag_type=body.type.value,
        message=body.message,
        certificate_id=certificate_id,
        certifier_name=certificate.certifier.name_he if certificate is not None else None,
        created_at=flag.created_at,
        admin_base_url=settings.admin_base_url,
    )

    return FlagCreateResponse(flag_id=flag.id, state="open")
