# Kashroot POC — Thursday 20 Aug 2026

**Decisions taken (17 Aug):** POC client = **React PWA** (not Expo — zero RN code exists,
and starting it now would consume the whole window). Data = **geocode the full corpus**,
all 517 records.

**Time budget:** Mon 17 (afternoon) · Tue 18 · Wed 19 = 3 build days. Thu 20 = demo.

**Critical path:** Postgres up + data loaded → public API → PWA → rehearsal.
Everything else is parallel or cuttable.

---

## ⚠ RESUME HERE — handoff, Mon 17 Aug late

**The one thing to know:** the PWA is now talking to the live API for the first time, and
that pass is **incomplete and currently failing**. Everything else is green.

### ✅ Since resolved — integration is COMPLETE and green (94 tests, 15 live vs the backend)

All four defects fixed. Profile now versioned (`kashroot.profile.v2`, old key actively
deleted, so a poisoned laptop self-heals on load). `ErrorState` no longer accepts a message
prop at all, so raw server text cannot regress into the UI by omission. Map + geolocation
built. Fixtures aligned to the 365-day window — נוגטין reads MATCH in mock and live alike.

**Two corrections to earlier instructions in this file:** `GET /v1/certifiers` returns no
`slug` (it returns `{id, name_he, name_en, type, levels}`), so presets resolve by `type`.
And the presets were never baked with IDs — the 422 came solely from the stale persisted
profile.

### 🔴 DECISION NEEDED — the "Local Rabbanut" preset is unusable in Jerusalem

Measured on live Jerusalem data (12 km):

| Preset | Certifiers | match / unknown / no_match |
|---|---|---|
| Any certification | 4 | 83 / 16 / 1 |
| **Local Rabbanut** | **1** | **2 / 0 / 98** |
| Rabbanut Mehadrin + Badatzim | 4 | 81 / 18 / 1 |
| Selected Badatzim | 3 | 81 / 16 / 3 |

The verdicts are *correct* — Rabbanut Bnei Brak genuinely doesn't certify Jerusalem — but a
user tapping "Local Rabbanut" sees a screen of red and reads it as **"Jerusalem is not
kosher"**, when the truth is "we hold no Jerusalem Rabbanut data". This is the single most
damaging thing that can happen in the demo, and it is one tap from the opening screen.
Options: hide the preset until national Rabbanut data exists, or rename it to what it
actually is (`רבנות בני ברק`). Product call — not changed.

Related: **`level` is `"unknown"` on every certificate in the corpus**, so any profile
requiring `min_level: mehadrin` returns UNKNOWN across the board (99 UNKNOWN / 1 NO_MATCH
measured). The presets avoid this today by not setting a minimum — don't add one.

### Open work, in priority order

1. **Four defects from the live integration** (frontend agent was mid-fix when the session
   ended — verify each, they may be partly done):
   - **Certifier IDs.** The client sends mock slugs (`"cert-rubin"`); the API requires the
     real UUIDs. `POST /v1/search` 422s. The whitelist must be built from
     `GET /v1/certifiers`, resolving presets by **`slug`**, never by display name (`בד"ץ`
     vs `בד״ץ` quoting variants won't match). Live IDs:
     `1715df45-8b3a-466e-914f-bcdb407ab02e` badatz_eda_haredit ·
     `f90792c5-0a17-4e01-99de-ff64030c9d74` badatz_mehadrin_rubin ·
     `123739a9-cdfb-4a79-986f-ce9b23be07f4` landa_bnei_brak ·
     `f40bcf02-376d-4a05-906c-fd1e748906a3` rabbanut_bnei_brak
   - **No schema version on the persisted profile.** A profile with bad IDs is already in
     localStorage and will keep failing after the code is fixed. **The demo laptop is
     probably in this state.** Needs a version guard that discards an unresolvable profile
     and silently re-runs onboarding.
   - **Raw Pydantic errors rendered to the user.** A wall of English validation output is
     being shown inside the Hebrew UI. Technical detail → `console.error`; the screen gets
     the human sentence. Fix on every error path, not just search.
   - **`0 מסעדות נבדקו עבורך` shown on a failed request** — asserts we checked and found
     nothing when we checked nothing. An error must never render as a finding.
2. **Finish the integration pass** and enumerate every live-vs-mock divergence (enum
   spellings, nullability, date formats). The certifier-ID mismatch was the first of these;
   assume there are more.
3. **Real map + geolocation** (queued, not started). Decided: **Google Maps JS API**, and
   **geolocation with silent city fallback**. Needs a *separate* browser key from the user
   — referrer-restricted, Maps JavaScript API only — in `web/.env.local` as
   `VITE_GOOGLE_MAPS_BROWSER_KEY`. **Never put the repo-root `.env` Geocoding key in the
   client bundle.** Must degrade to the striped placeholder when the key is absent or
   offline.
4. **Then D2–D5**: verifier pass, reviewer pass, one-command startup, and rehearse the demo
   end to end twice.

### Waiting on the user

- Create the Maps browser key (above).
- Visual pass on `/search`, `/saved`, `/r/r-nougatine`. **Two real bugs so far were found by
  looking at screenshots, and both were invisible to a green test suite** — jsdom does no
  layout, so a clipped verdict pill still passes every assertion.
- Sign-off on the 20 Jerusalem rows whose `needs_review` was cleared for geocoding, with a
  `Flag(WRONG_DETAILS)` opened per row to preserve the phone-verification need.

### How to run it

```
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose up -d   # docker NOT on PATH
python -m uvicorn app.main:app --port 8000                                # loads repo .env
cd web && npm run build && npx vite preview --port 4173
```

---

## STATUS — end of Mon 17 Aug

**Track A (data): done.** Migrations applied against real PostGIS. Corpus loaded:
531 restaurants / 540 certificates / **4 certifiers** (the "5" in the original plan was
stale — `data/README.md` only ever defined 4; 531 ≠ 517 is deterministic branch-address
splitting, not a double import). Geocoded 298/531 = 56.1%. Demo attribute slice seeded:
18 certificates across all three verdicts, indelibly labelled as demo data.

**Track B (API): done, reviewed, fixed.** `/v1/certifiers`, `POST /v1/search`,
`POST /v1/restaurants/{id}`. 303 tests green. A review caught a locked-decision violation —
search sorted by fit score alone, letting a NO_MATCH outrank a MATCH — now fixed to
gate → fit with regression tests.

**Track C (PWA): done.** All 8 screens, 64 tests green, builds clean. Neutrality of the
copy is now enforced by a test that fails the build on ranking vocabulary.

**All of the above since landed:** Jerusalem coverage lifted 45.7% → **70.7%** (99/140) by
OCR address repair, with **Bayit VeGan at 6/6 = 100%** — the accept bar was not moved. The
three additive API fields shipped (`diet_type`, `deciding_certificate`, free-text `query` —
note `query` is exact `ILIKE` substring only, **not** fuzzy and with no Hebrew plene/defective
normalization). Freshness window changed to 365 days: **540 fresh / 0 stale**, and the
expired-certificate check confirmed safe — 2 certificates are freshness-fresh but past
`valid_until` and still correctly degrade to UNKNOWN. Suite at 321 passing.

**Consequence of the 365-day window worth remembering:** the corpus's oldest verification is
328 days old, so *nothing* is stale. Stale-evidence UNKNOWN no longer occurs naturally —
remaining UNKNOWNs come from expiry, missing attributes, revocation and unpublished levels.

### Decisions taken Mon 17 Aug

- **Freshness window 90 days → 365 days.** Product-owner call: kashrut certificates are
  typically issued annually, so a year is the defensible staleness horizon. Consequence:
  the 160 Badatz Mehadrin (Rubin) certificates (source dated 2025-09-23, 328 days old)
  flip from stale to fresh. The rule itself is unchanged — the clock still runs from
  `verified_at`, an unexpired `valid_until` still does not exempt a certificate, and
  expiry remains separate from staleness.
- **Jerusalem stays the demo city**, with its coverage raised rather than switching to
  Bnei Brak (82.4%).
- **Preset copy relabelled** for halachic neutrality — "Rabbanut Mehadrin and above"
  asserted a cross-certifier ranking that CLAUDE.md forbids.

### Environment gotchas discovered (bite anyone cloning this repo)

- **Postgres is on port 5433**, not 5432 — a native Windows Postgres 16 service owns
  5432 and fails as an auth error, not a port conflict.
- **Norton does local TLS inspection.** Its injected root CA is not trusted by certifi,
  which breaks `uv sync` and Google Geocoding calls. Worked around per-command with a
  combined CA bundle via `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`; the installed certifi was
  deliberately left alone. The test suite consequently runs on the base Python 3.12.9
  interpreter, not `.venv`.
- **Chrome cannot reach localhost on this box** (curl can, external sites load fine) —
  almost certainly the same interception. Visual verification of the PWA must be done by
  a human on the demo machine.

---

## 0. Clear today — these block everything downstream

- [ ] **Google Maps API key** into `.env` as `KASHROOT_GOOGLE_MAPS_API_KEY`. Geocoding
      cannot run without it and Track A stalls at step A3. 517 records is inside the free tier.
- [ ] **Docker up:** `docker compose up -d` (Postgres+PostGIS, Redis, MinIO). Create the
      MinIO bucket once via the console (localhost:9001).
- [ ] **Accept the city-coverage reality** (see §5 Risk 1) and decide what the demo claims
      about Tel Aviv / Beer Sheva. This is a product call, not an engineering one.
- [ ] Confirm demo audience + length — drives how much polish Track C needs.

---

## 1. Track A — Data (Mon PM) · `data-pipeline` agent

The corpus has never been loaded into a real database. This is the highest-risk unknown
in the project: every test to date ran on SQLite shims.

- [ ] **A1.** `alembic upgrade head` against real Postgres. Confirm all four migrations
      (0001→0004) apply cleanly, including PostGIS geography columns and the enums.
      *No test has ever exercised real PostGIS — expect surprises here, not Wednesday.*
- [ ] **A2.** `kashroot seed-import --apply`. Verify 517 rows land: restaurants,
      certifiers (5), certificates. Record actual counts.
- [ ] **A3.** `kashroot geocode` dry-run → review the report → `kashroot geocode --apply`.
      Expect a meaningful `needs_review` tail (accept bar is strict: ROOFTOP/RANGE only,
      single candidate, locality match).
- [ ] **A4.** Triage geocode failures. Add `CITY_LOCALITY_ALIASES` entries for the new
      cities the corpus actually contains — the map currently covers the 5 launch cities,
      but the data spans **59 cities** (Safed, Beit Shemesh, Tiberias, Nof HaGalil…).
      Alias additions are the fail-safe city boundary — review each, don't bulk-add.
- [ ] **A5.** Report **geocoded coverage per city**. The PWA's list/distance/map are only
      as good as this number. If a headline city lands under ~70%, the demo route changes.
- [ ] **A6.** Sanity-check `verified_at` on imported certificates against the 90-day
      freshness window. Corpus source dates are Hebrew-calendar (latest = Tamuz 5786,
      ~Jun–Jul 2026). **If `verified_at` is older than 90 days, every verdict degrades to
      UNKNOWN and the demo shows nothing but grey badges.** Verify before building UI on it.
- [ ] **A7.** Prepare a **moderator-verified demo slice**: run ~15–20 Jerusalem/Bnei Brak
      certificates through the existing photo-review flow (or a seeded fixture) so they
      carry real attributes (glatt, chalav_yisrael…) and expiry dates. Without this, *no
      profile that requires any attribute can ever return MATCH* — the seed corpus is
      certifier+status only. This is what makes the machmir persona demoable.

## 2. Track B — Public API (Mon PM → Tue) · `backend-builder` agent

Nothing consumer-facing exists: `app/main.py` mounts `/health` and the admin router, full
stop. The match engine is a pure function that has never been connected to the database.

- [ ] **B1.** **DB→engine adapter** — the keystone. Map `Certificate` rows →
      `CertificateInput` and a request profile → the engine's profile input. Keep
      `app/match/` pure: the adapter lives outside it. There are tests asserting purity;
      don't break them.
- [ ] **B2.** `GET /v1/certifiers` — list for the whitelist picker (id, name he/en, type).
- [ ] **B3.** `POST /v1/search` — body carries `{profile, center|city, radius_km, filters,
      page}`. Returns per restaurant: Layer 1 verdict + reason codes, Layer 2 fit score,
      distance, geo point. **Profile travels in the request body — no auth, no accounts.**
      That sidesteps the open user-auth decision (PRD §21.4) entirely and matches
      local-first. Say this out loud in the demo; it is a POC shortcut, not the design.
- [ ] **B4.** `POST /v1/restaurants/{id}` — detail + full evidence: certificates,
      certifier, attributes with provenance, verdict reasons, freshness/expiry state.
- [ ] **B5.** Response schemas that keep the two layers **visibly separate** — verdict is
      an enum with reasons, fit is a number. Never one blended score. A reviewer will
      check this specifically; it is a locked decision.
- [ ] **B6.** Spatial query correctness — PostGIS distance ordering + radius filter, with
      an index. First real geography query in the project.
- [ ] **B7.** Wire routers in `create_app()`. **Use the Vite dev proxy** (`/api` →
      :8000) exactly as `admin/` does — do *not* add CORS middleware; its absence is
      deliberate.
- [ ] **B8.** Tests for the adapter + endpoints. Follow `STANDARDS.md`; match the existing
      pytest style in `tests/` (the unittest rule is unresolved — see NOTES.md; do not
      migrate the suite this week).

## 3. Track C — React PWA (Tue → Wed) · new `web/` app

Reuse `admin/`'s proven patterns: API client shape, `usePagedQuery`, vitest setup. Do not
reuse its visual design — this is a consumer surface.

- [ ] **C1.** Scaffold `web/`: Vite + React 18 + TS strict + `vite-plugin-pwa`
      (manifest, icons, service worker, installable, offline app shell). Dev proxy to :8000.
- [ ] **C2.** **RTL + Hebrew first.** `dir="rtl"`, `lang="he"`, Hebrew strings primary,
      English fallback. Retrofitting RTL on Wednesday night is how this slips — do it in
      the scaffold.
- [ ] **C3.** **Profile setup screen** — certifier whitelist (multi-select from B2) +
      required attributes. Persist to `localStorage`. Ship 3 one-tap presets:
      *Any certification* · *Rabbanut* · *Mehadrin/Badatz*. Presets are the demo's opening
      move and cover PRD §20 cold start.
- [ ] **C4.** **Results list** — verdict badge (MATCH green / NO_MATCH red / UNKNOWN grey),
      name, distance, certifier chip. Sorted by fit score. **Kashrut is never shown as a
      percentage.**
- [ ] **C5.** **Restaurant detail** — the money screen. Verdict + plain-language reason
      codes + the evidence: which certificate, which certifier, which attributes, verified
      when, source. "Why am I seeing this answer" must be legible to a non-technical user.
- [ ] **C6.** **Saved list** — `localStorage` only. No API, no accounts.
- [ ] **C7.** Empty/UNKNOWN states written deliberately. Given the data, UNKNOWN will be
      common — it should read as honest ("we don't have verified evidence for this"),
      not broken. This is the product's core value claim; do not treat it as an error state.
- [ ] **C8.** Mobile viewport shaping + install prompt. Demo it installed on a phone
      home screen — that is what makes a PWA read as an app.
- [ ] **C9.** *(Cuttable)* Map view with pins. Cut this first if Wednesday is tight; the
      list view carries the demo.

## 4. Track D — Integration & demo prep (Wed PM → Thu AM)

- [ ] **D1.** Full end-to-end pass against real Postgres — first time in the project.
      Budget real hours here; do not schedule it as a 30-minute formality.
- [ ] **D2.** `verifier` agent: full test suite + `admin/` and `web/` builds green.
- [ ] **D3.** `reviewer` agent: check against CLAUDE.md locked decisions — layer
      separation, fail-safe defaults, no hardcoded kashrut conclusions, provenance intact.
- [ ] **D4.** **Rehearse the demo end to end, twice.** Script it:
      preset profile → search → a MATCH → a NO_MATCH (whitelist excludes that certifier) →
      an UNKNOWN with evidence → save to list → show it installed on a phone.
      All three verdicts must appear on real data — confirm during D1, not on stage.
- [ ] **D5.** One-command startup (compose + API + web) so the demo can be restarted cold
      in under a minute if something wedges.
- [ ] **D6.** Fallback: recorded screen capture of the working flow, in case live fails.
- [ ] **D7.** Update NOTES.md with what the POC proved and what it faked.

---

## 5. Risks — read before committing to Thursday

**Risk 1 — "All 5 cities" is not achievable with current data.** Actual corpus counts:

| Launch city | Records |
|---|---|
| Jerusalem | 135 |
| Bnei Brak | 85 |
| Haifa | 19 |
| **Tel Aviv** | **0** |
| **Beer Sheva** | **0** |

The corpus spans 59 cities, but Tel Aviv and Beer Sheva have **zero** records — no source
documents exist for them (NOTES.md flags this as the project's biggest schedule risk).
Geocoding everything is still right, and it yields a genuinely national-looking map
(Safed 34, Beit Shemesh 29, Tiberias 27…). But the demo cannot show Tel Aviv. Either
demo Jerusalem/Bnei Brak and name the gap honestly, or acquire TA data — which is an
acquisition problem, not a 3-day engineering one.

**Risk 2 — only 5 certifiers, all charedi-leaning.** Eda Haredit, Mehadrin Rubin,
Rabbanut Bnei Brak, Landa. A "Rabbanut" preset covers only Bnei Brak; there is no
national Rabbanut data. Design the demo profiles around what exists.

**Risk 3 — no attributes or expiry in seed data.** Every certificate is certifier+status
only. Any profile requiring an attribute returns UNKNOWN for *everything* until A7 lands.
A7 is not optional polish; it is what makes the verdict engine visible.

**Risk 4 — real Postgres/PostGIS is unproven.** All 9 test files run on SQLite shims
(`tests/conftest.py`). FOR UPDATE, transaction timestamps and real geography behaviour
have never executed. A1 and D1 are where this surfaces.

**Risk 5 — the schedule is genuinely tight.** Three tracks, three days, and the API and
PWA are both from zero. If something must give, cut in this order: C9 map → C8 install
polish → C6 saved lists → A7 demo slice (falls back to an all-UNKNOWN demo, which is a
much weaker story).

---

## 6. Explicitly out of scope for the POC

Expo / React Native · real auth, accounts, RBAC · owner portal · Pesach mode · Shabbat &
chag hours logic · community flags in the client · the unittest migration · CI · deployment
beyond localhost · the 80% coverage launch gate.
