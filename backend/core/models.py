"""Tables in the `core` schema, shared by every app (see data-model.md)."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base

LANGUAGES = ("en", "fr")
DEFAULT_LANGUAGE = "fr"


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


class RevokedToken(Base):
    """JWT `jti` denylist: logged-out and rotated tokens, until they expire."""

    __tablename__ = "revoked_tokens"
    __table_args__ = {"schema": "core"}

    id: Mapped[int] = mapped_column(primary_key=True)
    jti: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
