"""Row-Level Security on the ``public`` schema — the invariant migration 0008 set.

The unit tests here are pure: they exercise the classification `kashroot db-check`
reports from and the DDL later migrations must emit, without a database.

`LivePublicSchemaRlsTests` is the one that actually proves the finding is closed. It
opens the configured database and asserts no table in `public` is left unprotected —
the same probe `db-check` runs. With no reachable database configured it skips, in
the manner of `tests/test_search_query_postgres.py`: it is an integration check on
top of the unit tests, not a replacement for them.
"""

from __future__ import annotations

import unittest

from app.db.consts import PUBLIC_TABLE_RLS_QUERY
from app.db.rls import classify_public_tables, enable_rls_sql

APP_TABLE = "certificate"
EXTENSION_TABLE = "spatial_ref_sys"


class ClassifyPublicTablesTests(unittest.TestCase):
    def test_enabled_table_is_protected(self) -> None:
        status = classify_public_tables([(APP_TABLE, True, False)])

        self.assertEqual(status.protected, (APP_TABLE,))
        self.assertEqual(status.unprotected, ())
        self.assertTrue(status.is_clean)

    def test_disabled_table_is_unprotected_and_fails_the_check(self) -> None:
        status = classify_public_tables([(APP_TABLE, False, False)])

        self.assertEqual(status.unprotected, (APP_TABLE,))
        self.assertFalse(status.is_clean)

    def test_extension_table_is_reported_apart_and_does_not_fail_the_check(self) -> None:
        status = classify_public_tables([(EXTENSION_TABLE, False, True)])

        self.assertEqual(status.unprotected_extension_tables, (EXTENSION_TABLE,))
        self.assertEqual(status.unprotected, ())
        self.assertTrue(status.is_clean)

    def test_one_unprotected_table_among_many_still_fails_the_check(self) -> None:
        status = classify_public_tables(
            [
                ("alembic_version", True, False),
                ("restaurant", True, False),
                ("saved_list", False, False),
                (EXTENSION_TABLE, False, True),
            ]
        )

        self.assertEqual(status.protected, ("alembic_version", "restaurant"))
        self.assertEqual(status.unprotected, ("saved_list",))
        self.assertFalse(status.is_clean)

    def test_empty_schema_is_clean(self) -> None:
        status = classify_public_tables([])

        self.assertTrue(status.is_clean)
        self.assertEqual(status.protected, ())


class EnableRlsSqlTests(unittest.TestCase):
    def test_statement_targets_the_named_table(self) -> None:
        self.assertEqual(
            enable_rls_sql(APP_TABLE),
            'ALTER TABLE "certificate" ENABLE ROW LEVEL SECURITY',
        )

    def test_identifier_is_quoted_so_a_quote_cannot_escape_it(self) -> None:
        statement = enable_rls_sql('odd"name')

        self.assertEqual(statement, 'ALTER TABLE "odd""name" ENABLE ROW LEVEL SECURITY')

    def test_no_force_row_level_security(self) -> None:
        """The app connects as table owner; FORCE would lock it out of its own data."""
        self.assertNotIn("FORCE", enable_rls_sql(APP_TABLE))


class LivePublicSchemaRlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from sqlalchemy import create_engine, text

        from app.core.config import get_settings
        from app.db.connection import build_connect_args, normalized_url

        settings = get_settings()
        try:
            engine = create_engine(
                normalized_url(settings.database_url),
                connect_args=build_connect_args(settings.database_url),
            )
            with engine.connect() as connection:
                cls.rows = connection.execute(text(PUBLIC_TABLE_RLS_QUERY)).all()
        except Exception as exc:
            raise unittest.SkipTest(f"no reachable database configured: {exc}") from exc

    def test_no_public_table_is_left_without_row_level_security(self) -> None:
        status = classify_public_tables(self.rows)

        self.assertTrue(
            status.is_clean,
            f"RLS disabled on {', '.join(status.unprotected)} — run `alembic upgrade head`",
        )

    def test_the_schema_is_not_empty(self) -> None:
        """Guards the check above against passing on a database with no tables."""
        self.assertTrue(self.rows)
