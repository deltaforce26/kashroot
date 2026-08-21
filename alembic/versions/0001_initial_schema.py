"""initial schema — PRD §16 core entities

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-06

Creates the whole PRD §16 model in one shot: restaurants, certifiers + source
documents, certificates (attributes live here), users/profiles/whitelists, saved
lists, and the moderation + audit tables.

Requires PostgreSQL 13+ (gen_random_uuid) with PostGIS and pg_trgm available.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PostGIS for geo discovery, pg_trgm for Hebrew/English restaurant-name search.
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Enum types are created once here and referenced with create_type=False below.
    op.execute("CREATE TYPE diet_type AS ENUM ('meat', 'dairy', 'pareve', 'fish', 'mixed', 'dairy_pareve')")
    op.execute("CREATE TYPE restaurant_status AS ENUM ('open', 'closed_temp', 'closed_perm')")
    op.execute("CREATE TYPE record_state AS ENUM ('list_verified', 'moderator_verified', 'owner_submitted', 'field_verified', 'unknown_pending_verification')")
    op.execute("CREATE TYPE certifier_type AS ENUM ('rabbanut_local', 'rabbanut_national', 'badatz', 'private')")
    op.execute("CREATE TYPE certification_level AS ENUM ('unknown', 'regular', 'mehadrin')")
    op.execute("CREATE TYPE certificate_source AS ENUM ('certifier_portal', 'official_list', 'moderator_verified', 'owner_submitted', 'field_verification')")
    op.execute("CREATE TYPE certificate_state AS ENUM ('active', 'expired', 'revoked', 'pending')")
    op.execute("CREATE TYPE hours_rule_type AS ENUM ('weekly', 'erev_shabbat', 'shabbat', 'erev_chag', 'chag', 'chol_hamoed')")
    op.execute("CREATE TYPE photo_kind AS ENUM ('storefront', 'interior', 'food', 'menu', 'certificate')")
    op.execute("CREATE TYPE flag_type AS ENUM ('closed', 'no_certificate_displayed', 'different_certifier', 'expired_certificate', 'wrong_details', 'wrong_hours', 'other')")
    op.execute("CREATE TYPE flag_state AS ENUM ('open', 'in_review', 'resolved', 'rejected')")
    op.execute("CREATE TYPE owner_claim_state AS ENUM ('pending', 'approved', 'rejected', 'revoked')")
    op.execute("CREATE TYPE user_role AS ENUM ('user', 'owner', 'moderator', 'admin')")
    op.execute("CREATE TYPE language AS ENUM ('he', 'en')")
    op.execute("CREATE TYPE source_document_kind AS ENUM ('pdf', 'image', 'web', 'api', 'portal', 'manual')")
    op.execute("CREATE TYPE ingestion_run_state AS ENUM ('running', 'completed', 'failed')")
    op.execute("CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'state_change')")

    op.create_table('app_user',
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('display_name', sa.String(length=120), nullable=True),
    sa.Column('role', postgresql.ENUM(name='user_role', create_type=False), server_default='user', nullable=False),
    sa.Column('language', postgresql.ENUM(name='language', create_type=False), server_default='he', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_app_user')),
    sa.UniqueConstraint('email', name=op.f('uq_app_user_email')),
    sa.UniqueConstraint('phone', name=op.f('uq_app_user_phone'))
    )
    op.create_table('certifier',
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('name_he', sa.String(length=200), nullable=False),
    sa.Column('name_en', sa.String(length=200), nullable=True),
    sa.Column('type', postgresql.ENUM(name='certifier_type', create_type=False), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('council_city_he', sa.String(length=120), nullable=True),
    sa.Column('council_city_en', sa.String(length=120), nullable=True),
    sa.Column('logo_url', sa.Text(), nullable=True),
    sa.Column('website', sa.Text(), nullable=True),
    sa.Column('contact_phone', sa.String(length=40), nullable=True),
    sa.Column('freshness_days', sa.Integer(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['certifier.id'], name=op.f('fk_certifier_parent_id_certifier'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_certifier')),
    sa.UniqueConstraint('slug', name=op.f('uq_certifier_slug'))
    )
    op.create_table('ingestion_run',
    sa.Column('pipeline', sa.String(length=120), nullable=False),
    sa.Column('pipeline_version', sa.String(length=40), nullable=False),
    sa.Column('source_label', sa.String(length=300), nullable=True),
    sa.Column('actor', sa.String(length=120), nullable=True),
    sa.Column('dry_run', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('state', postgresql.ENUM(name='ingestion_run_state', create_type=False), server_default='running', nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('stats', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ingestion_run'))
    )
    op.create_index(op.f('ix_ingestion_run_pipeline'), 'ingestion_run', ['pipeline'], unique=False)
    op.create_table('restaurant',
    sa.Column('dedupe_key', sa.String(length=300), nullable=False),
    sa.Column('name_he', sa.String(length=300), nullable=False),
    sa.Column('name_en', sa.String(length=300), nullable=True),
    sa.Column('branch_label', sa.String(length=200), nullable=True),
    sa.Column('address_he', sa.String(length=300), nullable=True),
    sa.Column('address_en', sa.String(length=300), nullable=True),
    sa.Column('city_he', sa.String(length=120), nullable=True),
    sa.Column('city_en', sa.String(length=120), nullable=True),
    sa.Column('city_slug', sa.String(length=120), nullable=True),
    sa.Column('neighborhood_he', sa.String(length=120), nullable=True),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('website', sa.Text(), nullable=True),
    sa.Column('menu_url', sa.Text(), nullable=True),
    sa.Column('business_type_he', sa.String(length=200), nullable=True),
    sa.Column('diet_type', postgresql.ENUM(name='diet_type', create_type=False), nullable=True),
    sa.Column('price_level', sa.SmallInteger(), nullable=True),
    sa.Column('amenities', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('status', postgresql.ENUM(name='restaurant_status', create_type=False), server_default='open', nullable=False),
    sa.Column('record_state', postgresql.ENUM(name='record_state', create_type=False), nullable=False),
    sa.Column('needs_review', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('corroboration_count', sa.Integer(), server_default='1', nullable=False),
    sa.Column('geo', Geography(geometry_type='POINT', srid=4326, dimension=2, spatial_index=False, from_text='ST_GeogFromText', name='geography'), nullable=True),
    sa.Column('geocoded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('google_place_id', sa.String(length=200), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('price_level is null or price_level between 1 and 4', name=op.f('ck_restaurant_price_level_range')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_restaurant')),
    sa.UniqueConstraint('dedupe_key', name=op.f('uq_restaurant_dedupe_key')),
    sa.UniqueConstraint('google_place_id', name=op.f('uq_restaurant_google_place_id'))
    )
    op.create_index(op.f('ix_restaurant_city_he'), 'restaurant', ['city_he'], unique=False)
    op.create_index(op.f('ix_restaurant_city_slug'), 'restaurant', ['city_slug'], unique=False)
    op.create_index('ix_restaurant_geo', 'restaurant', ['geo'], unique=False, postgresql_using='gist')
    op.create_index(op.f('ix_restaurant_name_he'), 'restaurant', ['name_he'], unique=False)
    op.create_index('ix_restaurant_name_he_trgm', 'restaurant', ['name_he'], unique=False, postgresql_using='gin', postgresql_ops={'name_he': 'gin_trgm_ops'})
    op.create_index(op.f('ix_restaurant_needs_review'), 'restaurant', ['needs_review'], unique=False)
    op.create_table('audit_log',
    sa.Column('entity_type', sa.String(length=60), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=True),
    sa.Column('action', postgresql.ENUM(name='audit_action', create_type=False), nullable=False),
    sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('actor', sa.String(length=120), nullable=True),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('evidence', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('ingestion_run_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_user_id'], ['app_user.id'], name=op.f('fk_audit_log_actor_user_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ingestion_run_id'], ['ingestion_run.id'], name=op.f('fk_audit_log_ingestion_run_id_ingestion_run'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    op.create_index('ix_audit_log_created_at', 'audit_log', ['created_at'], unique=False)
    op.create_index('ix_audit_log_entity_type_entity_id', 'audit_log', ['entity_type', 'entity_id'], unique=False)
    op.create_index(op.f('ix_audit_log_ingestion_run_id'), 'audit_log', ['ingestion_run_id'], unique=False)
    op.create_table('opening_hours',
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('rule_type', postgresql.ENUM(name='hours_rule_type', create_type=False), nullable=False),
    sa.Column('weekday', sa.SmallInteger(), nullable=True),
    sa.Column('opens_at', sa.Time(), nullable=True),
    sa.Column('closes_at', sa.Time(), nullable=True),
    sa.Column('closes_next_day', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('is_closed', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('minutes_before_candle_lighting', sa.SmallInteger(), nullable=True),
    sa.Column('effective_from', sa.Date(), nullable=True),
    sa.Column('effective_until', sa.Date(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(rule_type = 'weekly' and weekday is not null) or (rule_type <> 'weekly' and weekday is null)", name=op.f('ck_opening_hours_weekday_only_for_weekly')),
    sa.CheckConstraint('weekday is null or weekday between 0 and 6', name=op.f('ck_opening_hours_weekday_range')),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_opening_hours_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_opening_hours'))
    )
    op.create_index('ix_opening_hours_restaurant_id_rule_type', 'opening_hours', ['restaurant_id', 'rule_type'], unique=False)
    op.create_table('owner_claim',
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('state', postgresql.ENUM(name='owner_claim_state', create_type=False), server_default='pending', nullable=False),
    sa.Column('evidence_key', sa.Text(), nullable=True),
    sa.Column('reviewed_by_user_id', sa.UUID(), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_owner_claim_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['app_user.id'], name=op.f('fk_owner_claim_reviewed_by_user_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], name=op.f('fk_owner_claim_user_id_app_user'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_owner_claim'))
    )
    op.create_index(op.f('ix_owner_claim_restaurant_id'), 'owner_claim', ['restaurant_id'], unique=False)
    op.create_index(op.f('ix_owner_claim_user_id'), 'owner_claim', ['user_id'], unique=False)
    op.create_table('restaurant_photo',
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('storage_key', sa.Text(), nullable=False),
    sa.Column('kind', postgresql.ENUM(name='photo_kind', create_type=False), nullable=False),
    sa.Column('caption', sa.String(length=300), nullable=True),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('uploaded_by_user_id', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_restaurant_photo_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by_user_id'], ['app_user.id'], name=op.f('fk_restaurant_photo_uploaded_by_user_id_app_user'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_restaurant_photo'))
    )
    op.create_index(op.f('ix_restaurant_photo_restaurant_id'), 'restaurant_photo', ['restaurant_id'], unique=False)
    op.create_table('saved_list',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('share_token', sa.String(length=64), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], name=op.f('fk_saved_list_user_id_app_user'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_saved_list')),
    sa.UniqueConstraint('share_token', name=op.f('uq_saved_list_share_token'))
    )
    op.create_index(op.f('ix_saved_list_user_id'), 'saved_list', ['user_id'], unique=False)
    op.create_table('source_document',
    sa.Column('slug', sa.String(length=120), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('kind', postgresql.ENUM(name='source_document_kind', create_type=False), nullable=False),
    sa.Column('certifier_id', sa.UUID(), nullable=True),
    sa.Column('source_date_label', sa.String(length=120), nullable=True),
    sa.Column('source_date', sa.Date(), nullable=True),
    sa.Column('uri', sa.Text(), nullable=True),
    sa.Column('checksum_sha256', sa.String(length=64), nullable=True),
    sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['certifier_id'], ['certifier.id'], name=op.f('fk_source_document_certifier_id_certifier'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_source_document')),
    sa.UniqueConstraint('slug', name=op.f('uq_source_document_slug'))
    )
    op.create_index(op.f('ix_source_document_certifier_id'), 'source_document', ['certifier_id'], unique=False)
    op.create_table('user_profile',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), server_default='default', nullable=False),
    sa.Column('is_default', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('required_attributes', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('diet_prefs', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('language', postgresql.ENUM(name='language', create_type=False), server_default='he', nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], name=op.f('fk_user_profile_user_id_app_user'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_profile'))
    )
    op.create_index(op.f('ix_user_profile_user_id'), 'user_profile', ['user_id'], unique=False)
    op.create_table('certificate',
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('certifier_id', sa.UUID(), nullable=False),
    sa.Column('level', postgresql.ENUM(name='certification_level', create_type=False), server_default='unknown', nullable=False),
    sa.Column('attributes', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('valid_from', sa.Date(), nullable=True),
    sa.Column('valid_until', sa.Date(), nullable=True),
    sa.Column('state', postgresql.ENUM(name='certificate_state', create_type=False), nullable=False),
    sa.Column('source', postgresql.ENUM(name='certificate_source', create_type=False), nullable=False),
    sa.Column('source_document_id', sa.UUID(), nullable=True),
    sa.Column('evidence_photo_key', sa.Text(), nullable=True),
    sa.Column('verified_by_user_id', sa.UUID(), nullable=True),
    sa.Column('verified_by_label', sa.String(length=120), nullable=True),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('corroboration_count', sa.Integer(), server_default='1', nullable=False),
    sa.Column('import_key', sa.String(length=400), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['certifier_id'], ['certifier.id'], name=op.f('fk_certificate_certifier_id_certifier'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_certificate_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_document_id'], ['source_document.id'], name=op.f('fk_certificate_source_document_id_source_document'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['verified_by_user_id'], ['app_user.id'], name=op.f('fk_certificate_verified_by_user_id_app_user'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_certificate')),
    sa.UniqueConstraint('import_key', name=op.f('uq_certificate_import_key'))
    )
    op.create_index('ix_certificate_attributes', 'certificate', ['attributes'], unique=False, postgresql_using='gin')
    op.create_index('ix_certificate_certifier_id_state', 'certificate', ['certifier_id', 'state'], unique=False)
    op.create_index('ix_certificate_restaurant_id_state', 'certificate', ['restaurant_id', 'state'], unique=False)
    op.create_index(op.f('ix_certificate_source_document_id'), 'certificate', ['source_document_id'], unique=False)
    op.create_index('ix_certificate_valid_until', 'certificate', ['valid_until'], unique=False)
    op.create_table('profile_certifier_whitelist',
    sa.Column('profile_id', sa.UUID(), nullable=False),
    sa.Column('certifier_id', sa.UUID(), nullable=False),
    sa.Column('min_level', postgresql.ENUM(name='certification_level', create_type=False), server_default='regular', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['certifier_id'], ['certifier.id'], name=op.f('fk_profile_certifier_whitelist_certifier_id_certifier'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['profile_id'], ['user_profile.id'], name=op.f('fk_profile_certifier_whitelist_profile_id_user_profile'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('profile_id', 'certifier_id', name=op.f('pk_profile_certifier_whitelist'))
    )
    op.create_table('saved_list_item',
    sa.Column('saved_list_id', sa.UUID(), nullable=False),
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_saved_list_item_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['saved_list_id'], ['saved_list.id'], name=op.f('fk_saved_list_item_saved_list_id_saved_list'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_saved_list_item')),
    sa.UniqueConstraint('saved_list_id', 'restaurant_id', name='uq_saved_list_item_list_restaurant')
    )
    op.create_index(op.f('ix_saved_list_item_restaurant_id'), 'saved_list_item', ['restaurant_id'], unique=False)
    op.create_index(op.f('ix_saved_list_item_saved_list_id'), 'saved_list_item', ['saved_list_id'], unique=False)
    op.create_table('flag',
    sa.Column('restaurant_id', sa.UUID(), nullable=False),
    sa.Column('certificate_id', sa.UUID(), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('type', postgresql.ENUM(name='flag_type', create_type=False), nullable=False),
    sa.Column('state', postgresql.ENUM(name='flag_state', create_type=False), server_default='open', nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('photo_key', sa.Text(), nullable=True),
    sa.Column('resolution', sa.Text(), nullable=True),
    sa.Column('resolved_by_user_id', sa.UUID(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['certificate_id'], ['certificate.id'], name=op.f('fk_flag_certificate_id_certificate'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['resolved_by_user_id'], ['app_user.id'], name=op.f('fk_flag_resolved_by_user_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['restaurant_id'], ['restaurant.id'], name=op.f('fk_flag_restaurant_id_restaurant'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], name=op.f('fk_flag_user_id_app_user'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_flag'))
    )
    op.create_index(op.f('ix_flag_restaurant_id'), 'flag', ['restaurant_id'], unique=False)
    op.create_index('ix_flag_state_created_at', 'flag', ['state', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_table('flag')
    op.drop_table('saved_list_item')
    op.drop_table('profile_certifier_whitelist')
    op.drop_table('certificate')
    op.drop_table('user_profile')
    op.drop_table('source_document')
    op.drop_table('saved_list')
    op.drop_table('restaurant_photo')
    op.drop_table('owner_claim')
    op.drop_table('opening_hours')
    op.drop_table('audit_log')
    op.drop_table('restaurant')
    op.drop_table('ingestion_run')
    op.drop_table('certifier')
    op.drop_table('app_user')

    op.execute("DROP TYPE IF EXISTS diet_type")
    op.execute("DROP TYPE IF EXISTS restaurant_status")
    op.execute("DROP TYPE IF EXISTS record_state")
    op.execute("DROP TYPE IF EXISTS certifier_type")
    op.execute("DROP TYPE IF EXISTS certification_level")
    op.execute("DROP TYPE IF EXISTS certificate_source")
    op.execute("DROP TYPE IF EXISTS certificate_state")
    op.execute("DROP TYPE IF EXISTS hours_rule_type")
    op.execute("DROP TYPE IF EXISTS photo_kind")
    op.execute("DROP TYPE IF EXISTS flag_type")
    op.execute("DROP TYPE IF EXISTS flag_state")
    op.execute("DROP TYPE IF EXISTS owner_claim_state")
    op.execute("DROP TYPE IF EXISTS user_role")
    op.execute("DROP TYPE IF EXISTS language")
    op.execute("DROP TYPE IF EXISTS source_document_kind")
    op.execute("DROP TYPE IF EXISTS ingestion_run_state")
    op.execute("DROP TYPE IF EXISTS audit_action")
    # Extensions are deliberately left installed — other schemas may depend on them.
