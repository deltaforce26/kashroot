"""Reconcile an already-populated database to the Landa restaurants refresh (Elul 5786).

``seed_import`` carries most of this refresh on its own: it upserts restaurants on
``dedupe_key`` and certificates on ``import_key``, so re-importing the rebuilt corpus
updates phones, business types, corroboration counts and list dates in place, and the
one delisted record (``מאמה מיה בטיילת``) degrades to a PENDING certificate because its
corpus row now carries ``needs_review=TRUE``. None of that needs this script.

What the importer cannot do is a **rename**. ``dedupe_key`` is derived from the name, so
a business the newer list republishes under a changed name no longer matches its own
row: the importer takes it for a business it has never seen, creates a second restaurant
and a second certificate, and leaves the old pair behind — still ACTIVE, still serving a
verdict, from a name the certifier no longer publishes. The importer has no delete path
to clean that up, and Layer 1 precedence means the stale certificate can decide a MATCH.

So this script renames in place, before the import runs. The restaurant id is
deliberately preserved: saved lists, geocoding rows and
``scripts/seed_demo_attributes.py`` all address restaurants by id and would otherwise
lose them. Certificate ``import_key``s are rewritten to the key the importer will look
for next run, so the refresh lands on the existing certificate instead of forking one.

Refuses to run when a restaurant already exists under the new name: that means an import
already forked the record, and folding two restaurants that both hold certificates,
photos and saved-list entries is a merge decision, not a rename. It is surfaced rather
than guessed at.

Run ``python -m scripts.apply_landa_elul_refresh`` for a dry run (default; the
transaction is rolled back), or with ``--apply`` to commit.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.ingestion.normalize import restaurant_dedupe_key
from app.models import AuditAction, AuditLog, Certificate, Restaurant

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
RENAMES: dict[tuple[str, str, str], str] = {}

ERROR_ALREADY_FORKED = (
    "Refusing to rename {old!r} -> {new!r}: a restaurant already exists under the new "
    "name (dedupe_key {key!r}). An import has already forked this record; folding the "
    "two is a merge decision, not a rename. Resolve by hand before re-running."
)

REPORT_HEADER_DRY = f"{SOURCE_DOCUMENT_SLUG} rename reconciliation — DRY RUN (rolled back)"
REPORT_HEADER_APPLY = f"{SOURCE_DOCUMENT_SLUG} rename reconciliation — APPLIED"
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
    """

    renamed: list[tuple[str, str]] = field(default_factory=list)
    already_applied: list[str] = field(default_factory=list)
    absent: list[str] = field(default_factory=list)
    certificates_rekeyed: int = 0


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


def apply_refresh(session: Session, *, dry_run: bool = True) -> RefreshPlan:
    """
    Apply every published rename in the refresh, committing or rolling back as asked.

    ``dry_run=True`` performs every read and write against the session, reports what
    changed, then rolls it back — the same diff-review shape as
    ``app.ingestion.seed_import.import_seed``.

    Parameters:
        session (Session): Open database session.
        dry_run (bool): When True, roll the changes back instead of committing.

    Return:
        RefreshPlan: Everything that changed.
    """
    plan = RefreshPlan()
    for (old_name, city, address), new_name in RENAMES.items():
        _rename_one(session, old_name, city, address, new_name, plan)
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
    for name in plan.already_applied:
        print(f"    {name}")
    print(f"  not in database          {len(plan.absent)}")
    for name in plan.absent:
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
    parser.add_argument("--apply", action="store_true", help="Commit the renames.")
    args = parser.parse_args()

    with session_scope() as session:
        plan = apply_refresh(session, dry_run=not args.apply)
    _report(plan, applied=args.apply)


if __name__ == "__main__":
    main()
