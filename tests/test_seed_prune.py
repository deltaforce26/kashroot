"""Tests for `kashroot seed-import --prune` (app.ingestion.seed_prune).

DB-backed cases use the SQLite-backed ``session`` pytest fixture from conftest, the
same way the rest of the ingestion suite does (see tests/test_seed_import.py); wrapped
in ``unittest.TestCase`` per STANDARDS.md via an autouse fixture-injection method,
matching the pattern in tests/test_apply_landa_elul_refresh.py.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.ingestion.seed_import import import_seed
from app.ingestion.seed_prune import (
    PRUNE_SKIP_NON_SEED_CERTIFICATE,
    PRUNE_SKIP_SAVED_LIST,
)
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    RecordState,
    Restaurant,
    SavedList,
    SavedListItem,
    User,
)

_HEADER = (
    "restaurant_name_he,address_he,city_he,city_en,phone,business_type_he,"
    "diet_type,certifier_ids,corroboration_count,source_documents,source_date,"
    "record_state,needs_review,notes"
)

#: A stable, valid source-document slug pair every row below can cite.
_EDA = "eda_haredit_south_poster"
_RUBIN = "rubin_restaurants_pdf"


def _row(
    name: str,
    address: str,
    city: str = "אשקלון",
    certifier_ids: str = "badatz_eda_haredit",
    source_documents: str = _EDA,
) -> str:
    return (
        f"{name},{address},{city},Ashkelon,0500000000,מסעדה בשרית,meat,"
        f"{certifier_ids},1,{source_documents},Tamuz 5786 (Jun-Jul 2026),"
        "LIST_VERIFIED,FALSE,"
    )


def _write_csv(path: Path, *rows: str) -> Path:
    path.write_text("\n".join([_HEADER, *rows, ""]), encoding="utf-8-sig")

    return path


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


class SeedPruneTests(unittest.TestCase):
    """DB-backed prune behaviour. See module docstring for why unittest + fixture."""

    @pytest.fixture(autouse=True)
    def _inject_session(self, session, tmp_path):
        self.session = session
        self.tmp_path = tmp_path

    def test_stale_seed_restaurant_is_deleted_when_pruned(self) -> None:
        first = _write_csv(
            self.tmp_path / "first.csv",
            _row("מסעדה נעלמת", "הרצל 1"),
            _row("מסעדה קבועה", "אלנבי 5"),
        )
        import_seed(self.session, first, dry_run=False, actor="pytest")

        second = _write_csv(self.tmp_path / "second.csv", _row("מסעדה קבועה", "אלנבי 5"))
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertIsNotNone(stats.prune)
        self.assertEqual(stats.prune.restaurants_deleted, 1)
        self.assertEqual(stats.prune.deleted_restaurant_names, ["מסעדה נעלמת"])
        self.assertIsNone(
            self.session.scalar(select(Restaurant).where(Restaurant.name_he == "מסעדה נעלמת"))
        )
        self.assertIsNotNone(
            self.session.scalar(select(Restaurant).where(Restaurant.name_he == "מסעדה קבועה"))
        )

    def test_stale_certificates_of_the_deleted_restaurant_are_also_deleted(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")
        self.assertEqual(_count(self.session, Certificate), 1)

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertEqual(stats.prune.certificates_deleted, 1)
        self.assertEqual(_count(self.session, Certificate), 0)

    def test_non_seed_restaurant_is_never_touched(self) -> None:
        """A restaurant with no seed certificate at all is not this pipeline's to delete,
        even though its ``dedupe_key`` is obviously absent from any CSV.
        """
        restaurant = Restaurant(
            dedupe_key="manual|city|addr",
            name_he="מסעדה ידנית",
            record_state=RecordState.LIST_VERIFIED,
        )
        self.session.add(restaurant)
        self.session.commit()

        second = _write_csv(self.tmp_path / "second.csv", _row("מסעדה אחרת", "כלשהו 1"))
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertEqual(stats.prune.restaurants_deleted, 0)
        self.assertIsNotNone(self.session.get(Restaurant, restaurant.id))
        self.assertEqual(len(stats.prune.skipped_restaurants), 1)
        self.assertEqual(stats.prune.skipped_restaurants[0]["name"], "מסעדה ידנית")

    def test_stale_restaurant_with_non_seed_certificate_is_skipped_and_reported(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")

        restaurant = self.session.scalar(
            select(Restaurant).where(Restaurant.name_he == "מסעדה נעלמת")
        )
        certifier_id = restaurant.certificates[0].certifier_id
        manual_cert = Certificate(
            restaurant_id=restaurant.id,
            certifier_id=certifier_id,
            level=CertificationLevel.UNKNOWN,
            attributes={},
            state=CertificateState.ACTIVE,
            source=CertificateSource.MODERATOR_VERIFIED,
            import_key=None,
        )
        self.session.add(manual_cert)
        self.session.commit()
        #: A fresh CLI run gets a fresh session with nothing cached; expire here to
        #: match that rather than reusing this test's already-loaded relationship.
        self.session.expire_all()

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertEqual(stats.prune.restaurants_deleted, 0)
        self.assertEqual(stats.prune.prune_skipped, 1)
        self.assertEqual(
            stats.prune.skipped_restaurants[0]["reason"], PRUNE_SKIP_NON_SEED_CERTIFICATE
        )
        self.assertIsNotNone(self.session.get(Restaurant, restaurant.id))

    def test_stale_restaurant_on_a_saved_list_is_skipped_and_reported(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")

        restaurant = self.session.scalar(
            select(Restaurant).where(Restaurant.name_he == "מסעדה נעלמת")
        )
        user = User(display_name="test user")
        self.session.add(user)
        self.session.flush()
        saved_list = SavedList(user_id=user.id, name="my list")
        self.session.add(saved_list)
        self.session.flush()
        self.session.add(SavedListItem(saved_list_id=saved_list.id, restaurant_id=restaurant.id))
        self.session.commit()

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertEqual(stats.prune.restaurants_deleted, 0)
        self.assertEqual(stats.prune.skipped_restaurants[0]["reason"], PRUNE_SKIP_SAVED_LIST)
        self.assertIsNotNone(self.session.get(Restaurant, restaurant.id))

    def test_dropped_certifier_deletes_only_that_certificate(self) -> None:
        """A restaurant the CSV still lists, but under fewer certifiers, keeps the
        restaurant and loses only the certificate the certifier no longer earns.
        """
        first = _write_csv(
            self.tmp_path / "first.csv",
            _row(
                "מסעדה משותפת",
                "אלנבי 5",
                certifier_ids="badatz_eda_haredit;badatz_mehadrin_rubin",
                source_documents=f"{_EDA};{_RUBIN}",
            ),
        )
        import_seed(self.session, first, dry_run=False, actor="pytest")
        restaurant = self.session.scalar(
            select(Restaurant).where(Restaurant.name_he == "מסעדה משותפת")
        )
        self.assertEqual(len(restaurant.certificates), 2)

        second = _write_csv(
            self.tmp_path / "second.csv",
            _row("מסעדה משותפת", "אלנבי 5", certifier_ids="badatz_eda_haredit"),
        )
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        self.assertEqual(stats.prune.certificates_deleted, 1)
        self.assertEqual(stats.prune.restaurants_deleted, 0)
        self.session.refresh(restaurant)
        self.assertIsNotNone(self.session.get(Restaurant, restaurant.id))
        remaining = self.session.scalars(
            select(Certificate).where(Certificate.restaurant_id == restaurant.id)
        ).all()
        self.assertEqual(len(remaining), 1)

    def test_no_prune_without_the_flag(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=False, actor="pytest")

        self.assertIsNone(stats.prune)
        self.assertIsNotNone(
            self.session.scalar(select(Restaurant).where(Restaurant.name_he == "מסעדה נעלמת"))
        )

    def test_dry_run_prune_writes_nothing(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")
        restaurants_before = _count(self.session, Restaurant)
        certificates_before = _count(self.session, Certificate)

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=True, actor="pytest", prune=True)

        self.assertEqual(stats.prune.restaurants_deleted, 1)  # it planned the deletion…
        self.assertEqual(_count(self.session, Restaurant), restaurants_before)  # …wrote none
        self.assertEqual(_count(self.session, Certificate), certificates_before)
        self.assertIsNotNone(
            self.session.scalar(select(Restaurant).where(Restaurant.name_he == "מסעדה נעלמת"))
        )

    def test_deletions_are_audited(self) -> None:
        first = _write_csv(self.tmp_path / "first.csv", _row("מסעדה נעלמת", "הרצל 1"))
        import_seed(self.session, first, dry_run=False, actor="pytest")

        second = _write_csv(self.tmp_path / "second.csv")
        stats = import_seed(self.session, second, dry_run=False, actor="pytest", prune=True)

        deletes = self.session.scalars(
            select(AuditLog).where(AuditLog.action == AuditAction.DELETE)
        ).all()
        expected = stats.prune.restaurants_deleted + stats.prune.certificates_deleted
        self.assertEqual(len(deletes), expected)
        restaurant_deletes = [d for d in deletes if d.entity_type == "restaurant"]
        self.assertTrue(restaurant_deletes)
        self.assertEqual(restaurant_deletes[0].changes["before"]["name_he"], "מסעדה נעלמת")
        self.assertIsNone(restaurant_deletes[0].changes["after"])


if __name__ == "__main__":
    unittest.main()
