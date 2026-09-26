"""SheetSyncProposal — one Google Sheet snapshot awaiting a human decision.

`kashroot sheet-sync propose` (see ``app.ingestion.sheet_sync``) hashes the fetched
Google Sheet, and when the corpus changed, stores the exact CSV snapshot here along
with a dry-run summary and a single-use decision token. The person taps Approve or
Deny on the confirm page (``app.api.sync``); only an approval dispatches
`sheet-sync-apply.yml`, which imports **this stored snapshot** — never a re-fetch of
the sheet, so what gets applied is exactly what was reviewed.

``token_hash`` is a SHA-256 digest of a random URL-safe token; the raw token is never
stored, only ever embedded once in the WhatsApp link.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import SheetSyncProposalStatus, pg_enum


class SheetSyncProposal(UUIDPrimaryKeyMixin, Base):
    """A single Google Sheet snapshot proposed for import, pending human decision."""

    __tablename__ = "sheet_sync_proposal"

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    #: SHA-256 of ``csv_text``, hex-encoded — used to skip proposing an unchanged sheet.
    csv_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: The exact CSV snapshot fetched from the sheet (utf-8-sig text). ``apply`` writes
    #: this verbatim to ``DEFAULT_CSV_PATH`` — it never re-fetches the sheet.
    csv_text: Mapped[str] = mapped_column(Text, nullable=False)
    #: Human-readable dry-run summary (also the WhatsApp message body and the text
    #: shown on the confirm page).
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[SheetSyncProposalStatus] = mapped_column(
        pg_enum(SheetSyncProposalStatus, "sheet_sync_proposal_status"),
        nullable=False,
        server_default=SheetSyncProposalStatus.PENDING.value,
        index=True,
    )
    #: SHA-256 of the single-use decision token embedded in the WhatsApp link. The raw
    #: token is never persisted.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    #: Outcome of ``sheet-sync apply`` — the import stats summary, or the error string.
    result_text: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid only
        return f"<SheetSyncProposal {self.id} {self.status}>"
