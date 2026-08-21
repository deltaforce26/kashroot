# Kashroot — Working Notes

Running notes on decisions, gotchas, and open items that are not obvious from the
code or the PRD. Newest sections first. (Locked product decisions live in
CLAUDE.md; this file is for everything worth remembering that isn't locked.)

## Shared-building addresses defeat one-point-per-restaurant (Aug 2026)

- `Restaurant.google_place_id` is **unique**, and Google returns one place for a whole
  building. So when several distinct kosher businesses occupy one address — a mall, an
  office block (שמגר 16, ירמיהו, פארן, המרפא in Jerusalem) — **only the first can ever
  hold the geo point**; the rest are permanently `duplicate_place_id`, no matter how good
  the address text is. This is a schema/precision ceiling, not an OCR or data-quality
  problem, and no amount of address cleanup moves it.
- It is not rare: Israeli malls and commercial centres routinely host several certified
  businesses, so this scales with the corpus rather than washing out. 6 unrecoverable
  Jerusalem rows came from exactly this, and all 16 Jerusalem `duplicate_place_id` cases
  resolved the same way.
- Fixing it properly means decoupling "the place Google knows" from "the venue we list" —
  a shared `Place`/`Address` entity that many restaurants can reference, with an optional
  unit/floor discriminator — rather than storing `google_place_id` uniquely on
  `Restaurant`. Deferred past the POC; note it before the next city's ingestion, because
  retrofitting it after more corpora land will be worse.

## Layout bugs are invisible to the test suite (Aug 2026)

- The home list rendered every card vertically compressed with the **verdict pill clipped
  out of view entirely**, while all 68 `web/` tests passed. jsdom does not perform layout,
  so assertions that the pill "renders" pass against a pill no human can see.
- Cause: `.shell__scroll` is a scrolling flex column, and flex items default to
  `flex-shrink: 1` — content taller than the viewport compresses the children instead of
  scrolling. `.card { overflow: hidden }` then clips them. Fixed with
  `.shell__scroll > * { flex-shrink: 0 }`.
- Takeaway: for this app the test suite proves structure and logic only. Anything about
  *visibility* needs a human or a real browser. Worth remembering that the bug was found
  by one glance at a screenshot after the suite had been green for hours.

## Python coding standards (Aug 2026)

- `STANDARDS.md` is now the mandatory Python style contract (500-line file cap,
  no plain strings — everything in `consts.py`, no inline comments, full type
  annotations + docstrings on every function, blank line before `return`,
  unittest, Pydantic field validators, ruff). CLAUDE.md's Conventions section
  points at it. **Python only** — `admin/` (TS/React) is not governed by it.
- **The unittest rule contradicts the existing suite:** all 9 files under
  `tests/` are pytest-style (bare `test_*` functions, fixtures, `conftest.py`);
  zero `import unittest`. Nothing has been migrated. Decide whether to convert
  them, grandfather them, or relax the rule — until then the standard and the
  repo disagree.
- The old CLAUDE.md line "type hints everywhere, pytest" was removed so
  STANDARDS.md is the single source; the pytest→unittest conflict above is the
  live consequence.
- Two other rules are aspirational against current code: consts extraction and
  the 500-line cap have not been audited across `app/`.

## Certificate photo flow (Aug 2026)

- **Photo review is the only door for attributes/expiry** (source level 2, PRD §13):
  upload → PENDING_REVIEW (changes nothing) → moderator `POST /photos/{id}/review`.
  Only `accept` writes facts; the schema refuses attributes/valid_until on `reject`
  at validation time. Attributes are tri-state and **StrictBool** — pydantic must not
  coerce "yes"/1 into a kashrut fact. **Explicit `null` on accept CLEARS a key back
  to unknown** (doubt → UNKNOWN: the new certificate no longer rules on it), audited
  in before/after; an absent key stays untouched.
- **Photo-verified source = `MODERATOR_VERIFIED`** (a moderator verified the physical
  certificate from photo evidence). Applied only when strictly higher per
  SOURCE_AUTHORITY — a cert sourced `certifier_portal` keeps its provenance; the
  facts still land. Review-accept never touches `state`: restore stays exclusive to
  `verify-renewal`, which now 409s unless `evidence_photo_key` names an ACCEPTED
  photo of that same certificate.
- Upload validation: declared Content-Type must be jpeg/png/webp/pdf AND match magic
  bytes (400 on mismatch — headers are untrusted), ≤15 MB — rejected on the
  Content-Length header first, post-read check covers chunked (413) — and
  per-certificate sha256 dedupe (409; the DB unique constraint backstops the race,
  and its IntegrityError is surfaced as the same 409, not a 500).
- **Orphan-sweep is accepted ops debt:** a failed request after `storage.put` cleans
  up its object best-effort, but a commit failure after the handler returns, or a
  future restaurant/certificate cascade delete, can still strand objects under
  `cert-evidence/`. A periodic sweep (keys without a DB row) is the eventual fix.
- Storage: `app/storage/` — `MediaStorage` protocol, S3 impl (boto3, lazy import),
  in-memory fake for tests. Injected via `app.api.deps.get_media_storage`
  (lru_cached singleton; tests override the dependency — no test touches S3).
  Keys `cert-evidence/{certificate_id}/{uuid}.{ext}`; DB stores keys only, viewing
  via presigned GET URLs (15 min) that force Content-Disposition — images inline,
  **PDFs attachment** (blocks PDF-polyglot script execution in the browser viewer).
  S3 client pins region (`KASHROOT_S3_REGION`, default us-east-1), path-style
  addressing and explicit timeouts. MinIO service in docker-compose (ports 9000/9001,
  creds kashroot / kashroot-secret; create the bucket once via the console).
- Migration 0004 = `certificate_evidence_photo` + `evidence_photo_status` enum;
  chain test in test_geocode.py now pins heads at 0004.

## Moderation console (Aug 2026)

- **Auth is TEMPORARY:** HTTP Bearer tokens mapped to actor names via
  `KASHROOT_ADMIN_API_TOKENS='{"<token>":"<actor>"}'` (JSON in env). Constant-time
  comparison; empty config = everything 401s. Replace with real moderator accounts
  before any external exposure. Actor name flows into every AuditLog row.
- **"Degrade to UNKNOWN" maps to `CertificateState.EXPIRED`** — the enum has no
  UNKNOWN member; EXPIRED is what the match engine reads as UNKNOWN (never MATCH).
  See `_DEGRADE_TARGET` in `app/api/admin.py`.
- **The no-raise invariant is enforced twice:** flag outcomes are a closed Literal
  (anything else 422s) and `_STATE_RANK` refuses any non-lowering state transition
  (409). `verify-renewal` is the ONLY restore path, requires genuine evidence
  (min-length note or valid http(s) URL), and never applies to REVOKED certs —
  revocation is the certifier's call, not a moderator's.
- **Concurrency:** moderator actions take row locks (`with_for_update`) plus a
  state re-check before mutating, so a concurrent revocation or double-resolve
  409s instead of overwriting. SQLite (tests) ignores FOR UPDATE; the re-check is
  the portable guard.
- **Expiry windows use Asia/Jerusalem "today"**, not server-local — on a UTC
  server the boundary would otherwise flip at 02:00–03:00 Israel time.
- **Audit ordering** is by a monotonic `seq` column (migration 0003), because
  `func.now()` is the transaction timestamp in Postgres — multi-row actions share
  it and UUID tie-breaks are nondeterministic.
- Frontend (`admin/`): Vite + React 18 + TS strict, no UI kit, no state library.
  Token in sessionStorage (accepted for internal MVP). Dev proxy `/api` →
  localhost:8000. **Nothing serves `admin/dist` yet** — production needs
  same-origin hosting (no CORS middleware exists, deliberately).
- ~~Known gap: `verify-renewal` accepts `evidence_photo_key` but there is no media
  upload endpoint yet.~~ Closed — see "Certificate photo flow" above.

## Geocoding pipeline (Aug 2026)

- `kashroot geocode` — dry-run by default and FREE (uncached entries are reported
  as "would call API", not called). `--apply` needs `KASHROOT_GOOGLE_MAPS_API_KEY`.
  ~517 records fits Google's free monthly tier.
- **Accept bar:** status OK + exactly one candidate + ROOFTOP/RANGE_INTERPOLATED
  + locality matching the expected city. Everything else → `needs_review`, no
  point written. Never overwrites an existing point (guarded UPDATE … WHERE geo
  IS NULL; races counted as `skipped_concurrent`).
- **`CITY_LOCALITY_ALIASES`** (in `app/ingestion/geocode.py`) maps city_slug →
  accepted Hebrew locality spellings (plene/defective, Tel Aviv-Yafo municipal
  forms). Additions go through review — it is the fail-safe boundary for city
  matching. Google returns plene spellings (פתח תקווה); the corpus often has
  defective (פתח תקוה).
- Raw responses cached in `geocode_cache` (migration 0002) keyed by normalized
  query — re-runs never re-bill. Cache commits are per-row savepoints so
  concurrent runs can't discard each other's paid responses.
- **API key can never appear in logs/tracebacks/DB** — httpx errors are caught
  and sanitized inside `GoogleGeocoder`; tests assert the key is absent from
  messages. Keep it that way when touching transport code.
- Two branches sharing one published address resolve to one Google place: first
  gets the point, second flags `duplicate_place_id` for moderator dedupe.

## Match engine (Aug 2026)

- `app/match/` is pure: no DB, no settings, no clock (`now` is an explicit
  keyword-only param). Importing `app.match` must never build the DB engine —
  `app/db/__init__.py` deliberately does not import `session`. There are tests
  asserting purity; don't "fix" the lazy import.
- Layer 1 verdict precedence across certificates: MATCH > UNKNOWN > NO_MATCH
  (one unresolved cert means insufficient data for a definitive NO_MATCH).
- **The staleness clock always runs from `verified_at`** — an unexpired
  `valid_until` does NOT exempt freshness (a validity window doesn't prove we'd
  notice a revocation). This was a review catch; there's a test pinning it.
- Unrecognized/future `CertificateState` members → UNKNOWN, never MATCH
  (fail-safe default in `_state_reasons`).
- Whitelist `min_level=REGULAR` means "any certificate from this certifier" —
  required for level-unknown seed data and "Any certification" presets (PRD §20
  cold start). A minimum above base is strict.
- Naive datetimes are interpreted as UTC (documented on
  `CertificateInput.verified_at`). Keep DB writes tz-aware or UTC-naive.
- Layer 2 default weights (PRD gives components, not numbers): distance 0.35
  (exp decay, half-distance 1.5 km), open-now 0.25, price 0.15, amenities 0.15,
  diet 0.10. Contexts may pass custom weights; missing soft data scores 0.5.

## Public search API (Aug 2026)

- **Known future limitation:** `MAX_QUERY_ROWS = 1000` (`app/api/consts.py`) caps rows
  pulled from the DB for `/v1/search` *before* the amenities filter and Layer 1/Layer 2
  evaluation run in Python — a search that matches more than 1000 rows pre-amenities
  would silently truncate. Not a problem at the current ~517-record corpus; revisit
  (push amenities into SQL, or paginate the DB query itself) once corpus size or filter
  selectivity make it reachable. Not implemented — flagging only.

## Corpus / launch-gate risks (not code)

- **Tel Aviv, Haifa, Beer Sheva have no source documents** — 3 of 5 launch
  cities. The 80%-coverage gate is not currently measurable anyway: no coverage
  denominator (actively-certified count per city) is defined anywhere. Both are
  acquisition/ops problems, the biggest schedule risk in the project.
- Seed corpus is status+certifier only: no attributes, no expiry dates. The
  machmir persona (the PRD's trust bar) is unservable until certificate-photo
  verification exists. ≥70% attribute coverage is a 6-month metric.
- 56 corpus rows are `needs_review` (mostly Eda Haredit north poster OCR noise) —
  now serviceable via the moderation console.
- Ops assumptions in the PRD: ~2 FTE moderators + certificate-runner network;
  SLAs: flags <48h, expiring certs surfaced 14 days early, owner uploads <72h.

## Environment / tooling

- Tests run under SQLite via PG→SQLite shims in `tests/conftest.py` (JSONB/UUID/
  Geography compile shims, StaticPool for TestClient threads). Consequence:
  FOR UPDATE, PG transaction timestamps, and real PostGIS behavior are NOT
  exercised — an integration pass against real Postgres is still an open item.
- mypy and ruff are not installed in `.venv` (ruff conventions followed by hand,
  100-char lines). CI does not exist yet.
- `graphify-out/` is a knowledge graph of the repo (query with `/graphify query`).
  Rebuild with `/graphify . --update` after significant changes; it is untracked.
- Windows dev box: git warns LF→CRLF on new files; harmless.

## Open decisions (need the user / product owner)

- **User-facing auth model** (PRD §21.4): local-first profile vs accounts —
  blocks the public API layer design.
- Real moderator accounts + RBAC to replace bearer-token auth.
- Coverage denominator definition per launch city (what is "100%"?).
- Owner-portal upload path for certificate photos (the moderator upload/review flow
  exists; owner submissions need their own auth + actor labeling).
- Pesach mode in MVP or fast-follow (PRD §21.3).
