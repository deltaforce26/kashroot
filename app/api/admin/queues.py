"""Moderation work queues (read-only) — review, flags, expiry, photos, plus the
append-only audit trail.

Nothing here mutates. The match engine (``app.match``) is never imported: these
endpoints report recorded facts and provenance, they draw no kashrut conclusions.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.admin.consts import (
    DEFAULT_EXPIRY_WINDOW_DAYS,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
)
from app.api.admin.helpers import flag_out, paginate, photo_out, today
from app.api.deps import get_media_storage, require_moderator
from app.api.schemas import (
    AuditLogOut,
    CertificateOut,
    ExpiryQueueItem,
    FlagOut,
    Page,
    PhotoQueueItem,
    RestaurantBrief,
    ReviewQueueItem,
)
from app.db.session import get_session
from app.models import (
    AuditLog,
    Certificate,
    CertificateEvidencePhoto,
    CertificateState,
    EvidencePhotoStatus,
    Flag,
    FlagState,
    Restaurant,
)
from app.storage import MediaStorage

router = APIRouter()


@router.get("/queues/review", response_model=Page[ReviewQueueItem])
def review_queue(
    city: str | None = Query(None, description="Filter by city_slug"),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[ReviewQueueItem]:
    """Restaurants flagged ``needs_review`` by ingestion or moderation, oldest first,
    with their certificates and provenance fields.
    """
    stmt = select(Restaurant).where(Restaurant.needs_review.is_(True))
    if city:
        stmt = stmt.where(Restaurant.city_slug == city)
    stmt = stmt.order_by(Restaurant.created_at.asc(), Restaurant.id.asc())
    total, rows = paginate(
        session,
        stmt.options(selectinload(Restaurant.certificates).joinedload(Certificate.certifier)),
        limit,
        offset,
    )

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[ReviewQueueItem.model_validate(r) for r in rows],
    )


@router.get("/queues/flags", response_model=Page[FlagOut])
def flag_queue(
    city: str | None = Query(None, description="Filter by city_slug"),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[FlagOut]:
    """Unresolved community flags (OPEN and IN_REVIEW), oldest first, joined to
    restaurant + certificate. IN_REVIEW flags stay listed — parked for a field check
    is not resolved — and remain resolvable via ``/flags/{id}/resolve``; the ``state``
    field lets the console badge the two apart.
    """
    stmt = (
        select(Flag)
        .join(Restaurant, Flag.restaurant_id == Restaurant.id)
        .where(Flag.state.in_((FlagState.OPEN, FlagState.IN_REVIEW)))
    )
    if city:
        stmt = stmt.where(Restaurant.city_slug == city)
    stmt = stmt.order_by(Flag.created_at.asc(), Flag.id.asc())
    total, rows = paginate(session, stmt.options(selectinload(Flag.restaurant)), limit, offset)
    certificate_ids = [f.certificate_id for f in rows if f.certificate_id is not None]
    certificates: dict[uuid.UUID, Certificate] = {}
    if certificate_ids:
        certificates = {
            c.id: c
            for c in session.scalars(
                select(Certificate)
                .where(Certificate.id.in_(certificate_ids))
                .options(joinedload(Certificate.certifier))
            )
        }

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[flag_out(f, certificates.get(f.certificate_id)) for f in rows],
    )


@router.get("/queues/expiry", response_model=Page[ExpiryQueueItem])
def expiry_queue(
    days: int = Query(DEFAULT_EXPIRY_WINDOW_DAYS, ge=0, le=365),
    city: str | None = Query(None, description="Filter by city_slug"),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[ExpiryQueueItem]:
    """ACTIVE certificates whose ``valid_until`` falls within the next ``days`` days
    or is already past — i.e. not yet degraded. Soonest/most-overdue first.

    Certificates with ``valid_until`` NULL are governed by freshness, not expiry, and
    do not belong in this queue. "Today" is the civil date in Israel (``ISRAEL_TZ``).
    """
    now = today()
    cutoff = now + dt.timedelta(days=days)
    stmt = (
        select(Certificate)
        .join(Restaurant, Certificate.restaurant_id == Restaurant.id)
        .where(
            Certificate.valid_until.is_not(None),
            Certificate.valid_until <= cutoff,
            Certificate.state == CertificateState.ACTIVE,
        )
    )
    if city:
        stmt = stmt.where(Restaurant.city_slug == city)
    stmt = stmt.order_by(Certificate.valid_until.asc(), Certificate.id.asc())
    total, rows = paginate(
        session,
        stmt.options(selectinload(Certificate.restaurant), joinedload(Certificate.certifier)),
        limit,
        offset,
    )

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            ExpiryQueueItem(
                certificate=CertificateOut.model_validate(c),
                restaurant=RestaurantBrief.model_validate(c.restaurant),
                days_until_expiry=(c.valid_until - now).days,  # type: ignore[operator]
            )
            for c in rows
        ],
    )


@router.get("/queues/photos", response_model=Page[PhotoQueueItem])
def photo_queue(
    city: str | None = Query(None, description="Filter by city_slug"),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
    storage: MediaStorage = Depends(get_media_storage),
) -> Page[PhotoQueueItem]:
    """Evidence photos awaiting review (PENDING_REVIEW only), oldest first, with the
    certificate + restaurant context a moderator needs and a presigned view URL.
    Accepted/rejected photos leave the queue; their history lives in ``/audit``.
    """
    stmt = (
        select(CertificateEvidencePhoto)
        .join(Certificate, CertificateEvidencePhoto.certificate_id == Certificate.id)
        .join(Restaurant, Certificate.restaurant_id == Restaurant.id)
        .where(CertificateEvidencePhoto.status == EvidencePhotoStatus.PENDING_REVIEW)
    )
    if city:
        stmt = stmt.where(Restaurant.city_slug == city)
    stmt = stmt.order_by(
        CertificateEvidencePhoto.uploaded_at.asc(), CertificateEvidencePhoto.id.asc()
    )
    total, rows = paginate(
        session,
        stmt.options(
            joinedload(CertificateEvidencePhoto.certificate).joinedload(Certificate.certifier),
            joinedload(CertificateEvidencePhoto.certificate).joinedload(Certificate.restaurant),
        ),
        limit,
        offset,
    )

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            PhotoQueueItem(
                photo=photo_out(p, storage),
                certificate=CertificateOut.model_validate(p.certificate),
                restaurant=RestaurantBrief.model_validate(p.certificate.restaurant),
            )
            for p in rows
        ],
    )


@router.get("/audit", response_model=Page[AuditLogOut])
def audit_log(
    entity_type: str | None = Query(None),
    entity_id: uuid.UUID | None = Query(None),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[AuditLogOut]:
    """Audit trail, newest first. Read-only — the audit log is append-only and rows
    are written exclusively as side effects of audited mutations; there is no write
    endpoint, ever.

    Ordering is by ``seq``, the append-order identity column: a total ordering even
    when ``created_at`` ties within a transaction.
    """
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    stmt = stmt.order_by(AuditLog.seq.desc())
    total, rows = paginate(session, stmt, limit, offset)

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[AuditLogOut.model_validate(r) for r in rows],
    )
