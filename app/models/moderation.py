"""Moderation, provenance and audit: Flag, OwnerClaim, IngestionRun, AuditLog.

Kashrut status changes are event-sourced through AuditLog — every write that can move a
restaurant between MATCH / NO_MATCH / UNKNOWN leaves a row here with its evidence.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    AuditAction,
    FlagState,
    FlagType,
    IngestionRunState,
    OwnerClaimState,
    pg_enum,
)

if TYPE_CHECKING:
    from app.models.restaurant import Restaurant
    from app.models.user import User


class Flag(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Community report. A flag never raises status — it can only trigger review or
    degrade a record to UNKNOWN (PRD §13).
    """

    __tablename__ = "flag"
    __table_args__ = (Index("ix_flag_state_created_at", "state", "created_at"),)

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    certificate_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("certificate.id", ondelete="SET NULL")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )

    type: Mapped[FlagType] = mapped_column(pg_enum(FlagType, "flag_type"), nullable=False)
    state: Mapped[FlagState] = mapped_column(
        pg_enum(FlagState, "flag_state"), nullable=False, server_default=FlagState.OPEN.value
    )
    message: Mapped[str | None] = mapped_column(Text)
    photo_key: Mapped[str | None] = mapped_column(Text)

    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    restaurant: Mapped[Restaurant] = relationship(back_populates="flags")
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])
    resolved_by: Mapped[User | None] = relationship(foreign_keys=[resolved_by_user_id])


class OwnerClaim(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Restaurant owner claiming their listing (PRD §13 — "responsive owner")."""

    __tablename__ = "owner_claim"

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    state: Mapped[OwnerClaimState] = mapped_column(
        pg_enum(OwnerClaimState, "owner_claim_state"),
        nullable=False,
        server_default=OwnerClaimState.PENDING.value,
    )
    evidence_key: Mapped[str | None] = mapped_column(Text)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    restaurant: Mapped[Restaurant] = relationship(back_populates="owner_claims")
    user: Mapped[User] = relationship(foreign_keys=[user_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_user_id])


class IngestionRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One execution of a versioned ingestion pipeline. ``dry_run`` runs are the diff
    review step: they report what *would* change and roll back.
    """

    __tablename__ = "ingestion_run"

    pipeline: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    pipeline_version: Mapped[str] = mapped_column(String(40), nullable=False)
    source_label: Mapped[str | None] = mapped_column(String(300))
    actor: Mapped[str | None] = mapped_column(String(120))
    dry_run: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    state: Mapped[IngestionRunState] = mapped_column(
        pg_enum(IngestionRunState, "ingestion_run_state"),
        nullable=False,
        server_default=IngestionRunState.RUNNING.value,
    )
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    #: Counters + the diff summary shown in review.
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)


class AuditLog(UUIDPrimaryKeyMixin, Base):
    """Append-only. Never updated, never deleted."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_entity_type_entity_id", "entity_type", "entity_id"),
        Index("ix_audit_log_created_at", "created_at"),
    )

    #: Monotonic append order — a total ordering for the trail even when created_at
    #: ties within a transaction. BIGINT identity in PostgreSQL; the SQLite test shim
    #: feeds it from a process-local counter (see tests/conftest.py).
    seq: Mapped[int] = mapped_column(
        BigInteger, Identity(always=False), nullable=False, index=True
    )

    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    action: Mapped[AuditAction] = mapped_column(pg_enum(AuditAction, "audit_action"), nullable=False)
    #: {"field": {"before": ..., "after": ...}} — the diff, not the whole row.
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    #: Who did it: user id when a human, pipeline name when automated.
    actor: Mapped[str | None] = mapped_column(String(120))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )
    #: Provenance for the change: source document slug, photo key, flag id…
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    ingestion_run_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ingestion_run.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
