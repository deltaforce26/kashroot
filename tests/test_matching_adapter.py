"""Tests for the DB/API -> match-engine adapter (POC_PLAN.md B1, B8).

Two concerns:

* The adapter maps ORM rows / request schemas onto ``app.match``'s pure types
  faithfully (no silent coercion, no dropped fields).
* ``app.match`` stays pure. Importing it must never build a database engine or read
  settings — this is asserted in a subprocess so the check is not contaminated by
  whatever other test modules have already imported in-process.
"""

from __future__ import annotations

import datetime as dt
import subprocess
import sys
import types
import uuid

from app.api.schemas_public import ProfileRequest, WhitelistEntryRequest
from app.match import (
    CertificateInput,
    FitCandidate,
    FitPreferences,
    ProfileInput,
    Verdict,
    WhitelistEntry,
)
from app.models.enums import (
    CertificateSource,
    CertificateState,
    CertificationLevel,
    DietType,
)
from app.services.matching import (
    certificate_input_from_orm,
    evaluate_restaurant_kashrut,
    fit_candidate_from_restaurant,
    fit_preferences_from_profile,
    profile_input_from_request,
)


def _fake_certificate(**overrides: object) -> types.SimpleNamespace:
    """A duck-typed stand-in for a ``Certificate`` ORM row.

    Used instead of a real ORM instance so tests can carry values the database's
    native enum column would itself reject (e.g. an unrecognized ``state`` string) —
    ``certificate_input_from_orm`` only reads attributes, so it does not care.
    """
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "certifier_id": uuid.uuid4(),
        "state": CertificateState.ACTIVE,
        "level": CertificationLevel.MEHADRIN,
        "attributes": {"glatt": True},
        "valid_from": None,
        "valid_until": None,
        "verified_at": dt.datetime.now(dt.UTC),
        "source": CertificateSource.OFFICIAL_LIST,
        "corroboration_count": 1,
    }
    defaults.update(overrides)

    return types.SimpleNamespace(**defaults)


def _fake_restaurant(certificates: list[object], **overrides: object) -> types.SimpleNamespace:
    defaults: dict[str, object] = {
        "certificates": certificates,
        "price_level": 2,
        "amenities": {"parking": True},
        "diet_type": DietType.MEAT,
    }
    defaults.update(overrides)

    return types.SimpleNamespace(**defaults)


# --------------------------------------------------------------------------- purity


def test_importing_match_never_builds_a_db_engine() -> None:
    """Importing ``app.match`` alone must never import ``app.db.session`` — the module
    that reads settings and constructs the SQLAlchemy engine (see
    ``app/db/__init__.py``'s deliberate lazy import and NOTES.md "Match engine"). Run
    in a fresh subprocess so an earlier test module's imports cannot mask a regression.

    ``app.models.enums`` (which ``app.match`` imports for the domain enums) imports
    the ``sqlalchemy`` package itself, for its ``pg_enum`` column-type helper — that
    alone is not a DB connection and is not part of the purity contract; only engine
    construction (``app.db.session``) is.
    """
    probe = (
        "import sys\n"
        "import app.match\n"
        "assert 'app.db.session' not in sys.modules, 'app.match pulled in app.db.session'\n"
        "print('ok')\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        cwd=".",
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ok"


# ------------------------------------------------------------------ certificate map


def test_certificate_input_from_orm_maps_every_field() -> None:
    verified_at = dt.datetime(2026, 8, 1, tzinfo=dt.UTC)
    valid_until = dt.date(2026, 12, 31)
    certificate = _fake_certificate(
        certifier_id=uuid.UUID(int=7),
        state=CertificateState.ACTIVE,
        level=CertificationLevel.MEHADRIN,
        attributes={"glatt": True, "pas_yisrael": False},
        valid_until=valid_until,
        verified_at=verified_at,
        source=CertificateSource.MODERATOR_VERIFIED,
        corroboration_count=3,
    )

    result = certificate_input_from_orm(certificate)

    assert isinstance(result, CertificateInput)
    assert result.certificate_id == str(certificate.id)
    assert result.certifier_id == str(uuid.UUID(int=7))
    assert result.state == CertificateState.ACTIVE
    assert result.level == CertificationLevel.MEHADRIN
    assert result.attributes == {"glatt": True, "pas_yisrael": False}
    assert result.valid_until == valid_until
    assert result.verified_at == verified_at
    assert result.source == CertificateSource.MODERATOR_VERIFIED
    assert result.corroboration_count == 3


def test_certificate_input_from_orm_propagates_unrecognized_state() -> None:
    """The adapter does not validate ``state`` — it is a straight passthrough. A
    value the running code does not recognize (e.g. a future enum member written by
    a newer deployment, or DB corruption) must reach the engine unchanged so the
    fail-safe branch (-> UNKNOWN, never MATCH) actually runs.
    """
    certificate = _fake_certificate(state="some_future_state")

    result = certificate_input_from_orm(certificate)

    assert result.state == "some_future_state"


# ----------------------------------------------------------------------- profile map


def test_profile_input_from_request_maps_whitelist_and_attributes() -> None:
    certifier_id = uuid.uuid4()
    profile = ProfileRequest(
        whitelist=[
            WhitelistEntryRequest(certifier_id=certifier_id, min_level=CertificationLevel.MEHADRIN)
        ],
        required_attributes=["glatt", "chalav_yisrael"],
    )

    result = profile_input_from_request(profile)

    assert isinstance(result, ProfileInput)
    assert len(result.whitelist) == 1
    assert result.whitelist[0].certifier_id == str(certifier_id)
    assert result.whitelist[0].min_level == CertificationLevel.MEHADRIN
    assert result.required_attributes == frozenset({"glatt", "chalav_yisrael"})


def test_profile_input_from_request_empty_profile_is_empty() -> None:
    result = profile_input_from_request(ProfileRequest())

    assert result.whitelist == ()
    assert result.required_attributes == frozenset()


# ------------------------------------------------------------- kashrut integration


def test_evaluate_restaurant_kashrut_match_when_whitelisted_and_fresh() -> None:
    certifier_id = uuid.uuid4()
    certificate = _fake_certificate(
        certifier_id=certifier_id,
        attributes={"glatt": True},
        verified_at=dt.datetime.now(dt.UTC),
    )
    restaurant = _fake_restaurant([certificate])
    profile = ProfileInput(
        whitelist=(WhitelistEntry(certifier_id=str(certifier_id)),),
        required_attributes=frozenset({"glatt"}),
    )

    result = evaluate_restaurant_kashrut(restaurant, profile, now=dt.datetime.now(dt.UTC))

    assert result.verdict == Verdict.MATCH


def test_evaluate_restaurant_kashrut_no_certificates_is_unknown() -> None:
    """Fail-safe: a restaurant with no certificates at all is UNKNOWN, never MATCH or
    NO_MATCH — absence of a certificate is not evidence of anything.
    """
    restaurant = _fake_restaurant([])

    result = evaluate_restaurant_kashrut(restaurant, ProfileInput(), now=dt.datetime.now(dt.UTC))

    assert result.verdict == Verdict.UNKNOWN


# ------------------------------------------------------------------------- fit map


def test_fit_candidate_from_restaurant_maps_soft_facts_only() -> None:
    restaurant = _fake_restaurant(
        [], price_level=3, amenities={"parking": True}, diet_type=DietType.DAIRY
    )

    candidate = fit_candidate_from_restaurant(restaurant, distance_km=1.2)

    assert isinstance(candidate, FitCandidate)
    assert candidate.distance_km == 1.2
    assert candidate.is_open_now is None
    assert candidate.price_level == 3
    assert candidate.amenities == {"parking": True}
    assert candidate.diet_type == "dairy"


def test_fit_candidate_from_restaurant_none_diet_type_maps_to_none() -> None:
    restaurant = _fake_restaurant([], diet_type=None)

    candidate = fit_candidate_from_restaurant(restaurant, distance_km=None)

    assert candidate.diet_type is None


def test_fit_preferences_from_profile_maps_soft_preferences() -> None:
    profile = ProfileRequest(
        preferred_diets=[DietType.DAIRY],
        preferred_price_level=2,
        wanted_amenities=["parking"],
    )

    preferences = fit_preferences_from_profile(profile)

    assert isinstance(preferences, FitPreferences)
    assert preferences.preferred_price_level == 2
    assert preferences.wanted_amenities == frozenset({"parking"})
    assert preferences.preferred_diets == frozenset({"dairy"})
