"""Merge the ``rabbanut_bnei_brak`` certifier into ``landa_bnei_brak`` (Aug 2026).

The product decision to fold the two was taken in the seed corpus, the importer
(``app/ingestion/seed_import.py``) and the demo run-sheet, but never carried out on an
already-populated database. This script performs it there, once, with an audit trail.

``seed_import`` cannot do this job. It is purely additive: it has no delete path and
keys certificates by ``import_key`` (``seed:{dedupe_key}:{certifier_slug}``), so a
re-import after the merge creates a fresh ``landa_bnei_brak`` row and leaves the
``rabbanut_bnei_brak`` one behind. The restaurant then carries two certificates from
two certifiers, one of which the product has decided does not exist — and Layer 1
precedence (MATCH > UNKNOWN > NO_MATCH across certificates) means that stale row can
still decide a verdict.

What this does, per certificate currently attributed to ``rabbanut_bnei_brak``:

* If the restaurant already holds a ``landa_bnei_brak`` certificate, the
  ``rabbanut_bnei_brak`` row is a duplicate of it and is DELETED. These are the rows
  whose corpus entry named both slugs.
* Otherwise the row is REWRITTEN in place: ``certifier_id`` moves to
  ``landa_bnei_brak`` and ``import_key`` is rewritten to the slug the importer will
  look for next run. The certificate id is deliberately preserved, because
  ``scripts/seed_demo_attributes.py`` addresses demo rows by fixed certificate id and
  would otherwise lose them.

The source document ``rabbanut_bb_kitchens_pdf`` is reattributed rather than renamed:
it really is the Bnei Brak rabbanut's published kitchens list, and provenance records
where a record came from, which the merge does not change. Only the certifier the
document is filed under moves.

The certifier row is removed last, once nothing references it.

Refuses to run if a duplicate about to be deleted carries kashrut facts (attributes,
an expiry date, or a demo-seed marker) that the surviving row does not. Deleting a
row that knows more than its survivor would lose evidence, which is the one thing this
codebase must never do quietly.

This is a thin wrapper over the generic pure-merge machinery in
``scripts/certifier_merge_lib.py`` (``run_merge``); see ``scripts/merge_certifier.py``
for the fully parametrised CLI this and ``scripts/merge_rav_landa_variant.py`` are
specialisations of.

Run ``python -m scripts.merge_rabbanut_bnei_brak`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.db.session import session_scope
from scripts.certifier_merge_lib import MergePlan
from scripts.certifier_merge_lib import (
    facts_lost as _facts_lost,  # noqa: F401  re-exported for tests
)
from scripts.certifier_merge_lib import format_merge_report as _format_merge_report
from scripts.certifier_merge_lib import run_merge as _run_merge
from scripts.certifier_merge_lib import target_import_key as _target_import_key_generic

SOURCE_SLUG = "rabbanut_bnei_brak"
TARGET_SLUG = "landa_bnei_brak"

MERGE_ACTOR = "merge:rabbanut_bnei_brak->landa_bnei_brak"
AUDIT_REASON_VALUE = "certifier_merge_aug_2026"


def _target_import_key(import_key: str | None) -> str | None:
    """
    Rewrite a seed import key so it names the target certifier.

    Parameters:
        import_key (str | None): The existing key, or None for a non-seed certificate.

    Return:
        str | None: The rewritten key, or None when there was nothing to rewrite.
    """
    return _target_import_key_generic(import_key, SOURCE_SLUG, TARGET_SLUG)


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
