"""Contract tests between the seed corpus and the importer — no database required.

These run over the real `data/seed/kashroot_seed_corpus.csv`. They fail the moment the
corpus grows a certifier, source document, diet type or record state the pipeline does
not know how to map, which is exactly when a silent mis-import would otherwise happen.
"""

import collections

import pytest

from app.ingestion.normalize import restaurant_dedupe_key, split_branch_addresses
from app.ingestion.seed_import import (
    CERTIFIER_SEED,
    DEFAULT_CSV_PATH,
    SOURCE_DATE_EARLIEST,
    SOURCE_DOCUMENT_SEED,
    SOURCES_DIR,
    _parse_diet,
    _parse_record_state,
    _row_certifier_slugs,
    _row_source_slugs,
    read_rows,
)

pytestmark = pytest.mark.skipif(
    not DEFAULT_CSV_PATH.exists(), reason="seed corpus not present"
)


@pytest.fixture(scope="module")
def rows():
    return list(read_rows(DEFAULT_CSV_PATH))


def test_corpus_is_non_empty(rows):
    assert len(rows) > 300


def test_every_certifier_id_is_known(rows):
    for row in rows:
        assert _row_certifier_slugs(row)  # raises SeedImportError on unknown ids


def test_every_source_document_is_known(rows):
    for row in rows:
        assert _row_source_slugs(row)


def test_every_diet_and_record_state_maps(rows):
    for row in rows:
        _parse_diet(row)
        _parse_record_state(row)


def test_every_source_date_label_has_a_conservative_date(rows):
    labels = {(row.get("source_date") or "").strip() for row in rows}
    missing = labels - set(SOURCE_DATE_EARLIEST)
    assert not missing, f"no earliest-plausible date mapped for {missing}"


def test_every_document_has_its_own_conservative_date():
    """A document dates the certificates it establishes, so it must carry a date itself."""
    for slug, spec in SOURCE_DOCUMENT_SEED.items():
        label = spec.get("date_label")
        assert label, f"{slug} has no date_label"
        assert label in SOURCE_DATE_EARLIEST, f"no earliest-plausible date mapped for {label}"


def test_row_dates_agree_with_the_documents_they_cite(rows):
    """The corpus's own date column must name the freshest document on the row.

    The importer dates a certificate from the document registry, not from this column, so
    the two can drift silently: a row could claim a list date no document behind it
    supports. Pinning them together keeps the corpus readable as provenance and keeps a
    rebuild honest about which list last established each record.
    """
    for row in rows:
        cited = [SOURCE_DOCUMENT_SEED[slug]["date_label"] for slug in _row_source_slugs(row)]
        freshest = max(cited, key=lambda label: SOURCE_DATE_EARLIEST[label])
        assert (row.get("source_date") or "").strip() == freshest, (
            f"{row['restaurant_name_he']} claims {row['source_date']!r} "
            f"but its freshest cited document is dated {freshest!r}"
        )


def test_source_documents_point_at_files_that_exist():
    for slug, spec in SOURCE_DOCUMENT_SEED.items():
        assert (SOURCES_DIR / spec["file"]).exists(), f"{slug} → missing {spec['file']}"
        assert spec["certifier_slug"] in CERTIFIER_SEED


def test_dedupe_keys_are_unique_after_branch_split(rows):
    """Two different businesses must never collapse into one restaurant row."""
    keys = collections.Counter()
    for row in rows:
        for address in split_branch_addresses(row["address_he"]):
            keys[restaurant_dedupe_key(row["restaurant_name_he"], row["city_he"], address)] += 1
    collisions = {key: count for key, count in keys.items() if count > 1}
    assert not collisions, f"dedupe key collisions: {collisions}"


def test_branch_splitting_expands_multi_branch_rows(rows):
    expanded = sum(len(split_branch_addresses(row["address_he"])) for row in rows)
    assert expanded > len(rows), "expected multi-branch rows to expand into extra records"
