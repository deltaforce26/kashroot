"""Tests for the ``rav_landa_variant_unverified`` -> ``landa_bnei_brak`` merge.

Unlike ``kehilot_unidentified`` -> ``badatz_kehilot``, the target here already exists
in the database with certificates of its own, so this is always the pure-merge path
(no rename branch). These tests use the SQLite-backed ``session`` fixture from
conftest, the same shape ``tests/test_merge_kehilot_unidentified.py`` uses for its
merge-branch cases.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select

from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    ProfileCertifierWhitelist,
    RecordState,
    Restaurant,
    User,
    UserProfile,
)
from scripts.merge_rav_landa_variant import (
    AUDIT_REASON_VALUE,
    MERGE_ACTOR,
    SOURCE_SLUG,
    TARGET_SLUG,
    merge,
)


def _certifier(session, slug: str) -> Certifier:
    """
    Fetch or create a certifier row by slug.

    Parameters:
        session: Open database session.
        slug (str): The certifier slug to fetch or create.

    Return:
        Certifier: The stored row.
    """
    certifier = session.scalar(select(Certifier).where(Certifier.slug == slug))
    if certifier is not None:
        return certifier

    certifier = Certifier(slug=slug, name_he=slug, type=CertifierType.PRIVATE)
    session.add(certifier)
    session.flush()

    return certifier


def _certificate(
    session,
    certifier: Certifier,
    name: str,
    *,
    attributes: dict[str, bool] | None = None,
    valid_until: dt.date | None = None,
) -> tuple[Restaurant, Certificate]:
    """
    Create a restaurant and a single certificate attributed to the given certifier.

    Parameters:
        session: Open database session.
        certifier (Certifier): The certifier to attribute the certificate to.
        name (str): Restaurant name to store the row under.
        attributes (dict[str, bool] | None): Kashrut attributes on the certificate.
        valid_until (dt.date | None): Expiry date, if any.

    Return:
        tuple[Restaurant, Certificate]: The stored rows.
    """
    restaurant = Restaurant(
        dedupe_key=f"{name}|בני ברק|address",
        name_he=name,
        city_he="בני ברק",
        record_state=RecordState.UNKNOWN_PENDING_VERIFICATION,
        needs_review=True,
    )
    session.add(restaurant)
    session.flush()
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        import_key=f"seed:{restaurant.dedupe_key}:{certifier.slug}",
        level=CertificationLevel.UNKNOWN,
        state=CertificateState.PENDING,
        source=CertificateSource.OFFICIAL_LIST,
        attributes=attributes or {},
        valid_until=valid_until,
    )
    session.add(certificate)
    session.flush()

    return restaurant, certificate


def _seed_placeholder_with_target(
    session, restaurant_names: list[str]
) -> tuple[Certifier, Certifier, list[tuple[Restaurant, Certificate]]]:
    """
    Put the placeholder certifier, the pre-existing target and their certificates in the DB.

    Committed, not just flushed: a dry run rolls the transaction back, and the fixture
    stands in for a database that was already populated by an earlier import.

    Parameters:
        session: Open database session.
        restaurant_names (list[str]): One restaurant/certificate to create per name,
            all attributed to the placeholder certifier.

    Return:
        tuple[Certifier, Certifier, list[tuple[Restaurant, Certificate]]]: The source
            certifier, the target certifier, and the created (restaurant, certificate)
            pairs.
    """
    source = _certifier(session, SOURCE_SLUG)
    target = _certifier(session, TARGET_SLUG)
    rows = [_certificate(session, source, name) for name in restaurant_names]
    session.commit()

    return source, target, rows


def test_dry_run_makes_no_changes(session):
    """The default run reports the diff and rolls it back, like every other pipeline."""
    _seed_placeholder_with_target(session, ["בציר", "בון קפה", "נויה", "ריקוטה"])

    plan = merge(session, dry_run=True)

    assert len(plan.rewritten) == 4
    assert session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG)) is not None
    certificates = session.scalars(
        select(Certificate).join(Certifier).where(Certifier.slug == SOURCE_SLUG)
    ).all()
    assert len(certificates) == 4
    assert session.scalar(select(AuditLog)) is None


def test_apply_moves_all_four_certificates_and_deletes_placeholder(session):
    """The 4 certificates move onto landa_bnei_brak with rewritten import_keys."""
    source, target, rows = _seed_placeholder_with_target(
        session, ["בציר", "בון קפה", "נויה", "ריקוטה"]
    )
    certificate_ids = {str(certificate.id) for _, certificate in rows}

    plan = merge(session, dry_run=False)

    assert {cid for cid, _ in plan.rewritten} == certificate_ids
    assert session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG)) is None
    survivors = session.scalars(
        select(Certificate).where(Certificate.certifier_id == target.id)
    ).all()
    assert len(survivors) == 4
    for restaurant, _ in rows:
        survivor = next(c for c in survivors if c.restaurant_id == restaurant.id)
        assert survivor.import_key == f"seed:{restaurant.dedupe_key}:{TARGET_SLUG}"


def test_apply_dedupes_against_existing_target_certificate(session):
    """A restaurant already holding a landa_bnei_brak row keeps that one, not a duplicate."""
    source = _certifier(session, SOURCE_SLUG)
    target = _certifier(session, TARGET_SLUG)
    restaurant, loser = _certificate(session, source, "בציר")
    winner = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=target.id,
        import_key=f"seed:{restaurant.dedupe_key}:{TARGET_SLUG}",
        level=CertificationLevel.UNKNOWN,
        state=CertificateState.PENDING,
        source=CertificateSource.OFFICIAL_LIST,
    )
    session.add(winner)
    session.commit()

    plan = merge(session, dry_run=False)

    assert plan.deleted == [(str(loser.id), "בציר")]
    remaining = session.scalars(select(Certificate)).all()
    assert len(remaining) == 1
    assert remaining[0].id == winner.id


def test_apply_refuses_a_lossy_duplicate(session):
    """A duplicate carrying facts its survivor lacks must not be silently dropped."""
    source = _certifier(session, SOURCE_SLUG)
    target = _certifier(session, TARGET_SLUG)
    restaurant, loser = _certificate(
        session, source, "בציר", attributes={"glatt": True}, valid_until=dt.date(2027, 1, 1)
    )
    winner = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=target.id,
        import_key=f"seed:{restaurant.dedupe_key}:{TARGET_SLUG}",
        level=CertificationLevel.UNKNOWN,
        state=CertificateState.PENDING,
        source=CertificateSource.OFFICIAL_LIST,
    )
    session.add(winner)
    session.commit()

    with pytest.raises(SystemExit) as excinfo:
        merge(session, dry_run=False)

    assert str(loser.id) in str(excinfo.value)
    assert session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG)) is not None
    assert len(session.scalars(select(Certificate)).all()) == 2


def test_whitelisted_placeholder_refuses(session):
    """A merge must never silently drop a user's chosen certifier."""
    source, _target, _rows = _seed_placeholder_with_target(session, ["בציר"])
    user = User(email="user@example.com")
    session.add(user)
    session.flush()
    profile = UserProfile(user_id=user.id)
    session.add(profile)
    session.flush()
    session.add(ProfileCertifierWhitelist(profile_id=profile.id, certifier_id=source.id))
    session.commit()

    with pytest.raises(SystemExit) as excinfo:
        merge(session, dry_run=False)

    assert SOURCE_SLUG in str(excinfo.value)
    assert session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG)) is not None


def test_apply_is_audit_logged(session):
    """A kashrut-record ownership change that leaves no trail is not acceptable."""
    _seed_placeholder_with_target(session, ["בציר", "בון קפה"])

    merge(session, dry_run=False)

    entries = session.scalars(select(AuditLog)).all()
    assert {e.entity_type for e in entries} == {"certifier", "certificate"}
    assert all(e.actor == MERGE_ACTOR for e in entries)
    assert all(e.evidence["reason"] == AUDIT_REASON_VALUE for e in entries)
    certifier_log = next(e for e in entries if e.entity_type == "certifier")
    assert certifier_log.action == AuditAction.DELETE
    assert certifier_log.changes["before"]["slug"] == SOURCE_SLUG


def test_idempotent_on_second_run(session):
    """Already merged is reported as done, never applied a second time."""
    _seed_placeholder_with_target(session, ["בציר"])
    merge(session, dry_run=False)

    with pytest.raises(SystemExit) as excinfo:
        merge(session, dry_run=True)

    assert SOURCE_SLUG in str(excinfo.value)
    assert session.scalar(select(Certifier).where(Certifier.slug == TARGET_SLUG)) is not None
