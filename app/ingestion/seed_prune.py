"""Hard-delete pass for `kashroot seed-import --prune`.

The seed importer (`app.ingestion.seed_import`) is upsert-only: a restaurant or
certificate dropped from the corpus is simply left in the database forever. That is
the safe default, but the corpus is sometimes rebuilt from scratch and the product
decision is then to make the database match the file exactly — including removing
rows the old corpus put there and the new one no longer lists.

This module is the deliberate exception to "ingestion never deletes": it hard-deletes,
but only data this pipeline itself is sure it owns.

**The seed-origin rule** — a restaurant is only ever deleted here when *every one* of
the following holds:

* every certificate it carries (if any) has an ``import_key`` starting ``seed:`` —
  a manually created or API-created certificate blocks deletion;
* it carries at least one certificate — a restaurant with none was never established
  by this pipeline, so pruning has no basis to claim it as seed-origin;
* none of its certificates carry evidence photos, and none are referenced by a
  community flag — either means a moderator has since put real work into that
  certificate;
* it has no restaurant photos, no opening-hours rows, no community flags, no owner
  claims and appears on no saved list — every one of those is created outside this
  pipeline (owner portal, moderation console, the app itself).

Any restaurant failing one of these checks is left untouched and reported as
*skipped*, never deleted, even when it is not in the new CSV. A certificate dropped
from the corpus but attached to a restaurant the CSV still lists is deleted on its
own by the same rule (no evidence photos, no flags) — the certifier simply stopped
certifying that restaurant.

Every deletion writes an ``AuditLog`` row first, snapshotting the fields lost, exactly
as the importer does for creates and updates (`AuditLog` is append-only: this module
only ever adds rows to it, never touches an existing one). ``AuditLog.entity_id`` is a
plain UUID column with no foreign key (see `app.models.moderation.AuditLog`), so a
row pointing at a since-deleted restaurant or certificate stays valid — that is by
design, not an oversight this module needs to work around.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AuditAction, AuditLog, Certificate, Flag, Restaurant, SavedListItem

#: Prefix every certificate this pipeline ever created carries in ``import_key``.
SEED_IMPORT_KEY_PREFIX = "seed:"

PRUNE_REASON_STALE = "not in current CSV run"

PRUNE_SKIP_NON_SEED_CERTIFICATE = "carries a certificate not created by seed import"
PRUNE_SKIP_NO_CERTIFICATE = "has no certificate — not established by seed import"
PRUNE_SKIP_EVIDENCE_PHOTO = "a certificate has moderator-reviewed evidence photos"
PRUNE_SKIP_CERTIFICATE_FLAG = "a certificate is referenced by a community flag"
PRUNE_SKIP_PHOTO = "has restaurant photos"
PRUNE_SKIP_HOURS = "has opening-hours rows"
PRUNE_SKIP_FLAG = "has community flags"
PRUNE_SKIP_OWNER_CLAIM = "has an owner claim"
PRUNE_SKIP_SAVED_LIST = "appears on a saved list"
PRUNE_SKIP_CERTIFICATE_PROTECTED = "certificate has moderator evidence/flags — kept"


@dataclass
class PruneStats:
    restaurants_deleted: int = 0
    certificates_deleted: int = 0
    #: Restaurants left untouched despite being stale, because they fail the
    #: seed-origin rule.
    prune_skipped: int = 0
    #: Stale certificates left untouched (restaurant kept) because moderator work is
    #: attached to them; counted apart from ``prune_skipped`` since no restaurant is
    #: at stake for these.
    certificates_protected: int = 0
    deleted_restaurant_names: list[str] = field(default_factory=list)
    #: {"name": ..., "reason": ...} per skipped restaurant, for the dry-run review.
    skipped_restaurants: list[dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _jsonable(value: Any) -> Any:
    """Snapshot values for the audit log's JSONB ``changes`` column."""
    if isinstance(value, dt.date | dt.datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, StrEnum):
        return value.value
    return value


def _is_seed_certificate(certificate: Certificate) -> bool:
    """
    Whether a certificate was created by the seed pipeline and never repointed.

    Parameters:
        certificate (Certificate): The certificate to classify.

    Return:
        bool: True when ``import_key`` carries the seed prefix.
    """
    return bool(certificate.import_key) and certificate.import_key.startswith(
        SEED_IMPORT_KEY_PREFIX
    )


def _certificate_has_flags(session: Session, certificate_id: uuid.UUID) -> bool:
    """
    Whether any community flag references this certificate.

    Parameters:
        session (Session): The active database session.
        certificate_id (uuid.UUID): The certificate to check.

    Return:
        bool: True when at least one ``Flag`` row points at it.
    """
    count = session.scalar(
        select(func.count()).select_from(Flag).where(Flag.certificate_id == certificate_id)
    )

    return bool(count)


def _restaurant_on_a_saved_list(session: Session, restaurant_id: uuid.UUID) -> bool:
    """
    Whether any user has saved this restaurant to a list.

    Parameters:
        session (Session): The active database session.
        restaurant_id (uuid.UUID): The restaurant to check.

    Return:
        bool: True when at least one ``SavedListItem`` row points at it.
    """
    count = session.scalar(
        select(func.count())
        .select_from(SavedListItem)
        .where(SavedListItem.restaurant_id == restaurant_id)
    )

    return bool(count)


def _restaurant_skip_reason(session: Session, restaurant: Restaurant) -> str | None:
    """
    Why a stale restaurant must be kept, or ``None`` when it is safe to delete.

    Parameters:
        session (Session): The active database session.
        restaurant (Restaurant): A restaurant whose ``dedupe_key`` is not in this run's
            CSV.

    Return:
        str | None: The first disqualifying reason found, or None if the restaurant
            passes every seed-origin check in this module's docstring.
    """
    certificates = restaurant.certificates
    if any(not _is_seed_certificate(c) for c in certificates):
        return PRUNE_SKIP_NON_SEED_CERTIFICATE

    if not certificates:
        return PRUNE_SKIP_NO_CERTIFICATE

    if any(c.evidence_photos for c in certificates):
        return PRUNE_SKIP_EVIDENCE_PHOTO

    if any(_certificate_has_flags(session, c.id) for c in certificates):
        return PRUNE_SKIP_CERTIFICATE_FLAG

    if restaurant.photos:
        return PRUNE_SKIP_PHOTO

    if restaurant.hours:
        return PRUNE_SKIP_HOURS

    if restaurant.flags:
        return PRUNE_SKIP_FLAG

    if restaurant.owner_claims:
        return PRUNE_SKIP_OWNER_CLAIM

    if _restaurant_on_a_saved_list(session, restaurant.id):
        return PRUNE_SKIP_SAVED_LIST

    return None


def _certificate_snapshot(certificate: Certificate) -> dict[str, Any]:
    fields = (
        "restaurant_id",
        "certifier_id",
        "import_key",
        "level",
        "attributes",
        "state",
        "source",
        "source_document_id",
        "valid_from",
        "valid_until",
        "corroboration_count",
    )

    return {name: _jsonable(getattr(certificate, name)) for name in fields}


def _restaurant_snapshot(restaurant: Restaurant) -> dict[str, Any]:
    fields = (
        "dedupe_key",
        "name_he",
        "name_en",
        "address_he",
        "city_he",
        "city_slug",
        "phone",
        "record_state",
        "corroboration_count",
    )

    return {name: _jsonable(getattr(restaurant, name)) for name in fields}


def _audit_delete(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    snapshot: dict[str, Any],
    actor: str,
    run_id: Any,
) -> None:
    session.add(
        AuditLog(
            entity_type=entity_type,
            entity_id=entity_id,
            action=AuditAction.DELETE,
            changes={"before": snapshot, "after": None},
            actor=actor,
            evidence={"reason": PRUNE_REASON_STALE},
            ingestion_run_id=run_id,
        )
    )


def _delete_certificate(
    session: Session,
    certificate: Certificate,
    actor: str,
    run_id: Any,
    stats: PruneStats,
) -> None:
    """
    Audit and delete one certificate.

    Parameters:
        session (Session): The active database session.
        certificate (Certificate): The certificate being removed.
        actor (str): Audit actor label.
        run_id (Any): The owning ``IngestionRun`` id.
        stats (PruneStats): Counters to update.
    """
    _audit_delete(
        session,
        "certificate",
        certificate.id,
        _certificate_snapshot(certificate),
        actor,
        run_id,
    )
    session.delete(certificate)
    stats.certificates_deleted += 1


def _delete_restaurant(
    session: Session,
    restaurant: Restaurant,
    actor: str,
    run_id: Any,
    stats: PruneStats,
) -> None:
    """
    Audit and delete one restaurant along with every certificate it still carries.

    Parameters:
        session (Session): The active database session.
        restaurant (Restaurant): The restaurant being removed. Every certificate on it
            has already passed the seed-origin checks by the time this is called.
        actor (str): Audit actor label.
        run_id (Any): The owning ``IngestionRun`` id.
        stats (PruneStats): Counters to update.
    """
    for certificate in list(restaurant.certificates):
        _delete_certificate(session, certificate, actor, run_id, stats)

    _audit_delete(
        session,
        "restaurant",
        restaurant.id,
        _restaurant_snapshot(restaurant),
        actor,
        run_id,
    )
    stats.deleted_restaurant_names.append(restaurant.name_he)
    session.delete(restaurant)
    stats.restaurants_deleted += 1


def _prune_dropped_certificates(
    session: Session,
    csv_dedupe_keys: set[str],
    csv_import_keys: set[str],
    actor: str,
    run_id: Any,
    stats: PruneStats,
) -> None:
    """Delete certificates dropped by this run from a restaurant the CSV still lists
    (a certifier no longer certifies it). Restaurants absent from the CSV entirely are
    left to `_prune_stale_restaurants`, which reasons about the whole restaurant.
    """
    certificates = session.scalars(
        select(Certificate).where(Certificate.import_key.is_not(None))
    ).all()

    for certificate in certificates:
        if not _is_seed_certificate(certificate):
            continue
        if certificate.import_key in csv_import_keys:
            continue
        restaurant = certificate.restaurant
        if restaurant.dedupe_key not in csv_dedupe_keys:
            continue

        if certificate.evidence_photos or _certificate_has_flags(session, certificate.id):
            stats.certificates_protected += 1
            stats.skipped_restaurants.append(
                {"name": restaurant.name_he, "reason": PRUNE_SKIP_CERTIFICATE_PROTECTED}
            )
            continue

        _delete_certificate(session, certificate, actor, run_id, stats)

    session.flush()


def _prune_stale_restaurants(
    session: Session,
    csv_dedupe_keys: set[str],
    actor: str,
    run_id: Any,
    stats: PruneStats,
) -> None:
    """Delete restaurants whose ``dedupe_key`` this run's CSV never produced, but only
    the ones the seed-origin rule clears — see the module docstring.
    """
    restaurants = session.scalars(select(Restaurant)).all()

    for restaurant in restaurants:
        if restaurant.dedupe_key in csv_dedupe_keys:
            continue

        reason = _restaurant_skip_reason(session, restaurant)
        if reason is not None:
            stats.prune_skipped += 1
            stats.skipped_restaurants.append({"name": restaurant.name_he, "reason": reason})
            continue

        _delete_restaurant(session, restaurant, actor, run_id, stats)

    session.flush()


def prune_seed_data(
    session: Session,
    csv_dedupe_keys: set[str],
    csv_import_keys: set[str],
    actor: str,
    run_id: Any,
) -> PruneStats:
    """
    Hard-delete seed-origin certificates and restaurants this CSV run no longer names.

    Parameters:
        session (Session): The active database session (same one the upsert pass ran
            in — deletions land in the same transaction, so ``--dry-run`` rolls them
            back exactly like every other write this pipeline makes).
        csv_dedupe_keys (set[str]): Every restaurant ``dedupe_key`` this run's CSV
            produced.
        csv_import_keys (set[str]): Every certificate ``import_key`` this run's CSV
            produced.
        actor (str): Audit actor label (the CLI's ``--actor``).
        run_id (Any): The ``IngestionRun`` id this prune pass belongs to.

    Return:
        PruneStats: Counts and names for the CLI to report.
    """
    stats = PruneStats()
    _prune_dropped_certificates(session, csv_dedupe_keys, csv_import_keys, actor, run_id, stats)
    _prune_stale_restaurants(session, csv_dedupe_keys, actor, run_id, stats)

    return stats
