"""sheet sync proposal

Revision ID: 0009_sheet_sync_proposal
Revises: 0008_enable_row_level_security
Create Date: 2026-09-26

The Google Sheet -> WhatsApp approve/deny sync workflow (docs/sheet-sync-runbook.md).
`kashroot sheet-sync propose` stores one row per fetched-sheet snapshot that differs
from the last one: the exact CSV text, the dry-run summary, and a single-use decision
token hash. `apply` imports the stored snapshot, never a re-fetch.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.rls import enable_rls_sql

revision: str = "0009_sheet_sync_proposal"
down_revision: str | None = "0008_enable_row_level_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE sheet_sync_proposal_status AS ENUM ("
        "'pending', 'approved', 'denied', 'applied', 'failed', 'superseded', "
        "'expired', 'no_changes')"
    )

    op.create_table(
        "sheet_sync_proposal",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("csv_sha256", sa.String(length=64), nullable=False),
        sa.Column("csv_text", sa.Text(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(name="sheet_sync_proposal_status", create_type=False),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_text", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sheet_sync_proposal")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sheet_sync_proposal_token_hash")),
    )
    op.create_index(
        op.f("ix_sheet_sync_proposal_csv_sha256"),
        "sheet_sync_proposal",
        ["csv_sha256"],
        unique=False,
    )
    op.create_index(
        op.f("ix_sheet_sync_proposal_status"), "sheet_sync_proposal", ["status"], unique=False
    )
    op.execute(enable_rls_sql("sheet_sync_proposal"))


def downgrade() -> None:
    op.drop_index(op.f("ix_sheet_sync_proposal_status"), table_name="sheet_sync_proposal")
    op.drop_index(op.f("ix_sheet_sync_proposal_csv_sha256"), table_name="sheet_sync_proposal")
    op.drop_table("sheet_sync_proposal")
    op.execute("DROP TYPE sheet_sync_proposal_status")
