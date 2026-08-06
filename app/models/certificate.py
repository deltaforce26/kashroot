"""Certificate — the row the whole product hangs on.

Attributes (glatt, chalav yisrael, …) live **here**, not on Certifier: the same badatz
certifies different restaurants at different attribute sets (PRD §16, CLAUDE.md).

``attributes`` is tri-state JSONB::

    {"glatt": true, "pas_yisrael": false}   # yashan is *unknown*, not false

A key that is absent is unknown and can never satisfy a profile requirement. Doubt →
UNKNOWN, never doubt → MATCH.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    pg_enum,
)

if TYPE_CHECKING:
    from app.models.certifier import Certifier, SourceDocument
    from app.models.restaurant import Restaurant
    from app.models.user import User


def validate_attributes(attributes: dict[str, Any]) -> dict[str, bool]:
    """Reject unknown keys and non-boolean values before they reach the DB."""
    allowed = {a.value for a in CertificateAttribute}
    cleaned: dict[str, bool] = {}
    for key, value in attributes.items():
        if key not in allowed:
            raise ValueError(f"unknown certificate attribute {key!r}; allowed: {sorted(allowed)}")
        if not isinstance(value, bool):
            raise ValueError(
                f"attribute {key!r} must be true/false — omit the key entirely for unknown"
            )
        cleaned[key] = value
    return cleaned


class Certificate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "certificate"
    __table_args__ = (
        Index("ix_certificate_restaurant_id_state", "restaurant_id", "state"),
        Index("ix_certificate_certifier_id_state", "certifier_id", "state"),
        # Expiry queue: surface certs expiring in the next 14 days (PRD §13 SLA).
        Index("ix_certificate_valid_until", "valid_until"),
        Index("ix_certificate_attributes", "attributes", postgresql_using="gin"),
    )

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False
    )
    certifier_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("certifier.id", ondelete="RESTRICT"), nullable=False
    )

    level: Mapped[CertificationLevel] = mapped_column(
        pg_enum(CertificationLevel, "certification_level"),
        nullable=False,
        server_default=CertificationLevel.UNKNOWN.value,
    )
    attributes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )

    valid_from: Mapped[dt.date | None] = mapped_column(Date)
    #: NULL = expiry unknown (published lists carry no validity window). Freshness, not
    #: expiry, governs those; a NULL here never counts as "not expired".
    valid_until: Mapped[dt.date | None] = mapped_column(Date)

    state: Mapped[CertificateState] = mapped_column(
        pg_enum(CertificateState, "certificate_state"), nullable=False
    )
    source: Mapped[CertificateSource] = mapped_column(
        pg_enum(CertificateSource, "certificate_source"), nullable=False
    )
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("source_document.id", ondelete="SET NULL"), index=True
    )
    #: Object key of the certificate photo in S3-compatible storage.
    evidence_photo_key: Mapped[str | None] = mapped_column(Text)

    verified_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )
    #: Free-text actor when no user row exists (pipeline name, ops runner handle).
    verified_by_label: Mapped[str | None] = mapped_column(String(120))
    #: When the evidence was last confirmed — drives "verified X days ago" and staleness.
    verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    corroboration_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    #: Idempotency key for ingestion pipelines, e.g. ``seed:<restaurant>:<certifier>``.
    import_key: Mapped[str | None] = mapped_column(String(400), unique=True)
    notes: Mapped[str | None] = mapped_column(Text)

    restaurant: Mapped[Restaurant] = relationship(back_populates="certificates")
    certifier: Mapped[Certifier] = relationship(back_populates="certificates")
    source_document: Mapped[SourceDocument | None] = relationship()
    verified_by: Mapped[User | None] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Certificate {self.restaurant_id} × {self.certifier_id} [{self.state}]>"
