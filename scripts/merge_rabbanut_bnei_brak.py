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
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    Certifier,
    ProfileCertifierWhitelist,
    SourceDocument,
)

SOURCE_SLUG = "rabbanut_bnei_brak"
TARGET_SLUG = "landa_bnei_brak"
MOVED_SOURCE_DOCUMENT_SLUG = "rabbanut_bb_kitchens_pdf"

IMPORT_KEY_SUFFIX_SOURCE = f":{SOURCE_SLUG}"
IMPORT_KEY_SUFFIX_TARGET = f":{TARGET_SLUG}"

MERGE_ACTOR = "merge:rabbanut_bnei_brak->landa_bnei_brak"
AUDIT_REASON_KEY = "reason"
AUDIT_REASON_VALUE = "certifier_merge_aug_2026"

ENTITY_CERTIFICATE = "certificate"
ENTITY_CERTIFIER = "certifier"
ENTITY_SOURCE_DOCUMENT = "source_document"

ERROR_MISSING_CERTIFIER = (
    "Certifier {slug!r} not found. Nothing to do, or the merge already ran — "
    "check `select slug from certifier`."
)
ERROR_LOSSY_DELETE = (
    "Refusing to merge: certificate {loser} (restaurant {restaurant}) would be "
    "deleted as a duplicate, but it carries facts the surviving certificate "
    "{winner} does not: {facts}. Resolve by hand before re-running."
)
ERROR_WHITELISTED = (
    "Refusing to merge: {count} user profile(s) whitelist {slug!r}. Those rows must "
    "be repointed or removed first, or a user silently loses a certifier they chose."
)

REPORT_HEADER_DRY = "merge rabbanut_bnei_brak -> landa_bnei_brak — DRY RUN (rolled back)"
REPORT_HEADER_APPLY = "merge rabbanut_bnei_brak -> landa_bnei_brak — APPLIED"
REPORT_NOT_WRITTEN = "\n  nothing written — re-run with --apply to commit"


@dataclass
class MergePlan:
    """The full set of changes the merge will make, computed before anything is written.

    Attributes:
        rewritten (list[tuple[str, str]]): ``(certificate_id, restaurant_name)`` pairs
            whose certifier is moved in place.
        deleted (list[tuple[str, str]]): ``(certificate_id, restaurant_name)`` pairs
            removed as duplicates of an existing target-certifier certificate.
        source_documents (list[str]): slugs of source documents reattributed.
        demo_seed_preserved (int): how many rewritten rows carry demo-seeded facts.
    """

    rewritten: list[tuple[str, str]] = field(default_factory=list)
    deleted: list[tuple[str, str]] = field(default_factory=list)
    source_documents: list[str] = field(default_factory=list)
    demo_seed_preserved: int = 0


def _certificate_facts(certificate: Certificate) -> dict[str, Any]:
    """
    Summarise the kashrut-bearing fields of a certificate, for loss comparison.

    Parameters:
        certificate (Certificate): The certificate to summarise.

    Return:
        dict[str, Any]: The fields whose loss would lose evidence.
    """
    return {
        "attributes": dict(certificate.attributes or {}),
        "valid_until": certificate.valid_until.isoformat() if certificate.valid_until else None,
        "is_demo_seed": certificate.is_demo_seed,
        "state": certificate.state.value,
    }


def _facts_lost(loser: Certificate, winner: Certificate) -> dict[str, Any]:
    """
    Report kashrut facts held by a certificate about to be deleted but not by its survivor.

    An empty result means the deletion is information-preserving.

    Parameters:
        loser (Certificate): The certificate that would be deleted.
        winner (Certificate): The certificate that would survive.

    Return:
        dict[str, Any]: The facts that would be lost, empty when nothing would be.
    """
    lost: dict[str, Any] = {}
    loser_attributes = dict(loser.attributes or {})
    winner_attributes = dict(winner.attributes or {})
    missing = {
        key: value for key, value in loser_attributes.items() if key not in winner_attributes
    }
    if missing:
        lost["attributes"] = missing
    if loser.valid_until is not None and winner.valid_until is None:
        lost["valid_until"] = loser.valid_until.isoformat()
    if loser.is_demo_seed and not winner.is_demo_seed:
        lost["is_demo_seed"] = True

    return lost


def _target_import_key(import_key: str | None) -> str | None:
    """
    Rewrite a seed import key so it names the target certifier.

    Parameters:
        import_key (str | None): The existing key, or None for a non-seed certificate.

    Return:
        str | None: The rewritten key, or None when there was nothing to rewrite.
    """
    if import_key is None:
        return None
    if not import_key.endswith(IMPORT_KEY_SUFFIX_SOURCE):
        return import_key

    return import_key[: -len(IMPORT_KEY_SUFFIX_SOURCE)] + IMPORT_KEY_SUFFIX_TARGET


def _assert_unwhitelisted(session: Session, source: Certifier) -> None:
    """
    Fail if any user profile whitelists the certifier being removed.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier about to be deleted.

    Return:
        None
    """
    count = len(
        session.scalars(
            select(ProfileCertifierWhitelist).where(
                ProfileCertifierWhitelist.certifier_id == source.id
            )
        ).all()
    )
    if count:
        raise SystemExit(ERROR_WHITELISTED.format(count=count, slug=source.slug))


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
    plan = MergePlan()
    target_by_restaurant = {
        certificate.restaurant_id: certificate
        for certificate in session.scalars(
            select(Certificate).where(Certificate.certifier_id == target.id)
        )
    }
    moving = session.scalars(
        select(Certificate).where(Certificate.certifier_id == source.id)
    ).all()

    for certificate in moving:
        name = certificate.restaurant.name_he
        survivor = target_by_restaurant.get(certificate.restaurant_id)
        if survivor is not None:
            lost = _facts_lost(certificate, survivor)
            if lost:
                raise SystemExit(
                    ERROR_LOSSY_DELETE.format(
                        loser=certificate.id,
                        winner=survivor.id,
                        restaurant=name,
                        facts=lost,
                    )
                )
            session.add(
                AuditLog(
                    entity_type=ENTITY_CERTIFICATE,
                    entity_id=certificate.id,
                    action=AuditAction.DELETE,
                    changes={"before": _certificate_facts(certificate), "after": None},
                    actor=MERGE_ACTOR,
                    evidence={
                        AUDIT_REASON_KEY: AUDIT_REASON_VALUE,
                        "duplicate_of": str(survivor.id),
                        "restaurant": name,
                    },
                )
            )
            session.delete(certificate)
            plan.deleted.append((str(certificate.id), name))
            continue

        before = {"certifier": source.slug, "import_key": certificate.import_key}
        certificate.certifier_id = target.id
        certificate.import_key = _target_import_key(certificate.import_key)
        after = {"certifier": target.slug, "import_key": certificate.import_key}
        session.add(
            AuditLog(
                entity_type=ENTITY_CERTIFICATE,
                entity_id=certificate.id,
                action=AuditAction.UPDATE,
                changes={"before": before, "after": after},
                actor=MERGE_ACTOR,
                evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "restaurant": name},
            )
        )
        plan.rewritten.append((str(certificate.id), name))
        if certificate.is_demo_seed:
            plan.demo_seed_preserved += 1

    return plan


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
    moved: list[str] = []
    documents = session.scalars(
        select(SourceDocument).where(SourceDocument.certifier_id == source.id)
    ).all()
    for document in documents:
        session.add(
            AuditLog(
                entity_type=ENTITY_SOURCE_DOCUMENT,
                entity_id=document.id,
                action=AuditAction.UPDATE,
                changes={
                    "before": {"certifier": source.slug},
                    "after": {"certifier": target.slug},
                },
                actor=MERGE_ACTOR,
                evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "document": document.slug},
            )
        )
        document.certifier_id = target.id
        moved.append(document.slug)

    return moved


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
