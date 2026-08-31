"""enable row level security across the public schema

Revision ID: 0008_enable_row_level_security
Revises: 0007_drop_certifier_council_city
Create Date: 2026-08-25

Supabase publishes the ``public`` schema through PostgREST at the project URL, and
the publishable key that reaches it is by design shipped inside client applications.
Every Kashroot table stood there with Row-Level Security disabled — restaurants,
certificates, evidence photos, users, saved lists, the audit log — which made all of
them readable, writable and deletable by anyone holding the project URL. That is
Supabase's ``rls_disabled_in_public`` finding, and for a product whose moat is the
integrity of its certificate data, a silent write is worse than a leak.

Nothing here reads the database through PostgREST. FastAPI connects with the
``KASHROOT_DATABASE_URL`` role, which owns these tables, and a table owner bypasses
RLS unless ``FORCE ROW LEVEL SECURITY`` is set — deliberately not set below. So RLS
with no policies attached is invisible to the application and total for everyone
else: no policy means no row, for any other role.

The privilege revoke is the second half, and the reason this is not one line. RLS
gates rows; it does not withdraw the blanket ``GRANT ALL`` that Supabase's default
privileges hand ``anon`` and ``authenticated`` on every new table in ``public``.
Left in place, a single future permissive policy reopens everything. The
``ALTER DEFAULT PRIVILEGES`` statements carry the revoke forward to tables created
by later migrations; ``app.db.rls.enable_rls_sql`` is how those migrations must
carry the RLS half forward, since this sweep only sees the tables existing now.

Both halves are guarded — by table ownership, and by whether the roles exist at all —
so against a local ``docker compose`` Postgres, which has no PostgREST roles, this
migration only enables RLS and changes nothing an owner-connected app can observe.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0008_enable_row_level_security"
down_revision: str | None = "0007_drop_certifier_council_city"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Sweeps every ordinary table in ``public`` — application tables, ``alembic_version``
#: and PostGIS's ``spatial_ref_sys`` alike. ``pg_has_role`` skips anything the
#: connecting role cannot alter, so a hosted database that keeps its extension tables
#: under another owner is migrated as far as it can be instead of erroring out.
ENABLE_RLS_SWEEP = """
DO $$
DECLARE
    target regclass;
BEGIN
    FOR target IN
        SELECT c.oid::regclass
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND NOT c.relrowsecurity
          AND pg_has_role(current_user, c.relowner, 'USAGE')
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    END LOOP;
END
$$;
"""

DISABLE_RLS_SWEEP = """
DO $$
DECLARE
    target regclass;
BEGIN
    FOR target IN
        SELECT c.oid::regclass
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity
          AND pg_has_role(current_user, c.relowner, 'USAGE')
    LOOP
        EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', target);
    END LOOP;
END
$$;
"""

#: ``REVOKE ALL ON ALL TABLES IN SCHEMA public`` aborts with "permission denied" the
#: moment the schema holds one table the connecting role does not own — which on a
#: hosted database it will, since PostGIS reference tables can belong to another
#: role. The revoke is therefore driven off the same ownership filter as the sweep
#: above, so it covers everything it is allowed to touch and steps over the rest.
#: ``ALTER DEFAULT PRIVILEGES`` needs no such guard: it speaks only for the objects
#: this role creates later, which is what carries the revoke to future migrations.
REVOKE_POSTGREST_PRIVILEGES = """
DO $$
DECLARE
    grantee text;
    rel     record;
BEGIN
    FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
            CONTINUE;
        END IF;

        FOR rel IN
            SELECT c.oid::regclass AS ident,
                   CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p', 'S')
              AND pg_has_role(current_user, c.relowner, 'USAGE')
        LOOP
            EXECUTE format('REVOKE ALL ON %s %s FROM %I', rel.kind, rel.ident, grantee);
        END LOOP;

        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
            grantee);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
            grantee);
    END LOOP;
END
$$;
"""

GRANT_POSTGREST_PRIVILEGES = """
DO $$
DECLARE
    grantee text;
    rel     record;
BEGIN
    FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
            CONTINUE;
        END IF;

        FOR rel IN
            SELECT c.oid::regclass AS ident,
                   CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p', 'S')
              AND pg_has_role(current_user, c.relowner, 'USAGE')
        LOOP
            EXECUTE format('GRANT ALL ON %s %s TO %I', rel.kind, rel.ident, grantee);
        END LOOP;

        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I',
            grantee);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I',
            grantee);
    END LOOP;
END
$$;
"""


def upgrade() -> None:
    op.execute(ENABLE_RLS_SWEEP)
    op.execute(REVOKE_POSTGREST_PRIVILEGES)


def downgrade() -> None:
    """Restore the pre-0008 state, which is the publicly writable one.

    Reversing this migration re-exposes every table in ``public`` to the publishable
    key. It exists so the revision chain is complete, not because there is a reason
    to run it.
    """
    op.execute(GRANT_POSTGREST_PRIVILEGES)
    op.execute(DISABLE_RLS_SWEEP)
