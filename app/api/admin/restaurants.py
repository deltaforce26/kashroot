"""Restaurant directory — browse every record, correct its non-kashrut details.

The other queue endpoints answer "what needs my attention?". This one answers "show
me the corpus", which is what a moderator needs when a report arrives about a place
that is not in any queue: a wrong address, a renamed business, a branch that closed.

Fail-safe by construction, not by convention (CLAUDE.md, locked):

* No kashrut fact is writable here. Certificates, their attributes and their states
  are returned as read-only context; every transition that touches them lives in
  ``app.api.admin.actions`` and is guarded there.
* ``record_state``, ``needs_review`` and ``corroboration_count`` are owned by the
  review queue and by ingestion, and are not in the editable whitelist.
* The router writes only ``EDITABLE_RESTAURANT_FIELDS`` ∩ the request's explicitly-set
  fields, so an unlisted column cannot be written even if the schema grows one.

Correcting name/city/address re-derives ``dedupe_key`` in the same transaction: the
key is ingestion's natural key for the row, and leaving it stale would make the next
pipeline run insert a duplicate beside the corrected record instead of matching it.

Every edit writes an ``AuditLog`` row in the caller's transaction, like every other
mutation in this package.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.admin.audit import apply_changes, write_audit
from app.api.admin.consts import (
    DEDUPE_KEY_CONFLICT_DETAIL,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    MAX_RESTAURANT_QUERY_LENGTH,
    RESTAURANT_IDENTITY_FIELDS,
    URL_RESTAURANT_FIELDS,
)
from app.api.admin.helpers import get_or_404, paginate
from app.api.deps import require_moderator
from app.api.schemas import Page
from app.api.schemas_restaurants import (
    EDITABLE_RESTAURANT_FIELDS,
    RestaurantDetail,
    UpdateRestaurantRequest,
)
from app.db.session import get_session
from app.ingestion.normalize import restaurant_dedupe_key
from app.models import AuditAction, Certificate, RecordState, Restaurant, RestaurantStatus

router = APIRouter()

#: Eager-loads the certificates (and their certifiers) every directory row shows as
#: read-only kashrut context, so a page of N rows is 2 queries rather than 2N.
_WITH_CERTIFICATES = selectinload(Restaurant.certificates).joinedload(Certificate.certifier)


@router.get("/restaurants", response_model=Page[RestaurantDetail])
def list_restaurants(
    q: str | None = Query(
        None,
        max_length=MAX_RESTAURANT_QUERY_LENGTH,
        description="Case-insensitive substring of name (he/en), address or city",
    ),
    city: str | None = Query(None, description="Filter by city_slug"),
    restaurant_status: RestaurantStatus | None = Query(None, alias="status"),
    record_state: RecordState | None = Query(None),
    needs_review: bool | None = Query(None),
    limit: int = Query(DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT),
    offset: int = Query(0, ge=0),
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> Page[RestaurantDetail]:
    """The whole corpus, filterable and paged, ordered by Hebrew name.

    Unlike the queues this endpoint has no "needs attention" predicate baked in: it
    lists every restaurant, in or out of any queue. The filters narrow it; the
    optional ``needs_review`` filter reproduces the review queue's population for a
    moderator who wants both views in one place.
    """
    stmt = select(Restaurant)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Restaurant.name_he.ilike(pattern),
                Restaurant.name_en.ilike(pattern),
                Restaurant.address_he.ilike(pattern),
                Restaurant.city_he.ilike(pattern),
            )
        )
    if city:
        stmt = stmt.where(Restaurant.city_slug == city)
    if restaurant_status is not None:
        stmt = stmt.where(Restaurant.status == restaurant_status)
    if record_state is not None:
        stmt = stmt.where(Restaurant.record_state == record_state)
    if needs_review is not None:
        stmt = stmt.where(Restaurant.needs_review.is_(needs_review))
    stmt = stmt.order_by(Restaurant.name_he.asc(), Restaurant.id.asc())
    total, rows = paginate(session, stmt.options(_WITH_CERTIFICATES), limit, offset)

    return Page(
        total=total,
        limit=limit,
        offset=offset,
        items=[RestaurantDetail.model_validate(row) for row in rows],
    )


@router.get("/restaurants/{restaurant_id}", response_model=RestaurantDetail)
def get_restaurant(
    restaurant_id: uuid.UUID,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> RestaurantDetail:
    """One restaurant with every editable field and its certificates as context."""
    restaurant = get_or_404(session, Restaurant, restaurant_id, "restaurant")

    return RestaurantDetail.model_validate(restaurant)


@router.patch("/restaurants/{restaurant_id}", response_model=RestaurantDetail)
def update_restaurant(
    restaurant_id: uuid.UUID,
    body: UpdateRestaurantRequest,
    actor: str = Depends(require_moderator),
    session: Session = Depends(get_session),
) -> RestaurantDetail:
    """Correct a restaurant's details. Audited; kashrut facts are unreachable from here.

    Only the fields the request actually sets are written, and only those that appear
    in ``EDITABLE_RESTAURANT_FIELDS`` — the intersection is computed here rather than
    trusting the schema, so the whitelist is enforced at the write site.

    Correcting any of ``RESTAURANT_IDENTITY_FIELDS`` re-derives ``dedupe_key``. If the
    corrected identity already belongs to another row the edit is refused with 409
    rather than silently creating two records that ingestion cannot tell apart — that
    is a merge, and a merge is not a details edit.

    Concurrency: the row is read FOR UPDATE, so two moderators editing the same record
    serialize and the second one's audit row reports the true before-state.
    """
    restaurant = get_or_404(session, Restaurant, restaurant_id, "restaurant", for_update=True)
    submitted = body.model_dump(exclude_unset=True)
    values: dict[str, Any] = {
        field: submitted[field] for field in EDITABLE_RESTAURANT_FIELDS if field in submitted
    }
    for field in URL_RESTAURANT_FIELDS:
        if values.get(field) is not None:
            values[field] = str(values[field])
    if any(field in values for field in RESTAURANT_IDENTITY_FIELDS):
        values.update(_rekeyed(session, restaurant, values))

    changes = apply_changes(restaurant, values)
    write_audit(
        session,
        "restaurant",
        restaurant.id,
        AuditAction.UPDATE,
        changes,
        actor,
        {
            "action": "update_restaurant",
            "note": body.note,
            "fields": sorted(values),
        },
    )

    return RestaurantDetail.model_validate(restaurant)


def _rekeyed(session: Session, restaurant: Restaurant, values: dict[str, Any]) -> dict[str, Any]:
    """
    Re-derive the ingestion natural key after an identity field was corrected.

    ``dedupe_key`` is deliberately outside the editable whitelist: it is derived, not
    entered. It is recomputed here from the post-edit identity so that the next
    ingestion run matches the corrected row instead of inserting a duplicate.

    Parameters:
        session (Session): The open session, used to detect an existing owner of the
            new key.
        restaurant (Restaurant): The row being edited, still holding its old values.
        values (dict[str, Any]): The whitelisted edit, already filtered.

    Return:
        dict[str, Any]: ``{"dedupe_key": ...}`` when the key moved, else empty.
    """
    new_key = restaurant_dedupe_key(
        values.get("name_he", restaurant.name_he),
        values.get("city_he", restaurant.city_he),
        values.get("address_he", restaurant.address_he),
    )
    if new_key == restaurant.dedupe_key:
        return {}

    clash = session.scalar(
        select(Restaurant.id).where(
            Restaurant.dedupe_key == new_key, Restaurant.id != restaurant.id
        )
    )
    if clash is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=DEDUPE_KEY_CONFLICT_DETAIL)

    return {"dedupe_key": new_key}
