# Kashroot — Kosher Restaurant Discovery App

**Read `docs/kosher-app-prd.md` for full product context before making product decisions.**

## What this is
An app that answers "Can I eat here according to MY standards?" — user defines a kashrut profile once (certifier whitelist + required attributes), every restaurant is shown as MATCH / NO_MATCH / UNKNOWN with evidence. Israel-first, MVP = discovery + saved lists in 5 cities (Tel Aviv, Jerusalem, Bnei Brak, Haifa, Beer Sheva). This is a **data-integrity product wearing an app** — the moat is the verified per-certificate database.

## Locked decisions — do not revisit without explicit instruction
- **Architecture:** Modular monolith. FastAPI + PostgreSQL/PostGIS, SQLAlchemy 2.0 + Alembic, Redis, S3-compatible media storage. Client: React Native (Expo). Admin console + owner portal: React web.
- **Match model:** Two layers. Layer 1 = binary kashrut gate (deterministic, explainable, reason codes). Layer 2 = Fit Score 0–100 for soft preferences only (distance, open-now, price, amenities). NEVER blend them; kashrut is never a percentage.
- **Fail-safe rule:** doubt → UNKNOWN, never doubt → MATCH. Expired cert with no renewal evidence auto-degrades to UNKNOWN. Community flags never raise status, only trigger review/degrade.
- **Data model:** attributes (glatt, chalav_yisrael, pas_yisrael, bishul_yisrael…) live on **Certificate, not Certifier**. Rabbanut = ~130 local councils × levels, not one certifier. Every kashrut-relevant field carries provenance (source, verified_by, verified_at).
- **The app never rules on halacha.** No agency rankings, no "X is Mehadrin" judgments. Users whitelist; app reports facts.
- **Match engine = pure, unit-tested function** over (Certificate × Profile). Ingestion = versioned pipelines with diff review. Kashrut status changes are event-sourced/audit-logged.
- Hebrew (RTL) + English at launch. Israel hours logic: Shabbat, chagim, erev chag, Chol Hamoed.
- Paid placement never influences match results or organic ranking.

## Current status (Aug 2026)
- PRD complete (`docs/`). No application code yet.
- **Seed data corpus exists:** `data/seed/kashroot_seed_corpus.csv` — 517 unique records from 6 certifier source documents (see `data/README.md` for schema, sources, and known gaps). Built by `scripts/build_seed.py`.
- Seed data has certifier + status only — **no certificate-level attributes, no expiry dates**. Records are `LIST_VERIFIED` at best; treat as source-hierarchy level 1 (official published lists).
- Launch gate: don't launch a city below 80% coverage.

## Build order (from PRD roadmap)
1. Data pipeline + moderation console FIRST (weeks 1–8), before app polish.
2. 5-city corpus to ≥80% coverage.
3. App beta in Jerusalem, then public launch Israel.

## Conventions
- Python 3.11+, type hints everywhere, pytest. Match engine gets exhaustive unit tests before anything else.
- Hebrew text: UTF-8 everywhere; CSV outputs use utf-8-sig for Excel compatibility.
- Never hardcode kashrut logic conclusions; everything derives from Certificate records + Profile.
- Migrations via Alembic only; never edit schema manually.
