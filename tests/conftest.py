"""Test fixtures.

Production is PostgreSQL/PostGIS — full stop. But the ingestion pipeline is ordinary
relational code, and it is worth exercising end-to-end on every machine without a
database daemon. The fixture below compiles the PG-specific column types down to SQLite
equivalents *for tests only*. Nothing here is imported by application code.

Anything genuinely PostGIS-shaped (geo queries, GIN/GiST index behaviour, native enum
constraints) is out of scope for these tests and belongs in an integration suite run
against `docker compose up db`.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from geoalchemy2 import Geography
from sqlalchemy import ColumnDefault, Text, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

import app.models  # noqa: F401  registers every table
from app.db.base import Base


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN202
    return "JSON"


@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN202
    return "CHAR(32)"


@compiles(Geography, "sqlite")
def _compile_geography_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN202
    return "TEXT"


#: Server-side defaults SQLite cannot evaluate; replaced with client-side equivalents.
_PG_ONLY_DEFAULTS = ("gen_random_uuid()", "now()", "CURRENT_TIMESTAMP")


@pytest.fixture(scope="session")
def sqlite_metadata():
    """Base.metadata with PG-only server defaults swapped for client-side ones."""
    # geoalchemy2 wraps geography columns in AsBinary() on SELECT, which SQLite has no
    # function for. Geo is never touched by ingestion, so a plain text column will do.
    Base.metadata.tables["restaurant"].columns["geo"].type = Text()

    for table in Base.metadata.tables.values():
        for column in table.columns:
            default = column.server_default
            if default is None:
                continue
            text = str(getattr(default, "arg", "")).lower()
            if not any(token.lower() in text for token in _PG_ONLY_DEFAULTS):
                continue
            column.server_default = None
            if "gen_random_uuid" in text:
                column.default = ColumnDefault(lambda _ctx: uuid.uuid4())
            else:  # now() / CURRENT_TIMESTAMP
                column.default = ColumnDefault(lambda _ctx: dt.datetime.now(dt.UTC))
    return Base.metadata


@pytest.fixture
def session(sqlite_metadata) -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection, _record):  # noqa: ANN001, ANN202
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    sqlite_metadata.create_all(engine)
    with Session(engine, autoflush=False, expire_on_commit=False) as db:
        yield db
    engine.dispose()
