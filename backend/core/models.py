"""Tables in the `core` schema, shared by every app (see data-model.md)."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base

LANGUAGES = ("en", "fr")
DEFAULT_LANGUAGE = "fr"
# Apps access is granted to, per user (`core.user_apps`). The auth app is
# open to any logged-in user; the portfolio is public and its grant only
# allows editing projects.
APPS = ("portfolio", "workout", "cards", "media")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"language IN {LANGUAGES}", name="language"),
        {"schema": "core"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Always stored lowercased (see domains/auth/schemas.py), so uniqueness
    # is case-insensitive.
    email: Mapped[str] = mapped_column(Text, unique=True)
    hashed_password: Mapped[str] = mapped_column(Text)
    pseudo: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(
        Text, default=DEFAULT_LANGUAGE, server_default=DEFAULT_LANGUAGE
    )
    is_admin: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    app_grants: Mapped[list[UserApp]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )

    @property
    def apps(self) -> list[str]:
        """The apps this user can use: every app for an admin, else the grants."""
        if self.is_admin:
            return list(APPS)
        granted = {grant.app for grant in self.app_grants}
        return [app for app in APPS if app in granted]

    def can_use(self, app: str) -> bool:
        return app in self.apps


class UserApp(Base):
    """Access grant: `user_id` may use `app`. No row, no access."""

    __tablename__ = "user_apps"
    __table_args__ = (
        CheckConstraint(f"app IN {APPS}", name="app"),
        {"schema": "core"},
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("core.users.id", ondelete="CASCADE"), primary_key=True
    )
    app: Mapped[str] = mapped_column(Text, primary_key=True)


class RevokedToken(Base):
    """JWT `jti` denylist: logged-out and rotated tokens, until they expire."""

    __tablename__ = "revoked_tokens"
    __table_args__ = {"schema": "core"}

    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
