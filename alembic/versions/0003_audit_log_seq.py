"""audit log seq

Revision ID: 0003_audit_log_seq
Revises: 0002_geocode_cache
Create Date: 2026-08-07 09:30:00.000000

Adds a monotonic BIGINT identity column to audit_log so the /api/admin/audit endpoint
has a total "newest first" ordering even when created_at ties within a transaction.
PostgreSQL backfills existing rows in append order on ADD COLUMN ... IDENTITY.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0003_audit_log_seq'
down_revision: str | None = '0002_geocode_cache'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'audit_log',
        sa.Column('seq', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    )
    op.create_index(op.f('ix_audit_log_seq'), 'audit_log', ['seq'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_audit_log_seq'), table_name='audit_log')
    op.drop_column('audit_log', 'seq')
