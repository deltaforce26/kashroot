"""Pydantic schemas for hand-entering a certificate from the moderation console.

Product decision (locked, made by the user — plan doc, decision 1): certificate
``state`` on :class:`CreateCertificateRequest` is the moderator's free choice across
the full ``CertificateState`` enum, with **no server-side evidence gate**. This is a
deliberate, narrow exception to "the console can never raise a kashrut status except
``verify-renewal``" (PRD §13) — it was raised explicitly and the user chose it
anyway, because hand-entry is how the seed corpus's known holes get filled (the
5-city, 80%-coverage launch gate). The compensating control lives in the router, not
here: every create writes a full ``AuditLog`` row naming the moderator, and ``state``
below is required and never defaulted, so a certificate can never become ``active``
because nobody chose otherwise. Do not add an evidence gate to ``state`` without a
product conversation — a future reader who "fixes" this has reopened a decision the
user already made.
"""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from app.api.admin.consts import CERTIFICATE_DATES_DETAIL
from app.api.schemas import APIModel, OptionalText
from app.models.certificate import validate_attributes
from app.models.enums import CertificateState, CertificationLevel, CertifierType

#: Certificate columns written at create time, in the CREATE audit row's "changes"
#: payload (``{field: {"before": None, "after": ...}}``). ``restaurant_id`` is here
#: even though it arrives as a path parameter, not a body field — it is still a
#: column the create writes, and the audit trail should show it. Not listed:
#: ``corroboration_count`` (fixed at 1 for every hand-entered certificate, never a
#: choice) and every field :class:`CreateCertificateRequest` cannot express at all.
AUDITED_CERTIFICATE_CREATE_FIELDS: tuple[str, ...] = (
    "restaurant_id",
    "certifier_id",
    "level",
    "attributes",
    "valid_from",
    "valid_until",
    "state",
    "source",
    "verified_by_label",
    "verified_at",
    "notes",
)


class CreateCertificateRequest(BaseModel):
    """Hand-entry of a certificate on an existing restaurant, fully audited.

    ``state`` is required and carries no default — see the module docstring for why
    that is a deliberate, locked product decision and not an oversight to "fix".
    ``attributes`` has no null/clear variant: a certificate that does not exist yet
    has nothing to clear, unlike ``ReviewPhotoRequest``'s tri-state merge onto an
    existing row — a sent key records the fact, an absent key stays unknown.

    Deliberately inexpressible here: ``restaurant_id`` (a path parameter, not body),
    ``source``, ``verified_by_label``, ``verified_at``, ``verified_by_user_id``,
    ``corroboration_count``, ``import_key``, ``source_document_id``,
    ``evidence_photo_key`` and ``is_demo_seed`` — every one of those is server-stamped
    or owned by a different pipeline, never the moderator's hand-entry form.
    """

    certifier_id: uuid.UUID
    level: CertificationLevel = CertificationLevel.UNKNOWN
    #: StrictBool, no null variant: a fact is recorded true/false, or the key is
    #: simply omitted (unknown). There is nothing to "clear" on a brand-new row.
    attributes: dict[str, StrictBool] = Field(default_factory=dict)
    valid_from: dt.date | None = None
    valid_until: dt.date | None = None
    #: Required, never defaulted (locked product decision — see module docstring):
    #: a certificate cannot become ``active`` because nobody chose otherwise.
    state: CertificateState
    notes: OptionalText = None
    note: OptionalText = None

    @field_validator("attributes")
    @classmethod
    def _attributes_are_known_and_boolean(cls, value: dict[str, bool]) -> dict[str, bool]:
        """
        Delegate key/type validation to ``app.models.certificate.validate_attributes``.

        Parameters:
            value (dict[str, bool]): The submitted attribute map.

        Return:
            dict[str, bool]: The validated map.
        """
        return validate_attributes(value)

    @model_validator(mode="after")
    def _dates_are_ordered(self) -> CreateCertificateRequest:
        """
        Refuse an expiry date before the start date.

        Data-integrity validation only — unrelated to, and never a gate on, the
        certificate's ``state`` (decision 1, module docstring).

        Return:
            CreateCertificateRequest: The validated request.
        """
        if (
            self.valid_from is not None
            and self.valid_until is not None
            and self.valid_until < self.valid_from
        ):
            raise ValueError(CERTIFICATE_DATES_DETAIL)

        return self


class CertifierOption(APIModel):
    """A certifier as offered in the create-certificate picker.

    Name and identity only — no levels field. A level list next to a certifier here
    would read as a ranking, and the app makes no agency rankings (CLAUDE.md).
    """

    id: uuid.UUID
    slug: str
    name_he: str
    name_en: str | None
    type: CertifierType
    is_active: bool
