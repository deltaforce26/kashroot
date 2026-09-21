"""Certificate hand-entry — ``POST .../certificates`` and the certifier picker.

Product decision (locked, made by the user — plan doc, decision 1): certificate
``state`` is the moderator's free choice across the full ``CertificateState`` enum,
with **no server-side evidence gate**. This is a deliberate, narrow exception to "the
console can never raise a kashrut status except ``verify-renewal``" (PRD §13); it was
raised explicitly and the user chose it anyway. The compensating control is that
every create writes a full ``AuditLog`` row naming the moderator, and ``state`` on
``CreateCertificateRequest`` is required and never defaulted, so a certificate can
never become ``active`` because nobody chose otherwise. Full reasoning lives in
``app.api.schemas_certificates``. Do not add an evidence gate here without a product
conversation.

Never imports ``app.match`` — this module records facts and provenance, it draws no
kashrut conclusions.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.admin.audit import jsonable, write_audit
from app.api.admin.consts import (
    CONSOLE_CERTIFICATE_SOURCE,
    DEFAULT_PAGE_LIMIT,
    MAX_CERTIFIER_QUERY_LENGTH,
    MAX_PAGE_LIMIT,
    MODERATOR_ACTOR_PREFIX,
)
from app.api.admin.helpers import get_or_404, paginate
from app.api.deps import require_moderator
from app.api.schemas import CertificateOut, Page
from app.api.schemas_certificates import (
    AUDITED_CERTIFICATE_CREATE_FIELDS,
    CertifierOption,
    CreateCertificateRequest,
)
from app.db.session import get_session
from app.models import AuditAction, Certificate, Certifier, Restaurant

router = APIRouter()


@router.post(
    "/restaurants/{restaurant_id}/certificates",
    response_model=CertificateOut,
    status_code=status.HTTP_201_CREATED,
)
def create_certificate(
    restaurant_id: uuid.UUID,
    body: CreateCertificateRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> CertificateOut:
    """Hand-enter a certificate on an existing restaurant, fully audited.

    The certifier lookup is load-bearing, not a courtesy: ``certifier_id`` is
    ``ON DELETE RESTRICT`` on the certificate table, so without checking it here a
    bad id would surface as a 500 from the FK constraint at flush time instead of a
    clean 404. Inactive certifiers are allowed on purpose — a real historical
    certificate from a certifier that has since gone inactive must still be
    recordable; the fact is carried into the audit evidence for the picker to show.

    The server stamps ``source``, ``verified_by_label`` and ``verified_at``: the
    moderator is asserting this record at this moment, which is what those columns
    mean. ``state`` is whatever the moderator chose — see the module docstring for
    why there is deliberately no evidence gate on it. ``corroboration_count`` is
    fixed at 1: a hand-entered certificate has exactly one witness, the moderator.

    Parameters:
        restaurant_id (uuid.UUID): The restaurant the certificate belongs to.
        body (CreateCertificateRequest): The moderator's hand-entered certificate.
        actor (str): Resolved moderator name.
        session (Session): The open session.

    Return:
        CertificateOut: The created certificate, with its certifier eager-loaded.
    """
    restaurant = get_or_404(session, Restaurant, restaurant_id, "restaurant")
    certifier = get_or_404(session, Certifier, body.certifier_id, "certifier")

    now = dt.datetime.now(dt.UTC)
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=body.level,
        attributes=body.attributes,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        state=body.state,
        notes=body.notes,
        source=CONSOLE_CERTIFICATE_SOURCE,
        verified_by_label=f"{MODERATOR_ACTOR_PREFIX}{actor}",
        verified_at=now,
        corroboration_count=1,
    )
    session.add(certificate)
    session.flush()

    write_audit(
        session,
        "certificate",
        certificate.id,
        AuditAction.CREATE,
        {
            field: {"before": None, "after": jsonable(getattr(certificate, field))}
            for field in AUDITED_CERTIFICATE_CREATE_FIELDS
        },
        actor,
        {
            "action": "create_certificate",
            "note": body.note,
            "restaurant_id": restaurant.id,
            "certifier_slug": certifier.slug,
            "certifier_active": certifier.is_active,
            "state": body.state.value,
        },
    )

    return CertificateOut.model_validate(certificate)


@router.get("/certifiers", response_model=Page[CertifierOption])
def list_certifiers(
    q: str | None = Query(
        None,
        max_length=MAX_CERTIFIER_QUERY_LENGTH,
        description="Case-insensitive substring of name (he/en) or slug",
    ),
    include_inactive: bool = Query(False),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[CertifierOption]:
    """Certifier picker for the create-certificate panel.

    Deliberately not the same endpoint as the public ``/v1/certifiers``: that one is
    unauthenticated, active-only, and aggregates per-certifier certification levels
    for display — a level list beside a certifier in the moderator console would
    read as a ranking, which the app never makes (CLAUDE.md). This endpoint requires
    a moderator token, defaults to active certifiers only (a hand-entered certificate
    can still name an inactive one — the picker's ``include_inactive`` flag is how),
    and never returns levels.

    Parameters:
        q (str | None): Case-insensitive substring over name_he/name_en/slug.
        include_inactive (bool): When True, also returns inactive certifiers.
        limit (int): Page size.
        offset (int): Rows to skip.
        actor (str): Resolved moderator name.
        session (Session): The open session.

    Return:
        Page[CertifierOption]: The matching certifiers, ordered by name_he.
    """
    stmt = select(Certifier)
    if not include_inactive:
        stmt = stmt.where(Certifier.is_active.is_(True))
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Certifier.name_he.ilike(pattern),
                Certifier.name_en.ilike(pattern),
                Certifier.slug.ilike(pattern),
            )
        )
    stmt = stmt.order_by(Certifier.name_he.asc(), Certifier.id.asc())
    total, rows = paginate(session, stmt, limit, offset)

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[CertifierOption.model_validate(row) for row in rows],
    )
