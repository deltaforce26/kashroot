# Seed Data

## `seed/kashroot_seed_corpus.csv`
426 unique records, deduplicated from 570 raw rows across 7 certifier source documents (91 Landa records were dropped by the Elul 5786 refresh — see below). Built by `scripts/build_seed.py` (data is embedded in the script as transcribed from sources; re-run to regenerate — it writes this file in place). Encoding: UTF-8 with BOM.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew, as published) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" NOT yet split — split into separate rows at ingestion |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | As published (מסעדה, קייטרינג, מאפייה, חנות מזון…) |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — **inferred** from business type, blank if indeterminable |
| `certifier_ids` | `;`-separated: `badatz_mehadrin_rubin`, `badatz_eda_haredit`, `landa_bnei_brak` |
| `corroboration_count` | # of distinct source documents listing this business (35 have 2, 6 have 3) |
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

### Landa restaurants refresh (Elul 5786) — authoritative

`landa_restaurants_elul_5786.csv` is treated as the **complete current record for
`landa_bnei_brak` in every category it speaks for** (product decision, Aug 2026, explicit
instruction). Landa went from **183 corpus records to 92**; the whole corpus went from 517
to 426.

**Kept — 92:** the 41 the list names, plus **51 pizzerias and bakeries** it does not speak
for. Those are carried by the vacation-cities poster in cities the Elul list barely covers
(Netivot, Netanya, Kiryat Gat, Hadera…), under that poster's own category vocabulary, so
the two lists cover different ground rather than one superseding the other. The exemption
is `SUPERSEDE_EXEMPT_TOKENS` in `scripts/build_seed.py`, matched as a substring of the
published category — which is why `עיצובי פירות וקינוחים,מאפה ובצקים` survives on its
bakery half.

**Dropped — 91:** 45 catering businesses, 12 fruit-design, 9 event halls, 11
yeshiva/institution and old-age-home kitchens, 4 kugel makers, 2 hotels, 2 nut/produce
shops, and the remaining restaurant-category records the list omits.

**This is a deliberate departure from the fail-safe rule**, which degrades an unconfirmed
record to UNKNOWN rather than removing it, so a moderator can still see what the earlier
list said. Two mitigations:

- The source transcriptions in `scripts/build_seed.py` are left intact, so the drop is
  reversible in the repo: remove the entry from `AUTHORITATIVE_SOURCES` and rebuild.
- `scripts/apply_landa_elul_refresh.py` writes a full before-snapshot to `audit_log` for
  every row it removes from the database, which is the only remaining in-database record
  that the business was ever Landa-certified.

**Risk, stated plainly:** the source carries no publication date, and its own categories
cover restaurants only (`מסעדה חלבית` / `מסעדות ומזנונים` / `מעדניות`). The pizzeria and
bakery exemption covers the clearest case of a category it plainly does not speak for, but
the same doubt applies to catering, halls and institutional kitchens, which were dropped.
If the list is a narrower slice than assumed, the corpus has dropped businesses that Landa
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

### Known gaps — important
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates** — none exist in these sources. These lists establish *status + certifier* only (source-hierarchy level 1 per PRD §13). Certificate photos / field verification required for attributes.
- List dates are snapshots with no validity window → a per-certifier freshness/staleness rule is needed (configured: stale after 365 days without re-scrape, see `KASHROOT_DEFAULT_FRESHNESS_DAYS`).
- Records with `needs_review=TRUE` must be manually verified before serving.
- No geocoding yet — `geo point` population via Google Places is the next pipeline step.
