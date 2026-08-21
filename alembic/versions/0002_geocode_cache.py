"""geocode cache

Revision ID: 0002_geocode_cache
Revises: 0001_initial_schema
Create Date: 2026-08-07 01:05:29.911911

Response cache for the geocoding pipeline (app/ingestion/geocode.py): one row per
normalized query string, holding the raw provider response. Re-runs resolve from here
and never re-bill Google; accepted points cite their cache row as evidence.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0002_geocode_cache'
down_revision: str | None = '0001_initial_schema'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('geocode_cache',
    sa.Column('query', sa.String(length=500), nullable=False),
    sa.Column('provider', sa.String(length=60), server_default='google_geocoding', nullable=False),
    sa.Column('status', sa.String(length=40), nullable=False),
    sa.Column('response', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
              nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
              nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_geocode_cache')),
    sa.UniqueConstraint('query', name=op.f('uq_geocode_cache_query'))
    )


def downgrade() -> None:
    op.drop_table('geocode_cache')
