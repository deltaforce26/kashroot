# Seed Data

## `seed/kashroot_seed_corpus.csv`
517 unique records, deduplicated from 570 raw rows across 7 certifier source documents. Built by `scripts/build_seed.py` (data is embedded in the script as transcribed from sources; re-run to regenerate — it writes this file in place). Encoding: UTF-8 with BOM.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew, as published) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" NOT yet split — split into separate rows at ingestion |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | As published (מסעדה, קייטרינג, מאפייה, חנות מזון…) |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — **inferred** from business type, blank if indeterminable |
| `certifier_ids` | `;`-separated: `badatz_mehadrin_rubin`, `badatz_eda_haredit`, `landa_bnei_brak` |
| `corroboration_count` | # of distinct source documents listing this business (38 have 2, 6 have 3) |
| `source_documents` / `source_date` | Provenance; dates are Hebrew-calendar list dates (Tamuz/Av/Elul 5786 = summer 2026). Freshest document first — the importer dates the certificate from it. Each document's own date lives in `SOURCE_DOCUMENT_SEED`, never inferred from whichever row cites it first |
| `record_state` | `LIST_VERIFIED` (clean row from official list) or `UNKNOWN_PENDING_VERIFICATION` (56 rows) |
| `needs_review` | TRUE where poster layout made city/phone/address assignment ambiguous (mostly the Eda Haredit north poster) |

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

### Certifier merges
- **`rabbanut_bnei_brak` → `landa_bnei_brak`** (Aug 2026, product decision). The Bnei Brak
  rabbanut and Badatz Rav Landa are treated as one certification. 122 records were
  reassigned; 9 of them had carried both slugs and now carry one. No records were dropped
  (517 before and after) and both source documents survive, so `source_documents`,
  `corroboration_count` (which counts documents, not certifiers) and every date are
  unchanged — only the certifier attribution moved. The corpus now contains **no Rabbanut
  certifier of either type**; anything keyed on `rabbanut_local` / `rabbanut_national`
  matches nothing until national Rabbanut data lands.

### Landa restaurants refresh (Elul 5786)
`landa_restaurants_elul_5786.csv` is a newer Landa list covering **restaurant categories only**
(`מסעדה חלבית` / `מסעדות ומזנונים` / `מעדניות`, plus catering lines that carry one of them).
It supersedes the restaurant rows of `rabbanut_bb_kitchens_pdf` and
`landa_vacation_cities_poster`; halls, hotels, institutions, old-age homes, pure catering
and fruit-design businesses are outside its scope and keep their earlier provenance
untouched. 41 of its 42 corresponding corpus records matched field-for-field, so the
refresh mostly adds corroboration and a newer list date. Two records moved:

- **`שאבעס ביג - מחלקת אוכל מוכן` → `שאבעס ביג - מחלקת אוכל מוכן פתוח`** — republished under a
  changed name at the same address and phone. `RENAMED` in `scripts/build_seed.py` keys both
  rows onto one record so the rename does not fork the corpus; `scripts/apply_landa_elul_refresh.py`
  applies the same rename to an already-populated database, which the importer cannot do
  (`dedupe_key` is derived from the name, so a rename reaches it as a business it has never
  seen and orphans the record it already holds).
- **`מאמה מיה בטיילת` (Tiberias)** — on the Av poster, absent from the Elul list. Nothing
  establishes that it lapsed and nothing establishes that it holds, so per the fail-safe rule
  it degrades to `needs_review=TRUE` / `UNKNOWN_PENDING_VERIFICATION` (a PENDING certificate,
  which can never serve a MATCH) rather than being deleted, which would lose the provenance.
  It may be the same business as `מאמה מיה` at the same address — **needs moderator verification**.

**Date caveat:** the source carries no publication date. `Elul 5786 (Aug-Sep 2026)` records when
it was *received* (2026-08-29), not when Landa published it. If it turns out to be an older list,
the freshness maths currently overstates these 41 records by up to that gap.

### Known gaps — important
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates** — none exist in these sources. These lists establish *status + certifier* only (source-hierarchy level 1 per PRD §13). Certificate photos / field verification required for attributes.
- List dates are snapshots with no validity window → a per-certifier freshness/staleness rule is needed (configured: stale after 365 days without re-scrape, see `KASHROOT_DEFAULT_FRESHNESS_DAYS`).
- Records with `needs_review=TRUE` must be manually verified before serving.
- No geocoding yet — `geo point` population via Google Places is the next pipeline step.
