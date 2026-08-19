"""Shared moderation helpers: the date basis, paging, locked lookups, the fail-safe
degrade guard, and the row -> schema serializers used by more than one router.

``degrade_certificate_state`` is the load-bearing one: it is where "a moderation
action never raises a kashrut status" (PRD §13) stops being a convention and
becomes a runtime guard.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.api.admin.audit import apply_changes, write_audit
from app.api.admin.consts import DEGRADE_TARGET, ISRAEL_TZ, STATE_RANK
from app.api.schemas import CertificateOut, EvidencePhotoOut, FlagOut, RestaurantBrief
from app.models import AuditAction, Certificate, CertificateEvidencePhoto, Flag
from app.storage import MediaStorage


def today() -> dt.date:
    """
    Today as a civil date in Israel (see ``ISRAEL_TZ``).

    Return:
        dt.date: The current date in Asia/Jerusalem, not in the server's timezone.
    """
    return dt.datetime.now(ISRAEL_TZ).date()


def paginate(
    session: Session,
    stmt: Select[Any],
    limit: int,
    offset: int,
) -> tuple[int, list[Any]]:
    """
    Count a statement's full result set, then fetch one page of it.

    Parameters:
        session (Session): The open session.
        stmt (Select[Any]): The fully-filtered, fully-ordered statement.
        limit (int): Page size.
        offset (int): Rows to skip.

    Return:
        tuple[int, list[Any]]: Total row count and the page's rows.
    """
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.limit(limit).offset(offset)).all()

    return total, list(rows)


def get_or_404(
    session: Session,
    model: type[Any],
    entity_id: uuid.UUID,
    label: str,
    *,
    for_update: bool = False,
) -> Any:
    """
    Load an entity or raise 404.

    ``for_update=True`` takes a row lock (SELECT ... FOR UPDATE) so concurrent
    moderation actions serialize on the row — every state guard downstream then
    re-checks against the locked, current row, not a stale read. SQLite (tests)
    ignores FOR UPDATE, which is why the guards are re-checks in code rather than
    lock-only.

    Parameters:
        session (Session): The open session.
        model (type[Any]): The ORM class to load.
        entity_id (uuid.UUID): Primary key.
        label (str): Human name used in the 404 detail.
        for_update (bool): Whether to take a row lock.

    Return:
        Any: The loaded instance.
    """
    obj = session.get(model, entity_id, with_for_update=True if for_update else None)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{label} not found")

    return obj


def degrade_certificate_state(
    session: Session,
    certificate: Certificate,
    actor: str,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    """
    Degrade a certificate to the model's UNKNOWN-equivalent state (EXPIRED).

    This is the *only* certificate transition any flag resolution can cause, and the
    invariant "a flag never raises status" is enforced here, not by convention: the
    target must rank strictly below the current state, so an EXPIRED certificate
    cannot be re-stated and a REVOKED one cannot be lifted to EXPIRED.

    Parameters:
        session (Session): The open session; the audit row joins its transaction.
        certificate (Certificate): The certificate to degrade, ideally read FOR UPDATE.
        actor (str): Resolved moderator name.
        evidence (dict[str, Any]): Request context for the audit row.

    Return:
        dict[str, Any]: The audited before/after changes.
    """
    if STATE_RANK[DEGRADE_TARGET] >= STATE_RANK[certificate.state]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"certificate is already {certificate.state.value}; a moderation "
                "degrade can only lower a kashrut status, never raise or restate it"
            ),
        )
    changes = apply_changes(certificate, {"state": DEGRADE_TARGET})
    write_audit(
        session,
        "certificate",
        certificate.id,
        AuditAction.STATE_CHANGE,
        changes,
        actor,
        evidence,
    )

    return changes


def flag_certificate(
    session: Session, flag: Flag, *, for_update: bool = False
) -> Certificate | None:
    """
    Load the certificate a flag points at, if it points at one.

    Parameters:
        session (Session): The open session.
        flag (Flag): The flag row.
        for_update (bool): Whether to take a row lock on the certificate.

    Return:
        Certificate | None: The certificate, or None for a restaurant-level flag.
    """
    if flag.certificate_id is None:
        return None

    return session.get(
        Certificate, flag.certificate_id, with_for_update=True if for_update else None
    )


def flag_out(flag: Flag, certificate: Certificate | None) -> FlagOut:
    """
    Serialize a flag row with its restaurant and (optional) certificate context.

    Parameters:
        flag (Flag): The flag row, with ``restaurant`` loaded.
        certificate (Certificate | None): The flagged certificate, if any.

    Return:
        FlagOut: The response model.
    """
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


def photo_out(photo: CertificateEvidencePhoto, storage: MediaStorage) -> EvidencePhotoOut:
    """
    Serialize a photo row with a freshly minted presigned view URL.

    The URL is short-lived — never stored, never logged.

    Parameters:
        photo (CertificateEvidencePhoto): The photo row.
        storage (MediaStorage): Backend that mints the presigned URL.

    Return:
        EvidencePhotoOut: The response model, with ``view_url`` populated.
    """
    out = EvidencePhotoOut.model_validate(photo)
    out.view_url = storage.get_url(photo.storage_key)

    return out
