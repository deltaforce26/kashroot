"""Kashroot match engine — pure functions over (Certificate × Profile).

Two layers, never blended (PRD §17, CLAUDE.md locked decisions):

* **Layer 1 — kashrut gate** (:func:`evaluate_kashrut`): binary, deterministic,
  explainable. Verdict is MATCH / NO_MATCH / UNKNOWN plus machine-readable reason
  codes. Kashrut is never a percentage.
* **Layer 2 — fit score** (:func:`compute_fit_score`): 0–100 over *soft preferences
  only* (distance, open-now, price, amenities, diet). It neither reads nor alters the
  Layer 1 verdict.

Halachic neutrality: nothing here rules on halacha. The app reports published facts
(who certifies, at what published level, with which published attributes) against the
user's own whitelist. Doubt → UNKNOWN, never doubt → MATCH.

This package performs no I/O and never touches the database. Time enters only through
the explicit ``now`` parameter.
"""

from app.match.engine import DEFAULT_EXPIRES_SOON_DAYS, DEFAULT_FRESHNESS_DAYS, evaluate_kashrut
from app.match.fit import (
    DEFAULT_FIT_WEIGHTS,
    FitCandidate,
    FitComponent,
    FitPreferences,
    FitScoreResult,
    FitWeights,
    compute_fit_score,
)
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
    WhitelistEntry,
)

__all__ = [
    "DEFAULT_EXPIRES_SOON_DAYS",
    "DEFAULT_FIT_WEIGHTS",
    "DEFAULT_FRESHNESS_DAYS",
    "CertificateEvaluation",
    "CertificateInput",
    "Confidence",
    "FitCandidate",
    "FitComponent",
    "FitPreferences",
    "FitScoreResult",
    "FitWeights",
    "FreshnessInfo",
    "MatchResult",
    "ProfileInput",
    "Reason",
    "ReasonCode",
    "Verdict",
    "WhitelistEntry",
    "compute_fit_score",
    "evaluate_kashrut",
]
