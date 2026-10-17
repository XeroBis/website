"""Tables in the `media` schema: shared catalog, per-user library, sessions and
cached covers (see data-model.md `media`)."""

import enum
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    Text,
    UniqueConstraint,
    exists,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from core.database import Base


class MediaType(enum.StrEnum):
    book = "book"
    film = "film"
    series = "series"


class MediaSource(enum.StrEnum):
    tmdb = "tmdb"
    openlibrary = "openlibrary"
    manual = "manual"


class EntryStatus(enum.StrEnum):
    want = "want"
    in_progress = "in_progress"
    done = "done"
    dropped = "dropped"


def _pg_enum(py_enum: type[enum.Enum], name: str) -> Enum:
    # The type lives in the app's schema (`media.media_type`…).
    return Enum(
        py_enum,
        name=name,
        values_callable=lambda e: [m.value for m in e],
        schema="media",
    )


class Cover(Base):
    """Cover image cached at add time (no row = generated placeholder)."""

    __tablename__ = "covers"
    __table_args__ = {"schema": "media"}

    media_item_id: Mapped[int] = mapped_column(
        ForeignKey("media.media_items.id", ondelete="CASCADE"), primary_key=True
    )
    content_type: Mapped[str] = mapped_column(Text)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class MediaItem(Base):
    """Shared catalog row: one per book, film or series, whoever added it."""

    __tablename__ = "media_items"
    __table_args__ = (
        Index(
            "uq_media_items_source_external_id",
            "source",
            "external_id",
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
        {"schema": "media"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[MediaType] = mapped_column(_pg_enum(MediaType, "media_type"))
    # English (or the source's default) title; `title_fr` is the French one when
    # the source has it. Display: the viewer's language, falling back to `title`.
    title: Mapped[str] = mapped_column(Text)
    title_fr: Mapped[str | None] = mapped_column(Text)
    original_title: Mapped[str | None] = mapped_column(Text)
    year: Mapped[int | None] = mapped_column(SmallInteger)
    creators: Mapped[str | None] = mapped_column(Text)
    genres: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'::text[]"), default=list
    )
    synopsis: Mapped[str | None] = mapped_column(Text)
    synopsis_fr: Mapped[str | None] = mapped_column(Text)
    runtime_minutes: Mapped[int | None] = mapped_column(SmallInteger)
    isbn: Mapped[str | None] = mapped_column(Text)
    season_episode_counts: Mapped[list[int] | None] = mapped_column(ARRAY(SmallInteger))
    source: Mapped[MediaSource] = mapped_column(_pg_enum(MediaSource, "media_source"))
    external_id: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("core.users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Whether a cached cover exists, without loading the bytea.
    has_cover: Mapped[bool] = column_property(
        exists(select(1).where(Cover.media_item_id == id).scalar_subquery())
    )


class LibraryEntry(Base):
    """A user's relation to a catalog item: status, rating, notes, ownership."""

    __tablename__ = "library_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "media_item_id"),
        # 1-10 = 0.5-5 stars (half stars)
        CheckConstraint("rating BETWEEN 1 AND 10", name="rating"),
        {"schema": "media"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("core.users.id"))
    media_item_id: Mapped[int] = mapped_column(ForeignKey("media.media_items.id"))
    status: Mapped[EntryStatus] = mapped_column(
        _pg_enum(EntryStatus, "entry_status"),
        default=EntryStatus.want,
        server_default=EntryStatus.want.value,
    )
    rating: Mapped[int | None] = mapped_column(SmallInteger)
    notes: Mapped[str | None] = mapped_column(Text)
    owned_formats: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'::text[]"), default=list
    )
    current_season: Mapped[int | None] = mapped_column(SmallInteger)
    current_episode: Mapped[int | None] = mapped_column(SmallInteger)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    media_item: Mapped[MediaItem] = relationship(lazy="joined")
    sessions: Mapped[list[ReadingSession]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        passive_deletes=True,
        # Open session first, then most recently finished.
        order_by="(ReadingSession.finished_on.desc().nulls_first(), "
        "ReadingSession.started_on.desc().nulls_last(), ReadingSession.id.desc())",
    )


class ReadingSession(Base):
    """One read / watch of an entry (also used for films and series)."""

    __tablename__ = "reading_sessions"
    __table_args__ = (
        # At most one open session per entry.
        Index(
            "uq_reading_sessions_one_open",
            "library_entry_id",
            unique=True,
            postgresql_where=text("finished_on IS NULL"),
        ),
        {"schema": "media"},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    library_entry_id: Mapped[int] = mapped_column(
        ForeignKey("media.library_entries.id", ondelete="CASCADE"), index=True
    )
    started_on: Mapped[date | None]
    finished_on: Mapped[date | None]

    entry: Mapped[LibraryEntry] = relationship(back_populates="sessions")
