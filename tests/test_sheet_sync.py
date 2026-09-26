"""Tests for `app.ingestion.sheet_sync`.

Pure logic (hashing, tokens, link building, summary formatting) is exercised with
`unittest.TestCase`, per STANDARDS. `propose`/`apply_proposal`/`write_proposal_
snapshot` need a database, so — matching `tests/test_seed_import.py`'s own
convention — those run against the SQLite-backed `session` fixture from
`tests/conftest.py`, over the real seed corpus (skipped if it is not present).
"""

from __future__ import annotations

import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

from app.ingestion.seed_import import DEFAULT_CSV_PATH, SeedImportStats
from app.ingestion.seed_prune import PruneStats
from app.ingestion.sheet_sync import (
    SheetSyncError,
    apply_proposal,
    build_confirm_link,
    build_summary_text,
    fetch_and_write_sheet,
    generate_token,
    hash_text,
    is_no_op,
    propose,
    tokens_match,
    write_proposal_snapshot,
)
from app.ingestion.sheet_sync_consts import MAX_NAMES_LISTED
from app.models import SheetSyncProposal, SheetSyncProposalStatus

pytestmark = pytest.mark.skipif(
    not DEFAULT_CSV_PATH.exists(), reason="seed corpus not present"
)


def _stats(**overrides) -> SeedImportStats:
    stats = SeedImportStats()
    for key, value in overrides.items():
        setattr(stats, key, value)

    return stats


class HashAndTokenTests(unittest.TestCase):
    def test_hash_is_deterministic(self) -> None:
        self.assertEqual(hash_text("abc"), hash_text("abc"))

    def test_hash_differs_for_different_input(self) -> None:
        self.assertNotEqual(hash_text("abc"), hash_text("abd"))

    def test_generated_tokens_are_unique_and_urlsafe(self) -> None:
        first, second = generate_token(), generate_token()

        self.assertNotEqual(first, second)
        self.assertTrue(len(first) > 20)

    def test_tokens_match_true_for_the_right_token(self) -> None:
        token = generate_token()

        self.assertTrue(tokens_match(token, hash_text(token)))

    def test_tokens_match_false_for_the_wrong_token(self) -> None:
        self.assertFalse(tokens_match("wrong-token", hash_text("right-token")))


class BuildConfirmLinkTests(unittest.TestCase):
    def test_builds_the_expected_shape(self) -> None:
        proposal_id = uuid.uuid4()

        link = build_confirm_link("https://api.example.com", proposal_id, "tok123")

        self.assertEqual(link, f"https://api.example.com/sync/proposals/{proposal_id}?t=tok123")

    def test_trailing_slash_on_origin_is_stripped(self) -> None:
        proposal_id = uuid.uuid4()

        link = build_confirm_link("https://api.example.com/", proposal_id, "tok")

        self.assertNotIn("//sync", link)


class IsNoOpTests(unittest.TestCase):
    def test_all_zero_counts_is_a_no_op(self) -> None:
        self.assertTrue(is_no_op(_stats()))

    def test_a_created_restaurant_is_not_a_no_op(self) -> None:
        self.assertFalse(is_no_op(_stats(restaurants_created=1)))

    def test_an_updated_certificate_is_not_a_no_op(self) -> None:
        self.assertFalse(is_no_op(_stats(certificates_updated=1)))

    def test_a_pruned_deletion_is_not_a_no_op(self) -> None:
        stats = _stats(prune=PruneStats(restaurants_deleted=1))

        self.assertFalse(is_no_op(stats))

    def test_prune_with_only_skips_is_still_a_no_op(self) -> None:
        stats = _stats(prune=PruneStats(prune_skipped=3))

        self.assertTrue(is_no_op(stats))


class BuildSummaryTextTests(unittest.TestCase):
    def test_no_op_summary_says_no_changes(self) -> None:
        summary = build_summary_text(_stats())

        self.assertIn("no changes", summary.lower())

    def test_reports_created_and_updated_counts(self) -> None:
        summary = build_summary_text(
            _stats(restaurants_created=3, restaurants_updated=2, certificates_created=4)
        )

        self.assertIn("+3", summary)
        self.assertIn("~2", summary)
        self.assertIn("+4", summary)

    def test_deleted_names_are_listed(self) -> None:
        prune = PruneStats(restaurants_deleted=2, deleted_restaurant_names=["Pizza A", "Falafel B"])
        summary = build_summary_text(_stats(restaurants_created=1, prune=prune))

        self.assertIn("Pizza A", summary)
        self.assertIn("Falafel B", summary)

    def test_long_name_lists_are_truncated_with_a_count(self) -> None:
        names = [f"Restaurant {i}" for i in range(MAX_NAMES_LISTED + 5)]
        prune = PruneStats(restaurants_deleted=len(names), deleted_restaurant_names=names)
        summary = build_summary_text(_stats(restaurants_created=1, prune=prune))

        self.assertIn("and 5 more", summary)
        self.assertNotIn(f"Restaurant {MAX_NAMES_LISTED + 4}", summary)

    def test_skipped_restaurants_are_listed_by_name(self) -> None:
        prune = PruneStats(
            prune_skipped=1, skipped_restaurants=[{"name": "Kept Place", "reason": "has photos"}]
        )
        summary = build_summary_text(_stats(restaurants_created=1, prune=prune))

        self.assertIn("Kept Place", summary)


class FetchAndWriteSheetTests(unittest.TestCase):
    def test_writes_the_fetched_csv_verbatim(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "out.csv"
            with patch(
                "app.ingestion.sheet_sync.fetch_sheet_csv", return_value="﻿a,b\r\n1,2\r\n"
            ) as mocked:
                fetch_and_write_sheet("{}", "sheet123", "Sheet1", csv_path)

            mocked.assert_called_once_with("{}", "sheet123", "Sheet1")
            with open(csv_path, encoding="utf-8-sig", newline="") as fh:
                self.assertEqual(fh.read(), "a,b\r\n1,2\r\n")


# --------------------------------------------------------------------- DB-backed


class _FakeSender:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def send(self, *, summary: str, link: str | None) -> None:
        self.calls.append({"summary": summary, "link": link})


def _modified_csv(tmp_path: Path) -> Path:
    """A second corpus snapshot, distinct from `DEFAULT_CSV_PATH`, by dropping the
    last data row — enough to change the hash and the dry-run diff.
    """
    lines = DEFAULT_CSV_PATH.read_text(encoding="utf-8-sig").splitlines(keepends=True)
    path = tmp_path / "modified.csv"
    path.write_text("﻿" + "".join(lines[:-1]), encoding="utf-8", newline="")

    return path


def _copy_corpus(tmp_path: Path) -> Path:
    path = tmp_path / "unchanged.csv"
    path.write_text(DEFAULT_CSV_PATH.read_text(encoding="utf-8-sig"), encoding="utf-8-sig")

    return path


def test_propose_creates_a_pending_proposal_and_sends_a_message(session, tmp_path):
    sender = _FakeSender()

    proposal = propose(
        session,
        csv_path=_copy_corpus(tmp_path),
        public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )

    assert proposal is not None
    assert proposal.status is SheetSyncProposalStatus.PENDING
    assert len(sender.calls) == 1
    assert "https://api.example.com/sync/proposals/" in sender.calls[0]["link"]


def test_propose_is_quiet_when_the_sheet_is_unchanged(session, tmp_path):
    sender = _FakeSender()
    csv_path = _copy_corpus(tmp_path)
    first = propose(
        session, csv_path=csv_path, public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )
    assert first is not None

    second = propose(
        session, csv_path=csv_path, public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )

    assert second is None
    assert len(sender.calls) == 1  # no second message sent


def test_propose_supersedes_the_previous_pending_proposal(session, tmp_path):
    sender = _FakeSender()
    first = propose(
        session, csv_path=_copy_corpus(tmp_path), public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )
    first_id = first.id

    second = propose(
        session, csv_path=_modified_csv(tmp_path), public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )

    assert second is not None
    assert second.id != first_id
    refreshed_first = session.get(SheetSyncProposal, first_id)
    assert refreshed_first.status is SheetSyncProposalStatus.SUPERSEDED


def test_write_proposal_snapshot_requires_approved_status(session, tmp_path):
    sender = _FakeSender()
    proposal = propose(
        session, csv_path=_copy_corpus(tmp_path), public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )

    with pytest.raises(SheetSyncError):
        write_proposal_snapshot(session, proposal.id, tmp_path / "out.csv")


def test_write_proposal_snapshot_writes_the_stored_text(session, tmp_path):
    sender = _FakeSender()
    proposal = propose(
        session, csv_path=_copy_corpus(tmp_path), public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )
    proposal.status = SheetSyncProposalStatus.APPROVED
    session.commit()

    out_path = tmp_path / "written.csv"
    write_proposal_snapshot(session, proposal.id, out_path)

    assert out_path.read_text(encoding="utf-8-sig") == proposal.csv_text.lstrip("﻿")


def test_apply_proposal_requires_approved_status(session, tmp_path):
    sender = _FakeSender()
    proposal = propose(
        session, csv_path=_copy_corpus(tmp_path), public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )

    with pytest.raises(SheetSyncError):
        apply_proposal(session, proposal.id, csv_path=DEFAULT_CSV_PATH, whatsapp_sender=sender)


def test_apply_proposal_success_marks_applied_and_notifies(session, tmp_path):
    sender = _FakeSender()
    csv_path = _copy_corpus(tmp_path)
    proposal = propose(
        session, csv_path=csv_path, public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )
    proposal.status = SheetSyncProposalStatus.APPROVED
    session.commit()

    applied = apply_proposal(session, proposal.id, csv_path=csv_path, whatsapp_sender=sender)

    assert applied.status is SheetSyncProposalStatus.APPLIED
    assert applied.applied_at is not None
    assert len(sender.calls) == 2  # propose message + apply-result message


def test_apply_proposal_failure_marks_failed_and_notifies(session, tmp_path):
    sender = _FakeSender()
    csv_path = _copy_corpus(tmp_path)
    proposal = propose(
        session, csv_path=csv_path, public_api_origin="https://api.example.com",
        whatsapp_sender=sender,
    )
    proposal.status = SheetSyncProposalStatus.APPROVED
    session.commit()

    with patch("app.ingestion.sheet_sync.import_seed", side_effect=RuntimeError("boom")):
        result = apply_proposal(session, proposal.id, csv_path=csv_path, whatsapp_sender=sender)

    assert result.status is SheetSyncProposalStatus.FAILED
    assert "boom" in result.result_text
    assert len(sender.calls) == 2


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
