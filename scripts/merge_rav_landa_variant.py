"""Merge placeholder certifier ``rav_landa_variant_unverified`` into ``landa_bnei_brak`` (Sep 2026).

``rav_landa_variant_unverified`` was modeled as its own certifier — see the comment
above it in ``CERTIFIER_SEED`` (``app/ingestion/seed_import.py``) — because the source
carried a Landa-like label the corpus alone could not confirm was the same badatz;
every row under it carries ``needs_review=TRUE`` / ``UNKNOWN_PENDING_VERIFICATION``.
On the live database the product owner has now confirmed its 4 certificates belong to
the existing certifier ``landa_bnei_brak``.

Unlike ``scripts/merge_kehilot_unidentified.py``, ``landa_bnei_brak`` is not a slug
being newly identified — it already exists in the database with many certificates of
its own. So this is a pure MERGE (the Landa-collision path that script falls back to,
and the exact shape of ``scripts/merge_rabbanut_bnei_brak.py``), never a rename: the 4
certificates move onto the existing ``landa_bnei_brak`` row, deduped against any
``landa_bnei_brak`` certificate the same restaurant already holds (refusing if that
duplicate would lose evidence the survivor lacks), any source-document citations move
with them, any whitelist of the placeholder refuses the run rather than being silently
dropped, and the now-empty placeholder certifier row is deleted last.

This is a thin wrapper over ``scripts/certifier_merge_lib.run_merge`` — the same
underlying call ``scripts/merge_certifier.py --source rav_landa_variant_unverified
--target landa_bnei_brak`` makes — kept as its own documented, idempotent script
because the merge is a specific, one-time product decision worth a paper trail.

Run ``python -m scripts.merge_rav_landa_variant`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.db.session import session_scope
from scripts.certifier_merge_lib import MergePlan
from scripts.certifier_merge_lib import format_merge_report as _format_merge_report
from scripts.certifier_merge_lib import run_merge as _run_merge

SOURCE_SLUG = "rav_landa_variant_unverified"
TARGET_SLUG = "landa_bnei_brak"

MERGE_ACTOR = "merge:rav_landa_variant_unverified->landa_bnei_brak"
AUDIT_REASON_VALUE = "certifier_identified_landa_variant_sep_2026"


def merge(session: Session, *, dry_run: bool = True) -> MergePlan:
    """
    Perform the whole merge, committing or rolling back as asked.

    Parameters:
        session (Session): Open database session.
        dry_run (bool): When True, roll the changes back instead of committing.

    Return:
        MergePlan: Everything that changed.
    """
    return _run_merge(
        session,
        SOURCE_SLUG,
        TARGET_SLUG,
        actor=MERGE_ACTOR,
        reason_value=AUDIT_REASON_VALUE,
        dry_run=dry_run,
    )


def main() -> None:
    """
    Entry point: dry run by default, ``--apply`` to commit.

    Return:
        None
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit the merge.")
    args = parser.parse_args()

    with session_scope() as session:
        plan = merge(session, dry_run=not args.apply)
    print(
        _format_merge_report(
            plan, source_slug=SOURCE_SLUG, target_slug=TARGET_SLUG, applied=args.apply
        )
    )


if __name__ == "__main__":
    main()
