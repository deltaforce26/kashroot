"""All ORM models. Importing this package registers every table on ``Base.metadata`` —
Alembic's env.py relies on that, so any new model file must be imported here.
"""

from app.db.base import Base
from app.models.certificate import Certificate, CertificateEvidencePhoto, validate_attributes
from app.models.certifier import Certifier, SourceDocument
from app.models.enums import (
    CERTIFICATION_LEVEL_ORDER,
    ENUM_TYPES,
    SOURCE_AUTHORITY,
    AmenityKey,
    AuditAction,
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    CertifierType,
    DietType,
    EvidencePhotoStatus,
    FlagState,
    FlagType,
    HoursRuleType,
    IngestionRunState,
    Language,
    OwnerClaimState,
    PhotoKind,
    RecordState,
    RestaurantStatus,
    SourceDocumentKind,
    UserRole,
)
from app.models.geocode import GeocodeCache
from app.models.moderation import AuditLog, Flag, IngestionRun, OwnerClaim
from app.models.restaurant import OpeningHours, Restaurant, RestaurantPhoto
from app.models.user import (
    ProfileCertifierWhitelist,
    SavedList,
    SavedListItem,
    User,
    UserProfile,
)

__all__ = [
    "CERTIFICATION_LEVEL_ORDER",
    "ENUM_TYPES",
    "SOURCE_AUTHORITY",
    "AmenityKey",
    "AuditAction",
    "AuditLog",
    "Base",
    "Certificate",
    "CertificateAttribute",
    "CertificateEvidencePhoto",
    "CertificateSource",
    "CertificateState",
    "CertificationLevel",
    "Certifier",
    "CertifierType",
    "DietType",
    "EvidencePhotoStatus",
    "Flag",
    "FlagState",
    "FlagType",
    "GeocodeCache",
    "HoursRuleType",
    "IngestionRun",
    "IngestionRunState",
    "Language",
    "OpeningHours",
    "OwnerClaim",
    "OwnerClaimState",
    "PhotoKind",
    "ProfileCertifierWhitelist",
    "RecordState",
    "Restaurant",
    "RestaurantPhoto",
    "RestaurantStatus",
    "SavedList",
    "SavedListItem",
    "SourceDocument",
    "SourceDocumentKind",
    "User",
    "UserProfile",
    "UserRole",
    "validate_attributes",
]
