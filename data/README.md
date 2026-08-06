# Seed Data

## `seed/kashroot_seed_corpus.csv`
517 unique records, deduplicated from 529 raw rows across 6 certifier source documents. Built by `scripts/build_seed.py` (data is embedded in the script as transcribed from sources; re-run to regenerate). Encoding: UTF-8 with BOM.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew, as published) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" NOT yet split — split into separate rows at ingestion |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | As published (מסעדה, קייטרינג, מאפייה, חנות מזון…) |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — **inferred** from business type, blank if indeterminable |
| `certifier_ids` | `;`-separated: `rabbanut_bnei_brak`, `badatz_mehadrin_rubin`, `badatz_eda_haredit`, `landa_bnei_brak` |
| `corroboration_count` | # of distinct source documents listing this business (9 records have 2) |
| `source_documents` / `source_date` | Provenance; dates are Hebrew-calendar list dates (Tamuz/Av 5786 = summer 2026) |
| `record_state` | `LIST_VERIFIED` (clean row from official list) or `UNKNOWN_PENDING_VERIFICATION` (56 rows) |
| `needs_review` | TRUE where poster layout made city/phone/address assignment ambiguous (mostly the Eda Haredit north poster) |

### Sources (`sources/`)
| File | Certifier | Quality |
|---|---|---|
| `rabbanut_bb_kitchens.pdf` | Rabbanut Bnei Brak (רבני העיר) | Clean table |
| `rubin_restaurants.pdf` | Badatz Mehadrin (Rubin) | Good table; original OCR had ð→נ artifacts, fixed |
| `eda_haredit_jerusalem_poster.jpg` (+`_2`, duplicate) | Badatz Eda Haredit | Poster; phone alignment imperfect → meat section flagged |
| `eda_haredit_south_poster.jpg` | Badatz Eda Haredit | Poster, readable |
| `eda_haredit_north.pdf` | Badatz Eda Haredit | Poster layout, heavy OCR noise → most needs_review rows |
| `landa_vacation_cities_poster.jpg` | Landa (Bnei Brak) | Poster, readable |

### Known gaps — important
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates** — none exist in these sources. These lists establish *status + certifier* only (source-hierarchy level 1 per PRD §13). Certificate photos / field verification required for attributes.
- List dates are snapshots with no validity window → a per-certifier freshness/staleness rule is needed (suggested: stale after 90 days without re-scrape).
- Records with `needs_review=TRUE` must be manually verified before serving.
- No geocoding yet — `geo point` population via Google Places is the next pipeline step.
