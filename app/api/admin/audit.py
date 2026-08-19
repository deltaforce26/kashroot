"""Audit plumbing for the moderation console.

Every moderation mutation writes an ``AuditLog`` row **in the caller's still-open
transaction**, in the same shape ``app.ingestion.seed_import`` uses: action,
entity_type, entity_id, actor, changes as ``{field: {"before": …, "after": …}}``,
evidence JSON. There is no write endpoint for audit rows, ever, and moderator
tokens must never reach an evidence payload.
"""

from __future__ import annotations

import datetime as dt
import uuid
from enum import StrEnum
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditAction, AuditLog


def jsonable(value: Any) -> Any:
    """
    Coerce a value into something ``json.dumps`` accepts.

    Mirror of ``app.ingestion.seed_import._jsonable`` — audit payloads land in JSONB
    and must survive serialization.

    Parameters:
        value (Any): The value to coerce.

    Return:
        Any: The JSON-safe equivalent, or the value unchanged.
    """
    if isinstance(value, dt.date | dt.datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, StrEnum):
        return value.value

    return value


def apply_changes(obj: Any, values: dict[str, Any]) -> dict[str, Any]:
    """
    Set attributes on an ORM object and report what actually changed.

    Mirror of ``app.ingestion.seed_import._apply``. Fields whose value is unchanged
    are skipped, so an audit row never claims a write that did not happen.

    Parameters:
        obj (Any): The ORM instance to mutate.
        values (dict[str, Any]): Field name -> new value.

    Return:
        dict[str, Any]: ``{field: {"before": …, "after": …}}`` for the audit log.
    """
    changes: dict[str, Any] = {}
    for key, new in values.items():
        old = getattr(obj, key)
        if old == new:
            continue
        changes[key] = {"before": jsonable(old), "after": jsonable(new)}
        setattr(obj, key, new)

    return changes


def write_audit(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    action: AuditAction,
    changes: dict[str, Any],
    actor: str,
    evidence: dict[str, Any],
) -> None:
    """
    Append an audit row in the caller's (still-open) transaction.

    Same shape as ``app.ingestion.seed_import._audit``. Never include tokens in
    ``evidence``.

    Parameters:
        session (Session): The open session; the row joins the caller's transaction.
        entity_type (str): Entity table name, e.g. ``"certificate"``.
        entity_id (uuid.UUID): Primary key of the audited entity.
        action (AuditAction): What kind of mutation this was.
        changes (dict[str, Any]): Output of :func:`apply_changes`.
        actor (str): Resolved moderator name (never the token).
        evidence (dict[str, Any]): Request context; ``None`` values are dropped.

    Return:
        None
    """
    session.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            changes=changes,
            actor=actor,
            evidence={k: jsonable(v) for k, v in evidence.items() if v is not None},
        )
    )
