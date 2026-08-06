"""Layer 1 — the kashrut gate. Pure, deterministic, exhaustively unit-tested.

PRD §17 semantics::

    MATCH    iff ∃ active, unexpired, fresh certificate C where
             C.certifier ∈ profile.whitelist (at ≥ required level)
             ∧ ∀ a ∈ profile.required_attributes: C.attributes[a] = true
    NO_MATCH iff data sufficient and condition fails
    UNKNOWN  otherwise (missing / expired / stale data)

Fail-safe rules (PRD §13, CLAUDE.md — locked):

* Doubt → UNKNOWN, never doubt → MATCH.
* Past expiry with no renewal evidence → UNKNOWN (auto-degrade), even if the stored
  state still says ACTIVE.
* The staleness clock always runs from ``verified_at`` — an unexpired validity window
  is not proof we would have noticed a revocation, so stale or missing verification
  evidence degrades to UNKNOWN even when ``valid_until`` lies in the future.
* Any certificate state this engine does not recognize is doubt → UNKNOWN; only the
  known non-active states (REVOKED) may be definitive.
* A required attribute that a certificate does not mention is *unknown*, not false:
  absence of evidence is not evidence. It blocks MATCH but does not prove NO_MATCH.
* No certificate at all → UNKNOWN (we don't know, we never guess).
* NO_MATCH is reserved for definitive facts: the certifier is known and not
  whitelisted, the published level is known and below the user's minimum, an attribute
  is explicitly false, or the certificate was revoked.

Halachic neutrality: this module compares published facts against the user's own
whitelist. It never ranks certifiers against each other and never rules on halacha.
The one level comparison used (``CERTIFICATION_LEVEL_ORDER``) is within a single
certifier's own published levels.

Purity contract: no database, no settings import, no clock — ``now`` is an explicit
parameter and ``freshness_days`` defaults to the same value as
``app.core.config.Settings.default_freshness_days`` without importing it.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence

from app.match.types import (
    CertificateEvaluation,
    CertificateInput,
    Confidence,
    FreshnessInfo,
    MatchResult,
    ProfileInput,
    Reason,
    ReasonCode,
    Verdict,
)
from app.models.enums import (
    CERTIFICATION_LEVEL_ORDER,
    SOURCE_AUTHORITY,
    CertificateState,
    CertificationLevel,
)

#: Mirrors ``Settings.default_freshness_days`` (app/core/config.py). Kept as a plain
#: constant so the engine never imports settings; callers pass the configured value.
DEFAULT_FRESHNESS_DAYS = 90

#: PRD §13 SLA: expiring certificates are surfaced 14 days early.
DEFAULT_EXPIRES_SOON_DAYS = 14

#: Verdict precedence when combining certificates: one MATCH suffices (§17 is
#: existential); otherwise any doubt beats a definitive NO_MATCH, because an
#: unresolved certificate means the data is *not* sufficient to declare NO_MATCH.
_VERDICT_PRECEDENCE: dict[Verdict, int] = {
    Verdict.MATCH: 0,
    Verdict.UNKNOWN: 1,
    Verdict.NO_MATCH: 2,
}


def evaluate_kashrut(
    certificates: Sequence[CertificateInput],
    profile: ProfileInput,
    *,
    now: dt.datetime,
    freshness_days: int = DEFAULT_FRESHNESS_DAYS,
    expires_soon_days: int = DEFAULT_EXPIRES_SOON_DAYS,
) -> MatchResult:
    """Evaluate one restaurant's certificates against one kashrut profile.

    Pure function: same inputs → same output, no I/O, no hidden clock. ``now`` should
    be timezone-aware Israel time at the call site; dates are compared against
    ``now.date()``.

    Returns a :class:`MatchResult` whose top-level reasons describe the *deciding*
    certificate — the best MATCH when there is one, otherwise the strongest evidence
    for the verdict — and whose ``evaluations`` carry every certificate for the full
    "Why?" evidence UI. Reason ordering is deterministic (canonical code order, then
    attribute name).

    Raises ``ValueError`` on duplicate ``certificate_id`` values — a duplicate id is
    corrupt input, and silently collapsing it could hide a certificate from the gate.
    """
    ids = [certificate.certificate_id for certificate in certificates]
    if len(set(ids)) != len(ids):
        raise ValueError("certificate_id values must be unique — duplicate ids are corrupt input")
    evaluations = [
        _evaluate_certificate(
            certificate,
            profile,
            now=now,
            freshness_days=freshness_days,
            expires_soon_days=expires_soon_days,
        )
        for certificate in certificates
    ]
    authority = {c.certificate_id: SOURCE_AUTHORITY[c.source] for c in certificates}
    recency = {c.certificate_id: c.verified_at for c in certificates}
    evaluations.sort(key=lambda ev: _ranking_key(ev, authority, recency))

    if not evaluations:
        return MatchResult(
            verdict=Verdict.UNKNOWN,
            reasons=(Reason(ReasonCode.NO_CERTIFICATE),),
            confidence=Confidence.LOW,
            freshness=None,
            deciding_certificate_id=None,
            evaluations=(),
        )

    deciding = evaluations[0]
    return MatchResult(
        verdict=deciding.outcome,
        reasons=deciding.reasons,
        confidence=deciding.confidence,
        freshness=deciding.freshness,
        deciding_certificate_id=deciding.certificate_id,
        evaluations=tuple(evaluations),
    )


def _ranking_key(
    evaluation: CertificateEvaluation,
    authority: dict[str, int],
    recency: dict[str, dt.datetime | None],
) -> tuple[int, int, int, float, str]:
    """Deterministic best-certificate ordering (PRD §13 source hierarchy).

    Precedence: outcome (MATCH > UNKNOWN > NO_MATCH), then source authority, then most
    recent verification, then certificate id as the final total-order tiebreak.
    """
    verified_at = recency[evaluation.certificate_id]
    return (
        _VERDICT_PRECEDENCE[evaluation.outcome],
        -authority[evaluation.certificate_id],
        0 if verified_at is not None else 1,
        -_as_utc(verified_at).timestamp() if verified_at is not None else 0.0,
        evaluation.certificate_id,
    )


def _evaluate_certificate(
    certificate: CertificateInput,
    profile: ProfileInput,
    *,
    now: dt.datetime,
    freshness_days: int,
    expires_soon_days: int,
) -> CertificateEvaluation:
    """Evaluate one certificate. Definitive failures → NO_MATCH; any doubt → UNKNOWN."""
    today = now.date()
    freshness = _freshness_info(
        certificate, now=now, freshness_days=freshness_days, expires_soon_days=expires_soon_days
    )
    confidence = _confidence(certificate, freshness, freshness_days)

    # Whitelist first: the user whitelists; the app never ranks certifiers.
    entry = _whitelist_lookup(profile, certificate.certifier_id)

    # Certificate state gates content evaluation: a certificate that is not in force
    # can never grant MATCH, so its published content is not weighed at all.
    state_reasons = _state_reasons(certificate, today)
    if state_reasons is not None:
        outcome, reasons = state_reasons
        if entry is None:
            # A certifier the user does not accept is definitive regardless of state:
            # the "Why?" UI must never imply this certificate would count once it is
            # renewed or approved.
            outcome = Verdict.NO_MATCH
            reasons = [Reason(ReasonCode.CERTIFIER_NOT_IN_WHITELIST), *reasons]
        return _finish(certificate, outcome, reasons, confidence, freshness)

    failures: list[Reason] = []
    doubts: list[Reason] = []
    positives: list[Reason] = []

    if entry is None:
        failures.append(Reason(ReasonCode.CERTIFIER_NOT_IN_WHITELIST))
    else:
        positives.append(Reason(ReasonCode.CERTIFIER_IN_WHITELIST))
        # min_level REGULAR (the base published level) means "any certificate from
        # this certifier" — required so official lists that publish no level (level
        # UNKNOWN) can still match; the "Any certification" preset must work from day
        # one (PRD §20 cold start). A minimum *above* the base is strict: UNKNOWN
        # never satisfies it (doubt about the level is doubt about the match).
        if entry != CertificationLevel.REGULAR:
            if certificate.level == CertificationLevel.UNKNOWN:
                doubts.append(Reason(ReasonCode.LEVEL_UNKNOWN))
            elif CERTIFICATION_LEVEL_ORDER[certificate.level] >= CERTIFICATION_LEVEL_ORDER[entry]:
                positives.append(Reason(ReasonCode.LEVEL_MEETS_MINIMUM))
            else:
                failures.append(Reason(ReasonCode.LEVEL_BELOW_MINIMUM))

    # Required attributes — tri-state: True / False / absent (= unknown, blocks MATCH).
    for attribute in sorted(profile.required_attributes):
        value = certificate.attributes.get(attribute)
        if value is True:
            positives.append(Reason(ReasonCode.ATTRIBUTE_PRESENT, attribute))
        elif value is False:
            failures.append(Reason(ReasonCode.ATTRIBUTE_FALSE, attribute))
        else:
            doubts.append(Reason(ReasonCode.ATTRIBUTE_UNKNOWN, attribute))

    # Freshness. The staleness clock *always* runs from verified_at: an unexpired
    # validity window records what the document says, but it is not proof we would
    # have noticed a revocation — stale or missing verification evidence is doubt,
    # and doubt → UNKNOWN, never → MATCH.
    if certificate.valid_until is not None:
        positives.append(Reason(ReasonCode.CERTIFICATE_VALID))
        if freshness.expires_soon:
            positives.append(Reason(ReasonCode.CERTIFICATE_EXPIRES_SOON))
    if freshness.verified_at is None:
        doubts.append(Reason(ReasonCode.NO_FRESHNESS_EVIDENCE))
    elif freshness.is_stale:
        doubts.append(Reason(ReasonCode.EVIDENCE_STALE))
    else:
        positives.append(Reason(ReasonCode.EVIDENCE_FRESH))

    if failures:
        outcome = Verdict.NO_MATCH
    elif doubts:
        outcome = Verdict.UNKNOWN
    else:
        outcome = Verdict.MATCH
    return _finish(certificate, outcome, positives + failures + doubts, confidence, freshness)


def _state_reasons(
    certificate: CertificateInput, today: dt.date
) -> tuple[Verdict, list[Reason]] | None:
    """Outcome forced by certificate state/dates, or None when content evaluation runs."""
    if certificate.state == CertificateState.REVOKED:
        # A revocation is a published fact — the one non-active state that is
        # definitive rather than doubtful.
        return Verdict.NO_MATCH, [Reason(ReasonCode.CERTIFICATE_REVOKED)]
    if certificate.state == CertificateState.PENDING:
        return Verdict.UNKNOWN, [Reason(ReasonCode.CERTIFICATE_PENDING)]
    if certificate.state == CertificateState.EXPIRED:
        return Verdict.UNKNOWN, [Reason(ReasonCode.CERTIFICATE_EXPIRED)]
    if certificate.state != CertificateState.ACTIVE:
        # Fail-safe default for any state this engine does not recognize (a future
        # enum member, corrupt input): doubt → UNKNOWN, never → MATCH.
        return Verdict.UNKNOWN, [Reason(ReasonCode.CERTIFICATE_STATE_UNRECOGNIZED)]
    # ACTIVE — but dates outrank the stored state (fail-safe: data lags reality).
    if certificate.valid_until is not None and certificate.valid_until < today:
        return Verdict.UNKNOWN, [Reason(ReasonCode.CERTIFICATE_EXPIRED)]
    if certificate.valid_from is not None and certificate.valid_from > today:
        return Verdict.UNKNOWN, [Reason(ReasonCode.CERTIFICATE_NOT_YET_VALID)]
    return None


def _whitelist_lookup(profile: ProfileInput, certifier_id: str) -> CertificationLevel | None:
    """Effective min_level for a certifier, or None if not whitelisted.

    Duplicate entries collapse to the most permissive minimum the user granted.
    """
    best: CertificationLevel | None = None
    for entry in profile.whitelist:
        if entry.certifier_id != certifier_id:
            continue
        if best is None or (
            CERTIFICATION_LEVEL_ORDER[entry.min_level] < CERTIFICATION_LEVEL_ORDER[best]
        ):
            best = entry.min_level
    return best


def _freshness_info(
    certificate: CertificateInput,
    *,
    now: dt.datetime,
    freshness_days: int,
    expires_soon_days: int,
) -> FreshnessInfo:
    today = now.date()
    age_days: int | None = None
    if certificate.verified_at is not None:
        age_days = (_as_utc(now) - _as_utc(certificate.verified_at)).days
    days_until_expiry: int | None = None
    if certificate.valid_until is not None:
        days_until_expiry = (certificate.valid_until - today).days
    # The staleness clock always runs from verified_at; an explicit validity window
    # never exempts it. No evidence date at all is stale by fail-safe.
    is_stale = age_days is None or age_days > freshness_days
    expires_soon = days_until_expiry is not None and 0 <= days_until_expiry <= expires_soon_days
    return FreshnessInfo(
        verified_at=certificate.verified_at,
        evidence_age_days=age_days,
        valid_until=certificate.valid_until,
        days_until_expiry=days_until_expiry,
        is_stale=is_stale,
        expires_soon=expires_soon,
    )


def _confidence(
    certificate: CertificateInput, freshness: FreshnessInfo, freshness_days: int
) -> Confidence:
    """Band per PRD §13: source authority × recency × corroboration. Never numeric
    in the output — a band cannot be misread as "percent kosher".
    """
    points = SOURCE_AUTHORITY[certificate.source]
    if certificate.corroboration_count >= 2:
        points += 1
    aging = freshness.evidence_age_days is None or freshness.evidence_age_days > freshness_days // 2
    if aging:
        points -= 1
    if points >= 5:
        return Confidence.HIGH
    if points >= 3:
        return Confidence.MEDIUM
    return Confidence.LOW


def _finish(
    certificate: CertificateInput,
    outcome: Verdict,
    reasons: list[Reason],
    confidence: Confidence,
    freshness: FreshnessInfo,
) -> CertificateEvaluation:
    return CertificateEvaluation(
        certificate_id=certificate.certificate_id,
        certifier_id=certificate.certifier_id,
        outcome=outcome,
        reasons=tuple(sorted(reasons, key=Reason.sort_key)),
        confidence=confidence,
        freshness=freshness,
    )


def _as_utc(value: dt.datetime) -> dt.datetime:
    """Naive datetimes are taken as UTC so aware/naive inputs never raise mid-verdict."""
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value
