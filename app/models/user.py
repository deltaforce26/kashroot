"""Users, kashrut profiles and saved lists (PRD §16)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import CertificationLevel, Language, UserRole, pg_enum

if TYPE_CHECKING:
    from app.models.certifier import Certifier
    from app.models.restaurant import Restaurant


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "app_user"

    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    phone: Mapped[str | None] = mapped_column(String(40), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"), nullable=False, server_default=UserRole.USER.value
    )
    language: Mapped[Language] = mapped_column(
        pg_enum(Language, "language"), nullable=False, server_default=Language.HE.value
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")

    profiles: Mapped[list[UserProfile]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    saved_lists: Mapped[list[SavedList]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A kashrut profile: the whitelist + required attributes the gate runs against.

    Multiple profiles per user are allowed (Premium multi-profile, v2); exactly one is
    flagged ``is_default``.
    """

    __tablename__ = "user_profile"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, server_default="default")
    is_default: Mapped[bool] = mapped_column(nullable=False, server_default="true")

    #: Attribute keys the user *requires*; every one must be explicitly true on a
    #: certificate for MATCH. Values: app.models.enums.CertificateAttribute.
    required_attributes: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    #: Soft preferences (Layer 2 only): diet types, price band, amenity weights.
    diet_prefs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    language: Mapped[Language] = mapped_column(
        pg_enum(Language, "language"), nullable=False, server_default=Language.HE.value
    )

    user: Mapped[User] = relationship(back_populates="profiles")
    whitelist: Mapped[list[ProfileCertifierWhitelist]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )


class ProfileCertifierWhitelist(TimestampMixin, Base):
    """(certifier, min_level) pairs the user accepts. The user whitelists; the app never
    ranks certifiers for them.
    """

    __tablename__ = "profile_certifier_whitelist"

    profile_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("user_profile.id", ondelete="CASCADE"),
        primary_key=True,
    )
    certifier_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("certifier.id", ondelete="CASCADE"),
        primary_key=True,
    )
    min_level: Mapped[CertificationLevel] = mapped_column(
        pg_enum(CertificationLevel, "certification_level"),
        nullable=False,
        server_default=CertificationLevel.REGULAR.value,
    )

    profile: Mapped[UserProfile] = relationship(back_populates="whitelist")
    certifier: Mapped[Certifier] = relationship()


class SavedList(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "saved_list"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Set when the list has been shared; the share URL is the only way in.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    notes: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="saved_lists")
    items: Mapped[list[SavedListItem]] = relationship(
        back_populates="saved_list",
        cascade="all, delete-orphan",
        order_by="SavedListItem.position",
    )


class SavedListItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "saved_list_item"
    __table_args__ = (
        UniqueConstraint("saved_list_id", "restaurant_id", name="uq_saved_list_item_list_restaurant"),
    )

    saved_list_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("saved_list.id", ondelete="CASCADE"), nullable=False, index=True
    )
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("restaurant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    note: Mapped[str | None] = mapped_column(Text)

    saved_list: Mapped[SavedList] = relationship(back_populates="items")
    restaurant: Mapped[Restaurant] = relationship()
