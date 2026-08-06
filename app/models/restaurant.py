"""Restaurant, its photos and its opening-hours rules (PRD §16)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING, Any

from geoalchemy2 import Geography
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    DietType,
    HoursRuleType,
    PhotoKind,
    RecordState,
    RestaurantStatus,
    pg_enum,
)

if TYPE_CHECKING:
    from app.models.certificate import Certificate
    from app.models.moderation import Flag, OwnerClaim


class Restaurant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "restaurant"
    __table_args__ = (
        CheckConstraint("price_level is null or price_level between 1 and 4", name="price_level_range"),
        Index("ix_restaurant_geo", "geo", postgresql_using="gist"),
        Index(
            "ix_restaurant_name_he_trgm",
            "name_he",
            postgresql_using="gin",
            postgresql_ops={"name_he": "gin_trgm_ops"},
        ),
    )

    #: Deterministic natural key (normalized name + city + address) used by ingestion
    #: pipelines for idempotent upserts. See app.ingestion.normalize.restaurant_dedupe_key.
    dedupe_key: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)

    name_he: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    name_en: Mapped[str | None] = mapped_column(String(300))
    #: Set when one published entry covered several branches ("רשב\"י 15 / קק\"ל 13").
    branch_label: Mapped[str | None] = mapped_column(String(200))

    address_he: Mapped[str | None] = mapped_column(String(300))
    address_en: Mapped[str | None] = mapped_column(String(300))
    city_he: Mapped[str | None] = mapped_column(String(120), index=True)
    city_en: Mapped[str | None] = mapped_column(String(120))
    #: ASCII slug of the city, the stable key for city filters/coverage reporting.
    city_slug: Mapped[str | None] = mapped_column(String(120), index=True)
    neighborhood_he: Mapped[str | None] = mapped_column(String(120))

    phone: Mapped[str | None] = mapped_column(String(40))
    website: Mapped[str | None] = mapped_column(Text)
    menu_url: Mapped[str | None] = mapped_column(Text)

    #: Business type exactly as the certifier published it (מסעדה, קייטרינג, מאפייה…).
    business_type_he: Mapped[str | None] = mapped_column(String(200))
    diet_type: Mapped[DietType | None] = mapped_column(pg_enum(DietType, "diet_type"))
    price_level: Mapped[int | None] = mapped_column(SmallInteger)
    #: Soft preferences only (Layer 2 / Fit Score). Keys: app.models.enums.AmenityKey.
    amenities: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )

    status: Mapped[RestaurantStatus] = mapped_column(
        pg_enum(RestaurantStatus, "restaurant_status"), nullable=False, server_default="open"
    )
    record_state: Mapped[RecordState] = mapped_column(
        pg_enum(RecordState, "record_state"), nullable=False
    )
    #: Moderator queue flag carried from ingestion (ambiguous OCR, unresolved city…).
    needs_review: Mapped[bool] = mapped_column(nullable=False, server_default="false", index=True)
    #: Distinct source documents that listed this business — the corroboration term of
    #: the internal confidence score (PRD §13).
    corroboration_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    geo: Mapped[Any | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False)
    )
    geocoded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    google_place_id: Mapped[str | None] = mapped_column(String(200), unique=True)

    notes: Mapped[str | None] = mapped_column(Text)

    certificates: Mapped[list[Certificate]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan"
    )
    photos: Mapped[list[RestaurantPhoto]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan"
    )
    hours: Mapped[list[OpeningHours]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan"
    )
    flags: Mapped[list[Flag]] = relationship(back_populates="restaurant")
    owner_claims: Mapped[list[OwnerClaim]] = relationship(back_populates="restaurant")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Restaurant {self.name_he} ({self.city_he})>"


class RestaurantPhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "restaurant_photo"

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Object key in S3-compatible storage; never a public URL in the DB.
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[PhotoKind] = mapped_column(pg_enum(PhotoKind, "photo_kind"), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL")
    )

    restaurant: Mapped[Restaurant] = relationship(back_populates="photos")


class OpeningHours(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One rule row. ``WEEKLY`` rows carry ``weekday``; Shabbat/chag rules do not.

    A rule with ``is_closed`` and no times means "closed for this rule window" — that is
    how erev shabbat / chag closures are expressed.
    """

    __tablename__ = "opening_hours"
    __table_args__ = (
        CheckConstraint(
            "(rule_type = 'weekly' and weekday is not null) or "
            "(rule_type <> 'weekly' and weekday is null)",
            name="weekday_only_for_weekly",
        ),
        CheckConstraint("weekday is null or weekday between 0 and 6", name="weekday_range"),
        Index("ix_opening_hours_restaurant_id_rule_type", "restaurant_id", "rule_type"),
    )

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False
    )
    rule_type: Mapped[HoursRuleType] = mapped_column(
        pg_enum(HoursRuleType, "hours_rule_type"), nullable=False
    )
    #: 0 = Sunday … 6 = Saturday (Israeli week starts Sunday).
    weekday: Mapped[int | None] = mapped_column(SmallInteger)
    opens_at: Mapped[dt.time | None] = mapped_column(Time)
    closes_at: Mapped[dt.time | None] = mapped_column(Time)
    #: True when the rule crosses midnight (closes_at belongs to the next day).
    closes_next_day: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    is_closed: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    #: Minutes before candle-lighting the place shuts, for erev shabbat/chag rules.
    minutes_before_candle_lighting: Mapped[int | None] = mapped_column(SmallInteger)
    effective_from: Mapped[dt.date | None] = mapped_column(Date)
    effective_until: Mapped[dt.date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    restaurant: Mapped[Restaurant] = relationship(back_populates="hours")


__all__ = ["OpeningHours", "Restaurant", "RestaurantPhoto"]
