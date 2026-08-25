"""Row-Level Security posture of the ``public`` schema.

Supabase publishes ``public`` through PostgREST at the project URL, and the
publishable key that reaches it is by design shipped inside client applications. A
table there with RLS disabled is therefore readable, writable and deletable by
anyone who knows the project URL — Supabase's ``rls_disabled_in_public`` finding.

Kashroot has no PostgREST client. FastAPI is the only thing that touches the
database, and it connects as the role that owns the tables; a table owner bypasses
RLS unless ``FORCE ROW LEVEL SECURITY`` is also set, which Kashroot does not set. So
RLS-on-with-no-policies costs the application nothing and denies everyone else every
row.

The functions here are pure, so the invariant is unit-testable without a database.
``kashroot db-check`` applies them to a live one; migration 0008 established it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from app.db.consts import ENABLE_RLS_TEMPLATE

#: Doubled to escape it inside a double-quoted SQL identifier.
_IDENTIFIER_QUOTE = '"'


@dataclass(frozen=True)
class RlsStatus:
    """How the tables of the ``public`` schema divide by Row-Level Security."""

    protected: tuple[str, ...]
    unprotected: tuple[str, ...]
    unprotected_extension_tables: tuple[str, ...]

    @property
    def is_clean(self) -> bool:
        """
        Whether every table holding Kashroot data has RLS enabled.

        Return:
            bool: True when no non-extension table in ``public`` is unprotected.
        """
        return not self.unprotected


def classify_public_tables(rows: Iterable[tuple[str, bool, bool]]) -> RlsStatus:
    """
    Sort a public-schema RLS probe into protected and unprotected tables.

    Extension-owned tables are reported apart from the rest: they hold no Kashroot
    data, and on a hosted database the connecting role may not own them, in which
    case no migration can enable RLS on them at all.

    Parameters:
        rows (Iterable[tuple[str, bool, bool]]): ``(table name, RLS enabled,
            extension-owned)`` triples, as returned by
            :data:`app.db.consts.PUBLIC_TABLE_RLS_QUERY`.

    Return:
        RlsStatus: That partition of the tables.
    """
    protected: list[str] = []
    unprotected: list[str] = []
    unprotected_extension_tables: list[str] = []

    for name, rls_enabled, extension_owned in rows:
        if rls_enabled:
            protected.append(name)
        elif extension_owned:
            unprotected_extension_tables.append(name)
        else:
            unprotected.append(name)

    return RlsStatus(
        protected=tuple(protected),
        unprotected=tuple(unprotected),
        unprotected_extension_tables=tuple(unprotected_extension_tables),
    )


def enable_rls_sql(table_name: str) -> str:
    """
    DDL enabling Row-Level Security on one table of the ``public`` schema.

    Every migration that creates a table must emit this for it. RLS is off on a newly
    created table, and migration 0008 only swept the tables that existed when it ran,
    so a table added later arrives unprotected and publicly readable.

    Parameters:
        table_name (str): Unquoted table name.

    Return:
        str: An ``ALTER TABLE ... ENABLE ROW LEVEL SECURITY`` statement.
    """
    escaped = table_name.replace(_IDENTIFIER_QUOTE, _IDENTIFIER_QUOTE * 2)

    return ENABLE_RLS_TEMPLATE.format(table=escaped)
