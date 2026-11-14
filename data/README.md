# Seed Data

## `seed/kashroot_seed_corpus.csv` — the source of truth

**This CSV is the sole source of truth for seed data** (product decision, 2026-11-08).

- To change the corpus, edit the CSV directly (add, fix, or delete rows).
- Then sync the database so it holds exactly what the CSV has:
  ```
  kashroot seed-import --prune            # dry run (default), incl. planned deletions
  kashroot seed-import --apply --prune    # write; --prune drops rows removed from the CSV
  ```
- The original source documents (`archive/sources/`) and the generator `scripts/archive/build_seed.py`
  are **retired history**. Don't regenerate the CSV from them, and don't validate or
  "correct" CSV rows against them — where they disagree, the CSV wins.

Encoding: UTF-8 with BOM (Excel-compatible). ~657 rows, 27 certifier slugs.

### Columns
| Column | Meaning |
|---|---|
| `restaurant_name_he` | Business name (Hebrew) |
| `address_he` / `city_he` / `city_en` | Address; multi-branch addresses like "רשב"י 15 / קק"ל 13" are not yet split — split into separate rows |
| `phone` | Normalized (digits, leading 0, or `*` short codes) |
| `business_type_he` | מסעדה, קייטרינג, מאפייה, חנות מזון… |
| `diet_type` | meat / dairy / pareve / fish / mixed / dairy_pareve — blank if indeterminable |
| `certifier_ids` | `;`-separated certifier slugs. Every slug must exist in `CERTIFIER_SEED` (`app/ingestion/seed_import.py`) |
| `corroboration_count` | Historical: number of source documents that listed the business. Informational only |
| `source_documents` / `source_date` | Provenance labels carried into the DB (freshest first; the importer dates the certificate from it). Slugs not registered in `SOURCE_DOCUMENT_SEED` are dropped on import and reported under `source_documents_ignored` |
| `record_state` | `LIST_VERIFIED` or `UNKNOWN_PENDING_VERIFICATION` |
| `needs_review` | TRUE where city/phone/address/certifier is uncertain — verify before serving |
| `dedupe_hash_sha256` | Not read by the importer (dedupe keys are derived at import by `restaurant_dedupe_key`) |
| `source_url` | Not read by the importer |
| `opening_hours_he` | Not read by the importer |
| `google_business_place_id` | Optional Google Place ID of the business. When present, `seed-import` stores it (`business_place_source = seed_csv`) and `places-resolve` never re-searches it, `--force` included. Blank leaves any id a previous `places-resolve` found untouched. Restaurants in one building may share an id |

### Certifier identity decisions
These are product decisions about what CSV labels mean; they stand regardless of source.
- **`rabbanut_bnei_brak` → `landa_bnei_brak`** (Aug 2026): the Bnei Brak rabbanut and
  Badatz Rav Landa are one certification.
- **Landa is nationwide:** "הרב לנדא/לנדאו" in any city is `landa_bnei_brak`.
- **"קהילות"** is בד"ץ קהילות → `badatz_kehilot`.
- **"בהידור הכשרות"** is a real badatz → `badatz_behidur_hakashrut` (`badatz_unnamed` retired).
- Many names/types in `CERTIFIER_SEED` (local councils, private rabbis, `beit_yosef` as
  `PRIVATE`) were inferred from slugs, not published names — worth a human pass.

### Known gaps
- **No certificate-level attributes** (glatt, pas yisrael…) and **no expiry dates**.
  Records establish status + certifier only; attributes need certificate photos / field
  verification.
- No validity window on list dates → freshness rule: stale after
  `KASHROOT_DEFAULT_FRESHNESS_DAYS` (365) without re-verification.
- Rows with `needs_review=TRUE` must be manually verified before serving.
- Most rows have no `google_business_place_id` yet.

### History
Earlier versions of this file documented each source-document refresh (Landa Elul 5786,
Tishrei 5787 "Misadot Mehadrin", Beit Yosef Ashdod web directory, 2026-09-26 columns).
That detail is in git history (`git log -p -- data/README.md`); it no longer governs the
corpus.
