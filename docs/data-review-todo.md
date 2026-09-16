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
