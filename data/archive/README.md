# data/archive

Retired, historical material. Not to be used to regenerate or validate the seed CSV.

- `sources/` - the original certifier source documents the seed corpus was first built from.
- `../../scripts/archive/build_seed.py` and `apply_landa_elul_refresh.py` - the retired generator and one-off refresh script.

As of 2026-11-08, `data/seed/kashroot_seed_corpus.csv` is the sole source of truth. Edit it directly and sync the DB with `kashroot seed-import --apply --prune`. Where these archives disagree with the CSV, the CSV wins.
