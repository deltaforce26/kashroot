"""Reconcile an already-populated database to the Landa restaurants refresh (Elul 5786).

The Elul list is treated as the **complete** current record for ``landa_bnei_brak``, not
one category slice of it (product decision, Aug 2026, explicit instruction). Two things
follow that ``seed_import`` cannot do on its own, because it is purely additive and keys
restaurants on a name-derived ``dedupe_key``:

**Renames.** A business the newer list republishes under a changed name no longer matches
its own row: the importer takes it for a business it has never seen, creates a second
restaurant and certificate, and leaves the old pair behind — still ACTIVE, still serving
a verdict, from a name the certifier no longer publishes. So the rename is applied in
place first. The restaurant id is deliberately preserved: saved lists, geocoding rows and
``scripts/seed_demo_attributes.py`` all address restaurants by id and would otherwise
lose them.

**Deletions.** Every Landa-certified restaurant absent from the refreshed corpus is
removed. Where the restaurant holds certificates from other certifiers, only the Landa
certificate goes and the restaurant survives — this pass has no mandate to remove another
certifier's record. Where Landa was its only certifier, the restaurant itself is deleted,
and PostgreSQL cascades that to its certificates, photos, hours, flags, owner claims and
**saved-list entries**: users lose those saved restaurants.

This is a deliberate departure from the fail-safe default, which degrades an unconfirmed
record to UNKNOWN rather than removing it, so that a moderator can still see what the
earlier list said. Because the rows do not survive, every deletion is audit-logged with a
full before-snapshot — that log is the only remaining record inside the database that the
business was ever Landa-certified.

Refuses to delete a demo-seeded certificate unless ``--drop-demo-seed`` is passed: those
rows are pinned by fixed id in ``scripts/seed_demo_attributes.py`` and carry the verdicts
``DEMO_RUNSHEET.md`` walks through, so losing them silently would break the demo.

Run ``python -m scripts.apply_landa_elul_refresh`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.ingestion.normalize import (
    normalize_text,
    restaurant_dedupe_key,
    split_branch_addresses,
)
from app.ingestion.seed_import import DEFAULT_CSV_PATH, read_rows
from app.models import AuditAction, AuditLog, Certificate, Certifier, Restaurant

CERTIFIER_SLUG = "landa_bnei_brak"
SOURCE_DOCUMENT_SLUG = "landa_restaurants_elul_5786"

REFRESH_ACTOR = f"refresh:{SOURCE_DOCUMENT_SLUG}"
AUDIT_REASON_KEY = "reason"
AUDIT_REASON_VALUE = "landa_restaurants_refresh_elul_5786"

ENTITY_RESTAURANT = "restaurant"
ENTITY_CERTIFICATE = "certificate"

IMPORT_KEY_PREFIX = "seed:"

#: ``(old name, city, address) -> name on the refreshed list``. Mirrors ``RENAMED`` in
#: ``scripts/build_seed.py``, which collapses the same pair onto one corpus row; this is
#: the same rename applied to rows the corpus already put in the database.
RENAMES: dict[tuple[str, str, str], str] = {
    ("שאבעס ביג - מחלקת אוכל מוכן", "בני ברק", "בן יעקב 26"): (
        "שאבעס ביג - מחלקת אוכל מוכן פתוח"
    ),
}

ERROR_ALREADY_FORKED = (
    "Refusing to rename {old!r} -> {new!r}: a restaurant already exists under the new "
    "name (dedupe_key {key!r}). An import has already forked this record; folding the "
    "two is a merge decision, not a rename. Resolve by hand before re-running."
)
ERROR_DEMO_SEED = (
    "Refusing to delete {count} demo-seeded certificate(s): {names}. These are pinned by "
    "fixed id in scripts/seed_demo_attributes.py and carry the verdicts DEMO_RUNSHEET.md "
    "walks through. Re-run with --drop-demo-seed to remove them anyway, or re-point the "
    "demo slice at surviving certificates first."
)
ERROR_EMPTY_SURVIVORS = (
    "Refusing to run: the corpus at {path} lists no {slug!r} records at all. That would "
    "delete every Landa row in the database, which is far more likely a wrong or "
    "unbuilt corpus than an intended instruction. Rebuild with scripts/build_seed.py."
)

REPORT_HEADER_DRY = f"{SOURCE_DOCUMENT_SLUG} reconciliation — DRY RUN (rolled back)"
REPORT_HEADER_APPLY = f"{SOURCE_DOCUMENT_SLUG} reconciliation — APPLIED"
REPORT_NOT_WRITTEN = "\n  nothing written — re-run with --apply to commit"
REPORT_NEXT_STEP = "  next: kashroot seed-import --apply, to land the rest of the refresh"


@dataclass
class RefreshPlan:
    """What the reconciliation changed, computed as it goes, for reporting.

    Attributes:
        renamed (list[tuple[str, str]]): ``(old_name, new_name)`` pairs applied.
        already_applied (list[str]): New names already present, so nothing was done.
        absent (list[str]): Old names not in the database at all, so nothing was done.
        certificates_rekeyed (int): Certificates whose ``import_key`` was rewritten.
        restaurants_deleted (list[str]): Restaurants removed with their whole record.
        certificates_deleted (list[str]): Restaurants that kept their row but lost the
            Landa certificate, because another certifier also attests to them.
        demo_seed_deleted (int): Demo-seeded certificates removed under an override.
    """

    renamed: list[tuple[str, str]] = field(default_factory=list)
    already_applied: list[str] = field(default_factory=list)
    absent: list[str] = field(default_factory=list)
    certificates_rekeyed: int = 0
    restaurants_deleted: list[str] = field(default_factory=list)
    certificates_deleted: list[str] = field(default_factory=list)
    demo_seed_deleted: int = 0


def rekey_import_key(import_key: str | None, old_key: str, new_key: str) -> str | None:
    """
    Rewrite a seed import key so it names the restaurant's new dedupe key.

    Seed keys are ``seed:{dedupe_key}:{certifier_slug}``. The certifier suffix is left
    alone; only the embedded dedupe key moves, so the certificate stays attributed to
    the certifier that issued it.

    Parameters:
        import_key (str | None): The existing key, or None for a non-seed certificate.
        old_key (str): The dedupe key currently embedded in it.
        new_key (str): The dedupe key to embed instead.

    Return:
        str | None: The rewritten key, or the input unchanged when it is not a seed key
        for this restaurant.
    """
    if import_key is None:
        return None
    prefix = f"{IMPORT_KEY_PREFIX}{old_key}:"
    if not import_key.startswith(prefix):
        return import_key

    return f"{IMPORT_KEY_PREFIX}{new_key}:{import_key[len(prefix):]}"


def surviving_dedupe_keys(csv_path: Path) -> set[str]:
    """
    Read the dedupe keys of every certifier record the refreshed corpus still carries.

    Derived from the corpus rather than restated here so the two cannot drift: whatever
    ``scripts/build_seed.py`` kept is exactly what survives in the database. Branch rows
    are split the same way the importer splits them, or a multi-branch survivor would
    look absent and be deleted.

    Parameters:
        csv_path (Path): The seed corpus CSV.

    Return:
        set[str]: Dedupe keys of the certifier's surviving restaurants.
    """
    keys: set[str] = set()
    for row in read_rows(csv_path):
        if CERTIFIER_SLUG not in (row.get("certifier_ids") or ""):
            continue
        name = normalize_text(row.get("restaurant_name_he"))
        city = normalize_text(row.get("city_he"))
        for address in split_branch_addresses(row.get("address_he")):
            keys.add(restaurant_dedupe_key(name, city, address))

    return keys


def _certificate_snapshot(certificate: Certificate, restaurant: Restaurant) -> dict:
    """
    Capture what a certificate asserted, for the audit trail that outlives the row.

    Parameters:
        certificate (Certificate): The certificate about to be deleted.
        restaurant (Restaurant): The restaurant it belongs to.

    Return:
        dict: The fields worth keeping once the row itself is gone.
    """
    return {
        "restaurant": restaurant.name_he,
        "city": restaurant.city_he,
        "address": restaurant.address_he,
        "dedupe_key": restaurant.dedupe_key,
        "import_key": certificate.import_key,
        "state": certificate.state.value if certificate.state else None,
        "level": certificate.level.value if certificate.level else None,
        "attributes": dict(certificate.attributes or {}),
        "valid_from": certificate.valid_from.isoformat() if certificate.valid_from else None,
        "valid_until": certificate.valid_until.isoformat() if certificate.valid_until else None,
        "is_demo_seed": certificate.is_demo_seed,
    }


def _rename_one(
    session: Session, old_name: str, city: str, address: str, new_name: str, plan: RefreshPlan
) -> None:
    """
    Apply one published rename to the restaurant and its seed certificates.

    Parameters:
        session (Session): Open database session.
        old_name (str): Name the earlier list published.
        city (str): City as published, unchanged by the rename.
        address (str): Address as published, unchanged by the rename.
        new_name (str): Name the refreshed list publishes.
        plan (RefreshPlan): Accumulates what was done.

    Return:
        None
    """
    old_key = restaurant_dedupe_key(old_name, city, address)
    new_key = restaurant_dedupe_key(new_name, city, address)
    successor = session.scalar(select(Restaurant).where(Restaurant.dedupe_key == new_key))
    restaurant = session.scalar(select(Restaurant).where(Restaurant.dedupe_key == old_key))

    if restaurant is None:
        if successor is not None:
            plan.already_applied.append(new_name)
        else:
            plan.absent.append(old_name)

        return

    if successor is not None:
        raise SystemExit(ERROR_ALREADY_FORKED.format(old=old_name, new=new_name, key=new_key))

    session.add(
        AuditLog(
            entity_type=ENTITY_RESTAURANT,
            entity_id=restaurant.id,
            action=AuditAction.UPDATE,
            changes={
                "name_he": {"before": restaurant.name_he, "after": new_name},
                "dedupe_key": {"before": old_key, "after": new_key},
            },
            actor=REFRESH_ACTOR,
            evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "source": SOURCE_DOCUMENT_SLUG},
        )
    )
    restaurant.name_he = new_name
    restaurant.dedupe_key = new_key

    certificates = session.scalars(
        select(Certificate).where(Certificate.restaurant_id == restaurant.id)
    ).all()
    for certificate in certificates:
        rekeyed = rekey_import_key(certificate.import_key, old_key, new_key)
        if rekeyed == certificate.import_key:
            continue
        session.add(
            AuditLog(
                entity_type=ENTITY_CERTIFICATE,
                entity_id=certificate.id,
                action=AuditAction.UPDATE,
                changes={"import_key": {"before": certificate.import_key, "after": rekeyed}},
                actor=REFRESH_ACTOR,
                evidence={AUDIT_REASON_KEY: AUDIT_REASON_VALUE, "restaurant": new_name},
            )
        )
        certificate.import_key = rekeyed
        plan.certificates_rekeyed += 1

    plan.renamed.append((old_name, new_name))


def _superseded_certificates(session: Session, surviving: set[str]) -> list[Certificate]:
    """
    Find the certifier's certificates whose restaurant the refreshed corpus dropped.

    Parameters:
        session (Session): Open database session.
        surviving (set[str]): Dedupe keys the corpus still carries.

    Return:
        list[Certificate]: Certificates to remove.
    """
    certifier = session.scalar(select(Certifier).where(Certifier.slug == CERTIFIER_SLUG))
    if certifier is None:
        return []

    certificates = session.scalars(
        select(Certificate).where(Certificate.certifier_id == certifier.id)
    ).all()

    return [c for c in certificates if c.restaurant.dedupe_key not in surviving]


def _delete_superseded(
    session: Session, surviving: set[str], plan: RefreshPlan, *, drop_demo_seed: bool
) -> None:
    """
    Remove every certificate the refresh supersedes, and any restaurant left with none.

    Parameters:
        session (Session): Open database session.
        surviving (set[str]): Dedupe keys the corpus still carries.
        plan (RefreshPlan): Accumulates what was done.
        drop_demo_seed (bool): Allow deleting demo-seeded certificates.

    Return:
        None
    """
    doomed = _superseded_certificates(session, surviving)
    demo = [c for c in doomed if c.is_demo_seed]
    if demo and not drop_demo_seed:
        raise SystemExit(
            ERROR_DEMO_SEED.format(
                count=len(demo),
                names=", ".join(sorted(c.restaurant.name_he for c in demo)),
            )
        )

    for certificate in doomed:
        restaurant = certificate.restaurant
        snapshot = _certificate_snapshot(certificate, restaurant)
        others = [c for c in restaurant.certificates if c.id != certificate.id]
        session.add(
            AuditLog(
                entity_type=ENTITY_CERTIFICATE,
                entity_id=certificate.id,
                action=AuditAction.DELETE,
                changes={"before": snapshot, "after": None},
                actor=REFRESH_ACTOR,
                evidence={
                    AUDIT_REASON_KEY: AUDIT_REASON_VALUE,
                    "source": SOURCE_DOCUMENT_SLUG,
                    "superseded_by": "absent from the authoritative list",
                },
            )
        )
        if certificate.is_demo_seed:
            plan.demo_seed_deleted += 1

        if others:
            session.delete(certificate)
            plan.certificates_deleted.append(restaurant.name_he)
            continue

        session.add(
            AuditLog(
                entity_type=ENTITY_RESTAURANT,
                entity_id=restaurant.id,
                action=AuditAction.DELETE,
                changes={"before": snapshot, "after": None},
                actor=REFRESH_ACTOR,
                evidence={
                    AUDIT_REASON_KEY: AUDIT_REASON_VALUE,
                    "source": SOURCE_DOCUMENT_SLUG,
                    "cascade": "certificates, photos, hours, flags, claims, saved-list entries",
                },
            )
        )
        session.delete(restaurant)
        plan.restaurants_deleted.append(restaurant.name_he)


def apply_refresh(
    session: Session,
    csv_path: Path = DEFAULT_CSV_PATH,
    *,
    dry_run: bool = True,
    drop_demo_seed: bool = False,
) -> RefreshPlan:
    """
    Rename, then delete, so the database matches the refreshed corpus for this certifier.

    Renames run first: a record renamed and then looked up under its old name would be
    read as absent and deleted.

    ``dry_run=True`` performs every read and write against the session, reports what
    changed, then rolls it back — the same diff-review shape as
    ``app.ingestion.seed_import.import_seed``.

    Parameters:
        session (Session): Open database session.
        csv_path (Path): The refreshed seed corpus, which defines what survives.
        dry_run (bool): When True, roll the changes back instead of committing.
        drop_demo_seed (bool): Allow deleting demo-seeded certificates.

    Return:
        RefreshPlan: Everything that changed.
    """
    surviving = surviving_dedupe_keys(csv_path)
    if not surviving:
        raise SystemExit(ERROR_EMPTY_SURVIVORS.format(path=csv_path, slug=CERTIFIER_SLUG))

    plan = RefreshPlan()
    for (old_name, city, address), new_name in RENAMES.items():
        _rename_one(session, old_name, city, address, new_name, plan)
    session.flush()

    _delete_superseded(session, surviving, plan, drop_demo_seed=drop_demo_seed)
    session.flush()

    if dry_run:
        session.rollback()
    else:
        session.commit()

    return plan


def _report(plan: RefreshPlan, applied: bool) -> None:
    """
    Print what the reconciliation did, in the shape the other CLI tools use.

    Parameters:
        plan (RefreshPlan): The computed changes.
        applied (bool): Whether the transaction was committed.

    Return:
        None
    """
    print(REPORT_HEADER_APPLY if applied else REPORT_HEADER_DRY)
    print(f"  restaurants renamed      {len(plan.renamed)}")
    for old_name, new_name in plan.renamed:
        print(f"    {old_name} -> {new_name}")
    print(f"  certificates re-keyed    {plan.certificates_rekeyed}")
    print(f"  already applied          {len(plan.already_applied)}")
    print(f"  not in database          {len(plan.absent)}")
    print(f"  restaurants DELETED      {len(plan.restaurants_deleted)}")
    for name in sorted(plan.restaurants_deleted):
        print(f"    {name}")
    print(f"  certificates DELETED     {len(plan.certificates_deleted)}")
    for name in sorted(plan.certificates_deleted):
        print(f"    {name} (restaurant kept — another certifier attests)")
    if plan.demo_seed_deleted:
        print(f"  demo-seed rows DESTROYED {plan.demo_seed_deleted} — DEMO_RUNSHEET.md is affected")
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
    parser.add_argument("--apply", action="store_true", help="Commit the reconciliation.")
    parser.add_argument(
        "--csv", type=Path, default=DEFAULT_CSV_PATH, help="Refreshed seed corpus."
    )
    parser.add_argument(
        "--drop-demo-seed",
        action="store_true",
        help="Allow deleting demo-seeded certificates (breaks DEMO_RUNSHEET.md).",
    )
    args = parser.parse_args()

    with session_scope() as session:
        plan = apply_refresh(
            session,
            args.csv,
            dry_run=not args.apply,
            drop_demo_seed=args.drop_demo_seed,
        )
    _report(plan, applied=args.apply)


if __name__ == "__main__":
    main()
