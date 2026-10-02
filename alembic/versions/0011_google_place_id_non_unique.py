"""restaurant.google_place_id non-unique

Revision ID: 0011_google_place_id_non_unique
Revises: 0010_business_place_source
Create Date: 2026-09-30

``restaurant.google_place_id`` is the BUILDING/street-address place id from the
Geocoding API, so several distinct restaurants in one building or complex legitimately
share it. The unique constraint made ``app.ingestion.geocode`` unable to give each of
them its point; ``geocode`` now flags ``duplicate_place_id`` only when the normalized
names also match. The unique constraint is replaced by a plain index.

No table is created here, so no RLS statement is needed (STANDARDS.md /
``app.db.rls``); ``restaurant`` already has RLS from migration 0008.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_google_place_id_non_unique"
down_revision: str | None = "0010_business_place_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_restaurant_google_place_id", "restaurant", type_="unique")
    op.create_index(op.f("ix_restaurant_google_place_id"), "restaurant", ["google_place_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_restaurant_google_place_id"), table_name="restaurant")
    op.create_unique_constraint("uq_restaurant_google_place_id", "restaurant", ["google_place_id"])
