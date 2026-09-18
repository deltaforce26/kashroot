# Kashroot — Application & Database Architecture

> **Target schema for the database redesign. Not yet implemented** — no code written as of
> 2026-09-18. Column inventories were read from the live models; the planned deltas are
> marked NEW / REMOVED.

---

## What Kashroot is

### The problem

"Is this restaurant kosher?" has no single answer. It depends entirely on **whose** standard
you keep. A restaurant certified by the local Rabbanut is kosher to many Israelis and
unacceptable to others. Badatz Eda Haredit satisfies a different population. Someone who
requires *chalav yisrael* but not *glatt* has yet another answer.

Existing directories flatten this into a binary "kosher ✓" — wrong for most users, and
dangerously wrong for the strictest ones.

### The core promise

**"Can *I* eat here, according to *my* standards?"**

You define a kashrut profile once — a whitelist of certifying bodies you personally accept,
plus attributes you require. Every restaurant then renders as one of three verdicts, with
the evidence shown.

| Verdict | Meaning |
|---|---|
| **MATCH** | A valid certificate from a certifier you whitelisted, meeting every attribute you require |
| **NO_MATCH** | Certified, but not by anyone you accept — or missing an attribute you require |
| **UNKNOWN** | Not enough evidence to say. **Never treated as "no"** |

The app **never rules on halacha**. No rankings, no "X is more reliable than Y." Users
whitelist; the app reports facts with provenance.

### The two-layer model

These never blend. Kashrut is never expressed as a percentage.

- **Layer 1 — the kashrut gate.** Binary, deterministic, explainable. A pure function over
  (Certificate × Profile) returning a verdict plus reason codes. Fully unit-tested, no
  database access.
- **Layer 2 — Fit Score 0–100.** Soft preferences only: distance, open-now, price level,
  amenities. Visually distinct from the verdict.

### The fail-safe rule

Doubt resolves to UNKNOWN, **never** to MATCH.

Concretely: a certificate attribute that is *absent* means unknown, not false — so it can
never satisfy a requirement. An expired certificate with no renewal evidence auto-degrades
to UNKNOWN and notifies anyone who saved that restaurant. Community flags can only trigger
review or degrade a status; **nothing user-submitted can ever raise one.**

### How a search actually works

1. **Profile travels in the request body** (no auth required for discovery). It carries the
   certifier whitelist with a `min_level` per certifier, plus required attributes.
2. **SQL narrows the field** — PostGIS `ST_DWithin` for radius (≤50 km) or a `city_slug`
   filter, plus `ILIKE` text matching. Capped at `MAX_QUERY_ROWS` (1,000).
3. **The match engine evaluates each candidate in Python.** For every certificate: is the
   certifier whitelisted? Is its level ≥ the user's `min_level`? Is every required attribute
   explicitly `true`? Is the state `active`? Is it fresh (within 365 days of `verified_at`)?
   Any certificate passing all five → MATCH.
4. **Layer 2 scores the survivors** on distance, price, amenities.
5. **Results sort by verdict first**, then fit. NO_MATCH rows stay in the list with their own
   pill — hiding them would answer a question the user did not ask.

### How the data gets in

This is a **data-integrity product wearing an app**. The moat is the verified per-certificate
database, and the source hierarchy is what protects it.

| Authority | Source | Can it write attributes/expiry? |
|---|---|---|
| 5 | Certifier portal (direct feed) | Yes |
| 4 | Moderator-verified certificate photo | Yes |
| 3 | Official published list (PDF/poster) | No — certifier + status only |
| 2 | Field verification | No |
| 1 | Owner-submitted | No |
| — | Community flag | **Never raises status** |

A certificate's `source` can only ever be upgraded, never downgraded, and only strictly
upward per that table.

### Current state

- **Corpus:** 379 records from 7 certifier source documents — 3 certifiers
  (`badatz_eda_haredit` 174, `badatz_mehadrin_rubin` 160, `landa_bnei_brak` 45).
- **Critical gap:** no real source carries certificate attributes or expiry dates. All real
  rows have empty `attributes` and `valid_until = NULL`; ~18 demo rows carry attributes
  flagged `is_demo_seed`.
- **Geography:** Jerusalem 133, Bnei Brak 35, Tzfat 33, Beit Shemesh 25, Tiberias 21,
  Haifa 16.
- **Worth flagging:** CLAUDE.md names Tel Aviv and Beer Sheva as launch cities, but the
  corpus has essentially nothing there. With an 80%-coverage launch gate, the stated launch
  set and the actual data do not line up.

---

## Architecture principles

The schema encodes six rules. Every table exists to serve one of them.

1. **Attributes live on Certificate, not Certifier.** The same Badatz issues different
   certificates to different restaurants. A certifier-level attribute would let the app infer
   "Badatz X ⇒ glatt" where that badatz never certified glatt.
2. **Tri-state attributes.** `attributes` is JSONB where `true`/`false` are claims and an
   **absent key is unknown**. Unknown can never satisfy a requirement.
3. **Rabbanut is ~130 flat certifiers**, one per local religious council — deliberately no
   `parent_id`. A hierarchy would invite the inference that trusting the national body implies
   trusting a council.
4. **Provenance on every kashrut-relevant field** — `source`, `verified_by`, `verified_at`,
   `corroboration_count`.
5. **Freshness ≠ expiry.** `valid_until` is a *published fact*. Freshness is an internal
   365-day clock off `verified_at`. `valid_until IS NULL` means "no published expiry;
   freshness governs" — never "not expired".
6. **Row-Level Security on every table.** Supabase serves the `public` schema to the
   publishable key, so an unprotected table is world-writable.

### Conventions used below

Every table has `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at` and
`updated_at` (`timestamptz`, not null) — except `profile_certifier_whitelist`, which uses a
composite primary key. These are omitted from the column tables.

**Final shape: 17 tables → 14.** `opening_hours` survives (slimmed); `owner_claim`,
`source_document` and `audit_log` are dropped.

---

## Schema group A — core kashrut model

### `restaurant`

| Column | Type | Null | Notes |
|---|---|---|---|
| `dedupe_key` | String(300) | no | **Unique.** Normalized natural key |
| `name_he` | String(300) | no | Indexed; GIN trigram index |
| `name_en` | String(300) | yes | |
| `branch_label` | String(200) | yes | Multi-branch disambiguation |
| `address_he` / `address_en` | String(300) | yes | |
| `city_he` / `city_en` | String(120) | yes | `city_he` indexed |
| `city_slug` | String(120) | yes | Indexed — stable city filter key |
| `neighborhood_he` | String(120) | yes | |
| `phone` | String(40) | yes | |
| `website` / `menu_url` | Text | yes | |
| `business_type_he` | String(200) | yes | |
| `diet_type` | enum | yes | meat / dairy / pareve / fish / mixed / dairy_pareve |
| `price_level` | SmallInt | yes | CHECK 1–4 |
| `amenities` | JSONB | no | Layer 2 only: family, parking, accessibility, delivery, groups |
| `status` | enum | no | open / closed_temp / closed_perm |
| `record_state` | enum | no | list_verified / moderator_verified / owner_submitted / field_verified / unknown_pending_verification |
| `needs_review` | bool | no | Indexed |
| `corroboration_count` | Integer | no | Default 1 |
| `geo` | Geography(POINT,4326) | yes | **GiST index** — radius search |
| `geocoded_at` | timestamptz | yes | |
| `google_place_id` | String(200) | yes | Unique |
| `notes` | Text | yes | |
| `primary_photo_key` **NEW** | Text | yes | Denormalized card image — avoids a join per row on 1,000-row searches |

### `certifier`

| Column | Type | Null | Notes |
|---|---|---|---|
| `slug` | String(100) | no | Unique — `badatz_eda_haredit`, `landa_bnei_brak` |
| `name_he` | String(200) | no | |
| `name_en` | String(200) | yes | |
| `type` | enum | no | rabbanut_local / rabbanut_national / badatz / private |
| `logo_url` / `website` | Text | yes | |
| `contact_phone` | String(40) | yes | |
| `is_active` | bool | no | Default true |
| `notes` | Text | yes | |
| `freshness_days` **REMOVED** | — | — | Dead: never written, never read — the engine always used its hardcoded 365 |

### `certificate` — the keystone

| Column | Type | Null | Notes |
|---|---|---|---|
| `restaurant_id` | UUID FK | no | CASCADE |
| `certifier_id` | UUID FK | no | **RESTRICT** — a certifier with certificates cannot be deleted |
| `level` | enum | no | unknown(-1) / regular(0) / mehadrin(1) — orderable *within one certifier only* |
| `attributes` | JSONB | no | **Tri-state.** glatt, chalav_yisrael, pas_yisrael, bishul_yisrael, yashan, kitniyot_pesach, sheruya. **GIN index** |
| `valid_from` | Date | yes | |
| `valid_until` | Date | yes | Indexed (expiry queue). **NULL = no published expiry**, never "not expired" |
| `state` | enum | no | active / expired / revoked / pending |
| `source` | enum | no | The authority hierarchy; upgrade-only |
| `evidence_photo_key` | Text | yes | The certificate image |
| `verified_by_user_id` | UUID FK | yes | SET NULL — human verifier |
| `verified_by_label` | String(120) | yes | Pipeline actor, e.g. `pipeline:seed_corpus@1.0.0` |
| `verified_at` | timestamptz | yes | **The freshness clock** |
| `corroboration_count` | Integer | no | Default 1 |
| `import_key` | String(400) | yes | Unique — ingestion idempotency |
| `is_demo_seed` | bool | no | Partial index where true |
| `notes` | Text | yes | |
| `source_ref` **NEW** | String(200) | yes | Document slug, replacing the dropped `source_document` FK |
| CHECK **NEW** | — | — | `valid_from <= valid_until`; `corroboration_count >= 1` |

**Why both a FK and a label for `verified_by`:** not every actor is a person. Ingestion
pipelines have no user row but must still satisfy the provenance rule.

### `certificate_evidence_photo`

The **only** channel by which attributes and expiry enter the database (source authority 4).

| Column | Type | Null | Notes |
|---|---|---|---|
| `certificate_id` | UUID FK | no | CASCADE |
| `storage_key` | Text | no | Unique — private bucket |
| `content_type` | String(100) | no | |
| `size_bytes` | Integer | no | |
| `sha256` | String(64) | no | Unique with `certificate_id` |
| `uploaded_by` | String(120) | no | Label (predates auth) |
| `uploaded_at` | timestamptz | no | |
| `status` | enum | no | **NEW** name `photo_review_status`: pending_review / accepted / rejected |
| `reviewed_by` | String(120) | yes | |
| `reviewed_at` | timestamptz | yes | |
| `review_note` | Text | yes | |
| Partial unique **NEW** | — | — | `(certificate_id) WHERE status='accepted'` — **the "one certificate image per restaurant" guarantee** |

---

## Schema group B — restaurant detail

### `restaurant_photo` — rebuilt

Previously dead scaffolding with no review lifecycle. Now a real feature: a gallery on the
restaurant page plus one main photo on the card, with owner/community uploads under
moderation.

| Column | Type | Null | Notes |
|---|---|---|---|
| `restaurant_id` | UUID FK | no | CASCADE |
| `storage_key` | Text | no | Private bucket while pending, public on accept |
| `kind` | enum | no | storefront / interior / food / menu / certificate |
| `caption` | String(300) | yes | |
| `sort_order` | Integer | no | Gallery order |
| `uploaded_by_user_id` | UUID FK | yes | |
| `uploaded_at` **NEW** | timestamptz | no | |
| `sha256` **NEW** | String(64) | no | Unique with `restaurant_id` — same image cannot be submitted twice |
| `status` **NEW** | enum | no | `photo_review_status` — shared with evidence photos |
| `reviewed_by_user_id` **NEW** | UUID FK | yes | |
| `reviewed_at` **NEW** | timestamptz | yes | |
| `review_note` **NEW** | Text | yes | |
| `is_primary` **NEW** | bool | no | Partial unique WHERE true; CHECK `is_primary ⇒ status='accepted'` |

The `is_primary` partial unique index means the database itself guarantees at most one main
photo per restaurant, and the CHECK means the card can never surface an unreviewed photo.

### `opening_hours` — kept, slimmed 11 → 7 columns

Kept because the locked decision commits to Israel hours logic (Shabbat, chagim, erev chag,
Chol Hamoed) at launch, and this table is what expresses it. Slimmed now because **nothing
reads it yet** — every cut is free today and becomes a migration plus a consumer change
later.

| Column | Type | Null | Notes |
|---|---|---|---|
| `restaurant_id` | UUID FK | no | CASCADE |
| `rule_type` | enum | no | weekly / erev_shabbat / shabbat / erev_chag / chag / chol_hamoed |
| `weekday` | SmallInt | yes | 0 = Sunday. CHECK: present iff `rule_type='weekly'` |
| `opens_at` / `closes_at` | Time | yes | |
| `is_closed` | bool | no | **Explicit closure.** An absent row means *unknown*, not closed |
| `minutes_before_candle_lighting` | SmallInt | yes | Erev Shabbat/chag — no fixed time can express this |
| `closes_next_day` **REMOVED** | — | — | **Derived**: `closes_at <= opens_at` |
| `effective_from` **REMOVED** | — | — | Seasonal-hours versioning no feature asked for |
| `effective_until` **REMOVED** | — | — | Same |
| `notes` **REMOVED** | — | — | Free text nothing displays |

**Why `closes_next_day` goes:** it is derivable, and a stored boolean that can contradict the
times it describes is a latent bug. Deriving it also gets the 24-hour case right, where
`opens_at == closes_at`.

**Why `is_closed` and `minutes_before_candle_lighting` stay** — both look cuttable but are
not. "Closed on Shabbat" must be statable explicitly, because an absent row means unknown and
conflating the two breaks the fail-safe rule. And erev Shabbat closing is relative to
candle-lighting, which shifts by date and city, so no fixed time can express it — that column
is the entire reason this is not a generic hours table.

---

## Schema group C — moderation and pipeline

### `flag`

Community reports. A flag can trigger review or degrade a status; it can never raise one.

| Column | Type | Null | Notes |
|---|---|---|---|
| `restaurant_id` | UUID FK | no | CASCADE |
| `certificate_id` | UUID FK | yes | |
| `user_id` | UUID FK | yes | Nullable — anonymous reports allowed |
| `type` | enum | no | closed / no_certificate_displayed / different_certifier / expired_certificate / wrong_details / wrong_hours / other |
| `state` | enum | no | open / in_review / resolved / rejected |
| `message` | Text | yes | |
| `photo_key` | Text | yes | |
| `resolution` | Text | yes | |
| `resolved_by_user_id` | UUID FK | yes | |
| `resolved_at` | timestamptz | yes | |

Indexed on `(state, created_at)` for the moderation queue.

### `ingestion_run`

Versioned pipelines with diff review — every import records what ran, under which version,
and what it changed.

| Column | Type | Null | Notes |
|---|---|---|---|
| `pipeline` | String(120) | no | Indexed |
| `pipeline_version` | String(40) | no | |
| `source_label` | String(300) | yes | |
| `actor` | String(120) | yes | |
| `dry_run` | bool | no | Imports default to dry-run |
| `state` | enum | no | running / completed / failed |
| `started_at` / `finished_at` | timestamptz | yes | |
| `stats` | JSONB | no | Counts of created, updated, skipped |
| `error` | Text | yes | |

### `geocode_cache`

Turning a Hebrew address into coordinates costs money per lookup. This table is the billing
guard, and — once `audit_log` is gone — the last record of where each coordinate came from.

| Column | Type | Null | Notes |
|---|---|---|---|
| `query` | String(500) | no | **Unique.** Normalized address + city, the cache key |
| `provider` | String(60) | no | Default `google_geocoding` |
| `status` | String(40) | no | Provider status verbatim |
| `response` | JSONB | no | Raw response body, untouched |

`ZERO_RESULTS` **is** cached — "Google could not find it" is itself a billable answer. Abort
statuses (`OVER_QUERY_LIMIT`, `REQUEST_DENIED`) are never cached: they describe the run, not
the query.

---

## Schema group D — users

Identity is **Supabase Auth**. `app_user` is a profile row, not a credential store.

### `app_user`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID PK | no | **NEW:** FK to `auth.users(id)` CASCADE, created *conditionally* |
| `display_name` | String(120) | yes | |
| `role` | enum | no | user / owner / moderator / admin |
| `language` | enum | no | he / en |
| `is_active` | bool | no | Default true |
| `email` **REMOVED** | — | — | Lives in `auth.users`; mirroring creates drift with no owner |
| `phone` **REMOVED** | — | — | Same |

**The `auth` schema does not exist locally.** Docker-compose Postgres and the SQLite test
shim have no `auth.users`, so the cross-schema FK must be created conditionally, guarded on
the schema being present. Consequence: a bad `app_user.id` inserts fine locally and fails
only on Supabase.

### `user_profile`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | UUID FK | no | CASCADE |
| `name` | String(120) | no | Default "default" — users can keep several profiles |
| `is_default` | bool | no | |
| `required_attributes` | JSONB | no | List of attribute keys — the user half of the Layer 1 gate |
| `diet_prefs` | JSONB | no | Layer 2 soft preferences |
| `language` | enum | no | he / en |

### `profile_certifier_whitelist`

**Composite primary key `(profile_id, certifier_id)`** — no UUID id.

| Column | Type | Null | Notes |
|---|---|---|---|
| `profile_id` | UUID FK | no | CASCADE |
| `certifier_id` | UUID FK | no | CASCADE |
| `min_level` | enum | no | unknown / regular / mehadrin |

This tiny table *is* the other half of the Layer 1 gate. "All local Rabbanut" expands at
selection time into one concrete row per council — a **snapshot, not a rule** — so a council
added to the registry later never silently widens what a user already accepted.

### `saved_list`

| Column | Type | Null | Notes |
|---|---|---|---|
| `user_id` | UUID FK | no | CASCADE |
| `name` | String(200) | no | |
| `share_token` | String(64) | yes | Unique. **NEW:** generated with `secrets.token_urlsafe`, not a UUID |
| `notes` | Text | yes | |

### `saved_list_item`

| Column | Type | Null | Notes |
|---|---|---|---|
| `saved_list_id` | UUID FK | no | CASCADE |
| `restaurant_id` | UUID FK | no | |
| `position` | Integer | no | Explicit ordering |
| `note` | Text | yes | Per-item note |

Unique on `(saved_list_id, restaurant_id)`. This stays a real table rather than an array
column on `saved_list`, because it carries `position` and `note`.

### Local-first, sync on sign-in

Profiles and saved lists currently live in browser `localStorage`
(`web/src/profile/storage.ts`, `web/src/saved/saved.ts`). That stays the anonymous path —
nobody hits a signup wall before using core discovery. On sign-in, local state migrates to
the server. That merge (last-write-wins vs. union, and idempotency on retry) is client + API
work, separate from this schema.

---

## Security model

### Two media buckets, opposite postures

| Bucket | Read access | URL style | Contents |
|---|---|---|---|
| `kashroot-evidence` | Private | Presigned, 15 min | Certificate images; pending restaurant photos in quarantine |
| `kashroot-photos` | Public read | Stable CDN | Accepted restaurant photos only |

The split exists because the two kinds of image have genuinely opposite needs. Evidence
photos are internal moderation material that can carry signatures and phone numbers. Card
photos are rendered to anonymous users up to 1,000 per search page — presigning those would
be expensive, uncacheable, and the URLs would expire in 15 minutes.

**Moderation forces a two-stage flow.** Uploads land in the private bucket under a
`pending-photos/` prefix; on accept the object is promoted to the public bucket and the
private copy deleted; on reject it is deleted outright. A pending photo must never sit in a
world-readable bucket — that would defeat the moderation the feature exists for.

Promotion is ordered put-public → commit the row → delete-private, so a crash mid-flight
leaves a harmless orphan in the private bucket rather than an accepted row pointing at
nothing.

The PDF-polyglot guard (`is_forced_download`, forcing PDFs to download rather than render
inline) applies to **both** buckets — it matters more on a public one, not less.

### Row-Level Security

The reason RLS is inert today is **not** the grant revoke in migration 0008 — it is that
FastAPI connects as the service role, which bypasses RLS regardless of grants. RLS becomes a
genuine backstop only by changing how user-scoped requests connect.

The design uses a **restricted role plus a session variable**, not `auth.uid()`:

- An application role that is **not** the table owner and lacks `BYPASSRLS`. User-scoped
  requests connect as that role; admin, ingestion and scripts keep the service role.
- Each user-scoped transaction opens with `SET LOCAL app.current_user_id = '<uuid>'`.
- Policies on the five user tables compare the owning user id against
  `current_setting('app.current_user_id', true)::uuid`.
- `authenticated` gets privileges on **those five tables only**. Certificate, restaurant,
  evidence and moderation tables stay fully revoked and service-role-only.

A route that forgets its `user_id` filter then returns zero rows instead of every user's
data.

`auth.uid()` was rejected because FastAPI is the only client of user data, so JWT plumbing
buys nothing — and `auth.uid()` does not exist on compose Postgres, which would make every
policy untestable outside Supabase.

### Two failure modes worth naming

**`SET LOCAL`, never `SET`.** Under transaction-mode pooling a plain `SET` persists on the
pooled connection and hands the previous request's user id to the next request. That is a
cross-user data leak with a one-word cause.

**Which session a query runs on is a security decision.** Policies are bypassed entirely by
the service role and by the table owner, so a user-scoped query accidentally issued on the
service-role session silently loses all protection — and looks identical in the code. The
restricted session should be the default for request handlers, with the service-role one
requiring an explicit opt-in.

### What the checks do not cover

`kashroot db-check` inspects `relrowsecurity` on `public` tables. It does **not** see Supabase
Storage policies on `storage.objects`, so a misconfigured public bucket passes clean. It also
does not currently verify that a table granting to `authenticated` actually carries a policy —
extending it to do both is part of this work.

---

## What was removed, and why

### Dropped tables

| Table | Rationale |
|---|---|
| `owner_claim` | Dead scaffolding — zero application coupling. Free removal. |
| `source_document` | Explicit decision. `verified_at` already carries the freshness clock, so the fail-safe rule is unaffected. Loses `checksum_sha256`, `retrieved_at`, and the Hebrew printed date; correcting a misread source date now touches every affected certificate row instead of one document row. |
| `audit_log` | Explicit decision. Deletes a shipped `GET /admin/audit` endpoint and touches ~30 files. Contradicts the locked "kashrut status changes are event-sourced" decision and removes the named mitigation for the existential "wrong MATCH on lapsed cert" risk. Also removes the only in-database reversibility for the 142-record Landa deletion — `scripts/build_seed.py` transcriptions become the sole recovery path. |

The runtime guard that no moderation path can raise a kashrut status
(`helpers.degrade_certificate_state`) survives the `audit_log` removal: that guard is a state
comparison, and the audit write was a separate side effect on the same path.

### Considered and rejected

| Proposal | Why not |
|---|---|
| Collapse to restaurants + certifiers + link table | Deletes attributes, expiry, provenance and status history — the Layer 1 gate and the moat. The honest version of that idea is a *fat* link table, which is what `certificate` already is. |
| Elasticsearch for lexical search | Postgres must stay authoritative for PostGIS radius/distance, so ES means a two-system join or a second source of truth. Hebrew analysis in ES is weak (no solid built-in stemmer). And the existing `gin_trgm_ops` index is not even queried yet — search is a plain `ILIKE`. Fix the query before adding a cluster. |
| A `basis = LISTING / CERTIFICATE` discriminator | `valid_until IS NULL` already encodes this and cannot be set inconsistently. Computing a synthetic `valid_until` would surface an expiry date **no source published**, presented to users as fact. |
| One polymorphic `photo` table | A polymorphic `owner_type`/`owner_id` pair cannot carry a real foreign key — an orphan-UUID anti-pattern. Two tables with real FKs and a shared status enum is the correct shape. |

### Deferred to a follow-up

Search work is deliberately out of scope so the reset stays auditable: query-time Hebrew
normalization with a persisted `search_name` column and a real trigram query, amenities
pushdown into SQL, and replacing silent result truncation with an honest error.

Note that Layer 1 gating **cannot** move into SQL — NO_MATCH rows must stay in results,
verdict sorting spans all of them, and a SQL reimplementation would be a second untestable
copy of the fail-safe rules.
