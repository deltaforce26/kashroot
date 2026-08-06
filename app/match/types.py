"""Input and output types for the Layer 1 kashrut gate.

Everything here is a plain frozen dataclass or enum — no SQLAlchemy, no sessions, no
I/O. The API layer builds :class:`CertificateInput` / :class:`ProfileInput` from ORM
rows; tests build them directly. That keeps the engine a pure function that can be
exhaustively unit-tested without a database.

Deliberate absence: **no numeric score anywhere in the Layer 1 output.** The kashrut
verdict is categorical (MATCH / NO_MATCH / UNKNOWN) with reason codes; confidence is a
band, freshness is dates and day counts. "92% kosher" must be unrepresentable.

Halachic neutrality: these types carry published facts and the user's own whitelist.
Nothing ranks certifiers or rules on halacha.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from app.models.enums import CertificateSource, CertificateState, CertificationLevel


class Verdict(StrEnum):
    """Layer 1 outcome. Categorical — never a score, never blended with fit."""

    MATCH = "match"
    NO_MATCH = "no_match"
    UNKNOWN = "unknown"


class Confidence(StrEnum):
    """Internal confidence *band* (PRD §13: source authority × recency × corroboration).

    Surfaced as freshness UI, never as a "percent kosher". A band, not a number, so it
    cannot be mistaken for — or arithmetically combined into — a kashrut score.
    """

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReasonCode(StrEnum):
    """Machine-readable reason codes powering the "Why does this match?" UI (PRD §17).

    Definition order here **is** the canonical display order: positive evidence first,
    then problems. :func:`app.match.engine.evaluate_kashrut` sorts every reason list by
    this order (then by attribute name), so output is deterministic.
    """

    # Positive evidence.
    CERTIFIER_IN_WHITELIST = "certifier_in_whitelist"
    LEVEL_MEETS_MINIMUM = "level_meets_minimum"
    ATTRIBUTE_PRESENT = "attribute_present"
    CERTIFICATE_VALID = "certificate_valid"
    EVIDENCE_FRESH = "evidence_fresh"
    # Informational (does not change the verdict).
    CERTIFICATE_EXPIRES_SOON = "certificate_expires_soon"
    # Definitive failures (data sufficient, condition fails → NO_MATCH).
    CERTIFIER_NOT_IN_WHITELIST = "certifier_not_in_whitelist"
    LEVEL_BELOW_MINIMUM = "level_below_minimum"
    ATTRIBUTE_FALSE = "attribute_false"
    CERTIFICATE_REVOKED = "certificate_revoked"
    # Doubt (→ UNKNOWN, never → MATCH).
    NO_CERTIFICATE = "no_certificate"
    LEVEL_UNKNOWN = "level_unknown"
    ATTRIBUTE_UNKNOWN = "attribute_unknown"
    CERTIFICATE_EXPIRED = "certificate_expired"
    CERTIFICATE_NOT_YET_VALID = "certificate_not_yet_valid"
    CERTIFICATE_PENDING = "certificate_pending"
    #: Fail-safe for certificate states this engine does not recognize.
    CERTIFICATE_STATE_UNRECOGNIZED = "certificate_state_unrecognized"
    EVIDENCE_STALE = "evidence_stale"
    NO_FRESHNESS_EVIDENCE = "no_freshness_evidence"


#: Canonical sort index for deterministic reason ordering.
REASON_ORDER: dict[ReasonCode, int] = {code: index for index, code in enumerate(ReasonCode)}


@dataclass(frozen=True, slots=True)
class Reason:
    """One reason-code instance; ``attribute`` is set for per-attribute codes."""

    code: ReasonCode
    #: CertificateAttribute value for ATTRIBUTE_* codes, else None.
    attribute: str | None = None

    def sort_key(self) -> tuple[int, str]:
        return (REASON_ORDER[self.code], self.attribute or "")


@dataclass(frozen=True)
class CertificateInput:
    """The facts of one certificate, as published and verified — nothing more.

    ``attributes`` is tri-state exactly like ``Certificate.attributes``: ``True`` /
    ``False`` / key absent = unknown. Absent never satisfies a requirement.
    """

    certificate_id: str
    certifier_id: str
    state: CertificateState
    level: CertificationLevel = CertificationLevel.UNKNOWN
    attributes: Mapping[str, bool] = field(default_factory=dict)
    valid_from: dt.date | None = None
    #: None = expiry unknown (published lists carry no window); freshness governs then.
    valid_until: dt.date | None = None
    #: When the evidence was last confirmed; drives the staleness clock, which runs
    #: even when an explicit validity window exists (a window is not proof we would
    #: have noticed a revocation). Naive datetimes are interpreted as UTC — the
    #: storage convention for ``Certificate.verified_at``.
    verified_at: dt.datetime | None = None
    source: CertificateSource = CertificateSource.OFFICIAL_LIST
    corroboration_count: int = 1


@dataclass(frozen=True, slots=True)
class WhitelistEntry:
    """One (certifier, min_level) pair from the user's whitelist.

    ``min_level == REGULAR`` (the base published level) means "any certificate from
    this certifier". A minimum *above* the base (MEHADRIN) is never satisfied by an
    UNKNOWN published level — doubt about the level is doubt about the match.
    """

    certifier_id: str
    min_level: CertificationLevel = CertificationLevel.REGULAR


@dataclass(frozen=True)
class ProfileInput:
    """The user's kashrut profile: whitelist + required attributes. The user decides
    what they accept; the engine only checks published facts against that decision.
    """

    whitelist: tuple[WhitelistEntry, ...] = ()
    #: CertificateAttribute values; each must be explicitly True for MATCH.
    required_attributes: frozenset[str] = frozenset()

    def __init__(
        self,
        whitelist: Iterable[WhitelistEntry] = (),
        required_attributes: Iterable[str] = (),
    ) -> None:
        object.__setattr__(self, "whitelist", tuple(whitelist))
        object.__setattr__(self, "required_attributes", frozenset(required_attributes))


@dataclass(frozen=True, slots=True)
class FreshnessInfo:
    """Freshness facts for the "verified X days ago" UI. Day counts, never a score."""

    verified_at: dt.datetime | None
    #: Whole days since ``verified_at`` at evaluation time; None when never verified.
    evidence_age_days: int | None
    valid_until: dt.date | None
    #: Days from evaluation date to ``valid_until``; negative = past expiry.
    days_until_expiry: int | None
    #: Staleness-clock failure: verification evidence is missing or older than the
    #: freshness window. Runs even when an explicit validity window exists.
    is_stale: bool
    expires_soon: bool


@dataclass(frozen=True, slots=True)
class CertificateEvaluation:
    """Per-certificate verdict + full evidence, for the expandable "Why?" UI."""

    certificate_id: str
    certifier_id: str
    outcome: Verdict
    reasons: tuple[Reason, ...]
    confidence: Confidence
    freshness: FreshnessInfo


@dataclass(frozen=True, slots=True)
class MatchResult:
    """Layer 1 result for one restaurant against one profile.

    ``verdict``, ``reasons``, ``confidence`` and ``freshness`` describe the *deciding*
    certificate (best MATCH if any; otherwise the strongest evidence for the verdict).
    ``evaluations`` carries every certificate's evaluation for the full evidence UI.

    There is intentionally no numeric field here: kashrut is never a percentage.
    """

    verdict: Verdict
    reasons: tuple[Reason, ...]
    confidence: Confidence
    freshness: FreshnessInfo | None
    deciding_certificate_id: str | None
    evaluations: tuple[CertificateEvaluation, ...]
