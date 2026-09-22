# Seed Data

## `seed/kashroot_seed_corpus.csv`
521 unique records (518 from `scripts/build_seed.py`'s deterministic output + 3 hand-kept
exceptions — see "Three Landa records" below), deduplicated across 8 source documents
(142 Landa records were dropped by the Elul 5786 refresh — see below). Built by
`scripts/build_seed.py` (data for sources 1-7 is embedded in the script as transcribed
from sources; source 8 is parsed from `sources/misadot_mehadrin_restaurants.csv` at build
time, since it names its own certifier per row rather than one certifier per document; the
script writes this file in place). Encoding: UTF-8 with BOM.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew, as published) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" NOT yet split — split into separate rows at ingestion |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | As published (מסעדה, קייטרינג, מאפייה, חנות מזון…) |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — **inferred** from business type, blank if indeterminable |
| `certifier_ids` | `;`-separated certifier slugs (see the certifier tables below); a row can carry more than one, e.g. `beit_yosef;rabbanut_jerusalem` |
| `corroboration_count` | # of distinct source documents listing this business (35 have 2, 7 have 3) |
| `source_documents` / `source_date` | Provenance; dates are Hebrew-calendar list dates (Tamuz/Av/Elul 5786 = summer 2026). Freshest document first — the importer dates the certificate from it. Each document's own date lives in `SOURCE_DOCUMENT_SEED`, never inferred from whichever row cites it first |
| `record_state` | `LIST_VERIFIED` (clean row from official list) or `UNKNOWN_PENDING_VERIFICATION` (70 rows) |
| `needs_review` | TRUE where poster layout made city/phone/address assignment ambiguous (mostly the Eda Haredit north poster) |
| `dedupe_hash_sha256` | `sha256(f"{restaurant_name_he}|{address_he}|{city_he}")` hex digest — exact-match duplicate detection on the published Hebrew fields. Not a substitute for `record_key()`'s fuzzy merge key in `build_seed.py`, which already tolerates naming/punctuation variants at build time; this hash only catches byte-identical repeats post-build. |

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
| `misadot_mehadrin_restaurants.csv` | ~26 certifiers, one per row (see below) | Clean CSV scrape of misadotmehadrin.co.il, 145 restaurants; no publication date on the site — the label records receipt (2026-09-22) |

### New certifiers added with the misadot_mehadrin_restaurants.csv source (Sep 2026)

This source's `certificate` column named 28 distinct Hebrew values across ~26 organizations. Reused existing corpus certifiers where the value was unambiguously the same body (`הרב רובין` → `badatz_mehadrin_rubin`, `העדה החרדית` → `badatz_eda_haredit`, `מהדרין בני ברק` → `landa_bnei_brak`, per the documented rabbanut_bnei_brak merge). Everything else got a new slug in `CERTIFIER_SEED`:

| Slug | Hebrew name | Type |
|---|---|---|
| `beit_yosef` | בית יוסף | private |
| `rav_machpud` | הרב מחפוד | private |
| `chatam_sofer_petah_tikva` | חתם סופר פתח תקווה | private |
| `badatz_hadar_hakashrut_barda` | בד"ץ הדר הכשרות של הרב יצחק ברדא | badatz |
| `rav_refael_manat` | הרב רפאל מנת | private |
| `rabbanut_beer_yaakov`, `rabbanut_hatzor_haglilit`, `rabbanut_ashdod`, `rabbanut_gedera`, `rabbanut_jerusalem`, `rabbanut_kiryat_ata`, `rabbanut_ramat_gan`, `rabbanut_zichron_yaakov`, `rabbanut_petah_tikva`, `rabbanut_maale_adumim`, `rabbanut_sderot`, `rabbanut_afula`, `rabbanut_chevel_yavne` | Local rabbanut "mehadrin" tracks, one per city/council. `מהדרין <city>` and `רבנות מהדרין <city>` on the site are the same body (it just abbreviates) and share one slug per city. | rabbanut_local |

One row (`קפה גן סיפור`, ירושלים) names `בית יוסף ומהדרין ירושלים` — two certifiers on
one row — and carries both `beit_yosef` and `rabbanut_jerusalem` in `certifier_ids`.

**Two certificate values could not be confidently attributed and are open product
decisions — see `docs/data-review-todo.md` item 2:**
- `הרב לנדא` / `הרב לנדאו` (spelling variants of each other) — seeded as
  `rav_landa_variant_unverified`, deliberately **not** merged into `landa_bnei_brak`: this
  source's footprint for it may differ from the Bnei-Brak-scoped Badatz Rav Landa entity
  already in the corpus, and conflating them would let a MATCH leak across certifiers.
  One exception: `מסובין` / בית שמש (יגאל אלון 2) is mapped straight to `landa_bnei_brak`
  via `CERT_FIELD_OVERRIDE_8` in `scripts/build_seed.py`, not this unresolved slug — its
  phone number and street exactly match the `landa_bnei_brak`-certified record already in
  the corpus from `rabbanut_bb_kitchens_pdf`/`landa_restaurants_elul_5786`, so it's the
  same business under a confirmed certifier, not a new sighting of the open question. The
  other 3 `rav_landa_variant_unverified` rows stay unresolved.
- `קהילות` ("Kehilot") — no context in the source to identify the organization. Seeded as
  `kehilot_unidentified`.

Both slugs are distinct, newly created certifiers of their own, and every row that carries
either one is forced to `needs_review=TRUE` / `UNKNOWN_PENDING_VERIFICATION` so neither can
serve a MATCH before a human resolves who they are.

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

**Sep 2026 update:** adding the misadot_mehadrin_restaurants_csv source surfaced the same
tension from the other direction. One of its rows (`קפה גרג`, מצדה 5, בני ברק,
`מהדרין בני ברק` → `landa_bnei_brak`) is evidenced only by a source *newer* than the Elul
list, which the Elul list therefore never had a chance to confirm or deny — its silence
isn't disconfirmation. `build_seed.py` no longer lets `AUTHORITATIVE_SOURCES` silently drop
a record in that situation; it flags it `needs_review=TRUE` instead (see the
`new_evidence_conflicts` check in the script and `docs/data-review-todo.md` item 2). This
does not change how the original 7 sources merge with each other.

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

### Known gaps — important
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates** — none exist in these sources. These lists establish *status + certifier* only (source-hierarchy level 1 per PRD §13). Certificate photos / field verification required for attributes.
- List dates are snapshots with no validity window → a per-certifier freshness/staleness rule is needed (configured: stale after 365 days without re-scrape, see `KASHROOT_DEFAULT_FRESHNESS_DAYS`).
- Records with `needs_review=TRUE` must be manually verified before serving.
- No geocoding yet — `geo point` population via Google Places is the next pipeline step.
