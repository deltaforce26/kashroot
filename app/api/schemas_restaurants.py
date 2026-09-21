"""Pydantic schemas for the moderation console's restaurant directory — the
browse-all-records surface and its details editor (PRD FR8).

Split out of ``app.api.schemas`` for the 500-line rule (STANDARDS.md); the shared
entity schemas it builds on (``RestaurantBrief``, ``CertificateOut``) still live
there. Nothing in this module imports ``app.api.admin`` — the admin package imports
its schemas, never the other way round.

The whole point of the module is what it *cannot* express. A restaurant row carries
no kashrut facts: those live on Certificate (CLAUDE.md, locked), and no field of
:class:`UpdateRestaurantRequest` can reach one. ``record_state``, ``needs_review`` and
``corroboration_count`` are provenance/workflow fields owned by the review queue and
by ingestion, and are absent here for the same reason. ``diet_type``, ``price_level``
and ``amenities`` are Fit Score (Layer 2) inputs only.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from app.api.schemas import (
    BlankableHttpUrl,
    CertificateOut,
    OptionalText,
    RestaurantBrief,
)
from app.models.enums import AmenityKey, DietType, RestaurantStatus

#: Restaurant fields the console's details form may write. This tuple is the
#: enforcement point, not documentation: the router writes the intersection of the
#: request's explicitly-set fields and this whitelist, so a column that is not listed
#: cannot be written through the directory even if the schema later grows a field for
#: it. Everything absent is owned elsewhere — ``dedupe_key`` is derived from
#: name/city/address, ``record_state`` / ``needs_review`` belong to the review queue,
#: ``corroboration_count`` to ingestion, ``geo`` / ``geocoded_at`` /
#: ``google_place_id`` to the geocoding pipeline, and every kashrut fact to
#: Certificate.
EDITABLE_RESTAURANT_FIELDS: tuple[str, ...] = (
    "name_he",
    "name_en",
    "branch_label",
    "address_he",
    "address_en",
    "city_he",
    "city_en",
    "city_slug",
    "neighborhood_he",
    "phone",
    "website",
    "menu_url",
    "business_type_he",
    "diet_type",
    "price_level",
    "amenities",
    "status",
    "notes",
)

#: Editable fields whose column is NOT NULL. A request may omit them (untouched) but
#: may never send an explicit null: a required field is not clearable by accident.
NON_NULLABLE_RESTAURANT_FIELDS: tuple[str, ...] = ("name_he", "status", "amenities")

#: ASCII slug: lowercase alphanumerics in hyphen-separated groups. ``city_slug`` is the
#: stable key for city filters and coverage reporting, so free text is refused.
CITY_SLUG_PATTERN = r"[a-z0-9]+(?:-[a-z0-9]+)*"

MAX_NAME_LENGTH = 300
MAX_BRANCH_LABEL_LENGTH = 200
MAX_CITY_LENGTH = 120
MAX_PHONE_LENGTH = 40
MAX_BUSINESS_TYPE_LENGTH = 200
MIN_PRICE_LEVEL = 1
MAX_PRICE_LEVEL = 4

NAME_HE_BLANK_DETAIL = "name_he must not be blank"

CITY_SLUG_DETAIL = (
    "city_slug must be a lowercase ASCII slug of letters, digits and single hyphens "
    "(e.g. 'tel-aviv') — it is the stable key for city filters and coverage reporting"
)

UNKNOWN_AMENITY_DETAIL = "unknown amenity keys {unknown}; allowed: {allowed}"

NULL_NOT_ALLOWED_DETAIL = (
    "these fields are required on the record and cannot be cleared; omit them to "
    "leave them untouched: {fields}"
)

NO_FIELDS_DETAIL = (
    "no fields to update: send at least one editable restaurant field "
    "(a note on its own changes nothing)"
)

#: Fields of a new restaurant written at create time, in the CREATE audit row's
#: "changes" payload — the editable set plus the three fields the router derives or
#: assigns rather than takes from the request: ``dedupe_key`` (derived from
#: name/city/address) and the ``(record_state, needs_review)`` pair the review
#: checkbox maps onto.
AUDITED_RESTAURANT_CREATE_FIELDS: tuple[str, ...] = (
    *EDITABLE_RESTAURANT_FIELDS,
    "dedupe_key",
    "record_state",
    "needs_review",
)


def validated_name_he(value: str | None) -> str | None:
    """
    Reject a whitespace-only display name.

    Shared by :class:`UpdateRestaurantRequest` (where ``None`` means "untouched")
    and :class:`CreateRestaurantRequest` (where the field is required, so the
    ``None`` branch never triggers there).

    Parameters:
        value (str | None): The submitted Hebrew name, or None when untouched.

    Return:
        str | None: The stripped name, or None.
    """
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError(NAME_HE_BLANK_DETAIL)

    return value


def validated_city_slug(value: str | None) -> str | None:
    """
    Constrain the city slug to the ASCII slug shape city filters rely on.

    Shared by :class:`UpdateRestaurantRequest` and :class:`CreateRestaurantRequest`.

    Parameters:
        value (str | None): The submitted slug, or None when cleared/untouched.

    Return:
        str | None: The slug unchanged, or None.
    """
    if value is None:
        return None
    if re.fullmatch(CITY_SLUG_PATTERN, value) is None:
        raise ValueError(CITY_SLUG_DETAIL)

    return value


def validated_amenities(value: dict[str, bool] | None) -> dict[str, bool] | None:
    """
    Validate amenity keys against :class:`app.models.enums.AmenityKey`.

    Shared by :class:`UpdateRestaurantRequest` and :class:`CreateRestaurantRequest`.

    Parameters:
        value (dict[str, bool] | None): The submitted amenity map, or None.

    Return:
        dict[str, bool] | None: The map unchanged, or None.
    """
    if value is None:
        return None
    allowed = {amenity.value for amenity in AmenityKey}
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(UNKNOWN_AMENITY_DETAIL.format(unknown=unknown, allowed=sorted(allowed)))

    return value


class RestaurantDetail(RestaurantBrief):
    """Every restaurant field the directory shows or writes, plus read-only context.

    ``certificates`` is included so a moderator correcting an address can see what the
    record asserts about kashrut. It is context, never an editable surface: nothing on
    a certificate is expressible through :class:`UpdateRestaurantRequest`.

    ``dedupe_key`` is shown for the same reason — it is derived from name/city/address
    by ingestion, which is why correcting those three re-keys the row.
    """

    address_en: str | None
    city_en: str | None
    neighborhood_he: str | None
    website: str | None
    menu_url: str | None
    business_type_he: str | None
    price_level: int | None
    amenities: dict[str, bool]
    dedupe_key: str
    certificates: list[CertificateOut]


class UpdateRestaurantRequest(BaseModel):
    """Partial update of a restaurant's non-kashrut details.

    PATCH semantics: only fields actually present in the request body are written. An
    absent field is untouched; an explicit ``null`` clears an optional field; a blank
    or whitespace-only string counts as a null. Fields in
    ``NON_NULLABLE_RESTAURANT_FIELDS`` refuse an explicit null.

    ``note`` is the moderator's reason for the edit. It is audited alongside the
    before/after changes and is never stored on the restaurant row — it is deliberately
    outside ``EDITABLE_RESTAURANT_FIELDS`` so it cannot be mistaken for one.
    """

    name_he: str | None = Field(default=None, max_length=MAX_NAME_LENGTH)
    name_en: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    branch_label: OptionalText = Field(default=None, max_length=MAX_BRANCH_LABEL_LENGTH)
    address_he: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    address_en: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    city_he: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    city_en: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    city_slug: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    neighborhood_he: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    phone: OptionalText = Field(default=None, max_length=MAX_PHONE_LENGTH)
    website: BlankableHttpUrl = None
    menu_url: BlankableHttpUrl = None
    business_type_he: OptionalText = Field(default=None, max_length=MAX_BUSINESS_TYPE_LENGTH)
    diet_type: DietType | None = None
    price_level: int | None = Field(default=None, ge=MIN_PRICE_LEVEL, le=MAX_PRICE_LEVEL)
    #: StrictBool: an amenity is recorded true or false, never coerced from "yes"/1.
    #: Send ``{}`` to clear the set; null is refused (the column is NOT NULL).
    amenities: dict[str, StrictBool] | None = None
    status: RestaurantStatus | None = None
    notes: OptionalText = None
    note: OptionalText = None

    @field_validator("name_he")
    @classmethod
    def _name_he_not_blank(cls, value: str | None) -> str | None:
        """
        Delegate to the shared name_he validator.

        Parameters:
            value (str | None): The submitted Hebrew name, or None when untouched.

        Return:
            str | None: The stripped name, or None.
        """
        return validated_name_he(value)

    @field_validator("city_slug")
    @classmethod
    def _city_slug_is_a_slug(cls, value: str | None) -> str | None:
        """
        Delegate to the shared city_slug validator.

        Parameters:
            value (str | None): The submitted slug, or None when cleared/untouched.

        Return:
            str | None: The slug unchanged, or None.
        """
        return validated_city_slug(value)

    @field_validator("amenities")
    @classmethod
    def _amenities_are_known_keys(cls, value: dict[str, bool] | None) -> dict[str, bool] | None:
        """
        Delegate to the shared amenities validator.

        Parameters:
            value (dict[str, bool] | None): The submitted amenity map, or None.

        Return:
            dict[str, bool] | None: The map unchanged, or None.
        """
        return validated_amenities(value)

    @model_validator(mode="after")
    def _required_fields_are_not_cleared(self) -> UpdateRestaurantRequest:
        """
        Refuse an explicit null on a column the record cannot be missing.

        Return:
            UpdateRestaurantRequest: The validated request.
        """
        cleared = sorted(
            field
            for field in NON_NULLABLE_RESTAURANT_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        )
        if cleared:
            raise ValueError(NULL_NOT_ALLOWED_DETAIL.format(fields=", ".join(cleared)))

        return self

    @model_validator(mode="after")
    def _at_least_one_editable_field(self) -> UpdateRestaurantRequest:
        """
        Refuse a request that would write nothing, so no empty audit row is created.

        Return:
            UpdateRestaurantRequest: The validated request.
        """
        if not self.model_fields_set & set(EDITABLE_RESTAURANT_FIELDS):
            raise ValueError(NO_FIELDS_DETAIL)

        return self


class CreateRestaurantRequest(BaseModel):
    """Hand-entry of a new restaurant, fully audited (PRD FR8 create path).

    Reaches exactly ``EDITABLE_RESTAURANT_FIELDS`` — no field this schema can set is
    unreachable from :class:`UpdateRestaurantRequest`, and vice versa. Unlike PATCH
    there is no "untouched" state: ``name_he`` is required, and ``status`` /
    ``amenities`` default the same way the column itself defaults (``open`` / ``{}``).

    ``needs_review`` is the moderator's review-routing checkbox (plan decision 2): it
    is never written to a column directly — the router maps it onto
    ``(record_state, needs_review)`` as a pair. ``note`` is the moderator's reason for
    the entry; like PATCH's ``note`` it is audited and never stored on the restaurant
    row, deliberately outside ``EDITABLE_RESTAURANT_FIELDS`` for the same reason.

    ``dedupe_key`` is not expressible here either: like every other identity-derived
    field, it is computed by the router from ``name_he`` / ``city_he`` / ``address_he``,
    never entered by hand. ``extra="ignore"`` (pydantic's default, left as-is) is not
    the real enforcement — the ``EDITABLE_RESTAURANT_FIELDS`` intersection at the
    write site is, exactly as for PATCH.
    """

    name_he: str = Field(max_length=MAX_NAME_LENGTH)
    name_en: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    branch_label: OptionalText = Field(default=None, max_length=MAX_BRANCH_LABEL_LENGTH)
    address_he: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    address_en: OptionalText = Field(default=None, max_length=MAX_NAME_LENGTH)
    city_he: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    city_en: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    city_slug: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    neighborhood_he: OptionalText = Field(default=None, max_length=MAX_CITY_LENGTH)
    phone: OptionalText = Field(default=None, max_length=MAX_PHONE_LENGTH)
    website: BlankableHttpUrl = None
    menu_url: BlankableHttpUrl = None
    business_type_he: OptionalText = Field(default=None, max_length=MAX_BUSINESS_TYPE_LENGTH)
    diet_type: DietType | None = None
    price_level: int | None = Field(default=None, ge=MIN_PRICE_LEVEL, le=MAX_PRICE_LEVEL)
    #: StrictBool: an amenity is recorded true or false, never coerced from "yes"/1.
    amenities: dict[str, StrictBool] = Field(default_factory=dict)
    status: RestaurantStatus = RestaurantStatus.OPEN
    notes: OptionalText = None
    #: The "שליחה לתור בדיקה" checkbox (plan decision 2), default on. Mapped onto
    #: ``(record_state, needs_review)`` by the router — never a direct column write.
    needs_review: bool = True
    note: OptionalText = None

    @field_validator("name_he")
    @classmethod
    def _name_he_not_blank(cls, value: str) -> str:
        """
        Reject a whitespace-only display name.

        ``name_he`` is required on create, so the shared validator's None branch
        (reserved for the update schema's "untouched" case) never triggers here.

        Parameters:
            value (str): The submitted Hebrew name.

        Return:
            str: The stripped name.
        """
        stripped = validated_name_he(value)
        if stripped is None:
            raise ValueError(NAME_HE_BLANK_DETAIL)

        return stripped

    @field_validator("city_slug")
    @classmethod
    def _city_slug_is_a_slug(cls, value: str | None) -> str | None:
        """
        Delegate to the shared city_slug validator.

        Parameters:
            value (str | None): The submitted slug, or None.

        Return:
            str | None: The slug unchanged, or None.
        """
        return validated_city_slug(value)

    @field_validator("amenities")
    @classmethod
    def _amenities_are_known_keys(cls, value: dict[str, bool]) -> dict[str, bool]:
        """
        Delegate to the shared amenities validator.

        Parameters:
            value (dict[str, bool]): The submitted amenity map.

        Return:
            dict[str, bool]: The map unchanged.
        """
        validated = validated_amenities(value)
        if validated is None:
            return {}

        return validated
