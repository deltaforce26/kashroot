"""Kashroot POC demo slice — Track A7 (POC_PLAN.md, demo Thu 20 Aug 2026).

THIS WRITES FABRICATED DEMO DATA. It is not moderator verification of a real
physical certificate; no certificate photo exists for any row below. The seed
corpus (data/seed/kashroot_seed_corpus.csv) carries certifier + status only —
no attributes, no expiry dates (data/README.md) — so no profile requiring any
attribute can ever return MATCH against it. This script overlays attributes
and expiry on ~18 existing certificates in Jerusalem and Bnei Brak so the
match engine's Layer 1 verdict (MATCH / NO_MATCH / UNKNOWN) is demoable on
real data paths, with a realistic spread of all three outcomes.

Every touched row is unmistakably marked as demo data, never silently mixed
into the verified corpus:
  * ``is_demo_seed`` is always set ``True`` — the structured, queryable flag
    that distinguishes fabricated rows from genuine provenance even when
    ``source`` reads MODERATOR_VERIFIED for both (belt and braces with the
    two markers below, not a replacement for them).
  * ``verified_by_label`` is always ``DEMO_SEED_LABEL`` (never a real
    moderator name).
  * ``notes`` carries ``DEMO_DISCLAIMER`` verbatim.
  * ``source`` becomes MODERATOR_VERIFIED only where SOURCE_AUTHORITY ranks
    it strictly higher than what the certificate already had (the same rule
    the real photo-review flow uses) — never REGRESSING an existing higher
    source.

Re-runnable: every row is addressed by a fixed ``certificate_id`` and the
script only ever SETs the same target values, so running it twice converges
to the same state (plus one extra audit row per run, which is the honest
record of "this was re-applied").

Run: ``python -m scripts.seed_demo_attributes``
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.models import AuditAction, AuditLog, Certificate
from app.models.enums import SOURCE_AUTHORITY, CertificateSource, CertificateState

DEMO_SEED_LABEL = "DEMO-SEED (POC 2026-08-20, not a real moderator review)"
DEMO_DISCLAIMER = (
    "FABRICATED FOR THE POC DEMO. Attributes/expiry are not sourced from a real "
    "physical certificate photo. See scripts/seed_demo_attributes.py."
)
DEMO_ACTOR = "track-a-poc:A7"
AUDIT_REASON_KEY = "reason"
AUDIT_REASON_VALUE = "poc_demo_slice_seed"


@dataclass(frozen=True)
class DemoCertificate:
    """One certificate row to overlay with fabricated demo attributes."""

    certificate_id: uuid.UUID
    label: str
    scenario: str
    attributes: dict[str, bool]
    valid_until: dt.date | None
    revoke: bool = False


#: 18 certificates across Jerusalem + Bnei Brak, spanning MATCH / NO_MATCH
#: (attribute conflict and revocation) / UNKNOWN (attribute gap and expiry) so
#: every Layer 1 verdict is demoable against a machmir profile requiring
#: glatt + chalav_yisrael + pas_yisrael + bishul_yisrael. Each ``label`` is
#: the restaurant name at authoring time, for human review only — the join
#: key is always ``certificate_id``.
DEMO_SLICE: tuple[DemoCertificate, ...] = (
    DemoCertificate(
        uuid.UUID("73883702-0b0a-499b-9b7e-edfabb780c6c"),
        "אייס סטורי (Jerusalem, Eda Haredit)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 6, 1),
    ),
    DemoCertificate(
        uuid.UUID("a76c48bb-23f5-41e4-aaa0-95baed3ef4e9"),
        "ביג בייט (Jerusalem, Eda Haredit)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 3, 1),
    ),
    DemoCertificate(
        uuid.UUID("d3cb4f1b-4df1-4218-8ebc-aab13619468a"),
        "ברכת משה (Jerusalem, Eda Haredit)",
        "no_match_attribute",
        {"glatt": True, "chalav_yisrael": False, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 1, 1),
    ),
    DemoCertificate(
        uuid.UUID("86f4a696-10e0-4d67-9ef4-39ea75301cac"),
        "היימישע בייגל (Jerusalem, Eda Haredit)",
        "unknown_attribute_gap",
        {"pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 1, 1),
    ),
    DemoCertificate(
        uuid.UUID("2652c6d6-5486-4580-9956-5f320d593944"),
        "בית מלון בוטיק ביכורים (Jerusalem, Eda Haredit)",
        "no_match_revoked",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        None,
        revoke=True,
    ),
    DemoCertificate(
        uuid.UUID("791dd841-6c8b-45f7-90c2-7619b8b08620"),
        "אדמה ציפס (Jerusalem, Mehadrin Rubin)",
        "match_freshness_override",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 4, 1),
    ),
    DemoCertificate(
        uuid.UUID("0947ddc6-fd3b-45de-aa40-218b35be1f58"),
        "דנבר סטייק האוס (Jerusalem, Mehadrin Rubin)",
        "unknown_expired",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2026, 7, 1),
    ),
    DemoCertificate(
        uuid.UUID("d26cf1ab-87c4-47ac-a6c4-b0c2397573af"),
        "חומוס אליהו (Jerusalem, Mehadrin Rubin)",
        "no_match_attribute",
        {"glatt": False, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 2, 1),
    ),
    DemoCertificate(
        uuid.UUID("495da2cc-40f0-43c3-8d66-4c45e3dd6969"),
        "הרימון (Jerusalem, Rabbanut Bnei Brak)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 5, 1),
    ),
    DemoCertificate(
        uuid.UUID("f006973b-3f24-4f8e-9c50-11543a256bcf"),
        "אולמי דונולו (Bnei Brak, Rabbanut Bnei Brak)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 6, 1),
    ),
    DemoCertificate(
        uuid.UUID("72d53899-ec94-4846-ad55-a3dd85d82dd7"),
        "אולמי השמחות (Bnei Brak, Rabbanut Bnei Brak)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 5, 1),
    ),
    DemoCertificate(
        uuid.UUID("204f3746-e4ec-4e21-80ef-0ab96718b926"),
        "אירוע מושלם (Bnei Brak, Rabbanut Bnei Brak)",
        "no_match_attribute",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": False, "bishul_yisrael": True},
        dt.date(2027, 1, 1),
    ),
    DemoCertificate(
        uuid.UUID("e348fbdc-8884-4efa-9b16-89d4de62a32e"),
        "אריסטוקרט (Bnei Brak, Rabbanut Bnei Brak)",
        "unknown_attribute_gap",
        {"glatt": True},
        dt.date(2027, 1, 1),
    ),
    DemoCertificate(
        uuid.UUID("adbe9390-bc84-4e4f-a848-ec69256ddb6b"),
        "גולד (Bnei Brak, Rabbanut Bnei Brak)",
        "no_match_revoked",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        None,
        revoke=True,
    ),
    DemoCertificate(
        uuid.UUID("db523156-4f6b-41a5-99e6-9abb7abcbe02"),
        "הערינגס' (Bnei Brak, Mehadrin Rubin)",
        "match_freshness_override",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 3, 1),
    ),
    DemoCertificate(
        uuid.UUID("5392b2d6-db30-45b8-a4dd-ed9bd138173c"),
        "זיסלק (Bnei Brak, Mehadrin Rubin)",
        "unknown_expired",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2026, 6, 1),
    ),
    DemoCertificate(
        uuid.UUID("94437c78-0f01-4be3-a03a-8d238f3c9168"),
        "סושי טיים (Bnei Brak, Rabbanut Bnei Brak)",
        "no_match_attribute",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": False},
        dt.date(2027, 2, 1),
    ),
    DemoCertificate(
        uuid.UUID("9c99819b-fc45-4fa9-ae55-c0e9d41bf22c"),
        "גני הדקל (Bnei Brak, Rabbanut Bnei Brak)",
        "match",
        {"glatt": True, "chalav_yisrael": True, "pas_yisrael": True, "bishul_yisrael": True},
        dt.date(2027, 6, 1),
    ),
)


def apply_demo_slice() -> dict[str, int]:
    """Overlay ``DEMO_SLICE`` onto its target certificates and commit.

    Return:
        dict[str, int]: scenario name -> count applied, plus "missing" for any
            ``certificate_id`` no longer present in the database.
    """
    counts: dict[str, int] = {}
    with session_scope() as session:
        for demo in DEMO_SLICE:
            certificate = session.get(Certificate, demo.certificate_id)
            if certificate is None:
                counts["missing"] = counts.get("missing", 0) + 1
                continue
            _apply_one(session, certificate, demo)
            counts[demo.scenario] = counts.get(demo.scenario, 0) + 1

    return counts


def _apply_one(session: Session, certificate: Certificate, demo: DemoCertificate) -> None:
    """Write one demo certificate's fabricated attributes/expiry/state.

    Parameters:
        session (Session): Active SQLAlchemy session (transaction owned by the caller).
        certificate (Certificate): The row being overlaid.
        demo (DemoCertificate): The target scenario and values.
    """
    before = {
        "attributes": certificate.attributes,
        "valid_until": certificate.valid_until.isoformat() if certificate.valid_until else None,
        "state": certificate.state.value,
        "source": certificate.source.value,
    }
    certificate.attributes = demo.attributes
    certificate.valid_until = demo.valid_until
    certificate.is_demo_seed = True
    certificate.verified_by_label = DEMO_SEED_LABEL
    certificate.verified_at = dt.datetime.now(dt.UTC)
    certificate.notes = DEMO_DISCLAIMER
    if (
        SOURCE_AUTHORITY[CertificateSource.MODERATOR_VERIFIED]
        > SOURCE_AUTHORITY[certificate.source]
    ):
        certificate.source = CertificateSource.MODERATOR_VERIFIED
    if demo.revoke:
        certificate.state = CertificateState.REVOKED
    after = {
        "attributes": certificate.attributes,
        "valid_until": certificate.valid_until.isoformat() if certificate.valid_until else None,
        "state": certificate.state.value,
        "source": certificate.source.value,
    }
    session.add(
        AuditLog(
            entity_type="certificate",
            entity_id=certificate.id,
            action=AuditAction.UPDATE,
            changes={"before": before, "after": after},
            actor=DEMO_ACTOR,
            evidence={
                AUDIT_REASON_KEY: AUDIT_REASON_VALUE,
                "label": demo.label,
                "scenario": demo.scenario,
            },
        )
    )


if __name__ == "__main__":
    result = apply_demo_slice()
    total = sum(n for scenario, n in result.items() if scenario != "missing")
    print(f"demo slice applied — {total} certificates ({DEMO_SEED_LABEL})")
    for scenario, n in sorted(result.items()):
        print(f"  {scenario:<28} {n}")
