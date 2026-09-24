# Seed Data

## `seed/kashroot_seed_corpus.csv`
457 records across 8 source documents, following the Tishrei 5787 refresh described
below (previously 375 records / 7 documents; 142 Landa records had been dropped by the
Elul 5786 refresh — see that section). The corpus now includes rows added directly from
the supplied Tishrei 5787 CSV rather than exclusively through `scripts/build_seed.py`,
so the script is currently **not guaranteed to reproduce this file** — see the Tishrei
5787 section before re-running it. Encoding: UTF-8 with BOM.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew, as published) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" NOT yet split — split into separate rows at ingestion |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | As published (מסעדה, קייטרינג, מאפייה, חנות מזון…) |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — **inferred** from business type, blank if indeterminable |
| `certifier_ids` | `;`-separated. 23 known slugs as of the Tishrei 5787 refresh — see `CERTIFIER_SEED` in `app/ingestion/seed_import.py` for the full, current list |
| `corroboration_count` | # of distinct source documents listing this business (36 have 2, 6 have 3) |
| `source_documents` / `source_date` | Provenance; dates are Hebrew-calendar list dates. Freshest document first — the importer dates the certificate from it. Each document's own date lives in `SOURCE_DOCUMENT_SEED`, never inferred from whichever row cites it first |
| `record_state` | `LIST_VERIFIED` (clean row from official list, 393 rows) or `UNKNOWN_PENDING_VERIFICATION` (64 rows) |
| `needs_review` | TRUE where poster layout (or, for the Tishrei 5787 rows, an unresolved certifier attribution) made city/phone/address/certifier assignment ambiguous (64 rows) |
| `dedupe_hash_sha256` | Present in the Tishrei 5787 corpus; not read by the importer (dedupe keys are derived at import time by `restaurant_dedupe_key`, not from this column) |

### Sources (`sources/`)
| File | Certifier | Quality |
|---|---|---|
| `rabbanut_bb_kitchens.pdf` | Landa (Bnei Brak) — published as the rabbanut kitchens list | Clean table |
| `rubin_restaurants.pdf` | Badatz Mehadrin (Rubin) | Good table; original OCR had ð→נ artifacts, fixed |
| `eda_haredit_jerusalem_poster.jpg` (+`_2`, duplicate) | Badatz Eda Haredit | Poster; phone alignment imperfect → meat section flagged |
| `eda_haredit_south_poster.jpg` | Badatz Eda Haredit | Poster, readable |
| `eda_haredit_north.pdf` | Badatz Eda Haredit | Poster layout, heavy OCR noise → most needs_review rows |
| `landa_vacation_cities_poster.jpg` | Landa (Bnei Brak) | Poster, readable |
| `landa_restaurants_elul_5786.csv` | Landa (Bnei Brak) | Clean table, supplied as CSV |
| `misadot_mehadrin_restaurants.csv` | ~20 certifiers (consolidated directory, no single certifier) | **File missing** — see Tishrei 5787 section below |

### Certifier merges
- **`rabbanut_bnei_brak` → `landa_bnei_brak`** (Aug 2026, product decision). The Bnei Brak
  rabbanut and Badatz Rav Landa are treated as one certification. 122 records were
  reassigned; 9 of them had carried both slugs and now carry one. No records were dropped
  (517 before and after) and both source documents survive, so `source_documents`,
  `corroboration_count` (which counts documents, not certifiers) and every date are
  unchanged — only the certifier attribution moved. The corpus now contains **no Rabbanut
  certifier of either type**; anything keyed on `rabbanut_local` / `rabbanut_national`
  matches nothing until national Rabbanut data lands.

### Landa restaurants refresh (Elul 5786) — authoritative

`landa_restaurants_elul_5786.csv` is treated as the **complete current record for
`landa_bnei_brak`**, not one category slice of it (product decision, Aug 2026, explicit
instruction). Landa went from **183 corpus records to the 41 the list names**; the whole
corpus went from 517 to 375.

The 142 dropped records were not restaurants only. They included 45 catering businesses,
30 bakeries/patisseries, 20 pizzerias, 12 fruit-design businesses, 9 event halls, 11
yeshiva/institution and old-age-home kitchens, and 2 hotels.

**This is a deliberate departure from the fail-safe rule**, which degrades an unconfirmed
record to UNKNOWN rather than removing it, so a moderator can still see what the earlier
list said. Two mitigations:

- The source transcriptions in `scripts/build_seed.py` are left intact, so the drop is
  reversible in the repo: remove the entry from `AUTHORITATIVE_SOURCES` and rebuild.
- `scripts/apply_landa_elul_refresh.py` writes a full before-snapshot to `audit_log` for
  every row it removes from the database, which is the only remaining in-database record
  that the business was ever Landa-certified.

**Risk, stated plainly:** the source carries no publication date, and its own categories
cover restaurants only (`מסעדה חלבית` / `מסעדות ומזנונים` / `מעדניות`). If it is in fact a
category slice rather than the whole list, the corpus has dropped businesses that Landa
still certifies. `Elul 5786 (Aug-Sep 2026)` records when the file was *received*
(2026-08-29), not when Landa published it.

One rename came with the refresh: **`שאבעס ביג - מחלקת אוכל מוכן` → `... פתוח`**, same
address and phone. `RENAMED` in `scripts/build_seed.py` keys both rows onto one corpus
record so the rename does not fork the corpus; the reconciliation script applies the same
rename to an already-populated database, which the importer cannot do (`dedupe_key` is
derived from the name, so a rename reaches it as a business it has never seen and orphans
the record it already holds).

### Applying the refresh to a populated database

Order matters — renames must land before deletions, or a renamed record reads as absent
and is deleted:

```
python -m scripts.apply_landa_elul_refresh          # dry run, rolled back
python -m scripts.apply_landa_elul_refresh --apply
kashroot seed-import --apply
```

Deleting a restaurant cascades to its certificates, photos, hours, flags, owner claims
and **saved-list entries** — users lose those saved restaurants.

The script **refuses to delete a demo-seeded certificate** unless `--drop-demo-seed` is
passed. Eight of the ~18 certificates in `scripts/seed_demo_attributes.py` sit on Landa
records the refresh drops (`הרימון`, `אולמי דונולו`, `אולמי השמחות`, `אירוע מושלם`,
`אריסטוקרט`, `גולד`, `סושי טיים`, `גני הדקל`), so applying the override breaks the
verdicts `DEMO_RUNSHEET.md` walks through. Re-point the demo slice at surviving
certificates first if the demo still matters.

### Tishrei 5787 refresh — 82 rows added, 20 new certifiers, one open gap

The Tishrei 5787 corpus (2026-09, supplied directly as the new
`seed/kashroot_seed_corpus.csv`, 457 rows) adds 145 rows sourced from a new document,
`misadot_mehadrin_restaurants_csv` ("Misadot Mehadrin"), on top of the prior 375-row
corpus (one prior row also gained this document as a second citation, so net +82 rows
after dedupe/branch-splitting effects — see `git log` on this file for the exact prior
state).

**This document is unlike every other source in this repo: it is a consolidated
directory spanning ~20 different certifiers** (13 local Rabbanut councils, several named
private rabbis, and one additional badatz), not one certifier's own published list. It
is modeled in `SOURCE_DOCUMENT_SEED` with `certifier_slug: None` rather than attributed
to any single certifier it was never published by.

20 certifiers were added to `CERTIFIER_SEED` to cover this document's `certifier_ids`
values. **Every name/type for these 20 is derived from the slug and general place-name
knowledge, not published by any list in this repo** — no source here states a local
rabbinate's official name, a private rabbi's honorific spelling, or which organizational
type some of them are. Flagged for human review, particularly:
- `beit_yosef` — could plausibly be a local-rabbinate-administered standard or a private
  body; modeled as `PRIVATE`, unconfirmed.
- `kehilot_unidentified` — a placeholder for 4 rows whose community-level hechsher
  the source itself could not name. Never guess a real certifier onto it.
- `rav_landa_variant_unverified` — 4 rows carrying a Landa-like label the source could
  not confirm is `landa_bnei_brak`. Deliberately modeled as a separate, unmerged
  certifier so an unverified badge never inherits Landa's standing.
- All 3 above, plus every Tishrei 5787 row whose certifier is genuinely uncertain,
  already carry `record_state=UNKNOWN_PENDING_VERIFICATION` and `needs_review=TRUE` in
  the corpus — the fail-safe rule is doing its job on these rows already.

**Known gap — missing raw evidence file.** No file for `misadot_mehadrin_restaurants_csv`
exists under `data/sources/` — the 145 citing rows have no corresponding source document
checked into this repo. `data/sources/` is immutable raw evidence, and its absence is not
something to paper over: `tests/test_seed_corpus_contract.py::test_source_documents_point_at_files_that_exist`
fails on this and should keep failing until the actual source file is supplied and added
under `data/sources/misadot_mehadrin_restaurants.csv`.

### Known gaps — important
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates** — none exist in these sources. These lists establish *status + certifier* only (source-hierarchy level 1 per PRD §13). Certificate photos / field verification required for attributes.
- List dates are snapshots with no validity window → a per-certifier freshness/staleness rule is needed (configured: stale after 365 days without re-scrape, see `KASHROOT_DEFAULT_FRESHNESS_DAYS`).
- Records with `needs_review=TRUE` must be manually verified before serving.
- No geocoding yet — `geo point` population via Google Places is the next pipeline step.
- **Missing raw source file**: `data/sources/misadot_mehadrin_restaurants.csv` does not exist — see the Tishrei 5787 section above.
- **20 certifier names/types are unverified guesses** derived from slug + general knowledge, not from any published source in this repo — see the Tishrei 5787 section above for the full list and reasoning.
