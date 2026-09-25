"""Shared machinery for the one-off ``merge_<source>_<target>.py`` scripts.

``seed_import`` is purely additive: it keys certificates by
``import_key`` (``seed:{dedupe_key}:{certifier_slug}``) and never deletes or renames a
certifier. When the product folds two certifier slugs into one — a genuine merge of two
previously-distinct certifiers (``scripts/merge_rabbanut_bnei_brak.py``), or a rename of a
placeholder once its real identity is confirmed
(``scripts/merge_kehilot_unidentified.py``) — that has to be carried out by hand, once,
against an already-populated database, with an audit trail.

This module holds the parts of that job common to every such script: the loss-safety
check that refuses to delete a duplicate certificate knowing more than its survivor, the
import-key rewrite so a subsequent ``seed-import`` upserts onto the surviving row instead
of forking a new one, the refusal to silently drop a whitelisted certifier, and the
certificate/source-document move itself. Each script supplies only its own slugs, actor
label and audit reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    Certifier,
    ProfileCertifierWhitelist,
    SourceDocument,
)

ENTITY_CERTIFICATE = "certificate"
ENTITY_CERTIFIER = "certifier"
ENTITY_SOURCE_DOCUMENT = "source_document"

AUDIT_REASON_KEY = "reason"

ERROR_LOSSY_DELETE = (
    "Refusing to merge: certificate {loser} (restaurant {restaurant}) would be "
    "deleted as a duplicate, but it carries facts the surviving certificate "
    "{winner} does not: {facts}. Resolve by hand before re-running."
)
ERROR_WHITELISTED = (
    "Refusing to merge: {count} user profile(s) whitelist {slug!r}. Those rows must "
    "be repointed or removed first, or a user silently loses a certifier they chose."
)


@dataclass
class MergePlan:
    """The full set of certificate/document changes a merge makes.

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


def certificate_facts(certificate: Certificate) -> dict[str, Any]:
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


def facts_lost(loser: Certificate, winner: Certificate) -> dict[str, Any]:
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


def target_import_key(import_key: str | None, source_slug: str, target_slug: str) -> str | None:
    """
    Rewrite a seed import key so it names the target certifier.

    Parameters:
        import_key (str | None): The existing key, or None for a non-seed certificate.
        source_slug (str): The certifier slug being merged/renamed away.
        target_slug (str): The certifier slug the key should name instead.

    Return:
        str | None: The rewritten key, or None when there was nothing to rewrite.
    """
    if import_key is None:
        return None
    suffix = f":{source_slug}"
    if not import_key.endswith(suffix):
        return import_key

    return import_key[: -len(suffix)] + f":{target_slug}"


def assert_unwhitelisted(session: Session, source: Certifier) -> None:
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


def merge_certificates(
    session: Session,
    source: Certifier,
    target: Certifier,
    *,
    actor: str,
    reason_value: str,
) -> MergePlan:
    """
    Move or delete every certificate attributed to the source certifier.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier being merged away.
        target (Certifier): The certifier receiving its certificates.
        actor (str): Audit-log actor label for this script.
        reason_value (str): Audit-log ``reason`` evidence value for this script.

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
            lost = facts_lost(certificate, survivor)
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
                    changes={"before": certificate_facts(certificate), "after": None},
                    actor=actor,
                    evidence={
                        AUDIT_REASON_KEY: reason_value,
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
        certificate.import_key = target_import_key(certificate.import_key, source.slug, target.slug)
        after = {"certifier": target.slug, "import_key": certificate.import_key}
        session.add(
            AuditLog(
                entity_type=ENTITY_CERTIFICATE,
                entity_id=certificate.id,
                action=AuditAction.UPDATE,
                changes={"before": before, "after": after},
                actor=actor,
                evidence={AUDIT_REASON_KEY: reason_value, "restaurant": name},
            )
        )
        plan.rewritten.append((str(certificate.id), name))
        if certificate.is_demo_seed:
            plan.demo_seed_preserved += 1

    return plan


def move_source_documents(
    session: Session,
    source: Certifier,
    target: Certifier,
    *,
    actor: str,
    reason_value: str,
) -> list[str]:
    """
    Reattribute the source certifier's published documents to the target.

    Parameters:
        session (Session): Open database session.
        source (Certifier): The certifier being merged away.
        target (Certifier): The certifier receiving its documents.
        actor (str): Audit-log actor label for this script.
        reason_value (str): Audit-log ``reason`` evidence value for this script.

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
                actor=actor,
                evidence={AUDIT_REASON_KEY: reason_value, "document": document.slug},
            )
        )
        document.certifier_id = target.id
        moved.append(document.slug)

    return moved
