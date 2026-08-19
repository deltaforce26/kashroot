"""Moderation actions — the mutating half of the console.

Fail-safe (PRD §13): no path here may ever *raise* a kashrut status except
:func:`verify_renewal`, which demands explicit renewal evidence. Flag resolutions in
particular can only close the flag or degrade — see
``helpers.degrade_certificate_state``, which refuses any non-lowering move at
runtime rather than trusting the callers.

Every mutation writes an ``AuditLog`` row in the same transaction.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.admin.audit import apply_changes, write_audit
from app.api.admin.helpers import (
    degrade_certificate_state,
    flag_certificate,
    flag_out,
    get_or_404,
    today,
)
from app.api.deps import require_moderator
from app.api.schemas import (
    CertificateOut,
    DegradeRequest,
    FlagOut,
    ResolveFlagRequest,
    ResolveReviewRequest,
    RestaurantBrief,
    VerifyRenewalRequest,
)
from app.db.session import get_session
from app.models import (
    AuditAction,
    Certificate,
    CertificateEvidencePhoto,
    CertificateSource,
    CertificateState,
    EvidencePhotoStatus,
    Flag,
    FlagState,
    RecordState,
    Restaurant,
)

router = APIRouter()


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
    restaurant = get_or_404(session, Restaurant, restaurant_id, "restaurant")

    if body.resolution == "approve":
        changes = apply_changes(restaurant, {"needs_review": False})
    elif body.resolution == "reject":
        changes = apply_changes(
            restaurant,
            {
                "needs_review": False,
                "record_state": RecordState.UNKNOWN_PENDING_VERIFICATION,
            },
        )
    else:  # needs_more_info — no field transition, but the decision is still audited
        changes = apply_changes(restaurant, {"needs_review": True})

    write_audit(
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
    transition reachable from here is ``degrade_certificate_state``, which refuses any
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
    flag = get_or_404(session, Flag, flag_id, "flag", for_update=True)
    if flag.state in (FlagState.RESOLVED, FlagState.REJECTED):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"flag is already {flag.state.value}")

    now = dt.datetime.now(dt.UTC)
    evidence = {
        "action": "resolve_flag",
        "flag_id": flag.id,
        "outcome": body.outcome,
        "note": body.note,
    }
    certificate = flag_certificate(session, flag, for_update=True)

    if body.outcome == "dismissed":
        changes = apply_changes(
            flag,
            {"state": FlagState.REJECTED, "resolution": body.note, "resolved_at": now},
        )
    elif body.outcome == "confirmed_degrade":
        if certificate is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="flag has no certificate attached; nothing to degrade",
            )
        degrade_certificate_state(session, certificate, actor, evidence)
        changes = apply_changes(
            flag,
            {"state": FlagState.RESOLVED, "resolution": body.note, "resolved_at": now},
        )
    else:  # needs_field_check
        changes = apply_changes(flag, {"state": FlagState.IN_REVIEW, "resolution": body.note})
        restaurant_changes = apply_changes(flag.restaurant, {"needs_review": True})
        if restaurant_changes:
            write_audit(
                session,
                "restaurant",
                flag.restaurant_id,
                AuditAction.UPDATE,
                restaurant_changes,
                actor,
                evidence,
            )

    write_audit(session, "flag", flag.id, AuditAction.STATE_CHANGE, changes, actor, evidence)

    return flag_out(flag, certificate)


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
    certificate = get_or_404(session, Certificate, certificate_id, "certificate", for_update=True)
    degrade_certificate_state(
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

    A supplied ``evidence_photo_key`` is only evidence if it names an ACCEPTED
    evidence photo of THIS certificate — an unreviewed, rejected or foreign photo
    proves nothing.
    """
    certificate = get_or_404(session, Certificate, certificate_id, "certificate", for_update=True)

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
    if evidence_fields["evidence_photo_key"]:
        photo = session.scalar(
            select(CertificateEvidencePhoto).where(
                CertificateEvidencePhoto.storage_key == evidence_fields["evidence_photo_key"]
            )
        )
        if (
            photo is None
            or photo.certificate_id != certificate.id
            or photo.status is not EvidencePhotoStatus.ACCEPTED
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=(
                    "evidence_photo_key must reference an accepted evidence photo of "
                    "this certificate (upload via POST /certificates/{id}/photos and "
                    "review it first)"
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
    if body.valid_until <= today():
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
    changes = apply_changes(certificate, values)
    write_audit(
        session,
        "certificate",
        certificate.id,
        AuditAction.STATE_CHANGE,
        changes,
        actor,
        {"action": "verify_renewal", **evidence_fields},
    )

    return CertificateOut.model_validate(certificate)
