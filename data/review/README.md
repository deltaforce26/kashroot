# Address verification pass — 2026-08-30

First check of seed-corpus addresses against what each business publicly lists.
`data/seed/kashroot_seed_corpus.csv` was **not modified**. Everything here is input to a
human review.

## Files

| File | What it is |
|---|---|
| `address_changes.csv` | The deliverable — rows where the corpus and the listing disagree, both addresses side by side. |
| `address_verification_full.csv` | All 370 corpus rows that have an address, each with its verdict. Nothing is dropped. |
| `address_search_findings.jsonl` | Raw per-row search findings and evidence URLs. Re-running the script over this reproduces both CSVs. |

## Method

Two stages, deliberately separated so no verdict rests on prose judgement:

1. **Search.** Each restaurant was searched with a Hebrew query
   (`<name> <city> כתובת`), at most two searches per row. An address counted only if it
   appeared on a real listing page (`d.co.il`, `rest.co.il`, `easy.co.il`,
   `kosharot.co.il`, `10bis`, `mishloha`, or the business's own site), and that URL was
   recorded. Conflicting sources or a chain with several branches in one city →
   `AMBIGUOUS`, with every candidate listed and none chosen. Nothing credible →
   `NOT_FOUND`. No address was ever inferred or guessed.
2. **Compare.** `scripts/verify_addresses.py`, over
   `app/ingestion/address_compare.py`, decides whether the two disagree. Both sides are
   reduced to `(street, house_number)`; the city, country, postal code and any trailing
   neighbourhood or mall name are excluded. Unit tests: `tests/test_address_compare.py`.

Rebuild:

```
python scripts/verify_addresses.py --shards data/review/address_search_findings.jsonl
```

## Results

| Verdict | Rows | Meaning |
|---|---:|---|
| `NOT_CHECKED` | 193 | **Never searched** — the run hit the session's 200-call web-search cap. Not a negative result. |
| `SAME` | 110 | Corpus address confirmed by a listing. |
| `AMBIGUOUS` | 33 | Sources disagreed, or a chain has several branches in the city. |
| `NOT_FOUND` | 26 | Searched, no credible listing found. |
| `CHANGED_BOTH` | 4 | Street and house number both differ. |
| `CHANGED_NUMBER` | 3 | Same street, different house number. |
| `CHANGED_STREET` | 1 | Different street, same house number. |

**177 of 370 rows were searched. 8 discrepancies were found among them.** The remaining
193 rows still need a run with search budget available.

## Why so few changes

A first pass flagged 27 discrepancies in the same 177 rows; 19 were false positives —
the same street written differently:

- street-type words (`שד' יגאל אלון` vs `יגאל אלון`)
- fuller vs shorter names (`ז'בוטינסקי` vs `זאב ז'בוטינסקי`, `הרב קוק` vs
  `הרב אברהם יצחק הכהן קוק`)
- in-word geresh/gershayim (`ז'בוטינסקי`, `ש"ך`)
- plene/defective spelling (`האצטדיון` vs `האיצטדיון`, `בנין` vs `בניין`)
- trailing neighbourhoods and malls the corpus carries and listings do not (`תלפיות`)

`address_compare` absorbs each of these. Rows it matched non-exactly carry the reason in
`verdict_note`, so the suppression is visible rather than silent.

## Limitations — read before acting on this

- **A `CHANGED_*` row is a candidate, not a fact.** A listing site can be as stale as a
  certifier list. Only a person can tell a relocation from a bad transcription.
- Web search is US-locale and English-biased. Small, unlisted establishments in Bnei
  Brak, Beit Shemesh, Safed and Meron resolve poorly; that is what most `NOT_FOUND`
  rows are.
- `AMBIGUOUS` was applied inconsistently across search workers: some marked a chain
  ambiguous even where one branch listing matched the corpus row exactly, others called
  that `FOUND`. Treat `AMBIGUOUS` as "needs a human", not as a measured signal.
- A listing reflects a business *today*; the corpus reflects a certifier list dated
  `source_date`. A difference means the two disagree, not automatically that the corpus
  is wrong.
- The 56 `needs_review=TRUE` rows were searched and reported, but that flag travels with
  them into these files and still applies.
