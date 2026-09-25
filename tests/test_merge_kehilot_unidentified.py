"""Tests for the ``kehilot_unidentified`` -> ``badatz_kehilot`` rename/merge.

The normal path is a rename in place (same certifier row, id preserved): the corpus
label was always this one certifier, just unconfirmed until 2026-09-25. These tests use
the SQLite-backed ``session`` fixture from conftest, the same shape
``tests/test_apply_landa_elul_refresh.py`` uses for its end-to-end cases.
"""

from __future__ import annotations

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
from scripts.merge_kehilot_unidentified import (
    MODE_MERGED,
    MODE_RENAMED,
    SOURCE_SLUG,
    TARGET_NAME_EN,
    TARGET_NAME_HE,
    TARGET_SLUG,
    TARGET_TYPE,
    merge_or_rename,
)


def _seed_source(session, name: str) -> tuple[Certifier, Restaurant, Certificate]:
    """
    Put the placeholder certifier, one restaurant and its seed certificate in the DB.

    Committed, not just flushed: a dry run rolls the transaction back, and the fixture
    stands in for a database that was already populated by an earlier import.

    Parameters:
        session: Open database session.
        name (str): Restaurant name to store the row under.

    Return:
        tuple[Certifier, Restaurant, Certificate]: The stored rows.
    """
    certifier = session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG))
    if certifier is None:
        certifier = Certifier(
            slug=SOURCE_SLUG,
            name_he="כשרות קהילתית לא מזוהה",
            type=CertifierType.PRIVATE,
        )
        session.add(certifier)
        session.flush()

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
        import_key=f"seed:{restaurant.dedupe_key}:{SOURCE_SLUG}",
        level=CertificationLevel.UNKNOWN,
        state=CertificateState.PENDING,
        source=CertificateSource.OFFICIAL_LIST,
    )
    session.add(certificate)
    session.commit()

    return certifier, restaurant, certificate


def test_dry_run_makes_no_changes(session):
    """The default run reports the diff and rolls it back, like every other pipeline."""
    _seed_source(session, "בציר")

    plan = merge_or_rename(session, dry_run=True)

    assert plan.mode == MODE_RENAMED
    certifier = session.scalar(select(Certifier))
    assert certifier.slug == SOURCE_SLUG
    assert certifier.name_he == "כשרות קהילתית לא מזוהה"
    certificate = session.scalar(select(Certificate))
    assert certificate.import_key.endswith(f":{SOURCE_SLUG}")
    assert session.scalar(select(AuditLog)) is None


def test_apply_renames_certifier_and_rewrites_certificates(session):
    """The certifier row becomes badatz_kehilot in place; the 4-row case is 1 here."""
    certifier, restaurant, certificate = _seed_source(session, "בציר")
    original_id = certifier.id

    plan = merge_or_rename(session, dry_run=False)

    assert plan.mode == MODE_RENAMED
    renamed = session.scalar(select(Certifier).where(Certifier.id == original_id))
    assert renamed is not None
    assert renamed.slug == TARGET_SLUG
    assert renamed.name_he == TARGET_NAME_HE
    assert renamed.name_en == TARGET_NAME_EN
    assert renamed.type == TARGET_TYPE

    rewritten = session.scalar(select(Certificate).where(Certificate.id == certificate.id))
    assert rewritten.import_key == f"seed:{restaurant.dedupe_key}:{TARGET_SLUG}"
    assert rewritten.certifier_id == original_id
    assert plan.certificates_rewritten == [(str(certificate.id), "בציר")]


def test_apply_is_audit_logged(session):
    """A kashrut-record identity change that leaves no trail is not acceptable."""
    _seed_source(session, "בציר")

    merge_or_rename(session, dry_run=False)

    entries = session.scalars(select(AuditLog)).all()
    assert {e.entity_type for e in entries} == {"certifier", "certificate"}
    assert all(e.actor == "merge:kehilot_unidentified->badatz_kehilot" for e in entries)
    certifier_log = next(e for e in entries if e.entity_type == "certifier")
    assert certifier_log.action == AuditAction.UPDATE
    assert certifier_log.changes["slug"] == {"before": SOURCE_SLUG, "after": TARGET_SLUG}


def test_whitelist_rows_survive_the_rename(session):
    """A rename by id must never silently drop a user's chosen certifier."""
    certifier, _restaurant, _certificate = _seed_source(session, "בציר")
    user = User(email="user@example.com")
    session.add(user)
    session.flush()
    profile = UserProfile(user_id=user.id)
    session.add(profile)
    session.flush()
    whitelist = ProfileCertifierWhitelist(profile_id=profile.id, certifier_id=certifier.id)
    session.add(whitelist)
    session.commit()

    merge_or_rename(session, dry_run=False)

    surviving = session.get(ProfileCertifierWhitelist, (profile.id, certifier.id))
    assert surviving is not None
    assert surviving.certifier_id == certifier.id
    renamed_certifier = session.get(Certifier, certifier.id)
    assert renamed_certifier.slug == TARGET_SLUG


def test_idempotent_on_second_run(session):
    """Already renamed is reported as done, never applied a second time."""
    _seed_source(session, "בציר")
    merge_or_rename(session, dry_run=False)

    with pytest.raises(SystemExit) as excinfo:
        merge_or_rename(session, dry_run=True)

    assert "kehilot_unidentified" in str(excinfo.value)
    certifier = session.scalar(select(Certifier))
    assert certifier.slug == TARGET_SLUG


def test_pre_existing_target_is_merged_into(session):
    """If badatz_kehilot already exists, fall back to a Landa-style merge."""
    source, restaurant, certificate = _seed_source(session, "בציר")
    target = Certifier(
        slug=TARGET_SLUG,
        name_he=TARGET_NAME_HE,
        name_en=TARGET_NAME_EN,
        type=TARGET_TYPE,
    )
    session.add(target)
    session.commit()

    plan = merge_or_rename(session, dry_run=False)

    assert plan.mode == MODE_MERGED
    assert plan.merge.rewritten == [(str(certificate.id), "בציר")]
    assert session.scalar(select(Certifier).where(Certifier.slug == SOURCE_SLUG)) is None
    survivor = session.scalar(select(Certificate))
    assert survivor.certifier_id == target.id
    assert survivor.import_key == f"seed:{restaurant.dedupe_key}:{TARGET_SLUG}"
