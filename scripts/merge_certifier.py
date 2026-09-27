"""Generic pure-merge CLI: fold one already-seeded certifier into another.

``scripts/certifier_merge_lib.py`` holds the machinery every one-off
``merge_<source>_<target>.py`` script leans on: the loss-safety check that refuses to
delete a duplicate certificate knowing more than its survivor, the import-key rewrite
so a subsequent ``kashroot seed-import`` upserts onto the surviving row instead of
forking a new one, the refusal to silently drop a whitelisted certifier, and the
certificate/source-document move itself.

This script is the fully parametrised entry point over that machinery, for the case
where BOTH ``--source`` and ``--target`` already exist as certifier rows — a genuine
merge of two previously-distinct certifiers, or a placeholder confirmed to be an
already-seeded certifier (see ``scripts/merge_rav_landa_variant.py``). It is not for
renaming an otherwise-unreferenced placeholder into a brand-new identity, where the
target does not yet exist — that path preserves the certifier's row (and therefore
every foreign key pointing at it) and belongs in a script like
``scripts/merge_kehilot_unidentified.py``.

``scripts/merge_rabbanut_bnei_brak.py`` is the same operation with its slugs, actor
and audit reason hardcoded as a dedicated, documented script; this CLI is the same
underlying ``certifier_merge_lib.run_merge`` call for an ad-hoc merge that does not
warrant its own file. Because nothing here is hardcoded to a single product decision,
``--reason`` is required, so every ad-hoc merge still says on the record *why*.

Run ``python -m scripts.merge_certifier --source <slug> --target <slug> --reason
<why>`` for a dry run (default; the transaction is rolled back), or with ``--apply``
to commit.
"""

from __future__ import annotations

import argparse

from app.db.session import session_scope
from scripts.certifier_merge_lib import format_merge_report, run_merge

ACTOR_TEMPLATE = "merge:{source}->{target}"


def main() -> None:
    """
    Entry point: dry run by default, ``--apply`` to commit.

    Return:
        None
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Certifier slug being merged away.")
    parser.add_argument("--target", required=True, help="Certifier slug receiving the merge.")
    parser.add_argument(
        "--reason",
        required=True,
        help="Audit-log reason for this merge (e.g. 'confirmed same certifier, sep_2026').",
    )
    parser.add_argument(
        "--actor",
        default=None,
        help="Audit-log actor label. Defaults to 'merge:<source>-><target>'.",
    )
    parser.add_argument("--apply", action="store_true", help="Commit the merge.")
    args = parser.parse_args()

    actor = args.actor or ACTOR_TEMPLATE.format(source=args.source, target=args.target)

    with session_scope() as session:
        plan = run_merge(
            session,
            args.source,
            args.target,
            actor=actor,
            reason_value=args.reason,
            dry_run=not args.apply,
        )
    print(
        format_merge_report(
            plan, source_slug=args.source, target_slug=args.target, applied=args.apply
        )
    )


if __name__ == "__main__":
    main()
