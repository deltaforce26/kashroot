"""restaurant business place id

Revision ID: 0009_business_place_id
Revises: 0008_enable_row_level_security
Create Date: 2026-09-26

``Restaurant.google_place_id`` is filled by ``app.ingestion.geocode`` from the legacy
Geocoding API queried as ``"{address}, {city}"`` — that resolves the *street
address's* place id, not the business's, so Places (New) enrichment
(``app.services.places.PlacesService.enrichment``) gets no photos/hours for almost
every restaurant (the address place id carries none).

``google_business_place_id`` is the separate, nullable column
``app.ingestion.places_resolve`` fills via Places (New) Text Search, matched by name
+ address within a small radius of the existing geocoded point — never touching
``google_place_id``, which stays exactly what it always was. Non-unique index
(unlike ``google_place_id``'s unique one): a bad Text Search match sharing an id
with another row is a review question, not an integrity violation worth blocking
writes over. ``business_place_resolved_at`` records when the resolver decided,
whether it accepted or left the column null, so re-runs can tell "not tried" from
"tried and rejected" (``--force`` re-tries the latter).

No table is created here, so no RLS statement is needed (STANDARDS.md /
``app.db.rls``) — RLS applies per table, and ``restaurant`` already has it from
migration 0008.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_business_place_id"
down_revision: str | None = "0008_enable_row_level_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "restaurant",
        sa.Column("google_business_place_id", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "restaurant",
        sa.Column("business_place_resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_restaurant_google_business_place_id"),
        "restaurant",
        ["google_business_place_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_restaurant_google_business_place_id"),
        table_name="restaurant",
    )
    op.drop_column("restaurant", "business_place_resolved_at")
    op.drop_column("restaurant", "google_business_place_id")
