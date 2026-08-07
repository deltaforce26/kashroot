"""Moderation console API (PRD FR8) — queues, actions, audit trail.

Ground rules, enforced in code:

* Every mutation writes an ``AuditLog`` row **in the same transaction**, mirroring the
  shape used by ``app.ingestion.seed_import._audit`` (action, entity_type, entity_id,
  actor, changes as ``{field: {"before": …, "after": …}}``, evidence JSON).
* Fail-safe (PRD §13): no moderation path may ever *raise* a kashrut status except
  :func:`verify_renewal`, which demands explicit renewal evidence. Flag resolutions in
  particular can only close the flag or degrade — see ``_degrade_certificate``.
* The match engine (``app.match``) is never imported here; this module records facts
  and provenance, it draws no kashrut conclusions.
* ``/audit`` is read-only. There is no write endpoint for audit rows, ever.
"""

from __future__ import annotations

import datetime as dt
import uuid
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.deps import require_moderator
from app.api.schemas import (
    AuditLogOut,
    CertificateOut,
    DegradeRequest,
    ExpiryQueueItem,
    FlagOut,
    Page,
    ResolveFlagRequest,
    ResolveReviewRequest,
    RestaurantBrief,
    ReviewQueueItem,
    VerifyRenewalRequest,
)
from app.db.session import get_session
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    Flag,
    FlagState,
    RecordState,
    Restaurant,
)

router = APIRouter(
    prefix="/api/admin",
    tags=["moderation"],
    responses={401: {"description": "Missing or invalid moderator token"}},
)

MAX_PAGE_LIMIT = 200
DEFAULT_PAGE_LIMIT = 50
DEFAULT_EXPIRY_WINDOW_DAYS = 14  # PRD §13 SLA: surface expiring certs 14 days early

#: All expiry-window boundaries are civil dates in Israel — a certificate printed
#: "valid until 15 Av" expires at the end of that day *in Israel*, regardless of the
#: server's timezone.
ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")


def _today() -> dt.date:
    """Today as a civil date in Israel (see ``ISRAEL_TZ``)."""
    return dt.datetime.now(ISRAEL_TZ).date()

#: Kashrut-status severity order for certificate states. Used to *enforce* the
#: fail-safe invariant: moderation transitions (other than verify-renewal, which
#: requires evidence) may only move a certificate to a strictly lower rank.
_STATE_RANK: dict[CertificateState, int] = {
    CertificateState.REVOKED: 0,
    CertificateState.EXPIRED: 1,
    CertificateState.PENDING: 2,
    CertificateState.ACTIVE: 3,
}

#: The one state a moderation degrade may target. EXPIRED is the model's "degraded"
#: state: the match engine reads it as UNKNOWN, never as MATCH (fail-safe).
_DEGRADE_TARGET = CertificateState.EXPIRED


# ------------------------------------------------------------------ audit plumbing


def _jsonable(value: Any) -> Any:
    """Mirror of ``app.ingestion.seed_import._jsonable`` — audit payloads land in
    JSONB and must survive ``json.dumps``.
    """
    if isinstance(value, dt.date | dt.datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, StrEnum):
        return value.value
    return value


def _apply(obj: Any, values: dict[str, Any]) -> dict[str, Any]:
    """Set attributes, returning ``{field: {"before": …, "after": …}}`` for the audit
    log (mirror of ``app.ingestion.seed_import._apply``).
    """
    changes: dict[str, Any] = {}
    for key, new in values.items():
        old = getattr(obj, key)
        if old == new:
            continue
        changes[key] = {"before": _jsonable(old), "after": _jsonable(new)}
        setattr(obj, key, new)
    return changes


def _audit(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    action: AuditAction,
    changes: dict[str, Any],
    actor: str,
    evidence: dict[str, Any],
) -> None:
    """Append an audit row in the caller's (still-open) transaction — same shape as
    ``app.ingestion.seed_import._audit``. Never include tokens in ``evidence``.
    """
    session.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            changes=changes,
            actor=actor,
            evidence={k: _jsonable(v) for k, v in evidence.items() if v is not None},
        )
    )


# ------------------------------------------------------------------ shared helpers


def _paginate(
    session: Session,
    stmt: Select[Any],
    limit: int,
    offset: int,
) -> tuple[int, list[Any]]:
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.limit(limit).offset(offset)).all()
    return total, list(rows)


def _get_or_404(
    session: Session,
    model: type[Any],
    entity_id: uuid.UUID,
    label: str,
    *,
    for_update: bool = False,
) -> Any:
    """Load an entity or 404. ``for_update=True`` takes a row lock (SELECT ... FOR
    UPDATE) so concurrent moderation actions serialize on the row — every state guard
    downstream then re-checks against the locked, current row, not a stale read.
    SQLite (tests) ignores FOR UPDATE, which is why the guards are re-checks in code
    rather than lock-only.
    """
    obj = session.get(model, entity_id, with_for_update=True if for_update else None)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return obj


def _degrade_certificate(
    session: Session,
    certificate: Certificate,
    actor: str,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    """Degrade a certificate to the model's UNKNOWN-equivalent state (EXPIRED).

    This is the *only* certificate transition any flag resolution can cause, and the
    invariant "a flag never raises status" is enforced here, not by convention: the
    target must rank strictly below the current state, so an EXPIRED certificate
    cannot be re-stated and a REVOKED one cannot be lifted to EXPIRED.
    """
    if _STATE_RANK[_DEGRADE_TARGET] >= _STATE_RANK[certificate.state]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"certificate is already {certificate.state.value}; a moderation "
                "degrade can only lower a kashrut status, never raise or restate it"
            ),
        )
    changes = _apply(certificate, {"state": _DEGRADE_TARGET})
    _audit(
        session,
        "certificate",
        certificate.id,
        AuditAction.STATE_CHANGE,
        changes,
        actor,
        evidence,
    )
    return changes


def _flag_out(flag: Flag, certificate: Certificate | None) -> FlagOut:
    return FlagOut(
        id=flag.id,
        restaurant_id=flag.restaurant_id,
        certificate_id=flag.certificate_id,
        type=flag.type,
        state=flag.state,
        message=flag.message,
        photo_key=flag.photo_key,
        resolution=flag.resolution,
        resolved_at=flag.resolved_at,
        created_at=flag.created_at,
        restaurant=RestaurantBrief.model_validate(flag.restaurant),
        certificate=CertificateOut.model_validate(certificate) if certificate else None,
    )


def _flag_certificate(
    session: Session, flag: Flag, *, for_update: bool = False
) -> Certificate | None:
    if flag.certificate_id is None:
        return None
    return session.get(
        Certificate, flag.certificate_id, with_for_update=True if for_update else None
    )


# ------------------------------------------------------------------------- queues


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
    total, rows = _paginate(
        session,
        stmt.options(
            selectinload(Restaurant.certificates).joinedload(Certificate.certifier)
        ),
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
    total, rows = _paginate(
        session, stmt.options(selectinload(Flag.restaurant)), limit, offset
    )
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
        items=[_flag_out(f, certificates.get(f.certificate_id)) for f in rows],
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
    today = _today()
    cutoff = today + dt.timedelta(days=days)
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
    total, rows = _paginate(
        session,
        stmt.options(
            selectinload(Certificate.restaurant), joinedload(Certificate.certifier)
        ),
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
                days_until_expiry=(c.valid_until - today).days,  # type: ignore[operator]
            )
            for c in rows
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
    """
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    # seq is the append-order identity column — a total ordering even when
    # created_at ties within a transaction.
    stmt = stmt.order_by(AuditLog.seq.desc())
    total, rows = _paginate(session, stmt, limit, offset)
    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[AuditLogOut.model_validate(r) for r in rows],
    )


# ------------------------------------------------------------------------ actions


@router.post("/restaurants/{restaurant_id}/resolve-review", response_model=RestaurantBrief)
def resolve_review(
    restaurant_id: uuid.UUID,
    body: ResolveReviewRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> RestaurantBrief:
    """Resolve a review-queue item.

    * ``approve`` — the record checked out: clears ``needs_review``. Certificate
      states are deliberately untouched; activating a PENDING certificate requires
      evidence via ``/certificates/{id}/verify-renewal``.
    * ``reject`` — the record could not be verified: clears ``needs_review`` and
      drops ``record_state`` to UNKNOWN_PENDING_VERIFICATION (fail-safe).
    * ``needs_more_info`` — keeps the item in the queue; the note is audited.
    """
    restaurant = _get_or_404(session, Restaurant, restaurant_id, "restaurant")

    if body.resolution == "approve":
        changes = _apply(restaurant, {"needs_review": False})
    elif body.resolution == "reject":
        changes = _apply(
            restaurant,
            {
                "needs_review": False,
                "record_state": RecordState.UNKNOWN_PENDING_VERIFICATION,
            },
        )
    else:  # needs_more_info — no field transition, but the decision is still audited
        changes = _apply(restaurant, {"needs_review": True})

    _audit(
        session,
        "restaurant",
        restaurant.id,
        AuditAction.UPDATE,
        changes,
        actor,
        {"action": "resolve_review", "resolution": body.resolution, "note": body.note},
    )
    return RestaurantBrief.model_validate(restaurant)


@router.post("/flags/{flag_id}/resolve", response_model=FlagOut)
def resolve_flag(
    flag_id: uuid.UUID,
    body: ResolveFlagRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> FlagOut:
    """Resolve a community flag.

    INVARIANT (PRD §13): no outcome may ever raise a kashrut status. The outcome set
    is a closed enum (anything else is rejected with 422), and the only certificate
    transition reachable from here is ``_degrade_certificate``, which refuses any
    non-lowering move at runtime.

    * ``dismissed`` — flag was wrong/unactionable: closes it as REJECTED. Nothing else
      changes; in particular, dismissing an "expired certificate" flag does NOT
      re-affirm the certificate.
    * ``confirmed_degrade`` — evidence confirmed: degrades the flagged certificate
      (EXPIRED — read as UNKNOWN, never MATCH) and closes the flag as RESOLVED.
    * ``needs_field_check`` — moves the flag to IN_REVIEW and puts the restaurant in
      the review queue for a field visit. IN_REVIEW flags stay in the flag queue and
      can be resolved here once the field check comes back.

    Concurrency: the flag row and its certificate are read FOR UPDATE, so two
    moderators resolving simultaneously serialize — the loser sees the already-closed
    flag (409) instead of writing a duplicate audit trail; the state guards below
    re-check against the locked row, never a stale read.
    """
    flag = _get_or_404(session, Flag, flag_id, "flag", for_update=True)
    if flag.state in (FlagState.RESOLVED, FlagState.REJECTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"flag is already {flag.state.value}"
        )

    now = dt.datetime.now(dt.UTC)
    evidence = {"action": "resolve_flag", "flag_id": flag.id, "outcome": body.outcome, "note": body.note}
    certificate = _flag_certificate(session, flag, for_update=True)

    if body.outcome == "dismissed":
        changes = _apply(
            flag,
            {"state": FlagState.REJECTED, "resolution": body.note, "resolved_at": now},
        )
    elif body.outcome == "confirmed_degrade":
        if certificate is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="flag has no certificate attached; nothing to degrade",
            )
        _degrade_certificate(session, certificate, actor, evidence)
        changes = _apply(
            flag,
            {"state": FlagState.RESOLVED, "resolution": body.note, "resolved_at": now},
        )
    else:  # needs_field_check
        changes = _apply(flag, {"state": FlagState.IN_REVIEW, "resolution": body.note})
        restaurant_changes = _apply(flag.restaurant, {"needs_review": True})
        if restaurant_changes:
            _audit(
                session,
                "restaurant",
                flag.restaurant_id,
                AuditAction.UPDATE,
                restaurant_changes,
                actor,
                evidence,
            )

    _audit(session, "flag", flag.id, AuditAction.STATE_CHANGE, changes, actor, evidence)
    return _flag_out(flag, certificate)


@router.post("/certificates/{certificate_id}/degrade", response_model=CertificateOut)
def degrade_certificate(
    certificate_id: uuid.UUID,
    body: DegradeRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> CertificateOut:
    """Explicit moderator degrade to the UNKNOWN-equivalent state (EXPIRED), with a
    mandatory reason. Audited as a STATE_CHANGE with before/after. The row is read
    FOR UPDATE and the transition guard re-checks the locked state.
    """
    certificate = _get_or_404(
        session, Certificate, certificate_id, "certificate", for_update=True
    )
    _degrade_certificate(
        session,
        certificate,
        actor,
        {"action": "moderator_degrade", "reason": body.reason},
    )
    return CertificateOut.model_validate(certificate)


@router.post("/certificates/{certificate_id}/verify-renewal", response_model=CertificateOut)
def verify_renewal(
    certificate_id: uuid.UUID,
    body: VerifyRenewalRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> CertificateOut:
    """Record renewal evidence: new ``valid_until`` + evidence note/URL/photo key.

    This is the ONLY path in the moderation API that can restore an expired
    certificate to ACTIVE, and it is gated fail-safe: no evidence, no restore (400,
    nothing written). Only ACTIVE (extend) and EXPIRED (restore) certificates are
    eligible: a REVOKED certificate is never restorable here — revocation is the
    certifier's call, not a moderator's — and a PENDING one must clear record review
    first; renewal evidence cannot activate it (409 either way).

    Concurrency: the row is read FOR UPDATE and every guard below re-checks the
    locked state, so a revocation that lands concurrently is seen, not overwritten.
    ``valid_until`` must be strictly in the future as a civil date in Israel
    (``ISRAEL_TZ``) — a date of today would re-enter the expiry queue immediately.
    """
    certificate = _get_or_404(
        session, Certificate, certificate_id, "certificate", for_update=True
    )

    # Schema validation already normalized blanks to None and enforced substance.
    evidence_fields = {
        "evidence_note": body.evidence_note,
        "evidence_url": str(body.evidence_url) if body.evidence_url else None,
        "evidence_photo_key": body.evidence_photo_key,
    }
    if not any(evidence_fields.values()):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "renewal evidence required: provide at least one of evidence_note, "
                "evidence_url, evidence_photo_key (fail-safe: no evidence, no restore)"
            ),
        )
    if certificate.state is CertificateState.REVOKED:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="certificate is revoked; renewal evidence cannot restore a revocation",
        )
    if certificate.state is CertificateState.PENDING:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "certificate is pending moderation; renewal evidence can only extend "
                "an active certificate or restore an expired one — resolve the "
                "record review first"
            ),
        )
    today = _today()
    if body.valid_until <= today:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "valid_until must be strictly in the future (civil date in Israel); "
                "renewal evidence must extend validity"
            ),
        )

    values: dict[str, Any] = {
        "valid_until": body.valid_until,
        "state": CertificateState.ACTIVE,
        "source": CertificateSource.MODERATOR_VERIFIED,
        "verified_by_label": f"moderator:{actor}",
        "verified_at": dt.datetime.now(dt.UTC),
    }
    if evidence_fields["evidence_photo_key"]:
        values["evidence_photo_key"] = evidence_fields["evidence_photo_key"]
    changes = _apply(certificate, values)
    _audit(
        session,
        "certificate",
        certificate.id,
        AuditAction.STATE_CHANGE,
        changes,
        actor,
        {"action": "verify_renewal", **evidence_fields},
    )
    return CertificateOut.model_validate(certificate)
