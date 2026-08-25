# Supabase runbook

Kashroot runs on Supabase for both stores: **relational** (Supabase Postgres, reached
by the same SQLAlchemy 2.0 + Alembic stack — Supabase *is* Postgres) and **object**
(Supabase Storage, holding certificate evidence photos).

`docker compose up` remains a complete offline stack. Nothing in the models, the match
engine, or the migrations differs between the two — only environment variables.

**The whole switch is 3 new lines in `.env`, 1 existing line changed, and 4 commands.**

---

## Before you start

Create a project at supabase.com, then copy down four values:

| # | Value | Where in the dashboard |
|---|---|---|
| 1 | Connection string | **Connect** (top bar) → **Transaction pooler** tab |
| 2 | Database password | set when the project was created; resettable under Settings → Database |
| 3 | Project URL | Settings → API → Project URL |
| 4 | **Secret** key | Settings → API Keys → **Secret keys** → reveal/create (`sb_secret_...`) |

> **Take the pooler string, not the Direct connection one.** The Connect dialog offers
> three tabs. *Direct connection* (`db.<ref>.supabase.co`) publishes only an AAAA record
> since Supabase's IPv4 deprecation, so on a machine without IPv6 it fails DNS outright:
> `could not translate host name ... to address: Name or service not known`. The pooler
> hosts (`aws-0-<region>.pooler.supabase.com`) are IPv4-reachable.
>
> The username differs too: direct is `postgres`, pooler is `postgres.<project-ref>`.

The pooler string looks like this:

```
postgresql://postgres.abcdefghij:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Two edits to it:

1. Change `postgresql://` to `postgresql+psycopg://`. This project uses psycopg3; the
   bare scheme resolves to psycopg2, which cannot take the pooler settings. `db-check`
   and `alembic` now refuse this with a readable message rather than a deep traceback.
2. You will use it at **two different ports** — the only difference between the two
   forms:
   - **6543** (Transaction pooler) — what the app uses. Goes in `.env`.
   - **5432** (Session pooler) — what `alembic` uses. Pasted on the command line only.

Migrations need one stable server session for DDL and advisory locks, which is why they
do not go through the transaction pooler.

> **Do not enable the PostGIS extension from the dashboard.** Alembic migration 0001
> creates it in the `public` schema, which is where the models expect it. The dashboard
> toggle installs it into `extensions` instead — recoverable (see Troubleshooting) but
> avoidable.

> **Not the publishable key.** Supabase renamed its keys: *publishable*
> (`sb_publishable_...`, formerly `anon`) is the client-side key, bound by Row Level
> Security — it cannot create a bucket or write an evidence photo. *Secret*
> (`sb_secret_...`, formerly `service_role`) is the one the backend needs. Startup
> rejects a publishable or anon key with an explanation rather than letting it fail
> as a 403 on first upload.
>
> The secret key bypasses Row Level Security. It is a **server-only secret**: it
> belongs in `.env`, never in `web/`, a mobile bundle, or a commit.

---

## Step 1 — edit `.env`

Change this existing line:

```dotenv
KASHROOT_DATABASE_URL=postgresql+psycopg://postgres.abcdefghij:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

Add these three:

```dotenv
KASHROOT_SUPABASE_URL=https://abcdefghij.supabase.co
KASHROOT_SUPABASE_SERVICE_KEY=eyJhbGciOi...
KASHROOT_SUPABASE_STORAGE_BUCKET=kashroot-evidence
```

Leave every other variable alone.

There is deliberately **no `KASHROOT_STORAGE_BACKEND` line to add.** It defaults to
`auto`: the presence of those two `KASHROOT_SUPABASE_*` values is what moves evidence
photos to Supabase Storage, and their absence is what keeps them on MinIO.

## Step 2 — create the tables (port 5432, once)

```powershell
$env:KASHROOT_DATABASE_URL="postgresql+psycopg://postgres.abcdefghij:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
alembic upgrade head
```

Then **close that terminal.** The `$env:` override lives only in it; everything after
this reads `.env`, which is on 6543.

## Step 3 — check the database

In a fresh terminal:

```powershell
kashroot db-check
```

Passing:

```
supabase-hosted        True
transaction pooler     True
prepared statements    False
postgis                3.3.7
alembic revision       0008_enable_row_level_security
row-level security     19 public tables, all protected
```

`postgis NOT INSTALLED` means step 2 did not run against this database — check which
URL was in effect.

`row-level security DISABLED on ...` is a failure, and the reason `db-check` exits
non-zero: those tables are readable and writable by anyone holding the project URL
(see *Row-Level Security* below). Run `alembic upgrade head`.

## Step 4 — check storage

```powershell
kashroot storage-check --create-bucket
```

Passing:

```
backend                supabase
bucket                 created
put/sign/stat/delete   OK (signed URL 312 chars)
```

`backend supabase` is the line proving the switch took effect; `s3` means the two
`KASHROOT_SUPABASE_*` lines are not being read. The command writes a throwaway object
under `_healthcheck/` and deletes it again, so one green run covers credentials,
bucket, upload, signing and deletion. Re-running prints `already existed`, also a pass.

In the dashboard, Storage must list the bucket as **Private**. If it ever shows Public,
stop: evidence photos are only ever reachable through a short-lived signed URL.

## Step 5 — load the data and run it

The Supabase database starts empty; the seeded corpus lives in your local Docker
Postgres and is left untouched.

```powershell
kashroot seed-import --dry-run
kashroot seed-import --apply
uvicorn app.main:app --reload --port 8000
```

Then `GET /health` → 200.

---

## Deeper verification

Worth doing once before trusting the migration:

**A search with a `center`.** This exercises a PostGIS `ST_DWithin` query through the
pooler. If PostGIS resolution is wrong, it fails here rather than at migration time.

**A real evidence photo**, uploaded through the moderation console (`cd web; npm run dev`):

1. The object appears under `cert-evidence/<certificate-id>/` in Storage.
2. It renders in the console — the signed URL works.
3. Copy that URL, wait past its 15-minute expiry, load it again — it must fail. That is
   the point of never storing public URLs.

**A PDF uploaded as evidence.** Its view URL must **download**, never render in the
browser's PDF viewer. This is the PDF-polyglot defence; on Supabase it is enforced by a
`download=evidence.pdf` parameter on the signed URL.

## Row-Level Security

Supabase serves the `public` schema over PostgREST at the project URL, and the
publishable key that reaches it is meant to be shipped inside clients. A table there
with RLS disabled is world-readable *and* world-writable — Supabase reports it as
`rls_disabled_in_public`, and for this product a silent write to `certificate` is
worse than a leak.

Migration `0008_enable_row_level_security` closes it, in two halves:

- **RLS on, no policies**, on every table in `public` the migrating role owns —
  including `alembic_version`. No policy means no row, for every role except the
  table's owner. The backend *is* the owner (`KASHROOT_DATABASE_URL`), and an owner
  bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set, which it deliberately is
  not. So the application sees no change at all.
- **Privileges revoked** from `anon` and `authenticated`, including the default
  privileges Supabase applies to newly created tables. RLS alone gates rows; the
  blanket `GRANT ALL` Supabase hands those roles would otherwise turn one future
  permissive policy back into a public database.

Two consequences worth knowing:

- **Nothing may talk to the database with the publishable key** — not `web/`, not
  `admin/`, not the mobile client. They go through the FastAPI backend, which is the
  only holder of the connection string. This is already how the project is built.
- **Every migration that creates a table must enable RLS on it.** RLS is off on a new
  table, and 0008 only swept what existed when it ran. Use
  `app.db.rls.enable_rls_sql("<table>")`; `kashroot db-check` fails if you forget.

`spatial_ref_sys` may still be listed as unprotected if PostGIS was installed from the
dashboard rather than by migration 0001 — the table then belongs to another role and
no migration of ours can alter it. It holds public EPSG reference data and the
privilege revoke still applies, so `db-check` reports it as a note, not a failure.

## Going back to local Docker

Comment out the two `KASHROOT_SUPABASE_*` lines and set
`KASHROOT_DATABASE_URL` back to `localhost:5433`, then:

```powershell
docker compose up -d
kashroot db-check        # -> supabase-hosted False
kashroot storage-check   # -> backend s3
```

Your existing local data is still there.

---

## Troubleshooting

**`could not translate host name "db.<ref>.supabase.co" to address`**
You copied the *Direct connection* string. It is IPv6-only. Use the Session pooler
string (port 5432) for migrations and the Transaction pooler string (port 6543) for the
app — and remember the username becomes `postgres.<project-ref>`. `kashroot db-check`
prints a warning when it sees a direct host.

**Traceback ends in `psycopg2`**
The URL still starts `postgresql://`. Change it to `postgresql+psycopg://`.

**`prepared statement "_pg3_0" already exists`**
On port 6543 with prepared statements forced on, or on a pooled URL this code did not
recognise. Confirm with `kashroot db-check`; force it off with
`KASHROOT_DB_PREPARED_STATEMENTS=false`.

**`type "geography" does not exist` / `function st_dwithin does not exist`**
PostGIS landed in the `extensions` schema (the dashboard toggle) rather than `public`.
Add `KASHROOT_DB_SEARCH_PATH=public,extensions`.

**`SSL connection has been closed unexpectedly` after idling**
Normal pooler recycling; the engine already sets `pool_pre_ping` and a 30-minute
`pool_recycle`. If it persists, the pool exceeds the project's connection budget —
lower `KASHROOT_DB_POOL_SIZE`.

**`storage-check` fails on upload but not on anything else**
The bucket exists under a different name than `KASHROOT_SUPABASE_STORAGE_BUCKET`.

**`... holds a PUBLISHABLE key`**
You copied the client-side key. Take the secret key from Settings → API Keys →
Secret keys (`sb_secret_...`).

**`alembic upgrade head` hangs**
You are on the transaction pooler. Use port 5432.

---

## Offline test coverage

No Supabase account required — every HTTP call is served by a mock transport:

```powershell
python -m pytest tests/test_supabase_storage.py tests/test_db_connection.py tests/test_storage_backend_selection.py -q
```

Covers signed-URL construction, the PDF-forced-download rule, transaction-pooler
detection, TLS normalization, and backend selection.
