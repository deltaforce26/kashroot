"""Pydantic schemas for the admin/moderation API.

Explicit response models only — ORM rows never leak past this module. All datetimes
serialize as UTC ISO 8601; naive datetimes coming back from the driver are stored UTC
by convention and are stamped accordingly here.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    HttpUrl,
    StrictBool,
    field_validator,
    model_validator,
)

from app.models.enums import (
    AuditAction,
    CertificateAttribute,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    DietType,
    EvidencePhotoStatus,
    FlagState,
    FlagType,
    RecordState,
    RestaurantStatus,
)


def _ensure_utc(value: dt.datetime) -> dt.datetime:
    """Naive datetimes are UTC by convention (SQLite test driver drops tzinfo)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


UTCDateTime = Annotated[dt.datetime, AfterValidator(_ensure_utc)]


def _blank_to_none(value: Any) -> Any:
    """Treat empty / whitespace-only strings as "not provided"."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


#: HttpUrl that accepts ""/whitespace as None instead of failing URL validation.
BlankableHttpUrl = Annotated[HttpUrl | None, BeforeValidator(_blank_to_none)]

#: Optional free text where ""/whitespace means "clear this field" rather than
#: "set it to an empty string" — the DB records absence as NULL, never as "".
OptionalText = Annotated[str | None, BeforeValidator(_blank_to_none)]

ItemT = TypeVar("ItemT")


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[ItemT]):
    """Simple limit/offset page with total count."""

    total: int
    limit: int
    offset: int
    items: list[ItemT]


# --------------------------------------------------------------------------- entities


class CertifierBrief(APIModel):
    """Display identity of a certifier for console rows. Names only — the console must
    never receive (or invent) a ranking for a certifier.
    """

    name_he: str
    name_en: str | None


class CertificateOut(APIModel):
    id: uuid.UUID
    restaurant_id: uuid.UUID
    certifier_id: uuid.UUID
    certifier: CertifierBrief | None
    level: CertificationLevel
    attributes: dict[str, bool]
    valid_from: dt.date | None
    valid_until: dt.date | None
    state: CertificateState
    source: CertificateSource
    source_document_id: uuid.UUID | None
    evidence_photo_key: str | None
    verified_by_label: str | None
    verified_at: UTCDateTime | None
    corroboration_count: int
    notes: str | None


class RestaurantBrief(APIModel):
    """Restaurant with its review/provenance fields — no geo, no hours."""

    id: uuid.UUID
    name_he: str
    name_en: str | None
    branch_label: str | None
    address_he: str | None
    city_he: str | None
    city_slug: str | None
    phone: str | None
    diet_type: DietType | None
    status: RestaurantStatus
    record_state: RecordState
    needs_review: bool
    corroboration_count: int
    notes: str | None
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ReviewQueueItem(RestaurantBrief):
    certificates: list[CertificateOut]


class FlagOut(APIModel):
    id: uuid.UUID
    restaurant_id: uuid.UUID
    certificate_id: uuid.UUID | None
    type: FlagType
    state: FlagState
    message: str | None
    photo_key: str | None
    resolution: str | None
    resolved_at: UTCDateTime | None
    created_at: UTCDateTime
    restaurant: RestaurantBrief
    certificate: CertificateOut | None


class ExpiryQueueItem(BaseModel):
    certificate: CertificateOut
    restaurant: RestaurantBrief
    #: Negative when the certificate is already past its valid_until.
    days_until_expiry: int


class EvidencePhotoOut(APIModel):
    id: uuid.UUID
    certificate_id: uuid.UUID
    storage_key: str
    content_type: str
    size_bytes: int
    sha256: str
    status: EvidencePhotoStatus
    uploaded_by: str
    uploaded_at: UTCDateTime
    reviewed_by: str | None
    reviewed_at: UTCDateTime | None
    review_note: str | None
    #: Presigned GET URL (short-lived), minted per response — never stored.
    view_url: str | None = None


class PhotoQueueItem(BaseModel):
    photo: EvidencePhotoOut
    certificate: CertificateOut
    restaurant: RestaurantBrief


class AuditLogOut(APIModel):
    id: uuid.UUID
    #: Monotonic append order — the authoritative "newest first" sort key.
    seq: int
    entity_type: str
    entity_id: uuid.UUID | None
    action: AuditAction
    changes: dict[str, Any]
    actor: str | None
    evidence: dict[str, Any]
    ingestion_run_id: uuid.UUID | None
    created_at: UTCDateTime


# --------------------------------------------------------------------------- requests


MIN_NOTE_LENGTH = 5


class ResolveReviewRequest(BaseModel):
    """``note`` is required (min 5 chars after strip) for ``reject`` and
    ``needs_more_info`` — those decisions are meaningless in the audit trail without
    one. ``approve`` may omit it (FR8 audit quality; enforced server-side).
    """

    resolution: Literal["approve", "reject", "needs_more_info"]
    note: str | None = None

    @model_validator(mode="after")
    def _note_required_unless_approve(self) -> ResolveReviewRequest:
        note = (self.note or "").strip() or None
        self.note = note
        if self.resolution != "approve" and (note is None or len(note) < MIN_NOTE_LENGTH):
            raise ValueError(
                f"note (min {MIN_NOTE_LENGTH} chars) is required for "
                f"'{self.resolution}' resolutions"
            )
        return self


class ResolveFlagRequest(BaseModel):
    """The complete set of flag outcomes. There is deliberately no outcome that can
    raise a kashrut status (PRD §13: flags only trigger review or degrade) — any other
    value is rejected at validation time, and the degrade path is additionally guarded
    at runtime in the router.

    ``note`` is required for every outcome (min 5 chars after strip): a flag
    resolution without a stated reason is worthless in the audit trail.
    """

    outcome: Literal["dismissed", "confirmed_degrade", "needs_field_check"]
    note: str

    @field_validator("note")
    @classmethod
    def _note_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < MIN_NOTE_LENGTH:
            raise ValueError(f"note must be at least {MIN_NOTE_LENGTH} characters")
        return value


class DegradeRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("reason must not be blank")
        return value


class ReviewPhotoRequest(BaseModel):
    """Moderator review of a certificate evidence photo — the core of source-hierarchy
    level 2 (PRD §13). The moderator records what the certificate *actually says*.

    Fail-safe, enforced at validation time: ``attributes`` and ``valid_until`` are only
    expressible on an ``accept`` decision — a rejected photo can never write anything
    onto the certificate. ``attributes`` is tri-state: send only the keys the photo
    actually rules on — ``true``/``false`` records the fact, an explicit ``null``
    CLEARS the key back to unknown (doubt → UNKNOWN), and an absent key is untouched.
    Keys are validated against :class:`app.models.enums.CertificateAttribute`.
    """

    decision: Literal["accept", "reject"]
    note: str
    #: StrictBool: "yes"/1 must not be coerced — a kashrut fact is true, false, or
    #: explicitly null (= clear to unknown). Absent keys are untouched.
    attributes: dict[str, StrictBool | None] | None = None
    valid_until: dt.date | None = None

    @field_validator("note")
    @classmethod
    def _note_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < MIN_NOTE_LENGTH:
            raise ValueError(f"note must be at least {MIN_NOTE_LENGTH} characters")
        return value

    @field_validator("attributes")
    @classmethod
    def _attributes_are_known_keys(
        cls, value: dict[str, bool | None] | None
    ) -> dict[str, bool | None] | None:
        if value is None:
            return None
        allowed = {a.value for a in CertificateAttribute}
        unknown = sorted(set(value) - allowed)
        if unknown:
            raise ValueError(
                f"unknown certificate attribute keys {unknown}; allowed: {sorted(allowed)}"
            )
        return value

    @model_validator(mode="after")
    def _certificate_facts_require_accept(self) -> ReviewPhotoRequest:
        if self.decision == "reject" and (self.attributes is not None or self.valid_until is not None):
            raise ValueError(
                "attributes/valid_until can only accompany an 'accept' decision — "
                "a rejected photo never writes anything onto the certificate (fail-safe)"
            )
        return self


class VerifyRenewalRequest(BaseModel):
    """Renewal evidence. At least one evidence field must be non-empty — enforced in
    the router with a 400 (fail-safe: no evidence, no restore). A provided note must
    carry substance (min 10 chars after strip); a provided URL must be a real URL.
    Blank strings count as "not provided".
    """

    valid_until: dt.date
    evidence_note: str | None = None
    evidence_url: BlankableHttpUrl = None
    evidence_photo_key: str | None = None

    @field_validator("evidence_note")
    @classmethod
    def _note_substantive_or_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if len(value) < 10:
            raise ValueError("evidence_note must be at least 10 characters")
        return value

    @field_validator("evidence_photo_key")
    @classmethod
    def _photo_key_blank_is_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None
