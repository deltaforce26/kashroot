"""Tests for the Landa Elul-5786 rename reconciliation.

The rename exists because ``dedupe_key`` is derived from the name: without it a
republished name reaches the importer as a business it has never seen, and the record it
already holds is left behind, still ACTIVE and still able to decide a verdict.

The pure functions are unittest-style per STANDARDS.md. The end-to-end cases need the
SQLite-backed ``session`` fixture from conftest, which is a pytest fixture, so they
follow the shape the rest of the database-backed suite already uses.
"""

from __future__ import annotations

import unittest

import pytest
from sqlalchemy import select

from app.ingestion.normalize import restaurant_dedupe_key
from app.models import (
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    RecordState,
    Restaurant,
)
from scripts.apply_landa_elul_refresh import RENAMES, apply_refresh, rekey_import_key

OLD_NAME, CITY, ADDRESS = next(iter(RENAMES))
NEW_NAME = RENAMES[(OLD_NAME, CITY, ADDRESS)]


def _seed(session, name: str) -> Restaurant:
    """
    Put one restaurant and its seed certificate in the database under ``name``.

    Committed, not just flushed: a dry run rolls the transaction back, and the fixture
    stands in for a database that was already populated by an earlier import.

    Parameters:
        session: Open database session.
        name (str): Published name to store the restaurant under.

    Return:
        Restaurant: The stored restaurant.
    """
    certifier = session.scalar(select(Certifier).where(Certifier.slug == "landa_bnei_brak"))
    if certifier is None:
        certifier = Certifier(
            slug="landa_bnei_brak",
            name_he='בד"ץ שארית ישראל - הרב לנדא',
            type=CertifierType.BADATZ,
        )
        session.add(certifier)
        session.flush()

    dedupe_key = restaurant_dedupe_key(name, CITY, ADDRESS)
    restaurant = Restaurant(
        dedupe_key=dedupe_key,
        name_he=name,
        city_he=CITY,
        address_he=ADDRESS,
        record_state=RecordState.LIST_VERIFIED,
    )
    session.add(restaurant)
    session.flush()
    session.add(
        Certificate(
            restaurant_id=restaurant.id,
            certifier_id=certifier.id,
            import_key=f"seed:{dedupe_key}:landa_bnei_brak",
            level=CertificationLevel.UNKNOWN,
            state=CertificateState.ACTIVE,
            source=CertificateSource.OFFICIAL_LIST,
        )
    )
    session.commit()

    return restaurant


def test_rename_preserves_the_restaurant_id(session):
    """Saved lists, geocoding and demo attributes all address restaurants by id."""
    restaurant = _seed(session, OLD_NAME)
    original_id = restaurant.id

    plan = apply_refresh(session, dry_run=False)

    assert plan.renamed == [(OLD_NAME, NEW_NAME)]
    renamed = session.scalar(select(Restaurant).where(Restaurant.id == original_id))
    assert renamed.name_he == NEW_NAME
    assert renamed.dedupe_key == restaurant_dedupe_key(NEW_NAME, CITY, ADDRESS)


def test_rename_repoints_the_certificate_the_importer_will_look_for(session):
    """A certificate left on the old key forks into a duplicate on the next import."""
    _seed(session, OLD_NAME)

    plan = apply_refresh(session, dry_run=False)

    assert plan.certificates_rekeyed == 1
    certificate = session.scalars(select(Certificate)).one()
    expected = restaurant_dedupe_key(NEW_NAME, CITY, ADDRESS)
    assert certificate.import_key == f"seed:{expected}:landa_bnei_brak"


def test_rename_is_audit_logged(session):
    """A kashrut-record change that leaves no trail is not an acceptable change."""
    _seed(session, OLD_NAME)

    apply_refresh(session, dry_run=False)

    entries = session.scalars(select(AuditLog)).all()
    assert {e.entity_type for e in entries} == {"restaurant", "certificate"}
    assert all(e.actor == "refresh:landa_restaurants_elul_5786" for e in entries)


def test_dry_run_writes_nothing(session):
    """The default run reports the diff and rolls it back, like every other pipeline."""
    _seed(session, OLD_NAME)

    plan = apply_refresh(session, dry_run=True)

    assert plan.renamed == [(OLD_NAME, NEW_NAME)]
    assert session.scalar(select(Restaurant)).name_he == OLD_NAME


def test_rerunning_after_apply_is_a_no_op(session):
    """Already renamed is reported as such, never as a second rename."""
    _seed(session, NEW_NAME)

    plan = apply_refresh(session, dry_run=False)

    assert plan.renamed == []
    assert plan.already_applied == [NEW_NAME]


def test_a_record_absent_from_the_database_is_reported_not_created(session):
    """This script reconciles what is there; creating records is the importer's job."""
    plan = apply_refresh(session, dry_run=False)

    assert plan.renamed == []
    assert plan.absent == [OLD_NAME]
    assert session.scalar(select(Restaurant)) is None


def test_refuses_when_an_import_already_forked_the_record(session):
    """Two restaurants holding certificates is a merge decision, not a rename."""
    _seed(session, OLD_NAME)
    _seed(session, NEW_NAME)

    with pytest.raises(SystemExit) as excinfo:
        apply_refresh(session, dry_run=True)

    assert "already forked" in str(excinfo.value)
    assert session.scalar(
        select(Restaurant).where(Restaurant.name_he == OLD_NAME)
    ) is not None


class RekeyImportKeyTests(unittest.TestCase):
    """The importer finds a renamed restaurant's certificate only if its key moved too."""

    def test_rewrites_the_embedded_dedupe_key(self) -> None:
        """
        The dedupe key inside a seed import key moves with the rename.

        Return:
            None
        """
        old_key = "old name|bnei brak|street 1"
        new_key = "new name|bnei brak|street 1"

        self.assertEqual(
            rekey_import_key(f"seed:{old_key}:landa_bnei_brak", old_key, new_key),
            f"seed:{new_key}:landa_bnei_brak",
        )

    def test_keeps_the_certifier_suffix(self) -> None:
        """
        A rename never reattributes a certificate to a different certifier.

        Return:
            None
        """
        rekeyed = rekey_import_key("seed:a:badatz_eda_haredit", "a", "b")

        self.assertTrue(rekeyed.endswith(":badatz_eda_haredit"))

    def test_leaves_a_key_for_another_restaurant_alone(self) -> None:
        """
        Only keys embedding this restaurant's own dedupe key are rewritten.

        Return:
            None
        """
        other = "seed:someone else|city|street:landa_bnei_brak"

        self.assertEqual(rekey_import_key(other, "a", "b"), other)

    def test_passes_through_a_non_seed_certificate(self) -> None:
        """
        A certificate with no import key is not a seed row and is left untouched.

        Return:
            None
        """
        self.assertIsNone(rekey_import_key(None, "a", "b"))


class RenameTableTests(unittest.TestCase):
    """The table must actually rename something, in a direction the importer can follow."""

    def test_every_entry_changes_the_name(self) -> None:
        """
        A rename to the same name would be a silent no-op hiding a transcription error.

        Return:
            None
        """
        for (old_name, _, _), new_name in RENAMES.items():
            self.assertNotEqual(old_name, new_name)


if __name__ == "__main__":
    unittest.main()
