"""Database connection tuning — the Supabase rules, and what they must not touch.

These are pure functions over a URL, so nothing here opens a connection. The point
is that pointing KASHROOT_DATABASE_URL at Supabase silently does the right thing,
and that a local `docker compose up` Postgres is left exactly as it was.
"""

from __future__ import annotations

import unittest

from app.db.connection import (
    build_connect_args,
    build_engine_kwargs,
    normalized_url,
    profile_for_url,
)
from app.db.consts import PREPARE_THRESHOLD_KEY

LOCAL_URL = "postgresql+psycopg://kashroot:kashroot@localhost:5433/kashroot"
TRANSACTION_POOLER_URL = "postgresql+psycopg://postgres.abcdefghijklm:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
SESSION_POOLER_URL = "postgresql+psycopg://postgres.abcdefghijklm:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
DIRECT_URL = "postgresql+psycopg://postgres:pw@db.abcdefghijklm.supabase.co:5432/postgres"


class ProfileTests(unittest.TestCase):
    def test_local_postgres_is_not_supabase(self) -> None:
        profile = profile_for_url(LOCAL_URL)

        self.assertFalse(profile.is_supabase)
        self.assertFalse(profile.is_transaction_pooler)

    def test_transaction_pooler_is_detected(self) -> None:
        profile = profile_for_url(TRANSACTION_POOLER_URL)

        self.assertTrue(profile.is_supabase)
        self.assertTrue(profile.is_transaction_pooler)

    def test_session_pooler_on_5432_is_not_transaction_mode(self) -> None:
        profile = profile_for_url(SESSION_POOLER_URL)

        self.assertTrue(profile.is_supabase)
        self.assertFalse(profile.is_transaction_pooler)

    def test_direct_connection_is_supabase_but_not_pooled(self) -> None:
        profile = profile_for_url(DIRECT_URL)

        self.assertTrue(profile.is_supabase)
        self.assertFalse(profile.is_transaction_pooler)


class DriverResolutionTests(unittest.TestCase):
    def test_a_bare_scheme_is_upgraded_to_psycopg3(self) -> None:
        """A dashboard connection string pastes in as `postgresql://` and must just work."""
        bare = TRANSACTION_POOLER_URL.replace("postgresql+psycopg://", "postgresql://")

        self.assertEqual(normalized_url(bare).drivername, "postgresql+psycopg")

    def test_the_upgrade_preserves_host_port_user_and_password(self) -> None:
        bare = TRANSACTION_POOLER_URL.replace("postgresql+psycopg://", "postgresql://")

        url = normalized_url(bare)

        self.assertEqual(url.host, "aws-0-eu-central-1.pooler.supabase.com")
        self.assertEqual(url.port, 6543)
        self.assertEqual(url.username, "postgres.abcdefghijklm")
        self.assertEqual(url.password, "pw")

    def test_a_bare_scheme_still_gets_the_pooler_connect_args(self) -> None:
        bare = TRANSACTION_POOLER_URL.replace("postgresql+psycopg://", "postgresql://")

        self.assertIn(PREPARE_THRESHOLD_KEY, build_connect_args(bare))

    def test_a_bare_local_scheme_is_upgraded_too(self) -> None:
        bare = LOCAL_URL.replace("postgresql+psycopg://", "postgresql://")

        self.assertEqual(normalized_url(bare).drivername, "postgresql+psycopg")

    def test_psycopg2_named_explicitly_is_rejected(self) -> None:
        """Omitting the driver is an oversight; naming the wrong one is a choice."""
        explicit = TRANSACTION_POOLER_URL.replace("+psycopg://", "+psycopg2://")

        with self.assertRaises(ValueError) as caught:
            build_connect_args(explicit)

        self.assertIn("postgresql+psycopg://", str(caught.exception))

    def test_asyncpg_is_rejected(self) -> None:
        explicit = TRANSACTION_POOLER_URL.replace("+psycopg://", "+asyncpg://")

        with self.assertRaises(ValueError):
            build_connect_args(explicit)

    def test_a_non_postgres_url_is_left_alone(self) -> None:
        """The SQLite test fixture must pass through untouched."""
        url = normalized_url("sqlite+pysqlite:///:memory:")

        self.assertEqual(url.drivername, "sqlite+pysqlite")


class DirectHostTests(unittest.TestCase):
    def test_the_ipv6_only_direct_host_is_flagged(self) -> None:
        """`db.<ref>.supabase.co` is AAAA-only and fails DNS on an IPv4-only box."""
        self.assertTrue(profile_for_url(DIRECT_URL).is_direct_host)

    def test_pooler_hosts_are_not_flagged(self) -> None:
        self.assertFalse(profile_for_url(TRANSACTION_POOLER_URL).is_direct_host)
        self.assertFalse(profile_for_url(SESSION_POOLER_URL).is_direct_host)

    def test_local_postgres_is_not_flagged(self) -> None:
        self.assertFalse(profile_for_url(LOCAL_URL).is_direct_host)


class SslTests(unittest.TestCase):
    def test_supabase_urls_get_sslmode_require(self) -> None:
        url = normalized_url(DIRECT_URL)

        self.assertEqual(url.query["sslmode"], "require")

    def test_an_explicit_sslmode_is_respected(self) -> None:
        url = normalized_url(f"{DIRECT_URL}?sslmode=verify-full")

        self.assertEqual(url.query["sslmode"], "verify-full")

    def test_local_urls_are_untouched(self) -> None:
        url = normalized_url(LOCAL_URL)

        self.assertNotIn("sslmode", url.query)
        self.assertEqual(url.render_as_string(hide_password=False), LOCAL_URL)

    def test_the_string_form_masks_the_password(self) -> None:
        """URLs reach logs and error surfaces; the password must not travel with them."""
        self.assertNotIn("pw", str(normalized_url(DIRECT_URL)))

    def test_the_password_survives_normalization(self) -> None:
        url = normalized_url(DIRECT_URL)

        self.assertEqual(url.password, "pw")


class PreparedStatementTests(unittest.TestCase):
    def test_transaction_pooler_disables_prepared_statements(self) -> None:
        """Supavisor multiplexes sessions and cannot support server-side prepares."""
        connect_args = build_connect_args(TRANSACTION_POOLER_URL)

        self.assertIn(PREPARE_THRESHOLD_KEY, connect_args)
        self.assertIsNone(connect_args[PREPARE_THRESHOLD_KEY])

    def test_local_postgres_keeps_prepared_statements(self) -> None:
        connect_args = build_connect_args(LOCAL_URL)

        self.assertNotIn(PREPARE_THRESHOLD_KEY, connect_args)

    def test_session_pooler_keeps_prepared_statements(self) -> None:
        connect_args = build_connect_args(SESSION_POOLER_URL)

        self.assertNotIn(PREPARE_THRESHOLD_KEY, connect_args)

    def test_the_setting_can_force_them_off_anywhere(self) -> None:
        connect_args = build_connect_args(LOCAL_URL, prepared_statements=False)

        self.assertIn(PREPARE_THRESHOLD_KEY, connect_args)

    def test_the_setting_can_force_them_on_against_the_pooler(self) -> None:
        connect_args = build_connect_args(TRANSACTION_POOLER_URL, prepared_statements=True)

        self.assertNotIn(PREPARE_THRESHOLD_KEY, connect_args)


class SearchPathTests(unittest.TestCase):
    def test_no_startup_option_is_sent_by_default(self) -> None:
        """Some poolers reject unknown startup parameters, so this stays opt-in."""
        connect_args = build_connect_args(TRANSACTION_POOLER_URL)

        self.assertNotIn("options", connect_args)

    def test_a_configured_search_path_becomes_a_libpq_option(self) -> None:
        connect_args = build_connect_args(LOCAL_URL, search_path="public,extensions")

        self.assertEqual(connect_args["options"], "-c search_path=public,extensions")


class EngineKwargTests(unittest.TestCase):
    def test_engine_kwargs_carry_pooling_and_connect_args(self) -> None:
        kwargs = build_engine_kwargs(TRANSACTION_POOLER_URL, echo=True, pool_size=3)

        self.assertTrue(kwargs["echo"])
        self.assertTrue(kwargs["pool_pre_ping"])
        self.assertEqual(kwargs["pool_size"], 3)
        self.assertIn(PREPARE_THRESHOLD_KEY, kwargs["connect_args"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
