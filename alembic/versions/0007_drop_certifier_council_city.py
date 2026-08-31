"""drop certifier.council_city_he / council_city_en

Revision ID: 0007_drop_certifier_council_city
Revises: 0006_drop_certifier_parent_id
Create Date: 2026-08-23

The certifier's own name identifies its municipality: a local religious council is
``rabbanut_ashdod`` by slug and states the city in ``name_he``. Two further columns
holding the same fact could only ever drift out of sync with them, and nothing read
them — no filter, no coverage query, no client.

They were also unconstrained, and in practice wrong: the single row that carried them
(``landa_bnei_brak``) is a badatz, not a ``rabbanut_local``, so the "which council is
this" reading did not hold even for the one row populated. City-level questions are
answered by ``restaurant.city_slug``, which is indexed for exactly that.

Follows 0006 (drop of ``parent_id``) in the same direction: certifiers are a flat set
of concrete, self-describing rows.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_drop_certifier_council_city"
down_revision: str | None = "0006_drop_certifier_parent_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("certifier", "council_city_he")
    op.drop_column("certifier", "council_city_en")


def downgrade() -> None:
    op.add_column("certifier", sa.Column("council_city_en", sa.String(length=120), nullable=True))
    op.add_column("certifier", sa.Column("council_city_he", sa.String(length=120), nullable=True))
