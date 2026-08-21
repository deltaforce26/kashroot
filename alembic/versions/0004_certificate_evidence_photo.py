"""certificate evidence photo

Revision ID: 0004_certificate_evidence_photo
Revises: 0003_audit_log_seq
Create Date: 2026-08-07

Certificate evidence photos (PRD §13, source-hierarchy level 2): uploaded photos/PDF
scans of the physical certificate, reviewed by a moderator. Only an ACCEPTED review
may feed attributes / expiry / a source upgrade onto the certificate.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0004_certificate_evidence_photo'
down_revision: str | None = '0003_audit_log_seq'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Enum type created once here, referenced with create_type=False below (same
    # pattern as 0001).
    op.execute(
        "CREATE TYPE evidence_photo_status AS ENUM ('pending_review', 'accepted', 'rejected')"
    )

    op.create_table('certificate_evidence_photo',
    sa.Column('certificate_id', sa.UUID(), nullable=False),
    sa.Column('storage_key', sa.Text(), nullable=False),
    sa.Column('content_type', sa.String(length=100), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('uploaded_by', sa.String(length=120), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column(
        'status',
        postgresql.ENUM(name='evidence_photo_status', create_type=False),
        server_default='pending_review',
        nullable=False,
    ),
    sa.Column('reviewed_by', sa.String(length=120), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('review_note', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(
        ['certificate_id'],
        ['certificate.id'],
        name=op.f('fk_certificate_evidence_photo_certificate_id_certificate'),
        ondelete='CASCADE',
    ),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_certificate_evidence_photo')),
    sa.UniqueConstraint(
        'certificate_id', 'sha256',
        name=op.f('uq_certificate_evidence_photo_certificate_id_sha256'),
    ),
    sa.UniqueConstraint('storage_key', name=op.f('uq_certificate_evidence_photo_storage_key')),
    )
    op.create_index(
        op.f('ix_certificate_evidence_photo_certificate_id'),
        'certificate_evidence_photo',
        ['certificate_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_certificate_evidence_photo_status'),
        'certificate_evidence_photo',
        ['status'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_certificate_evidence_photo_status'), table_name='certificate_evidence_photo'
    )
    op.drop_index(
        op.f('ix_certificate_evidence_photo_certificate_id'),
        table_name='certificate_evidence_photo',
    )
    op.drop_table('certificate_evidence_photo')
    op.execute('DROP TYPE evidence_photo_status')
