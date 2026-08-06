"""Layer 1 kashrut gate — the executable spec.

The match engine is a pure function over (Certificate × Profile); nothing here touches
a database. Every rule from PRD §17 (gate semantics), §13 (fail-safe/trust) and the
CLAUDE.md locked decisions has a test. Read top to bottom as the specification:

* MATCH iff an active, unexpired, fresh certificate from a whitelisted certifier (at
  the required level) explicitly carries every required attribute.
* NO_MATCH only on definitive facts. UNKNOWN for every kind of doubt.
* Doubt → UNKNOWN, never → MATCH. Absence of evidence is not evidence.
* Kashrut is never a number.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

import pytest

from app.match import (
    DEFAULT_FRESHNESS_DAYS,
    CertificateInput,
    Confidence,
    MatchResult,
    ProfileInput,
    Reason,
    ReasonCode,
    Verdict,
    WhitelistEntry,
    evaluate_kashrut,
)
from app.models.enums import (
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
)

NOW = dt.datetime(2026, 8, 7, 12, 0, tzinfo=dt.UTC)
TODAY = NOW.date()

BADATZ = "certifier-badatz-rubin"
RABBANUT = "certifier-rabbanut-tel-aviv"
OTHER = "certifier-not-in-any-list"


def make_cert(**overrides) -> CertificateInput:
    """A certificate that MATCHes the default profile unless overridden."""
    defaults: dict = {
        "certificate_id": "cert-1",
        "certifier_id": BADATZ,
        "state": CertificateState.ACTIVE,
        "level": CertificationLevel.MEHADRIN,
        "attributes": {},
        "valid_until": TODAY + dt.timedelta(days=90),
        "verified_at": NOW - dt.timedelta(days=6),
        "source": CertificateSource.MODERATOR_VERIFIED,
    }
    defaults.update(overrides)
    return CertificateInput(**defaults)


def make_profile(
    *entries: WhitelistEntry, required: tuple[str, ...] = ()
) -> ProfileInput:
    if not entries:
        entries = (WhitelistEntry(BADATZ),)
    return ProfileInput(whitelist=entries, required_attributes=required)


def run(certs, profile=None, **kwargs) -> MatchResult:
    return evaluate_kashrut(certs, profile or make_profile(), now=NOW, **kwargs)


def codes(result_or_eval) -> list[ReasonCode]:
    return [reason.code for reason in result_or_eval.reasons]


# ---------------------------------------------------------------------------
# Whitelist: the user decides which certifiers they accept; the app never ranks.
# ---------------------------------------------------------------------------


class TestWhitelist:
    def test_whitelisted_certifier_matches(self):
        result = run([make_cert()])
        assert result.verdict == Verdict.MATCH
        assert ReasonCode.CERTIFIER_IN_WHITELIST in codes(result)

    def test_non_whitelisted_certifier_is_definitive_no_match(self):
        # PRD §17: "✗ Certified Rabbanut regular — not in your list." Data is
        # sufficient — we know who certifies and the user does not accept them.
        result = run([make_cert(certifier_id=OTHER)])
        assert result.verdict == Verdict.NO_MATCH
        assert ReasonCode.CERTIFIER_NOT_IN_WHITELIST in codes(result)

    def test_empty_whitelist_is_no_match(self):
        result = run([make_cert()], ProfileInput())
        assert result.verdict == Verdict.NO_MATCH

    def test_duplicate_whitelist_entries_use_most_permissive_minimum(self):
        profile = make_profile(
            WhitelistEntry(BADATZ, CertificationLevel.MEHADRIN),
            WhitelistEntry(BADATZ, CertificationLevel.REGULAR),
        )
        result = run([make_cert(level=CertificationLevel.UNKNOWN)], profile)
        assert result.verdict == Verdict.MATCH


class TestLevels:
    """min_level is evaluated within one certifier's own published levels only."""

    @pytest.mark.parametrize(
        ("level", "verdict", "expected_code"),
        [
            (CertificationLevel.MEHADRIN, Verdict.MATCH, ReasonCode.LEVEL_MEETS_MINIMUM),
            (CertificationLevel.REGULAR, Verdict.NO_MATCH, ReasonCode.LEVEL_BELOW_MINIMUM),
            # Doubt about the level is doubt about the match — UNKNOWN, not NO_MATCH.
            (CertificationLevel.UNKNOWN, Verdict.UNKNOWN, ReasonCode.LEVEL_UNKNOWN),
        ],
        ids=["mehadrin-meets", "regular-below", "unknown-is-doubt"],
    )
    def test_mehadrin_minimum(self, level, verdict, expected_code):
        profile = make_profile(WhitelistEntry(BADATZ, CertificationLevel.MEHADRIN))
        result = run([make_cert(level=level)], profile)
        assert result.verdict == verdict
        assert expected_code in codes(result)

    def test_regular_minimum_accepts_unknown_level(self):
        # min_level REGULAR = "any certificate from this certifier". Official lists
        # publish no level; the "Any certification" preset must work from day one
        # (PRD §20 cold start).
        result = run([make_cert(level=CertificationLevel.UNKNOWN)])
        assert result.verdict == Verdict.MATCH

    def test_regular_minimum_emits_no_level_reason(self):
        result = run([make_cert()])
        assert ReasonCode.LEVEL_MEETS_MINIMUM not in codes(result)
        assert ReasonCode.LEVEL_UNKNOWN not in codes(result)


# ---------------------------------------------------------------------------
# Required attributes: tri-state. True satisfies; False is definitive; absent is
# unknown and can never satisfy a requirement (absence of evidence ≠ evidence).
# ---------------------------------------------------------------------------


class TestRequiredAttributes:
    @pytest.mark.parametrize("attribute", [a.value for a in CertificateAttribute])
    def test_attribute_explicitly_true_matches(self, attribute):
        result = run(
            [make_cert(attributes={attribute: True})],
            make_profile(required=(attribute,)),
        )
        assert result.verdict == Verdict.MATCH
        assert Reason(ReasonCode.ATTRIBUTE_PRESENT, attribute) in result.reasons

    @pytest.mark.parametrize("attribute", [a.value for a in CertificateAttribute])
    def test_attribute_explicitly_false_is_no_match(self, attribute):
        result = run(
            [make_cert(attributes={attribute: False})],
            make_profile(required=(attribute,)),
        )
        assert result.verdict == Verdict.NO_MATCH
        assert Reason(ReasonCode.ATTRIBUTE_FALSE, attribute) in result.reasons

    @pytest.mark.parametrize("attribute", [a.value for a in CertificateAttribute])
    def test_attribute_absent_is_unknown_never_match(self, attribute):
        result = run([make_cert(attributes={})], make_profile(required=(attribute,)))
        assert result.verdict == Verdict.UNKNOWN
        assert Reason(ReasonCode.ATTRIBUTE_UNKNOWN, attribute) in result.reasons

    def test_one_false_attribute_dominates_an_unknown_one(self):
        # An explicit False is definitive: the certificate cannot satisfy the profile
        # no matter what the unknown attribute turns out to be.
        result = run(
            [make_cert(attributes={"glatt": False})],
            make_profile(required=("glatt", "pas_yisrael")),
        )
        assert result.verdict == Verdict.NO_MATCH

    def test_all_required_attributes_true_matches(self):
        required = ("bishul_yisrael", "chalav_yisrael", "glatt")
        result = run(
            [make_cert(attributes={a: True for a in required})],
            make_profile(required=required),
        )
        assert result.verdict == Verdict.MATCH

    def test_unrequired_false_attribute_is_irrelevant(self):
        # The user did not require yashan; the certificate saying "not yashan" is a
        # published fact, not a mismatch.
        result = run(
            [make_cert(attributes={"glatt": True, "yashan": False})],
            make_profile(required=("glatt",)),
        )
        assert result.verdict == Verdict.MATCH


# ---------------------------------------------------------------------------
# Expiry: past expiry auto-degrades to UNKNOWN — fail safe, always (PRD §13).
# ---------------------------------------------------------------------------


class TestExpiry:
    def test_past_valid_until_degrades_to_unknown_even_if_state_active(self):
        result = run([make_cert(valid_until=TODAY - dt.timedelta(days=1))])
        assert result.verdict == Verdict.UNKNOWN
        assert codes(result) == [ReasonCode.CERTIFICATE_EXPIRED]

    def test_expired_state_wins_over_future_valid_until(self):
        # The certifier said expired; a stored date does not override that signal.
        result = run(
            [make_cert(state=CertificateState.EXPIRED, valid_until=TODAY + dt.timedelta(days=30))]
        )
        assert result.verdict == Verdict.UNKNOWN
        assert ReasonCode.CERTIFICATE_EXPIRED in codes(result)

    def test_expires_today_is_still_valid(self):
        result = run([make_cert(valid_until=TODAY)])
        assert result.verdict == Verdict.MATCH

    def test_expiring_soon_still_matches_but_is_flagged(self):
        # PRD §13 SLA: expiring certificates surface 14 days early.
        result = run([make_cert(valid_until=TODAY + dt.timedelta(days=14))])
        assert result.verdict == Verdict.MATCH
        assert ReasonCode.CERTIFICATE_EXPIRES_SOON in codes(result)
        assert result.freshness is not None and result.freshness.expires_soon

    def test_expiring_later_is_not_flagged(self):
        result = run([make_cert(valid_until=TODAY + dt.timedelta(days=15))])
        assert result.verdict == Verdict.MATCH
        assert ReasonCode.CERTIFICATE_EXPIRES_SOON not in codes(result)
        assert result.freshness is not None and not result.freshness.expires_soon

    def test_not_yet_valid_is_unknown(self):
        result = run([make_cert(valid_from=TODAY + dt.timedelta(days=7))])
        assert result.verdict == Verdict.UNKNOWN
        assert codes(result) == [ReasonCode.CERTIFICATE_NOT_YET_VALID]

    def test_expired_certificate_content_is_not_evaluated(self):
        # An out-of-force certificate's attributes are stale facts; they must appear
        # neither as evidence for nor against.
        result = run(
            [make_cert(valid_until=TODAY - dt.timedelta(days=1), attributes={"glatt": True})],
            make_profile(required=("glatt",)),
        )
        assert codes(result) == [ReasonCode.CERTIFICATE_EXPIRED]


class TestCertificateStates:
    def test_revoked_is_definitive_no_match(self):
        # Revocation is the one non-active state that is a definitive published fact.
        result = run([make_cert(state=CertificateState.REVOKED)])
        assert result.verdict == Verdict.NO_MATCH
        assert codes(result) == [ReasonCode.CERTIFICATE_REVOKED]

    def test_pending_is_unknown(self):
        result = run([make_cert(state=CertificateState.PENDING)])
        assert result.verdict == Verdict.UNKNOWN
        assert codes(result) == [ReasonCode.CERTIFICATE_PENDING]

    def test_expired_state_is_unknown(self):
        result = run([make_cert(state=CertificateState.EXPIRED, valid_until=None)])
        assert result.verdict == Verdict.UNKNOWN
        assert codes(result) == [ReasonCode.CERTIFICATE_EXPIRED]

    @pytest.mark.parametrize("state", ["suspended", "on_hold", ""])
    def test_unrecognized_state_is_unknown_never_match(self, state):
        # Fail-safe default: a state this engine does not know (a future enum member,
        # corrupt input) is doubt — it must never fall through to content evaluation
        # and reach MATCH.
        result = run([make_cert(state=state)])
        assert result.verdict == Verdict.UNKNOWN
        assert codes(result) == [ReasonCode.CERTIFICATE_STATE_UNRECOGNIZED]

    def test_expired_cert_from_non_whitelisted_certifier_is_no_match(self):
        # The whitelist miss is definitive regardless of state: renewal would not make
        # this certificate count, and the "Why?" UI must say so.
        result = run([make_cert(certifier_id=OTHER, state=CertificateState.EXPIRED)])
        assert result.verdict == Verdict.NO_MATCH
        assert codes(result) == [
            ReasonCode.CERTIFIER_NOT_IN_WHITELIST,
            ReasonCode.CERTIFICATE_EXPIRED,
        ]

    def test_revoked_cert_from_non_whitelisted_certifier_lists_both_reasons(self):
        result = run([make_cert(certifier_id=OTHER, state=CertificateState.REVOKED)])
        assert result.verdict == Verdict.NO_MATCH
        assert codes(result) == [
            ReasonCode.CERTIFIER_NOT_IN_WHITELIST,
            ReasonCode.CERTIFICATE_REVOKED,
        ]

    def test_pending_cert_from_non_whitelisted_certifier_is_no_match(self):
        result = run([make_cert(certifier_id=OTHER, state=CertificateState.PENDING)])
        assert result.verdict == Verdict.NO_MATCH
        assert ReasonCode.CERTIFIER_NOT_IN_WHITELIST in codes(result)


# ---------------------------------------------------------------------------
# Freshness: list-sourced certificates carry no validity window; the staleness
# clock runs from verified_at. Stale → UNKNOWN, never → MATCH.
# ---------------------------------------------------------------------------


class TestFreshness:
    def test_fresh_evidence_without_window_matches(self):
        result = run([make_cert(valid_until=None, verified_at=NOW - dt.timedelta(days=10))])
        assert result.verdict == Verdict.MATCH
        assert ReasonCode.EVIDENCE_FRESH in codes(result)

    def test_stale_evidence_degrades_to_unknown(self):
        result = run(
            [
                make_cert(
                    valid_until=None,
                    verified_at=NOW - dt.timedelta(days=DEFAULT_FRESHNESS_DAYS + 1),
                )
            ]
        )
        assert result.verdict == Verdict.UNKNOWN
        assert ReasonCode.EVIDENCE_STALE in codes(result)

    def test_staleness_boundary_is_inclusive(self):
        # Exactly freshness_days old is still fresh; day freshness_days+1 is not.
        verified_at = NOW - dt.timedelta(days=DEFAULT_FRESHNESS_DAYS)
        result = run([make_cert(valid_until=None, verified_at=verified_at)])
        assert result.verdict == Verdict.MATCH

    def test_freshness_days_parameter_is_respected(self):
        cert = make_cert(valid_until=None, verified_at=NOW - dt.timedelta(days=31))
        assert run([cert]).verdict == Verdict.MATCH  # default 90
        assert run([cert], freshness_days=30).verdict == Verdict.UNKNOWN

    def test_no_freshness_evidence_at_all_is_unknown(self):
        result = run([make_cert(valid_until=None, verified_at=None)])
        assert result.verdict == Verdict.UNKNOWN
        assert ReasonCode.NO_FRESHNESS_EVIDENCE in codes(result)

    def test_validity_window_does_not_exempt_the_staleness_clock(self):
        # A future valid_until records what the document says, but stale verification
        # evidence means we might not have noticed a revocation. Doubt → UNKNOWN,
        # never → MATCH.
        result = run(
            [
                make_cert(
                    valid_until=TODAY + dt.timedelta(days=60),
                    verified_at=NOW - dt.timedelta(days=400),
                )
            ]
        )
        assert result.verdict == Verdict.UNKNOWN
        assert ReasonCode.EVIDENCE_STALE in codes(result)
        assert result.freshness is not None and result.freshness.is_stale

    def test_validity_window_with_no_verification_evidence_is_unknown(self):
        result = run([make_cert(valid_until=TODAY + dt.timedelta(days=60), verified_at=None)])
        assert result.verdict == Verdict.UNKNOWN
        assert ReasonCode.NO_FRESHNESS_EVIDENCE in codes(result)

    def test_naive_verified_at_is_interpreted_as_utc(self):
        # Storage convention: naive datetimes are UTC. A naive timestamp exactly at
        # the freshness boundary behaves identically to its aware-UTC equivalent.
        boundary = NOW - dt.timedelta(days=DEFAULT_FRESHNESS_DAYS)
        fresh = run([make_cert(valid_until=None, verified_at=boundary.replace(tzinfo=None))])
        assert fresh.verdict == Verdict.MATCH
        stale_naive = (NOW - dt.timedelta(days=DEFAULT_FRESHNESS_DAYS + 1)).replace(tzinfo=None)
        stale = run([make_cert(valid_until=None, verified_at=stale_naive)])
        assert stale.verdict == Verdict.UNKNOWN
        assert ReasonCode.EVIDENCE_STALE in codes(stale)

    def test_freshness_info_day_counts(self):
        result = run([make_cert(verified_at=NOW - dt.timedelta(days=6))])
        assert result.freshness is not None
        assert result.freshness.evidence_age_days == 6  # "verified 6 days ago"
        assert result.freshness.days_until_expiry == 90
        assert result.freshness.valid_until == TODAY + dt.timedelta(days=90)


# ---------------------------------------------------------------------------
# No certificate: we don't know, we never guess.
# ---------------------------------------------------------------------------


class TestNoCertificate:
    def test_no_certificate_is_unknown(self):
        result = run([])
        assert result.verdict == Verdict.UNKNOWN
        assert result.reasons == (Reason(ReasonCode.NO_CERTIFICATE),)
        assert result.deciding_certificate_id is None
        assert result.freshness is None
        assert result.confidence == Confidence.LOW
        assert result.evaluations == ()


# ---------------------------------------------------------------------------
# Multiple certificates: §17 is existential — one qualifying certificate MATCHes.
# Otherwise an unresolved certificate means data is insufficient for NO_MATCH.
# ---------------------------------------------------------------------------


class TestMultipleCertificates:
    def test_one_match_among_no_matches_is_match(self):
        result = run(
            [make_cert(certificate_id="bad", certifier_id=OTHER), make_cert(certificate_id="good")]
        )
        assert result.verdict == Verdict.MATCH
        assert result.deciding_certificate_id == "good"

    def test_unknown_beats_no_match(self):
        # A pending certificate might resolve either way → data insufficient.
        result = run(
            [
                make_cert(certificate_id="rejected", certifier_id=OTHER),
                make_cert(certificate_id="pending", state=CertificateState.PENDING),
            ]
        )
        assert result.verdict == Verdict.UNKNOWN
        assert result.deciding_certificate_id == "pending"

    def test_match_beats_unknown(self):
        result = run(
            [
                make_cert(certificate_id="stale", valid_until=None, verified_at=None),
                make_cert(certificate_id="good"),
            ]
        )
        assert result.verdict == Verdict.MATCH
        assert result.deciding_certificate_id == "good"

    def test_best_match_certificate_is_highest_source_authority(self):
        result = run(
            [
                make_cert(certificate_id="list", source=CertificateSource.OFFICIAL_LIST),
                make_cert(certificate_id="portal", source=CertificateSource.CERTIFIER_PORTAL),
            ]
        )
        assert result.deciding_certificate_id == "portal"

    def test_equal_authority_prefers_more_recent_verification(self):
        result = run(
            [
                make_cert(certificate_id="older", verified_at=NOW - dt.timedelta(days=40)),
                make_cert(certificate_id="newer", verified_at=NOW - dt.timedelta(days=2)),
            ]
        )
        assert result.deciding_certificate_id == "newer"

    def test_full_tie_breaks_on_certificate_id(self):
        result = run([make_cert(certificate_id="b"), make_cert(certificate_id="a")])
        assert result.deciding_certificate_id == "a"

    def test_evaluations_carry_every_certificate_best_first(self):
        result = run(
            [
                make_cert(certificate_id="rejected", certifier_id=OTHER),
                make_cert(certificate_id="good"),
                make_cert(certificate_id="pending", state=CertificateState.PENDING),
            ]
        )
        assert [ev.certificate_id for ev in result.evaluations] == ["good", "pending", "rejected"]
        assert [ev.outcome for ev in result.evaluations] == [
            Verdict.MATCH,
            Verdict.UNKNOWN,
            Verdict.NO_MATCH,
        ]


# ---------------------------------------------------------------------------
# Reason codes: machine-readable, deterministic order — they *are* the "Why?" UI.
# ---------------------------------------------------------------------------


class TestReasons:
    def test_canonical_match_reason_list(self):
        # "✓ Badatz Rubin (in your list) · ✓ Glatt · Certificate valid until … "
        result = run(
            [make_cert(attributes={"glatt": True})],
            make_profile(required=("glatt",)),
        )
        assert result.reasons == (
            Reason(ReasonCode.CERTIFIER_IN_WHITELIST),
            Reason(ReasonCode.ATTRIBUTE_PRESENT, "glatt"),
            Reason(ReasonCode.CERTIFICATE_VALID),
            Reason(ReasonCode.EVIDENCE_FRESH),
        )

    def test_reasons_are_sorted_by_canonical_code_order_then_attribute(self):
        result = run(
            [make_cert(attributes={"pas_yisrael": True})],
            make_profile(required=("pas_yisrael", "glatt", "chalav_yisrael")),
        )
        assert [(r.code, r.attribute) for r in result.reasons] == [
            (ReasonCode.CERTIFIER_IN_WHITELIST, None),
            (ReasonCode.ATTRIBUTE_PRESENT, "pas_yisrael"),
            (ReasonCode.CERTIFICATE_VALID, None),
            (ReasonCode.EVIDENCE_FRESH, None),
            (ReasonCode.ATTRIBUTE_UNKNOWN, "chalav_yisrael"),
            (ReasonCode.ATTRIBUTE_UNKNOWN, "glatt"),
        ]

    def test_no_match_still_carries_positive_context(self):
        # "✗ not in your list" alongside the facts that *were* established.
        result = run(
            [make_cert(certifier_id=OTHER, attributes={"glatt": True})],
            ProfileInput(
                whitelist=(WhitelistEntry(BADATZ),), required_attributes=("glatt",)
            ),
        )
        assert result.verdict == Verdict.NO_MATCH
        assert Reason(ReasonCode.ATTRIBUTE_PRESENT, "glatt") in result.reasons
        assert Reason(ReasonCode.CERTIFIER_NOT_IN_WHITELIST) in result.reasons


# ---------------------------------------------------------------------------
# Confidence: source authority × recency × corroboration, banded — never numeric.
# ---------------------------------------------------------------------------


class TestConfidence:
    @pytest.mark.parametrize(
        ("source", "corroboration", "age_days", "expected"),
        [
            (CertificateSource.CERTIFIER_PORTAL, 1, 2, Confidence.HIGH),
            (CertificateSource.MODERATOR_VERIFIED, 2, 2, Confidence.HIGH),
            (CertificateSource.MODERATOR_VERIFIED, 1, 2, Confidence.MEDIUM),
            (CertificateSource.OFFICIAL_LIST, 1, 2, Confidence.MEDIUM),
            (CertificateSource.OFFICIAL_LIST, 1, 80, Confidence.LOW),
            (CertificateSource.OWNER_SUBMITTED, 1, 2, Confidence.LOW),
        ],
    )
    def test_confidence_bands(self, source, corroboration, age_days, expected):
        result = run(
            [
                make_cert(
                    source=source,
                    corroboration_count=corroboration,
                    verified_at=NOW - dt.timedelta(days=age_days),
                )
            ]
        )
        assert result.confidence == expected

    def test_confidence_is_a_band_not_a_number(self):
        result = run([make_cert()])
        assert isinstance(result.confidence, Confidence)
        assert not isinstance(result.confidence, int | float)


# ---------------------------------------------------------------------------
# Determinism, purity, and the shape of the output.
# ---------------------------------------------------------------------------


class TestDeterminismAndPurity:
    def test_same_input_same_output(self):
        certs = [
            make_cert(certificate_id="a", attributes={"glatt": True}),
            make_cert(certificate_id="b", certifier_id=OTHER),
        ]
        profile = make_profile(required=("glatt",))
        first = evaluate_kashrut(certs, profile, now=NOW)
        second = evaluate_kashrut(certs, profile, now=NOW)
        assert first == second

    def test_input_order_does_not_change_the_result(self):
        a = make_cert(certificate_id="a", source=CertificateSource.OFFICIAL_LIST)
        b = make_cert(certificate_id="b", source=CertificateSource.CERTIFIER_PORTAL)
        assert run([a, b]) == run([b, a])

    def test_inputs_are_not_mutated(self):
        attributes = {"glatt": True}
        cert = make_cert(attributes=attributes)
        run([cert], make_profile(required=("glatt", "yashan")))
        assert attributes == {"glatt": True}

    def test_duplicate_certificate_ids_are_rejected(self):
        # A duplicate id is corrupt input; silently collapsing it could hide a
        # certificate from the gate.
        with pytest.raises(ValueError, match="unique"):
            run([make_cert(certificate_id="dup"), make_cert(certificate_id="dup")])

    def test_now_is_required_and_explicit(self):
        # The engine has no hidden clock: forgetting `now` is a TypeError, and moving
        # `now` moves the verdict.
        with pytest.raises(TypeError):
            evaluate_kashrut([make_cert()], make_profile())  # type: ignore[call-arg]
        cert = make_cert(valid_until=TODAY + dt.timedelta(days=1))
        later = dt.datetime.combine(TODAY + dt.timedelta(days=2), dt.time(9), tzinfo=dt.UTC)
        assert evaluate_kashrut([cert], make_profile(), now=NOW).verdict == Verdict.MATCH
        assert evaluate_kashrut([cert], make_profile(), now=later).verdict == Verdict.UNKNOWN


class TestOutputShape:
    def test_result_is_frozen(self):
        result = run([make_cert()])
        with pytest.raises(dataclasses.FrozenInstanceError):
            result.verdict = Verdict.NO_MATCH  # type: ignore[misc]

    def test_verdict_is_strictly_ternary(self):
        assert {v.value for v in Verdict} == {"match", "no_match", "unknown"}

    def test_layer1_result_has_no_numeric_score_field(self):
        # Locked decision: kashrut is NEVER a percentage or score. Neither the result
        # nor the per-certificate evaluation may carry a score-like field, and no
        # top-level field value is numeric.
        from app.match.types import CertificateEvaluation

        forbidden = ("score", "percent", "rating", "rank")
        for cls in (MatchResult, CertificateEvaluation):
            for field in dataclasses.fields(cls):
                assert not any(word in field.name for word in forbidden), field.name
        result = run([make_cert()])
        for field in dataclasses.fields(result):
            value = getattr(result, field.name)
            assert not isinstance(value, int | float), field.name

    def test_verdicts_are_exhaustive_over_core_scenarios(self):
        # One sweep across the three verdicts, as a reader's summary.
        assert run([make_cert()]).verdict == Verdict.MATCH
        assert run([make_cert(certifier_id=OTHER)]).verdict == Verdict.NO_MATCH
        assert run([]).verdict == Verdict.UNKNOWN


class TestProfileInputCoercion:
    def test_profile_input_coerces_iterables(self):
        profile = ProfileInput(
            whitelist=[WhitelistEntry(BADATZ)], required_attributes=["glatt", "glatt"]
        )
        assert profile.whitelist == (WhitelistEntry(BADATZ),)
        assert profile.required_attributes == frozenset({"glatt"})

    def test_whitelist_entry_defaults_to_regular_minimum(self):
        assert WhitelistEntry(BADATZ).min_level == CertificationLevel.REGULAR
