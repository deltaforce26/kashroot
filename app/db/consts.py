"""Constants for database connection handling.

STANDARDS.md: connection details belong in a constants module, not inline in the
engine factory. The Supabase-specific values here encode two facts about hosted
Postgres that are easy to lose as folklore:

* Supabase's transaction-mode pooler (Supavisor, port 6543) multiplexes many client
  sessions onto few server connections and therefore cannot support server-side
  prepared statements. psycopg3 prepares statements automatically after a few
  executions, so it must be told not to.
* Supabase requires TLS. ``sslmode`` is forced on rather than left to whatever the
  operator happened to put in the URL.
"""

from __future__ import annotations

#: Any host containing one of these is a Supabase-hosted database.
SUPABASE_HOST_MARKERS = ("supabase.co", "supabase.com", "supabase.in")

#: Connections through Supavisor rather than direct to Postgres.
POOLER_HOST_MARKER = "pooler.supabase.com"

#: Supavisor transaction mode. Session mode (5432) keeps prepared statements.
TRANSACTION_POOLER_PORT = 6543

SSLMODE_QUERY_PARAM = "sslmode"
SSLMODE_REQUIRE = "require"

#: psycopg3 connect kwarg. ``None`` disables automatic statement preparation.
PREPARE_THRESHOLD_KEY = "prepare_threshold"
PREPARED_STATEMENTS_DISABLED = None

#: libpq startup option carrying per-connection settings such as search_path.
LIBPQ_OPTIONS_KEY = "options"
SEARCH_PATH_OPTION_TEMPLATE = "-c search_path={search_path}"

#: Supabase installs extensions into the ``extensions`` schema when they are enabled
#: from the dashboard. Set KASHROOT_DB_SEARCH_PATH to this when PostGIS was enabled
#: that way rather than created by Alembic migration 0001 (which puts it in public).
SUPABASE_EXTENSIONS_SEARCH_PATH = "public,extensions"

#: Recycle below the pooler's own idle timeout so SQLAlchemy never hands out a
#: connection the far side has already dropped.
DEFAULT_POOL_RECYCLE_SECONDS = 1800

#: Probes used by ``kashroot db-check``.
SERVER_VERSION_QUERY = "SELECT version()"
POSTGIS_VERSION_QUERY = "SELECT extversion FROM pg_extension WHERE extname = 'postgis'"
ALEMBIC_REVISION_QUERY = "SELECT version_num FROM alembic_version"

#: The direct-connection host (``db.<ref>.supabase.co``) publishes only an AAAA
#: record since Supabase's IPv4 deprecation, so it fails to resolve at all on a
#: host without IPv6 connectivity. The pooler hosts are IPv4-reachable.
SUPABASE_DIRECT_HOST_PREFIX = "db."

#: The driver this project targets. psycopg2 cannot accept the pooler tuning above
#: and is not a declared dependency. A bare ``postgresql://`` scheme is upgraded to
#: the psycopg3 drivername below; an explicitly different driver is an error.
PSYCOPG3_DRIVER = "psycopg"
POSTGRES_DIALECT = "postgresql"
POSTGRES_PSYCOPG3_DRIVERNAME = "postgresql+psycopg"

WRONG_DRIVER_ERROR = (
    "KASHROOT_DATABASE_URL names the {driver!r} driver, which this project does not "
    "ship. Use 'postgresql+psycopg://' (psycopg3), or drop the driver suffix entirely "
    "and 'postgresql://' will be resolved to it."
)
DIRECT_HOST_HINT = (
    "Host {host!r} is Supabase's direct connection, which is IPv6-only unless the IPv4 "
    "add-on is enabled — on a host without IPv6 it fails DNS resolution outright. Use a "
    "pooler host instead (Connect -> Session pooler for migrations, Transaction pooler "
    "for the app): postgres.<project-ref>@aws-0-<region>.pooler.supabase.com"
)

#: Roles Supabase exposes through PostgREST at the project URL: ``anon`` is the role
#: the publishable key assumes, ``authenticated`` any signed-in Supabase Auth user.
#: Kashroot has no PostgREST client — FastAPI is the only thing that reads or writes
#: the database — so neither role needs a single privilege in ``public``.
POSTGREST_ROLES = ("anon", "authenticated")

#: RLS is off by default on a newly created table, and a table in ``public`` without
#: it is world-readable through PostgREST. Every migration that creates a table must
#: emit this for it; see :func:`app.db.rls.enable_rls_sql`.
ENABLE_RLS_TEMPLATE = 'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'

#: Every ordinary table in ``public``, whether RLS is on, and whether the table
#: belongs to an extension (PostGIS reference data, which a hosted database may not
#: let the connecting role alter). Probed by ``kashroot db-check``.
PUBLIC_TABLE_RLS_QUERY = """
SELECT c.relname,
       c.relrowsecurity,
       EXISTS (
           SELECT 1
           FROM pg_depend d
           WHERE d.classid = 'pg_class'::regclass
             AND d.objid = c.oid
             AND d.deptype = 'e'
       )
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname
"""

RLS_CLEAN_TEMPLATE = "{count} public tables, all protected"
RLS_UNPROTECTED_TEMPLATE = (
    "DISABLED on {tables} — anyone holding the project's publishable key can read and "
    "write these over PostgREST. Run `alembic upgrade head`."
)
RLS_EXTENSION_TABLE_HINT = (
    "no RLS on {tables} — extension-owned reference data, not alterable by the connecting "
    "role, so migration 0008 stepped over it. No Kashroot data lives there, and that "
    "migration's privilege revoke still keeps PostgREST out."
)
