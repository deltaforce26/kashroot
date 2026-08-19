"""Connection tuning for the relational database.

Pure functions over a database URL, so the Supabase-specific rules are unit-testable
without opening a connection. :mod:`app.db.session` and ``alembic/env.py`` both go
through here, which is what keeps migrations and the running app from disagreeing
about how to reach the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import URL, make_url

from app.core.consts import DEFAULT_DB_MAX_OVERFLOW, DEFAULT_DB_POOL_SIZE
from app.db.consts import (
    DEFAULT_POOL_RECYCLE_SECONDS,
    LIBPQ_OPTIONS_KEY,
    POOLER_HOST_MARKER,
    POSTGRES_DIALECT,
    POSTGRES_PSYCOPG3_DRIVERNAME,
    PREPARE_THRESHOLD_KEY,
    PREPARED_STATEMENTS_DISABLED,
    PSYCOPG3_DRIVER,
    SEARCH_PATH_OPTION_TEMPLATE,
    SSLMODE_QUERY_PARAM,
    SSLMODE_REQUIRE,
    SUPABASE_DIRECT_HOST_PREFIX,
    SUPABASE_HOST_MARKERS,
    TRANSACTION_POOLER_PORT,
    WRONG_DRIVER_ERROR,
)


@dataclass(frozen=True)
class ConnectionProfile:
    """What a database URL tells us about the server on the other end."""

    is_supabase: bool
    is_transaction_pooler: bool
    is_direct_host: bool


def profile_for_url(database_url: str | URL) -> ConnectionProfile:
    """
    Classify a database URL as Supabase-hosted and pooled or not.

    Parameters:
        database_url (str | URL): SQLAlchemy database URL.

    Return:
        ConnectionProfile: Flags describing the target server.
    """
    url = make_url(database_url)
    host = (url.host or "").lower()
    is_supabase = any(marker in host for marker in SUPABASE_HOST_MARKERS)
    is_transaction_pooler = POOLER_HOST_MARKER in host and url.port == TRANSACTION_POOLER_PORT

    return ConnectionProfile(
        is_supabase=is_supabase,
        is_transaction_pooler=is_transaction_pooler,
        is_direct_host=is_supabase and host.startswith(SUPABASE_DIRECT_HOST_PREFIX),
    )


def with_supported_driver(database_url: str | URL) -> URL:
    """
    Resolve a Postgres URL onto the driver this project actually ships.

    A bare ``postgresql://`` scheme is an *omission*, not a choice: SQLAlchemy resolves
    it to psycopg2, which is not a declared dependency and cannot accept the
    transaction-pooler settings. Since psycopg3 is the only Postgres driver here, the
    omission is filled in rather than raised on — the connection string pasted out of
    the Supabase dashboard then works unedited.

    Naming a different driver explicitly is a choice, and a wrong one, so that still
    raises with the fix in the message rather than failing deep inside the driver.

    Parameters:
        database_url (str | URL): SQLAlchemy database URL.

    Return:
        URL: The same URL, guaranteed to name a driver this project supports.
    """
    url = make_url(database_url)
    if url.drivername == POSTGRES_DIALECT:
        return url.set(drivername=POSTGRES_PSYCOPG3_DRIVERNAME)

    if url.drivername.startswith(f"{POSTGRES_DIALECT}+"):
        driver = url.get_driver_name()
        if driver != PSYCOPG3_DRIVER:
            raise ValueError(WRONG_DRIVER_ERROR.format(driver=driver))

    return url


def normalized_url(database_url: str | URL) -> URL:
    """
    Database URL with TLS forced on for Supabase-hosted targets.

    An explicit ``sslmode`` in the URL is always respected; this only fills in a
    missing one, so an operator can still choose ``verify-full``.

    Parameters:
        database_url (str | URL): SQLAlchemy database URL.

    Return:
        URL: The URL to connect with.
    """
    url = with_supported_driver(database_url)
    if not profile_for_url(url).is_supabase:
        return url

    if SSLMODE_QUERY_PARAM in url.query:
        return url

    return url.update_query_dict({SSLMODE_QUERY_PARAM: SSLMODE_REQUIRE})


def build_connect_args(
    database_url: str | URL,
    *,
    prepared_statements: bool | None = None,
    search_path: str | None = None,
) -> dict[str, Any]:
    """
    DBAPI connect arguments for a database URL.

    Prepared statements are disabled automatically when the URL points at Supabase's
    transaction-mode pooler, which cannot support them; ``prepared_statements``
    overrides that decision in either direction.

    ``search_path`` is sent as a libpq startup option and is left unset by default —
    some poolers reject unknown startup parameters, and PostGIS created by Alembic
    migration 0001 already lives in ``public``. Set it only when PostGIS was enabled
    from the Supabase dashboard, which installs it into the ``extensions`` schema.

    Parameters:
        database_url (str | URL): SQLAlchemy database URL.
        prepared_statements (bool | None): Force prepared statements on or off; None
            auto-detects from the URL.
        search_path (str | None): Postgres ``search_path`` to pin per connection.

    Return:
        dict[str, Any]: Keyword arguments for ``create_engine(connect_args=...)``.
    """
    profile = profile_for_url(with_supported_driver(database_url))
    connect_args: dict[str, Any] = {}

    use_prepared = prepared_statements
    if use_prepared is None:
        use_prepared = not profile.is_transaction_pooler
    if not use_prepared:
        connect_args[PREPARE_THRESHOLD_KEY] = PREPARED_STATEMENTS_DISABLED

    if search_path:
        connect_args[LIBPQ_OPTIONS_KEY] = SEARCH_PATH_OPTION_TEMPLATE.format(
            search_path=search_path
        )

    return connect_args


def build_engine_kwargs(
    database_url: str | URL,
    *,
    echo: bool = False,
    prepared_statements: bool | None = None,
    search_path: str | None = None,
    pool_size: int = DEFAULT_DB_POOL_SIZE,
    max_overflow: int = DEFAULT_DB_MAX_OVERFLOW,
) -> dict[str, Any]:
    """
    Complete keyword arguments for ``create_engine`` against a database URL.

    Parameters:
        database_url (str | URL): SQLAlchemy database URL.
        echo (bool): Whether SQLAlchemy logs emitted SQL.
        prepared_statements (bool | None): Force prepared statements on or off.
        search_path (str | None): Postgres ``search_path`` to pin per connection.
        pool_size (int): Persistent pool size.
        max_overflow (int): Connections allowed beyond the pool size.

    Return:
        dict[str, Any]: Keyword arguments to splat into ``create_engine``.
    """
    return {
        "echo": echo,
        "future": True,
        "pool_pre_ping": True,
        "pool_size": pool_size,
        "max_overflow": max_overflow,
        "pool_recycle": DEFAULT_POOL_RECYCLE_SECONDS,
        "connect_args": build_connect_args(
            database_url,
            prepared_statements=prepared_statements,
            search_path=search_path,
        ),
    }
