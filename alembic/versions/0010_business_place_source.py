"""restaurant business place source

Revision ID: 0010_business_place_source
Revises: 0009_business_place_id
Create Date: 2026-09-27

Adds ``restaurant.business_place_source`` (nullable), recording where
``google_business_place_id`` came from: the seed CSV's own
``google_business_place_id`` column (``seed_csv``) or a
``app.ingestion.places_resolve`` Text Search match (``google_places_text_search``).
See ``app.ingestion.places_resolve_consts.BUSINESS_PLACE_SOURCE_SEED_CSV`` /
``BUSINESS_PLACE_SOURCE_TEXT_SEARCH`` for the consts. A CSV-provided id is never
re-searched or overwritten by ``places-resolve --force`` — this column is how the
resolver tells the two apart.

No table is created here, so no RLS statement is needed (STANDARDS.md /
``app.db.rls``) — RLS applies per table, and ``restaurant`` already has it from
migration 0008.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_business_place_source"
down_revision: str | None = "0009_business_place_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "restaurant",
        sa.Column("business_place_source", sa.String(length=40), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("restaurant", "business_place_source")
