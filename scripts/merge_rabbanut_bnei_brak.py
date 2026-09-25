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

Run ``python -m scripts.merge_rabbanut_bnei_brak`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.models import AuditAction, AuditLog, Certifier
from scripts.certifier_merge_lib import (
    AUDIT_REASON_KEY,
    ENTITY_CERTIFIER,
    MergePlan,
)
from scripts.certifier_merge_lib import assert_unwhitelisted as _assert_unwhitelisted
from scripts.certifier_merge_lib import (
    facts_lost as _facts_lost,  # noqa: F401  re-exported for tests
)
from scripts.certifier_merge_lib import merge_certificates as _merge_certificates_generic
from scripts.certifier_merge_lib import move_source_documents as _move_source_documents_generic
from scripts.certifier_merge_lib import target_import_key as _target_import_key_generic

SOURCE_SLUG = "rabbanut_bnei_brak"
TARGET_SLUG = "landa_bnei_brak"
MOVED_SOURCE_DOCUMENT_SLUG = "rabbanut_bb_kitchens_pdf"

MERGE_ACTOR = "merge:rabbanut_bnei_brak->landa_bnei_brak"
AUDIT_REASON_VALUE = "certifier_merge_aug_2026"

ERROR_MISSING_CERTIFIER = (
    "Certifier {slug!r} not found. Nothing to do, or the merge already ran — "
    "check `select slug from certifier`."
)

REPORT_HEADER_DRY = "merge rabbanut_bnei_brak -> landa_bnei_brak — DRY RUN (rolled back)"
REPORT_HEADER_APPLY = "merge rabbanut_bnei_brak -> landa_bnei_brak — APPLIED"
REPORT_NOT_WRITTEN = "\n  nothing written — re-run with --apply to commit"


def _target_import_key(import_key: str | None) -> str | None:
    """
    Rewrite a seed import key so it names the target certifier.

    Parameters:
        import_key (str | None): The existing key, or None for a non-seed certificate.

    Return:
        str | None: The rewritten key, or None when there was nothing to rewrite.
    """
    return _target_import_key_generic(import_key, SOURCE_SLUG, TARGET_SLUG)


def _merge_certificates(session: Session, source: Certifier, target: Certifier) -> MergePlan:
    """
    Move or delete every certificate attributed to the source certifier.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier being merged away.
        target (Certifier): The certifier receiving its certificates.

    Return:
        MergePlan: What was changed, for reporting.
    """
    return _merge_certificates_generic(
        session, source, target, actor=MERGE_ACTOR, reason_value=AUDIT_REASON_VALUE
    )


def _move_source_documents(session: Session, source: Certifier, target: Certifier) -> list[str]:
    """
    Reattribute the source certifier's published documents to the target.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier being merged away.
        target (Certifier): The certifier receiving its documents.

    Return:
        list[str]: Slugs of the documents that moved.
    """
    return _move_source_documents_generic(
        session, source, target, actor=MERGE_ACTOR, reason_value=AUDIT_REASON_VALUE
    )


def merge(session: Session, *, dry_run: bool = True) -> MergePlan:
    """
    Perform the whole merge, committing or rolling back as asked.

    ``dry_run=True`` performs every read and write against the session, reports what
    changed, then rolls it back — the same diff-review shape as
    ``app.ingestion.seed_import.import_seed``.

    Parameters:
        session (Session): Open database session.
        dry_run (bool): When True, roll the changes back instead of committing.

    Return:
        MergePlan: Everything that changed.
    """
    source = session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG))
    target = session.scalar(select(Certifier).where(Certifier.slug == TARGET_SLUG))
    if source is None:
        raise SystemExit(ERROR_MISSING_CERTIFIER.format(slug=SOURCE_SLUG))
    if target is None:
        raise SystemExit(ERROR_MISSING_CERTIFIER.format(slug=TARGET_SLUG))

    _assert_unwhitelisted(session, source)
    plan = _merge_certificates(session, source, target)
    plan.source_documents = _move_source_documents(session, source, target)
    session.flush()
    session.add(
        AuditLog(
            entity_type=ENTITY_CERTIFIER,
            entity_id=source.id,
            action=AuditAction.DELETE,
            changes={
                "before": {"slug": source.slug, "name_he": source.name_he},
                "after": None,
            },
            actor=MERGE_ACTOR,
            evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "merged_into": target.slug},
        )
    )
    session.delete(source)
    session.flush()

    if dry_run:
        session.rollback()
    else:
        session.commit()

    return plan


def _report(plan: MergePlan, applied: bool) -> None:
    """
    Print what the merge did, in the shape the other CLI tools use.

    Parameters:
        plan (MergePlan): The computed changes.
        applied (bool): Whether the transaction was committed.

    Return:
        None
    """
    print(REPORT_HEADER_APPLY if applied else REPORT_HEADER_DRY)
    print(f"  certificates rewritten   {len(plan.rewritten)}")
    print(f"  certificates deleted     {len(plan.deleted)}")
    print(f"  demo-seed rows preserved {plan.demo_seed_preserved}")
    print(f"  source documents moved   {len(plan.source_documents)}")
    for slug in plan.source_documents:
        print(f"    {slug}")
    if plan.deleted:
        print("  deleted as duplicates:")
        for _, name in plan.deleted:
            print(f"    {name}")
    if not applied:
        print(REPORT_NOT_WRITTEN)


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
    _report(plan, applied=args.apply)


if __name__ == "__main__":
    main()
