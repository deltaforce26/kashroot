"""Alembic environment.

The URL comes from app settings (KASHROOT_DATABASE_URL), never from alembic.ini, so
there is exactly one source of truth for which database is being migrated. It is put
through app.db.connection so migrations reach a Supabase-hosted database on exactly
the same terms as the running app (TLS forced on, prepared statements handled).

Run migrations through Supabase's *session* pooler or direct connection (port 5432),
not the transaction pooler: DDL and advisory locks want one stable server session.
"""

from __future__ import annotations

from logging.config import fileConfig

from geoalchemy2 import alembic_helpers
from sqlalchemy import create_engine, pool

from alembic import context
from app.core.config import settings
from app.db.base import Base
from app.db.connection import build_connect_args, normalized_url

# Importing the models package registers every table on Base.metadata.
import app.models  # noqa: F401  isort:skip

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

#: Never written back into alembic.ini: a password containing '%' would be eaten
#: by ConfigParser interpolation. The engine below is built from this directly.
DATABASE_URL = normalized_url(settings.database_url)

target_metadata = Base.metadata

#: PostGIS-managed objects that must never appear in an autogenerate diff.
EXCLUDED_TABLES = {"spatial_ref_sys", "geography_columns", "geometry_columns"}


def include_object(obj, name, type_, reflected, compare_to):  # noqa: ANN001, ANN201
    if type_ == "table" and name in EXCLUDED_TABLES:
        return False
    # geoalchemy2 manages its own spatial indexes/columns.
    return alembic_helpers.include_object(obj, name, type_, reflected, compare_to)


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
        include_schemas=False,
        process_revision_directives=alembic_helpers.writer,
        render_item=alembic_helpers.render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
        connect_args=build_connect_args(
            DATABASE_URL,
            prepared_statements=settings.db_prepared_statements,
            search_path=settings.db_search_path,
        ),
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
            include_schemas=False,
            process_revision_directives=alembic_helpers.writer,
            render_item=alembic_helpers.render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
