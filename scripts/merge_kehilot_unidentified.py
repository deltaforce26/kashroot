"""Rename the placeholder certifier ``kehilot_unidentified`` to ``badatz_kehilot`` (Sep 2026).

The corpus label "קהילות" (misadot_mehadrin) was modeled as an unidentified certifier
because the source alone did not say who it was. On 2026-09-25 the product owner
identified it as Badatz Kehilot (Bnei Brak, est. 2009), corroborated by the certifier's
public restaurant listings — see the comment above ``badatz_kehilot`` in
``CERTIFIER_SEED`` (``app/ingestion/seed_import.py``). The corpus CSV now cites
``badatz_kehilot`` for the 4 affected rows (בציר, בון קפה in Bnei Brak; נויה, ריקוטה in
Jerusalem), all ``LIST_VERIFIED``.

Unlike ``scripts/merge_rabbanut_bnei_brak.py``, this is not folding two previously
distinct certifiers together — ``kehilot_unidentified`` and ``badatz_kehilot`` are the
same real-world certifier, one just unconfirmed. So the *normal* path here is a RENAME:
the existing certifier row is renamed in place (id preserved) rather than merged into a
separate row, which automatically keeps every foreign key that points at it — including
``profile_certifier_whitelist`` — pointed at the very same certifier. Each of its
certificates has its ``import_key`` rewritten from the old slug suffix to the new one, so
the next ``kashroot seed-import`` upserts onto them instead of forking duplicates.

This script does **not** touch ``Certificate.state`` or ``Restaurant.record_state``. The
corpus flip from ``UNKNOWN_PENDING_VERIFICATION``/``needs_review=TRUE`` to
``LIST_VERIFIED``/``FALSE`` is exactly the kind of field change ``seed_import``'s upsert
path already applies (and audit-logs) once the import key matches — mirroring
``scripts/merge_rabbanut_bnei_brak.py``, which likewise never touches certificate state.
Run ``kashroot seed-import --apply`` after this script to land that part of the refresh.

Fallback merge path: if ``badatz_kehilot`` already exists as its own certifier row — e.g.
because ``kashroot seed-import`` was run against the updated corpus before this script —
a rename would collide with a real row. In that case this behaves exactly like
``scripts/merge_rabbanut_bnei_brak.py``: the 4 certificates are moved onto the existing
``badatz_kehilot`` (deleted as duplicates if that restaurant already holds one, refusing
if the duplicate would lose evidence the survivor lacks), any whitelist of
``kehilot_unidentified`` refuses the run rather than being silently dropped, and the
now-empty ``kehilot_unidentified`` row is deleted last.

Run ``python -m scripts.merge_kehilot_unidentified`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.models import AuditAction, AuditLog, Certificate, Certifier, CertifierType
from scripts.certifier_merge_lib import (
    AUDIT_REASON_KEY,
    ENTITY_CERTIFICATE,
    ENTITY_CERTIFIER,
    MergePlan,
)
from scripts.certifier_merge_lib import assert_unwhitelisted as _assert_unwhitelisted
from scripts.certifier_merge_lib import merge_certificates as _merge_certificates
from scripts.certifier_merge_lib import move_source_documents as _move_source_documents
from scripts.certifier_merge_lib import target_import_key as _target_import_key

SOURCE_SLUG = "kehilot_unidentified"
TARGET_SLUG = "badatz_kehilot"
TARGET_NAME_HE = 'בד"ץ קהילות'
TARGET_NAME_EN = "Badatz Kehilot"
TARGET_TYPE = CertifierType.BADATZ

MERGE_ACTOR = "merge:kehilot_unidentified->badatz_kehilot"
AUDIT_REASON_VALUE = "certifier_identified_badatz_kehilot_sep_2026"

MODE_RENAMED = "renamed"
MODE_MERGED = "merged"

ERROR_MISSING_SOURCE = (
    "Certifier {slug!r} not found. Nothing to do, or this already ran — "
    "check `select slug from certifier`."
)

REPORT_HEADER_DRY = "merge kehilot_unidentified -> badatz_kehilot — DRY RUN (rolled back)"
REPORT_HEADER_APPLY = "merge kehilot_unidentified -> badatz_kehilot — APPLIED"
REPORT_NOT_WRITTEN = "\n  nothing written — re-run with --apply to commit"
REPORT_NEXT_STEP = "  next: kashroot seed-import --apply, to land LIST_VERIFIED status"


@dataclass
class RenameOrMergePlan:
    """What this run did — either a rename of the source row, or a Landa-style merge.

    Attributes:
        mode (str): ``MODE_RENAMED`` or ``MODE_MERGED``.
        certificates_rewritten (list[tuple[str, str]]): ``(certificate_id,
            restaurant_name)`` pairs whose ``import_key`` was rewritten.
        merge (MergePlan | None): The full merge plan, only set when ``mode`` is
            ``MODE_MERGED``.
    """

    mode: str
    certificates_rewritten: list[tuple[str, str]] = field(default_factory=list)
    merge: MergePlan | None = None


def _rename_in_place(session: Session, source: Certifier) -> RenameOrMergePlan:
    """
    Rename the source certifier row to the target identity, preserving its id.

    Preserving the id is what keeps every foreign key — certificates' ``certifier_id``,
    ``profile_certifier_whitelist`` rows, ``source_document.certifier_id`` — pointed at
    the same certifier automatically; nothing else needs to change to follow the rename.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier row to rename in place.

    Return:
        RenameOrMergePlan: What was renamed and rewritten.
    """
    plan = RenameOrMergePlan(mode=MODE_RENAMED)

    session.add(
        AuditLog(
            entity_type=ENTITY_CERTIFIER,
            entity_id=source.id,
            action=AuditAction.UPDATE,
            changes={
                "slug": {"before": source.slug, "after": TARGET_SLUG},
                "name_he": {"before": source.name_he, "after": TARGET_NAME_HE},
                "name_en": {"before": source.name_en, "after": TARGET_NAME_EN},
                "type": {"before": source.type.value, "after": TARGET_TYPE.value},
            },
            actor=MERGE_ACTOR,
            evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE},
        )
    )
    old_slug = source.slug
    source.slug = TARGET_SLUG
    source.name_he = TARGET_NAME_HE
    source.name_en = TARGET_NAME_EN
    source.type = TARGET_TYPE

    certificates = session.scalars(
        select(Certificate).where(Certificate.certifier_id == source.id)
    ).all()
    for certificate in certificates:
        rewritten = _target_import_key(certificate.import_key, old_slug, TARGET_SLUG)
        if rewritten == certificate.import_key:
            continue
        session.add(
            AuditLog(
                entity_type=ENTITY_CERTIFICATE,
                entity_id=certificate.id,
                action=AuditAction.UPDATE,
                changes={"import_key": {"before": certificate.import_key, "after": rewritten}},
                actor=MERGE_ACTOR,
                evidence={
                    AUDIT_REASON_KEY: AUDIT_REASON_VALUE,
                    "restaurant": certificate.restaurant.name_he,
                },
            )
        )
        certificate.import_key = rewritten
        plan.certificates_rewritten.append((str(certificate.id), certificate.restaurant.name_he))

    return plan


def _merge_into_existing_target(
    session: Session, source: Certifier, target: Certifier
) -> RenameOrMergePlan:
    """
    Fall back to a Landa-style merge when ``badatz_kehilot`` already exists as its own row.

    Parameters:
        session (Session): Open database session.
        source (Certifier): ``kehilot_unidentified``, being merged away.
        target (Certifier): The pre-existing ``badatz_kehilot`` row.

    Return:
        RenameOrMergePlan: The underlying merge plan, wrapped for a uniform report.
    """
    _assert_unwhitelisted(session, source)
    merge_plan = _merge_certificates(
        session, source, target, actor=MERGE_ACTOR, reason_value=AUDIT_REASON_VALUE
    )
    merge_plan.source_documents = _move_source_documents(
        session, source, target, actor=MERGE_ACTOR, reason_value=AUDIT_REASON_VALUE
    )
    session.flush()
    session.add(
        AuditLog(
            entity_type=ENTITY_CERTIFIER,
            entity_id=source.id,
            action=AuditAction.DELETE,
            changes={"before": {"slug": source.slug, "name_he": source.name_he}, "after": None},
            actor=MERGE_ACTOR,
            evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "merged_into": target.slug},
        )
    )
    session.delete(source)

    return RenameOrMergePlan(mode=MODE_MERGED, merge=merge_plan)


def merge_or_rename(session: Session, *, dry_run: bool = True) -> RenameOrMergePlan:
    """
    Rename ``kehilot_unidentified`` to ``badatz_kehilot``, or merge if it already exists.

    ``dry_run=True`` performs every read and write against the session, reports what
    changed, then rolls it back — the same diff-review shape as
    ``app.ingestion.seed_import.import_seed``.

    Parameters:
        session (Session): Open database session.
        dry_run (bool): When True, roll the changes back instead of committing.

    Return:
        RenameOrMergePlan: Everything that changed.
    """
    source = session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG))
    if source is None:
        raise SystemExit(ERROR_MISSING_SOURCE.format(slug=SOURCE_SLUG))

    target = session.scalar(select(Certifier).where(Certifier.slug == TARGET_SLUG))
    if target is None:
        plan = _rename_in_place(session, source)
    else:
        plan = _merge_into_existing_target(session, source, target)

    session.flush()
    if dry_run:
        session.rollback()
    else:
        session.commit()

    return plan


def _report(plan: RenameOrMergePlan, applied: bool) -> None:
    """
    Print what the run did, in the shape the other CLI tools use.

    Parameters:
        plan (RenameOrMergePlan): The computed changes.
        applied (bool): Whether the transaction was committed.

    Return:
        None
    """
    print(REPORT_HEADER_APPLY if applied else REPORT_HEADER_DRY)
    print(f"  mode                     {plan.mode}")
    if plan.mode == MODE_RENAMED:
        print(f"  certifier renamed        {SOURCE_SLUG} -> {TARGET_SLUG}")
        print(f"  certificates rewritten   {len(plan.certificates_rewritten)}")
        for _, name in plan.certificates_rewritten:
            print(f"    {name}")
    else:
        merge_plan = plan.merge
        print(f"  certificates rewritten   {len(merge_plan.rewritten)}")
        print(f"  certificates deleted     {len(merge_plan.deleted)}")
        print(f"  demo-seed rows preserved {merge_plan.demo_seed_preserved}")
        print(f"  source documents moved   {len(merge_plan.source_documents)}")
        if merge_plan.deleted:
            print("  deleted as duplicates:")
            for _, name in merge_plan.deleted:
                print(f"    {name}")
    if applied:
        print(REPORT_NEXT_STEP)
    else:
        print(REPORT_NOT_WRITTEN)


def main() -> None:
    """
    Entry point: dry run by default, ``--apply`` to commit.

    Return:
        None
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit the rename/merge.")
    args = parser.parse_args()

    with session_scope() as session:
        plan = merge_or_rename(session, dry_run=not args.apply)
    _report(plan, applied=args.apply)


if __name__ == "__main__":
    main()
