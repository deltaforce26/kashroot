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

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    EvidencePhotoStatus,
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
        # Partial: demo rows are a small, occasional subset (POC-only), so indexing
        # only the true side keeps the index tiny while still making "which certs are
        # synthetic" / "delete all demo rows" trivial lookups.
        Index(
            "ix_certificate_is_demo_seed_true",
            "is_demo_seed",
            postgresql_where=text("is_demo_seed"),
        ),
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
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

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

    #: True only for rows fabricated by ``scripts/seed_demo_attributes.py`` (POC demo
    #: data). Orthogonal to ``source``: a demo row can carry ``MODERATOR_VERIFIED`` the
    #: same way a genuine photo-reviewed row does, so this flag — not ``source`` — is
    #: the structured way to tell fabricated rows from real provenance and to find or
    #: purge them later.
    is_demo_seed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())

    restaurant: Mapped[Restaurant] = relationship(back_populates="certificates")
    certifier: Mapped[Certifier] = relationship(back_populates="certificates")
    source_document: Mapped[SourceDocument | None] = relationship()
    verified_by: Mapped[User | None] = relationship()
    evidence_photos: Mapped[list[CertificateEvidencePhoto]] = relationship(
        back_populates="certificate", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Certificate {self.restaurant_id} × {self.certifier_id} [{self.state}]>"


class CertificateEvidencePhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A photo (or PDF scan) of the physical certificate — source-hierarchy level 2
    evidence (PRD §13). This is how attributes and expiry dates enter the database:
    a moderator reviews the photo and records what the certificate *actually says*.

    Fail-safe lifecycle: uploads land as PENDING_REVIEW and change nothing. Only an
    ACCEPTED review may write attributes / valid_until / a source upgrade onto the
    certificate; a REJECTED photo changes nothing, ever.
    """

    __tablename__ = "certificate_evidence_photo"
    __table_args__ = (
        # Exact-duplicate uploads (same bytes, same certificate) are rejected in the
        # API with 409; this constraint is the race-proof backstop.
        UniqueConstraint("certificate_id", "sha256"),
        Index("ix_certificate_evidence_photo_status", "status"),
    )

    certificate_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("certificate.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    #: Object key in S3-compatible storage (``cert-evidence/{certificate_id}/{uuid}.{ext}``);
    #: never a public URL in the DB — viewing goes through presigned URLs.
    storage_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Hex digest of the stored bytes — dedupe key and integrity check.
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    #: Actor label of the uploader (``moderator:<name>`` for now; owner-portal uploads
    #: will carry their own prefix).
    uploaded_by: Mapped[str] = mapped_column(String(120), nullable=False)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    status: Mapped[EvidencePhotoStatus] = mapped_column(
        pg_enum(EvidencePhotoStatus, "evidence_photo_status"),
        nullable=False,
        server_default=EvidencePhotoStatus.PENDING_REVIEW.value,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(120))
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)

    certificate: Mapped[Certificate] = relationship(back_populates="evidence_photos")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<CertificateEvidencePhoto {self.certificate_id} [{self.status}]>"
