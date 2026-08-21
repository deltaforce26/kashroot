"""Engine / session factory. Sync SQLAlchemy 2.0 — the ingestion pipeline and the
match engine are both plain synchronous code; FastAPI runs them in a threadpool.

The engine is built from :mod:`app.db.connection`, which applies the Supabase-hosted
rules (TLS, transaction-pooler prepared-statement handling) when the configured URL
points at Supabase, and leaves a local Docker Postgres untouched.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.connection import build_engine_kwargs, normalized_url

engine = create_engine(
    normalized_url(settings.database_url),
    **build_engine_kwargs(
        settings.database_url,
        echo=settings.db_echo,
        prepared_statements=settings.db_prepared_statements,
        search_path=settings.db_search_path,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    ),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope. Commits on success, rolls back on any exception."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as session:
        yield session
