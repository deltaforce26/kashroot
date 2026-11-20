# Data review TODO

Open questions about the seed corpus that need a human decision. Each item says what is
wrong, why it matters, and what would settle it.

`data/seed/kashroot_seed_corpus.csv` is the sole source of truth (product decision,
2026-11-08). A row disagreeing with an original source document is **not** an open
question — the CSV wins. Items here are about the CSV's own content.

---

_No open items._

## Resolved

### Three Landa records absent from the Elul 5786 list — closed 2026-11-08

`קברנה` (Jerusalem), `רויאל` and `שביט - לכבוד שבת ויו"ט` (Bnei Brak) carry
`landa_bnei_brak` in the CSV but were not on `landa_restaurants_elul_5786.csv`. Closed by
the source-of-truth decision: the CSV keeps them as they are, and Landa's record set is
whatever the CSV lists. `scripts/archive/build_seed.py` (which would drop them) is retired and
must not be used to regenerate the corpus.
