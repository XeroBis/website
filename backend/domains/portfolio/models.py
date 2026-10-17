"""Tables in the `portfolio` schema (see data-model.md)."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Table,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base

project_tags = Table(
    "project_tags",
    Base.metadata,
    Column(
        "project_id",
        ForeignKey("portfolio.projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id", ForeignKey("portfolio.tags.id", ondelete="CASCADE"), primary_key=True
    ),
    schema="portfolio",
)


class Tag(Base):
    """Created on the fly from a project's tag names; deleted once unused."""

    __tablename__ = "tags"
    __table_args__ = {"schema": "portfolio"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("position >= 0", name="position"),
        {"schema": "portfolio"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    description_fr: Mapped[str] = mapped_column(Text)
    description_en: Mapped[str] = mapped_column(Text)
    repo_url: Mapped[str | None] = mapped_column(Text)
    featured: Mapped[bool] = mapped_column(default=False, server_default="false")
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    tags: Mapped[list[Tag]] = relationship(
        secondary=project_tags, order_by=func.lower(Tag.name), lazy="selectin"
    )


# Names are unique case-insensitively. A tag keeps the casing first typed.
Index("uq_tags_name_lower", func.lower(Tag.name), unique=True)
Index("uq_projects_name_lower", func.lower(Project.name), unique=True)
