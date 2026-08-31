"""drop certifier.parent_id

Revision ID: 0006_drop_certifier_parent_id
Revises: 0005_certificate_is_demo_seed
Create Date: 2026-08-23

Certifiers are a flat set. The national Rabbanut is a certifier in its own right,
exactly like each of the ~130 local religious councils — not their parent.

``parent_id`` was documented as "display grouping only", but a hierarchy column in the
schema is a standing invitation to the inference the product forbids: trust in a parent
body never implies trust in a local council, nor the reverse (CLAUDE.md — the app never
ranks certifiers; users whitelist concrete ones). Nothing read the column: no ingestion
pipeline, no API response, no client. Removing it makes the schema state the rule.

This also removes the only self-referential foreign key in the schema.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_drop_certifier_parent_id"
down_revision: str | None = "0005_certificate_is_demo_seed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("fk_certifier_parent_id_certifier", "certifier", type_="foreignkey")
    op.drop_column("certifier", "parent_id")


def downgrade() -> None:
    op.add_column("certifier", sa.Column("parent_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_certifier_parent_id_certifier"),
        "certifier",
        "certifier",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
