"""Request/response bodies of `/api/media` (see features.md "Media")."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from domains.media.models import EntryStatus, MediaSource, MediaType

Rating = Annotated[int, Field(ge=1, le=10)]
NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
LibrarySort = Literal["added", "title", "year", "rating", "finished"]
Shelf = Literal["books", "videos"]
JournalEvent = Literal["started", "finished"]

SHELF_TYPES: dict[str, tuple[MediaType, ...]] = {
    "books": (MediaType.book,),
    "videos": (MediaType.film, MediaType.series),
}
OWNED_BOOKS_ONLY = "Only books can be owned"


class SearchResult(BaseModel):
    source: MediaSource
    external_id: str
    type: MediaType
    title: str
    year: int | None
    creators: str | None
    thumb_url: str | None
    # Set when this result is already in the user's library.
    library_entry_id: int | None = None


class AddFromSearch(BaseModel):
    source: Literal[MediaSource.tmdb, MediaSource.openlibrary]
    external_id: NonEmpty
    type: MediaType
    status: EntryStatus = EntryStatus.want
    owned: bool = False

    @model_validator(mode="after")
    def _source_matches_type(self):
        book = self.type == MediaType.book
        if book != (self.source == MediaSource.openlibrary):
            raise ValueError("Books come from Open Library, films and series from TMDB")
        if self.owned and not book:
            raise ValueError(OWNED_BOOKS_ONLY)
        return self


class AddManual(BaseModel):
    type: MediaType
    title: NonEmpty
    creators: str | None = None
    year: Annotated[int, Field(ge=0, le=9999)] | None = None
    genres: list[NonEmpty] = []
    status: EntryStatus = EntryStatus.want
    owned: bool = False

    @model_validator(mode="after")
    def _owned_books_only(self):
        if self.owned and self.type != MediaType.book:
            raise ValueError(OWNED_BOOKS_ONLY)
        return self


class MediaItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: MediaType
    title: str
    title_fr: str | None
    original_title: str | None
    year: int | None
    creators: str | None
    genres: list[str]
    synopsis: str | None
    synopsis_fr: str | None
    runtime_minutes: int | None
    isbn: str | None
    season_episode_counts: list[int] | None
    source: MediaSource
    external_id: str | None
    has_cover: bool


class SeriesProgress(BaseModel):
    watched: int
    total: int


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    started_on: date | None
    finished_on: date | None


class EntrySummary(BaseModel):
    id: int
    status: EntryStatus
    rating: int | None
    owned: bool
    current_season: int | None
    current_episode: int | None
    added_at: datetime
    updated_at: datetime
    last_finished_on: date | None
    # Series only: null when episode counts aren't all known.
    progress: SeriesProgress | None
    # Series only: on the last known episode, so Finish replaces +1 episode.
    at_last_known_episode: bool
    item: MediaItemOut


class EntryDetail(EntrySummary):
    notes: str | None
    sessions: list[SessionOut]


class EntryUpdate(BaseModel):
    """Partial update: only the fields sent are changed (null clears)."""

    rating: Rating | None = None
    notes: str | None = None
    owned: bool | None = None
    current_season: Annotated[int, Field(ge=1, le=999)] | None = None
    current_episode: Annotated[int, Field(ge=0, le=9999)] | None = None


class SessionIn(BaseModel):
    started_on: date | None = None
    finished_on: date | None = None

    @model_validator(mode="after")
    def _finish_after_start(self):
        if self.started_on and self.finished_on and self.finished_on < self.started_on:
            raise ValueError("finished_on must not be before started_on")
        return self


class JournalEntry(BaseModel):
    """One start or finish of a session, for the journal."""

    date: date
    event: JournalEvent
    session_id: int
    entry: EntrySummary
