"""Moderation console API (PRD FR8) — queues, actions, audit trail.

Router assembly only. The four ground rules the package enforces, each in code
rather than by convention:

* Every mutation writes an ``AuditLog`` row **in the same transaction** — see
  :mod:`app.api.admin.audit`.
* Fail-safe (PRD §13): no moderation path may ever *raise* a kashrut status except
  ``actions.verify_renewal``, which demands explicit renewal evidence. Flag
  resolutions in particular can only close the flag or degrade — see
  ``helpers.degrade_certificate_state``.
* The match engine (``app.match``) is never imported anywhere in this package; it
  records facts and provenance, it draws no kashrut conclusions.
* ``/audit`` is read-only. There is no write endpoint for audit rows, ever.

Module map:
    consts   — paging limits, SLA windows, upload caps, fail-safe state ranking
    audit    — jsonable / apply_changes / write_audit
    helpers  — date basis, paging, locked lookups, degrade guard, serializers
    queues   — the five read endpoints
    actions  — resolve-review, resolve-flag, degrade, verify-renewal
    photos   — evidence upload, listing, and review
    restaurants — the full directory: browse every record, edit non-kashrut details
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.admin.actions import router as actions_router
from app.api.admin.photos import router as photos_router
from app.api.admin.queues import router as queues_router
from app.api.admin.restaurants import router as restaurants_router

router = APIRouter(
    prefix="/api/admin",
    tags=["moderation"],
    responses={401: {"description": "Missing or invalid moderator token"}},
)
router.include_router(queues_router)
router.include_router(actions_router)
router.include_router(photos_router)
router.include_router(restaurants_router)

__all__ = ["router"]
