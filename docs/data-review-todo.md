# Data review TODO

Open questions about the seed corpus that need a human decision or an external source
check. Each item says what is wrong, why it matters, and what would settle it.

---

## 1. Three Landa records absent from Landa's current published list

**Status:** open — needs research against Landa's current publication.
**Raised:** 2026-09-09, during the DB architecture reset.
**Severity:** kashrut-correctness. These records can currently return **MATCH**.

### What

Three rows in `data/seed/kashroot_seed_corpus.csv` carry
`certifier_ids = landa_bnei_brak` but do **not** appear in
`data/sources/landa_restaurants_elul_5786.csv`. Their only source is
`rabbanut_bb_kitchens_pdf`:

| Name | Address | City |
|---|---|---|
| קברנה | שבתי חזקיה 31 | ירושלים |
| רויאל | שלמה המלך 31 | בני ברק |
| שביט - לכבוד שבת ויו"ט | רש"י 24 | בני ברק |

The arithmetic: **45 Landa rows in the corpus = 41 (the Elul list) + 1 (a duplicate row,
fixed separately) + these 3.**

### Why it matters

`data/README.md` and commit `78daaa5` ("Treat the Elul 5786 Landa list as the whole of
Landa, not a category slice") establish the Elul 5786 list as Landa's *complete current
record*. On that reading these three should have been removed by
`scripts/apply_landa_elul_refresh.py`, and their presence means a user who whitelists
Landa gets a **MATCH** for a restaurant Landa's own current list omits — PRD §20's
"wrong MATCH on a lapsed cert", which the PRD classes as existential.

Against that: `data/README.md` records real doubt about the source — it *"carries no
publication date and may be a category slice."* If it is a slice, absence from it is not
evidence of revocation, and removing these three would delete valid records.

Both readings cannot be right, and the corpus currently reflects neither cleanly.

### Suspected cause

Not an ingestion bug. `cc4ab1b` applied the refresh and emptied `RENAMES`; `78daaa5` made
the Elul list authoritative. The merge commits after that include
*"Restore the dev-side files the merge reverted"* — a merge most likely resurrected rows
the refresh had deleted. Worth confirming with
`git log -p -- data/seed/kashroot_seed_corpus.csv` around those commits.

### What would settle it

1. Obtain Landa's current published restaurant list and check whether it is complete or
   categorised (the decisive question).
2. If complete → remove the three via a refresh run, and note the deletion in
   `data/README.md` as with the original Elul refresh.
3. If a slice → keep them, amend `data/README.md`'s "whole of Landa" wording, and update
   `tests/test_seed_import.py::test_the_refresh_is_the_whole_of_its_certifier` to the
   correct expectation.

### Until then

Two tests are marked `xfail(strict=False)` with a pointer to this document —
`test_the_refresh_is_the_whole_of_its_certifier` and
`test_survivors_are_read_from_the_real_corpus`. Both assert Landa == 41 and currently see
44. **When this is resolved they will either pass (flipping to XPASS, which pytest
reports) or need their expectation updated — do not delete them.**

### ⚠️ The corpus currently diverges from its generator

`data/seed/kashroot_seed_corpus.csv` holds **378** rows. Running `scripts/build_seed.py`
produces **375** — it drops these 3 rows, because `AUTHORITATIVE_SOURCES` already treats
the Elul list as the whole of Landa.

So **regenerating the corpus silently resolves this open question in favour of deletion**,
without anyone deciding to. Before running `build_seed.py`, either settle this item or
diff the output first. The CSV is otherwise a generated artifact and should not be
hand-edited; these 3 rows are the one deliberate exception, and they exist only because
the decision was deferred rather than made.

(2026-09-09: a separate merge artifact in the same area — a duplicate
`שאבעס ביג` row that had also lost its published rename — was fixed by matching the
generator's output. That one was unambiguous and is not part of this open question.)

---

## 2. Unresolved certifier identities and a new-evidence conflict from the 8th source

**Status:** open — needs a product decision (identities) and, for the conflict, either
confirmation from Landa or a policy call on how new-evidence-vs-authoritative-source
conflicts should resolve going forward.
**Raised:** 2026-09-22, ingesting `misadot_mehadrin_restaurants.csv` (misadotmehadrin.co.il
scrape) as the 8th seed corpus source.
**Severity:** kashrut-correctness for the two unresolved identities (7 rows can currently
return UNKNOWN rather than a wrong MATCH, which is the fail-safe rule working correctly —
but the underlying organizations still need identifying before these can ever resolve to
MATCH). Lower severity for the new-evidence conflict (1 row), which is also currently
UNKNOWN.

### Two certificate values with no confident certifier match

The source's `certificate` column named 28 distinct Hebrew values. Two could not be
attributed to a known organization:

- `הרב לנדא` / `הרב לנדאו` (spelling variants of each other, originally 4 rows) — seeded as
  a **new, distinct slug** `rav_landa_variant_unverified`, deliberately **not** merged into
  the corpus's existing `landa_bnei_brak` (Badatz Rav Landa, Bnei Brak). This source's rows
  under this name are in בית שמש, בני ברק, טבריה and ירושלים — a wider footprint than the
  Bnei-Brak-scoped entity already in the corpus, so treating them as the same organization
  without confirmation would let a MATCH leak across kashrut agencies, which CLAUDE.md's
  fail-safe rule forbids. **One of the 4 has since been resolved and removed from this
  count**: `מסובין` / בית שמש (יגאל אלון 2) has the exact same phone number and street as
  the corpus's existing `landa_bnei_brak`-certified record for the same business — not
  speculation about the organization generally, but a positive identification of this one
  restaurant as a duplicate already in the corpus. It's mapped straight to `landa_bnei_brak`
  via `CERT_FIELD_OVERRIDE_8` in `scripts/build_seed.py`. **3 rows remain unresolved**
  (בני ברק, טבריה, ירושלים).
- `קהילות` ("Kehilot", 4 rows) — no context in the source to identify which organization
  this is. Seeded as `kehilot_unidentified`.

Every row carrying either slug is forced to `needs_review=TRUE` /
`UNKNOWN_PENDING_VERIFICATION` by `scripts/build_seed.py`, so neither can serve a MATCH
until a human resolves who they are.

### What would settle it

1. Contact misadotmehadrin.co.il or the named rows' restaurants directly to identify the
   organizations behind `הרב לנדא`/`הרב לנדאו` and `קהילות`.
2. If `הרב לנדא`/`הרב לנדאו` turns out to be the same Badatz Rav Landa already in the
   corpus (`landa_bnei_brak`), re-slug the remaining 3 rows and update `CERT_MAP_8` in
   `scripts/build_seed.py` accordingly — do not merge speculatively before then.
3. If `קהילות` is identified, give it a proper slug and `CERTIFIER_SEED` entry in place of
   `kehilot_unidentified`.

### A new-evidence conflict with the Elul 5786 Landa refresh (item 1's mechanism, from the other direction)

One row from this source, `קפה גרג` (מצדה 5, בני ברק, `מהדרין בני ברק` → `landa_bnei_brak`),
is evidenced **only** by `misadot_mehadrin_restaurants_csv` (received 2026-09-22) — a
source dated after `landa_restaurants_elul_5786` (received 2026-08-29), the document item 1
established as authoritative/complete for `landa_bnei_brak`. Before this change,
`AUTHORITATIVE_SOURCES` in `scripts/build_seed.py` would have silently dropped this row,
the same way it dropped the 142 records item 1's arithmetic accounts for: the Elul list
doesn't name it, so it read as revoked.

That reading doesn't hold here — the Elul list predates this row's evidence, so its silence
is not disconfirmation, it's simply that the list couldn't have seen a business a newer
source reports. `build_seed.py` now flags any record in this situation
(`needs_review=TRUE` / `UNKNOWN_PENDING_VERIFICATION`, see `new_evidence_conflicts` in the
script) instead of silently dropping it or silently trusting it clean. This does not change
how sources 1-7 merge with each other or with each other's dates.

### What would settle it

Obtain Landa's current published list (same ask as item 1) and check whether `קפה גרג`
appears on it. If yes, clear `needs_review` and set `record_state=LIST_VERIFIED`. If the
Elul list is confirmed to be scope-restricted to restaurant categories (not cafés), the
`AUTHORITATIVE_SOURCES` mechanism itself may need to exclude café/coffee-cart categories
from its drop, which would also bear on item 1.
