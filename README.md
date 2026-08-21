# Kashroot
Kosher restaurant discovery — "Can I eat here according to MY standards?"

- `AGENTS.md` — project instructions for Codex (read first)
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
