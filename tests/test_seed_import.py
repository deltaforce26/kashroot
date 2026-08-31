"""End-to-end seed import over the real corpus (SQLite-backed — see conftest)."""

import datetime as dt

import pytest
from sqlalchemy import func, select

from app.ingestion.normalize import split_branch_addresses
from app.ingestion.seed_import import DEFAULT_CSV_PATH, import_seed, read_rows
from app.models import (
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    IngestionRun,
    IngestionRunState,
    RecordState,
    Restaurant,
    SourceDocument,
)

pytestmark = pytest.mark.skipif(
    not DEFAULT_CSV_PATH.exists(), reason="seed corpus not present"
)


def count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


@pytest.fixture
def imported(session):
    stats = import_seed(session, DEFAULT_CSV_PATH, dry_run=False, actor="pytest")
    return stats


def test_import_creates_certifiers_and_source_documents(session, imported):
    # 3, not 4: rabbanut_bnei_brak was merged into landa_bnei_brak (Aug 2026). The
    # source-document count is unchanged by that merge — a merge moves attribution, never
    # provenance — and grew to 7 with the Elul 5786 Landa restaurants refresh.
    assert count(session, Certifier) == 3
    assert count(session, SourceDocument) == 7
    doc = session.scalar(select(SourceDocument).where(SourceDocument.slug == "rubin_restaurants_pdf"))
    assert doc.source_date_label == "5786 (2026)"
    # Conservative: the earliest date the Hebrew-year label can mean.
    assert doc.source_date == dt.date(2025, 9, 23)


def test_each_document_carries_its_own_list_date(session, imported):
    """A document's date is its own, never the date of whichever row cites it first.

    ``landa_vacation_cities_poster`` is the case that proves it: every row citing it also
    cites the older ``rabbanut_bb_kitchens_pdf``, so a date derived from row order labels
    the Av poster Tamuz. The reverse error is the dangerous one — once a newer list cites
    an older document, row order would stamp the newer date on the older document and
    make every record it establishes look fresher than its evidence supports.
    """
    dates = {
        doc.slug: (doc.source_date_label, doc.source_date)
        for doc in session.scalars(select(SourceDocument))
    }

    assert dates["landa_vacation_cities_poster"] == (
        "Av 5786 (Jul-Aug 2026)",
        dt.date(2026, 7, 15),
    )
    assert dates["rabbanut_bb_kitchens_pdf"] == (
        "Tamuz 5786 (Jun-Jul 2026)",
        dt.date(2026, 6, 16),
    )
    assert dates["landa_restaurants_elul_5786"] == (
        "Elul 5786 (Aug-Sep 2026)",
        dt.date(2026, 8, 14),
    )


def test_refreshed_rows_are_dated_by_their_freshest_source(session, imported):
    """A certificate is as fresh as the newest list that establishes it, not the oldest.

    ``שניצלשף`` is carried by both the Tamuz kitchens PDF and the Elul restaurants
    refresh. Dating it from the older document would leave the refresh with no effect on
    the freshness maths that is the whole reason to ingest a newer list.
    """
    restaurant = session.scalar(
        select(Restaurant).where(Restaurant.name_he == "שניצלשף")
    )
    certificate = restaurant.certificates[0]

    assert certificate.valid_from == dt.date(2026, 8, 14)
    assert certificate.verified_at.date() == dt.date(2026, 8, 14)


def test_the_refresh_is_the_whole_of_its_certifier(session, imported):
    """The Elul list is treated as the complete record for Landa, not a category slice.

    Everything Landa previously carried and that list omits is gone from the corpus, so
    the import can only produce the 41 records the list names. ``מאמה מיה בטיילת``, on the
    older vacation-cities poster and absent from the refresh, is the case that shows it.
    """
    landa = session.scalar(select(Certifier).where(Certifier.slug == "landa_bnei_brak"))
    certificates = session.scalars(
        select(Certificate).where(Certificate.certifier_id == landa.id)
    ).all()

    assert len(certificates) == 41
    assert session.scalar(
        select(Restaurant).where(Restaurant.name_he == "מאמה מיה בטיילת")
    ) is None


def test_import_creates_one_restaurant_per_branch(session, imported):
    """A row listing "רשב\"י 15 / קק\"ל 13" is two businesses, not one."""
    rows = list(read_rows(DEFAULT_CSV_PATH))
    expected = sum(len(split_branch_addresses(row["address_he"])) for row in rows)

    assert imported.rows_read == len(rows)
    assert expected > len(rows), "corpus should contain multi-branch rows"
    assert imported.branch_rows_split > 0
    assert count(session, Restaurant) == expected
    assert imported.restaurants_created == expected

    branched = session.scalars(
        select(Restaurant).where(Restaurant.branch_label.is_not(None))
    ).all()
    assert branched
    assert all(r.branch_label == r.address_he for r in branched)


def test_certificates_carry_no_attributes_and_no_expiry(session, imported):
    """The sources establish certifier + status only — anything more would be invented."""
    certs = session.scalars(select(Certificate)).all()
    assert certs
    assert all(c.attributes == {} for c in certs)
    assert all(c.valid_until is None for c in certs)
    assert all(c.level is CertificationLevel.UNKNOWN for c in certs)
    assert all(c.source is CertificateSource.OFFICIAL_LIST for c in certs)
    assert all(c.source_document_id is not None for c in certs)


def test_rows_needing_review_never_produce_active_certificates(session, imported):
    pending_restaurants = session.scalars(
        select(Restaurant).where(Restaurant.needs_review.is_(True))
    ).all()
    assert pending_restaurants
    for restaurant in pending_restaurants:
        assert all(c.state is CertificateState.PENDING for c in restaurant.certificates)


def test_clean_rows_produce_active_certificates(session, imported):
    clean = session.scalars(
        select(Restaurant)
        .where(Restaurant.needs_review.is_(False))
        .where(Restaurant.record_state == RecordState.LIST_VERIFIED)
    ).all()
    assert clean
    assert all(c.state is CertificateState.ACTIVE for r in clean for c in r.certificates)


def test_corroborated_rows_keep_every_source_document(session, imported):
    """``corroboration_count`` counts *source documents*, and must keep doing so.

    It is the assertion that catches provenance quietly thrown away — by the
    rabbanut_bnei_brak -> landa_bnei_brak merge, which collapsed two certifier slugs onto
    one certificate without touching the documents behind it, or by a list refresh, which
    adds a document to rows an older list already established. Pinned against the corpus
    rather than a literal so it keeps checking the database against the data, not against
    whatever the count happened to be when the test was written.
    """
    expected = sorted(
        len(row["source_documents"].split(";"))
        for row in read_rows(DEFAULT_CSV_PATH)
        for _ in split_branch_addresses(row["address_he"])
    )
    restaurants = session.scalars(select(Restaurant)).all()

    assert sorted(r.corroboration_count for r in restaurants) == expected

    corroborated = [r for r in restaurants if r.corroboration_count > 1]
    assert corroborated
    # Post-merge the corpus lists no restaurant under two certifiers.
    assert all(len({c.certifier_id for c in r.certificates}) == 1 for r in corroborated)


def test_multi_certifier_rows_get_one_certificate_each(session, tmp_path):
    """One certificate per certifier ID on the row.

    Driven by a synthetic CSV rather than the corpus: the real corpus stopped containing
    multi-certifier rows at the Aug 2026 merge, but the ingestion logic still handles them
    and must stay covered.
    """
    csv_path = tmp_path / "multi_certifier.csv"
    header = (
        "restaurant_name_he,address_he,city_he,city_en,phone,business_type_he,"
        "diet_type,certifier_ids,corroboration_count,source_documents,source_date,"
        "record_state,needs_review,notes"
    )
    row = (
        "מסעדת בדיקה,הרצל 1,אשקלון,Ashkelon,0500000000,מסעדה בשרית,"
        "meat,badatz_eda_haredit;badatz_mehadrin_rubin,2,"
        "eda_haredit_south_poster;rubin_restaurants_pdf,Tamuz 5786 (Jun-Jul 2026),"
        "LIST_VERIFIED,FALSE,"
    )
    csv_path.write_text("\n".join([header, row, ""]), encoding="utf-8-sig")

    import_seed(session, csv_path, dry_run=False, actor="pytest")

    restaurant = session.scalar(select(Restaurant))
    assert restaurant.corroboration_count == 2
    assert len(restaurant.certificates) == 2
    assert len({c.certifier_id for c in restaurant.certificates}) == 2


def test_import_is_idempotent(session, imported):
    restaurants_before = count(session, Restaurant)
    certificates_before = count(session, Certificate)

    second = import_seed(session, DEFAULT_CSV_PATH, dry_run=False, actor="pytest")

    assert count(session, Restaurant) == restaurants_before
    assert count(session, Certificate) == certificates_before
    assert second.restaurants_created == 0
    assert second.certificates_created == 0
    assert second.restaurants_updated == 0
    assert second.certificates_updated == 0
    assert second.changed_fields == {}


def test_dry_run_writes_no_data_but_records_the_run(session):
    stats = import_seed(session, DEFAULT_CSV_PATH, dry_run=True, actor="pytest")

    assert stats.restaurants_created > 0  # it planned the work…
    assert count(session, Restaurant) == 0  # …and wrote none of it
    assert count(session, Certificate) == 0
    assert count(session, Certifier) == 0

    run = session.scalar(select(IngestionRun))
    assert run is not None
    assert run.dry_run is True
    assert run.state is IngestionRunState.COMPLETED
    assert run.stats["restaurants_created"] == stats.restaurants_created


def test_apply_run_is_recorded_with_stats(session, imported):
    run = session.scalar(select(IngestionRun).where(IngestionRun.dry_run.is_(False)))
    assert run.state is IngestionRunState.COMPLETED
    assert run.pipeline == "seed_corpus"
    assert run.actor == "pytest"
    assert run.stats["rows_read"] == len(list(read_rows(DEFAULT_CSV_PATH)))
    assert run.finished_at is not None


def test_every_created_certificate_is_audited(session, imported):
    audited = session.scalars(
        select(AuditLog).where(AuditLog.entity_type == "certificate")
    ).all()
    assert len(audited) == count(session, Certificate)
    assert all(entry.evidence.get("source_document") for entry in audited)
    assert all(entry.ingestion_run_id is not None for entry in audited)
