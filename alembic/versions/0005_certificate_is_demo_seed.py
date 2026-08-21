"""certificate is_demo_seed

Revision ID: 0005_certificate_is_demo_seed
Revises: 0004_certificate_evidence_photo
Create Date: 2026-08-18

Structured provenance flag for fabricated POC demo certificates
(scripts/seed_demo_attributes.py). Distinct from ``certificate.source``: a demo row
may legitimately carry ``MODERATOR_VERIFIED`` the same way a genuine photo-reviewed
row does, so ``source`` alone cannot tell them apart. ``is_demo_seed`` is the
structured, queryable way to find or purge synthetic rows without touching
``SOURCE_AUTHORITY`` ordering (AGENTS.md: every kashrut-relevant field carries
provenance).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_certificate_is_demo_seed"
down_revision: str | None = "0004_certificate_evidence_photo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "certificate",
        sa.Column(
            "is_demo_seed",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.create_index(
        op.f("ix_certificate_is_demo_seed_true"),
        "certificate",
        ["is_demo_seed"],
        unique=False,
        postgresql_where=sa.text("is_demo_seed"),
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_certificate_is_demo_seed_true"),
        table_name="certificate",
        postgresql_where=sa.text("is_demo_seed"),
    )
    op.drop_column("certificate", "is_demo_seed")
