# Kashroot
Kosher restaurant discovery — "Can I eat here according to MY standards?"

- `CLAUDE.md` — project context for Claude Code (read first)
- `docs/` — PRD
- `data/` — seed corpus + certifier source documents (see `data/README.md`)
- `scripts/` — data pipeline scripts
- `app/` — FastAPI backend (modular monolith)
- `alembic/` — database migrations

## Layout

```
app/
  core/config.py        settings (env-driven, KASHROOT_* prefix)
  db/                   declarative base, engine, session scope
  models/               PRD §16 entities — restaurant, certifier, certificate, …
  ingestion/            versioned, idempotent, diff-reviewable pipelines
  cli.py                admin commands (typer)
  main.py               FastAPI app
alembic/versions/       migrations — the only way the schema ever changes
tests/                  pure-function + end-to-end ingestion tests
```

## Getting started

```bash
python -m venv .venv && .venv/Scripts/activate      # POSIX: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env

docker compose up -d db redis                        # PostGIS 16 + Redis
alembic upgrade head                                 # create the schema
```

`alembic upgrade head --sql` renders the migration without touching a database — handy
for reviewing exactly what will run.

Run the API:

```bash
uvicorn app.main:app --reload      # /health, /health/db, /docs
```

Run the tests (no database needed — the ingestion suite runs on in-memory SQLite):

```bash
pytest
```

## Importing the seed corpus

```bash
kashroot seed-import               # dry run: reports the diff, writes nothing
kashroot seed-import --apply       # writes
```

517 corpus rows become **531 restaurants** (rows listing several branches in one
address cell are split) and **540 certificates** (9 businesses are listed by two
certifiers), plus 4 certifiers and 6 source documents.

What the import establishes, and what it deliberately does not:

| | |
|---|---|
| Certifier + status | ✅ from official published lists (source hierarchy level 1) |
| Certificate attributes (glatt, pas yisrael…) | ❌ absent from the sources → `attributes = {}`, i.e. *unknown* |
| Expiry dates | ❌ absent → `valid_until = NULL`; per-certifier freshness governs staleness |
| Level (regular / mehadrin) | ❌ not published in these lists → `unknown` |

So a profile requiring any attribute resolves to **UNKNOWN** against seed records — never
MATCH. Rows the corpus flagged `needs_review` (ambiguous poster layout) get `PENDING`
certificates so they cannot serve a MATCH before a moderator sees them. Certificate
photos and field verification are what upgrade these records later.

Every run writes an `ingestion_run` row (including dry runs — reviews leave a trail) and
an `audit_log` entry per created or changed record, with the source document as evidence.

Re-running is safe: restaurants upsert on `dedupe_key`, certificates on `import_key`.

## Migrations

Alembic only — never edit the schema by hand.

```bash
alembic revision --autogenerate -m "add x"
alembic upgrade head
alembic downgrade -1
```

The URL comes from `KASHROOT_DATABASE_URL` via `app.core.config`, not from `alembic.ini`.

## Report notification email

Two public, anonymous events each send one email through [Resend](https://resend.com)
after their row is committed (`app.services.notifications`), via a background task
so a slow or failing send never delays or fails the response:

- Every community report (`POST /v1/restaurants/{id}/flags`).
- Every successful certificate-photo upload (`POST /v1/restaurants/{id}/certificate-photo`)
  — a rate-limited, rejected (409/413/415) or otherwise failed upload sends nothing.
  Admin/moderator uploads (`app.api.admin.photos`) never send anything either.

| Variable | Purpose |
| --- | --- |
| `KASHROOT_RESEND_API_KEY` | Resend API key (secret). |
| `KASHROOT_REPORT_EMAIL_FROM` | Verified Resend "from" address. |
| `KASHROOT_REPORT_EMAIL_TO` | Comma-separated recipient list. |
| `KASHROOT_ADMIN_BASE_URL` | Optional — base URL of the admin console, linked in each email to its flag or photo queue. |

Unset key or recipients is a silent no-op (`NullSender`), so local dev and the test
suite need none of this configured. See `.env.example`.

At startup, the app logs exactly one WARNING line stating whether report email is
configured (never the API key itself) — this is a WARNING, not INFO, specifically so
it is visible in Render's default uvicorn log output. A send failure logs Resend's
HTTP status and a truncated response body (e.g. `403 "domain not verified"`).

## Anonymous upload rate limiting

`POST /v1/restaurants/{id}/certificate-photo` and `POST /v1/restaurants/{id}/flags`
are both rate-limited per client IP (`app.services.rate_limit`), reused as a FastAPI
dependency with a distinct scope per endpoint (`"photo_upload"`, `"flag_report"`) so
their counters never collide, even for the same IP.

| Variable | Default | Purpose |
| --- | --- | --- |
| `KASHROOT_TRUST_PROXY_HEADERS` | `false` | Trust `X-Forwarded-For`'s first hop as the client IP. Enable only behind a proxy that itself sets/overwrites the header. |
| `KASHROOT_PHOTO_UPLOAD_RATE_LIMIT_PER_HOUR` | `5` | Uploads per IP per rolling-hour fixed window. |
| `KASHROOT_PHOTO_UPLOAD_RATE_LIMIT_PER_DAY` | `20` | Uploads per IP per rolling-day fixed window. |
| `KASHROOT_FLAG_REPORT_RATE_LIMIT_PER_HOUR` | `5` | Flag reports per IP per rolling-hour fixed window. |
| `KASHROOT_FLAG_REPORT_RATE_LIMIT_PER_DAY` | `20` | Flag reports per IP per rolling-day fixed window. |

Counts are kept in Redis (`KASHROOT_REDIS_URL`) so they're shared across worker
processes; if Redis is unset or errors at request time, the limiter falls back to an
in-process in-memory counter and logs the error, so local dev and the test suite need
no Redis daemon. The attempt is counted before the endpoint does any further
processing, so a rejected oversized upload still counts, and a rate-limited flag
report is rejected before a `Flag` row is created or a notification email is queued.
Over the limit, the response is `429` with a `Retry-After` header and
`detail: "rate_limited"`.
