"""Domain enums.

Every value here is a *fact as published* — a label a certifier or a source document
uses. Nothing in this module ranks certifiers or rules on halacha (PRD §13, AGENTS.md).
The one ordering that exists (CERTIFICATION_LEVEL_ORDER) is *within* a single certifier,
which publishes its own levels; it is never used to compare one certifier to another.
"""

from __future__ import annotations

from enum import StrEnum

import sqlalchemy as sa


def pg_enum(enum_cls: type[StrEnum], name: str) -> sa.Enum:
    """Native PG enum bound to a Python StrEnum, stored by value."""
    return sa.Enum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


class DietType(StrEnum):
    MEAT = "meat"
    DAIRY = "dairy"
    PAREVE = "pareve"
    FISH = "fish"
    MIXED = "mixed"
    DAIRY_PAREVE = "dairy_pareve"


class RestaurantStatus(StrEnum):
    OPEN = "open"
    CLOSED_TEMP = "closed_temp"
    CLOSED_PERM = "closed_perm"


class RecordState(StrEnum):
    """How well a *restaurant* record itself is established (PRD §13)."""

    LIST_VERIFIED = "list_verified"
    MODERATOR_VERIFIED = "moderator_verified"
    OWNER_SUBMITTED = "owner_submitted"
    FIELD_VERIFIED = "field_verified"
    UNKNOWN_PENDING_VERIFICATION = "unknown_pending_verification"


class CertifierType(StrEnum):
    RABBANUT_LOCAL = "rabbanut_local"
    RABBANUT_NATIONAL = "rabbanut_national"
    BADATZ = "badatz"
    PRIVATE = "private"


class CertificationLevel(StrEnum):
    """Level as published by the issuing certifier on the certificate itself."""

    UNKNOWN = "unknown"
    REGULAR = "regular"
    MEHADRIN = "mehadrin"


#: Ordering *within one certifier's own published levels* — used only to evaluate a
#: profile whitelist entry's ``min_level``. UNKNOWN never satisfies a minimum.
CERTIFICATION_LEVEL_ORDER: dict[CertificationLevel, int] = {
    CertificationLevel.UNKNOWN: -1,
    CertificationLevel.REGULAR: 0,
    CertificationLevel.MEHADRIN: 1,
}


class CertificateSource(StrEnum):
    """Source hierarchy of PRD §13, most authoritative first."""

    CERTIFIER_PORTAL = "certifier_portal"
    OFFICIAL_LIST = "official_list"
    MODERATOR_VERIFIED = "moderator_verified"
    OWNER_SUBMITTED = "owner_submitted"
    FIELD_VERIFICATION = "field_verification"


#: Higher = more authoritative. Feeds the internal confidence score
#: (source authority × recency × corroboration). Community flags are absent by
#: design: a flag can never be the source of a certificate.
SOURCE_AUTHORITY: dict[CertificateSource, int] = {
    CertificateSource.CERTIFIER_PORTAL: 5,
    CertificateSource.MODERATOR_VERIFIED: 4,
    CertificateSource.OFFICIAL_LIST: 3,
    CertificateSource.FIELD_VERIFICATION: 2,
    CertificateSource.OWNER_SUBMITTED: 1,
}


class CertificateState(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    PENDING = "pending"


class CertificateAttribute(StrEnum):
    """Keys allowed in ``Certificate.attributes`` (PRD §16 — per certificate, not per
    certifier). The JSONB column is tri-state: ``True`` / ``False`` / key absent =
    unknown. Absent is never read as satisfied — that is the fail-safe rule.
    """

    GLATT = "glatt"
    CHALAV_YISRAEL = "chalav_yisrael"
    PAS_YISRAEL = "pas_yisrael"
    BISHUL_YISRAEL = "bishul_yisrael"
    YASHAN = "yashan"
    KITNIYOT_PESACH = "kitniyot_pesach"
    SHERUYA = "sheruya"


class EvidencePhotoStatus(StrEnum):
    """Review lifecycle of a certificate evidence photo (PRD §13, source level 2).

    Fail-safe: only an ACCEPTED photo may ever feed certificate attributes, expiry
    dates or a source upgrade. PENDING_REVIEW and REJECTED photos change nothing.
    """

    PENDING_REVIEW = "pending_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class AmenityKey(StrEnum):
    """Keys allowed in ``Restaurant.amenities`` — soft preferences (Layer 2 only)."""

    FAMILY = "family"
    PARKING = "parking"
    ACCESSIBILITY = "accessibility"
    DELIVERY = "delivery"
    GROUPS = "groups"


class HoursRuleType(StrEnum):
    """Israel hours logic (AGENTS.md): weekly grid + Shabbat/chag overrides."""

    WEEKLY = "weekly"
    EREV_SHABBAT = "erev_shabbat"
    SHABBAT = "shabbat"
    EREV_CHAG = "erev_chag"
    CHAG = "chag"
    CHOL_HAMOED = "chol_hamoed"


class PhotoKind(StrEnum):
    STOREFRONT = "storefront"
    INTERIOR = "interior"
    FOOD = "food"
    MENU = "menu"
    CERTIFICATE = "certificate"


class FlagType(StrEnum):
    CLOSED = "closed"
    NO_CERTIFICATE_DISPLAYED = "no_certificate_displayed"
    DIFFERENT_CERTIFIER = "different_certifier"
    EXPIRED_CERTIFICATE = "expired_certificate"
    WRONG_DETAILS = "wrong_details"
    WRONG_HOURS = "wrong_hours"
    OTHER = "other"


class FlagState(StrEnum):
    OPEN = "open"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class OwnerClaimState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVOKED = "revoked"


class UserRole(StrEnum):
    USER = "user"
    OWNER = "owner"
    MODERATOR = "moderator"
    ADMIN = "admin"


class Language(StrEnum):
    HE = "he"
    EN = "en"


class SourceDocumentKind(StrEnum):
    PDF = "pdf"
    IMAGE = "image"
    WEB = "web"
    API = "api"
    PORTAL = "portal"
    MANUAL = "manual"


class IngestionRunState(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AuditAction(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    STATE_CHANGE = "state_change"


#: Every PG enum type name created by migrations, in creation order (0001 creates all
#: but the last; evidence_photo_status is added by 0004). Keep in sync with
#: ``alembic/versions/``.
ENUM_TYPES: dict[str, type[StrEnum]] = {
    "diet_type": DietType,
    "restaurant_status": RestaurantStatus,
    "record_state": RecordState,
    "certifier_type": CertifierType,
    "certification_level": CertificationLevel,
    "certificate_source": CertificateSource,
    "certificate_state": CertificateState,
    "hours_rule_type": HoursRuleType,
    "photo_kind": PhotoKind,
    "flag_type": FlagType,
    "flag_state": FlagState,
    "owner_claim_state": OwnerClaimState,
    "user_role": UserRole,
    "language": Language,
    "source_document_kind": SourceDocumentKind,
    "ingestion_run_state": IngestionRunState,
    "audit_action": AuditAction,
    "evidence_photo_status": EvidencePhotoStatus,
}
