"""Tests for the certifier-merge safety rules.

The merge itself is a one-off against a populated database, but the two pure functions
it leans on encode the rule that makes it safe to run: a duplicate row may only be
deleted when the row surviving it knows at least as much. These are unittest-style per
STANDARDS.md; the rest of ``tests/`` predates that rule (see NOTES.md).
"""

from __future__ import annotations

import datetime as dt
import unittest
from types import SimpleNamespace
from typing import Any

from scripts.merge_rabbanut_bnei_brak import _facts_lost, _target_import_key


def _certificate(
    attributes: dict[str, Any] | None = None,
    valid_until: dt.date | None = None,
    is_demo_seed: bool = False,
) -> SimpleNamespace:
    """
    Build the minimal certificate-shaped object the loss comparison reads.

    Parameters:
        attributes (dict[str, Any] | None): Kashrut attributes on the certificate.
        valid_until (dt.date | None): Expiry date, if any.
        is_demo_seed (bool): Whether the row is demo-seeded.

    Return:
        SimpleNamespace: A stand-in carrying only the compared fields.
    """
    return SimpleNamespace(
        attributes=attributes or {},
        valid_until=valid_until,
        is_demo_seed=is_demo_seed,
    )


class TargetImportKeyTests(unittest.TestCase):
    """The importer finds a moved certificate only if its key names the new certifier."""

    def test_rewrites_the_source_slug_suffix(self) -> None:
        """A seed key ending in the merged-away slug is repointed at the target."""
        self.assertEqual(
            _target_import_key("seed:some-dedupe-key:rabbanut_bnei_brak"),
            "seed:some-dedupe-key:landa_bnei_brak",
        )

    def test_leaves_other_certifiers_alone(self) -> None:
        """Keys belonging to an unrelated certifier are returned untouched."""
        key = "seed:some-dedupe-key:badatz_eda_haredit"
        self.assertEqual(_target_import_key(key), key)

    def test_only_the_suffix_is_rewritten(self) -> None:
        """The slug appearing inside the dedupe key is not a suffix and must not move."""
        key = "seed:rabbanut_bnei_brak-cafe:badatz_eda_haredit"
        self.assertEqual(_target_import_key(key), key)

    def test_passes_through_a_non_seed_certificate(self) -> None:
        """A certificate with no import key has nothing to rewrite."""
        self.assertIsNone(_target_import_key(None))


class FactsLostTests(unittest.TestCase):
    """Deleting a duplicate must never drop evidence the survivor does not hold."""

    def test_two_empty_seed_rows_lose_nothing(self) -> None:
        """The real merge case: both rows are bare corpus entries."""
        self.assertEqual(_facts_lost(_certificate(), _certificate()), {})

    def test_attribute_absent_from_the_survivor_is_lost(self) -> None:
        """An attribute the survivor never mentions would vanish with the deletion."""
        lost = _facts_lost(
            _certificate({"glatt": True, "pas_yisrael": True}),
            _certificate({"glatt": True}),
        )
        self.assertEqual(lost, {"attributes": {"pas_yisrael": True}})

    def test_a_disagreeing_attribute_is_not_reported_as_lost(self) -> None:
        """The survivor states the fact; the merge does not adjudicate which is right."""
        lost = _facts_lost(_certificate({"glatt": True}), _certificate({"glatt": False}))
        self.assertEqual(lost, {})

    def test_expiry_known_only_to_the_deleted_row_is_lost(self) -> None:
        """An expiry date is what auto-degrades a stale certificate; losing it is unsafe."""
        lost = _facts_lost(
            _certificate(valid_until=dt.date(2027, 6, 1)),
            _certificate(),
        )
        self.assertEqual(lost, {"valid_until": "2027-06-01"})

    def test_expiry_already_on_the_survivor_is_not_lost(self) -> None:
        """The survivor carries its own expiry, so nothing goes missing."""
        lost = _facts_lost(
            _certificate(valid_until=dt.date(2027, 6, 1)),
            _certificate(valid_until=dt.date(2027, 1, 1)),
        )
        self.assertEqual(lost, {})

    def test_demo_seed_marker_is_lost(self) -> None:
        """Demo rows are addressed by fixed id elsewhere; deleting one breaks the demo."""
        lost = _facts_lost(_certificate(is_demo_seed=True), _certificate())
        self.assertEqual(lost, {"is_demo_seed": True})


if __name__ == "__main__":
    unittest.main()
