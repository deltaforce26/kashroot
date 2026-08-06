"""Certifiers and the source documents we ingest them from.

Rabbanut is modelled as ~130 *local religious councils*, one Certifier row each — never
one national "Rabbanut" certifier (PRD §16). ``parent_id`` links a local council to the
national body for display grouping only; whitelists always name the concrete certifier.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import CertifierType, SourceDocumentKind, pg_enum

if TYPE_CHECKING:
    from app.models.certificate import Certificate


class Certifier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "certifier"

    #: Stable human-readable key used by ingestion and by seed CSVs
    #: (e.g. ``rabbanut_bnei_brak``, ``badatz_eda_haredit``).
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    name_he: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(200))
    type: Mapped[CertifierType] = mapped_column(
        pg_enum(CertifierType, "certifier_type"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("certifier.id", ondelete="SET NULL")
    )

    #: For rabbanut_local: which municipality's religious council this is.
    council_city_he: Mapped[str | None] = mapped_column(String(120))
    council_city_en: Mapped[str | None] = mapped_column(String(120))

    logo_url: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str | None] = mapped_column(String(40))

    #: Per-certifier staleness window. A certificate from this certifier goes stale
    #: (→ UNKNOWN, never → MATCH) this many days after its evidence date when no
    #: explicit ``valid_until`` is known. NULL = use settings.default_freshness_days.
    freshness_days: Mapped[int | None] = mapped_column(Integer)

    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text)

    parent: Mapped[Certifier | None] = relationship(remote_side="Certifier.id", back_populates="children")
    children: Mapped[list[Certifier]] = relationship(back_populates="parent")
    certificates: Mapped[list[Certificate]] = relationship(back_populates="certifier")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Certifier {self.slug}>"


class SourceDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Provenance anchor: the published list / poster / portal payload a record came from.

    Every kashrut-relevant field carries provenance (CLAUDE.md); certificates point here.
    """

    __tablename__ = "source_document"

    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    kind: Mapped[SourceDocumentKind] = mapped_column(
        pg_enum(SourceDocumentKind, "source_document_kind"), nullable=False
    )
    certifier_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("certifier.id", ondelete="SET NULL"), index=True
    )

    #: As printed on the source, Hebrew calendar included ("Tamuz 5786 (Jun-Jul 2026)").
    source_date_label: Mapped[str | None] = mapped_column(String(120))
    #: Best-effort Gregorian date for the label above; drives freshness maths.
    source_date: Mapped[dt.date | None] = mapped_column(Date)

    uri: Mapped[str | None] = mapped_column(Text)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    retrieved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    certifier: Mapped[Certifier | None] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<SourceDocument {self.slug}>"
