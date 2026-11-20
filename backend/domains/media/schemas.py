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
SERIES_BOOKS_ONLY = "Only books can be in a series"
Volume = Annotated[int, Field(ge=0, le=9999)]
SeriesName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class _AddOptions(BaseModel):
    """Options shared by both add routes."""

    type: MediaType
    status: EntryStatus = EntryStatus.want
    # With status done: the read has no date.
    undated: bool = False
    owned: bool = False
    series_id: int | None = None
    series_volume: Volume | None = None

    @model_validator(mode="after")
    def _check_options(self):
        book = self.type == MediaType.book
        if self.owned and not book:
            raise ValueError(OWNED_BOOKS_ONLY)
        if (self.series_id is not None or self.series_volume is not None) and not book:
            raise ValueError(SERIES_BOOKS_ONLY)
        if self.undated and self.status != EntryStatus.done:
            raise ValueError("undated is only for a finished read")
        return self


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
    library_status: EntryStatus | None = None
    library_owned: bool | None = None
    library_series_id: int | None = None


class AddFromSearch(_AddOptions):
    source: Literal[MediaSource.tmdb, MediaSource.openlibrary]
    external_id: NonEmpty

    @model_validator(mode="after")
    def _source_matches_type(self):
        book = self.type == MediaType.book
        if book != (self.source == MediaSource.openlibrary):
            raise ValueError("Books come from Open Library, films and series from TMDB")
        return self


class AddManual(_AddOptions):
    title: NonEmpty
    creators: str | None = None
    year: Annotated[int, Field(ge=0, le=9999)] | None = None
    genres: list[NonEmpty] = []


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
    # Changes with the cover (the cover URL is cached as immutable).
    updated_at: datetime


class SeriesProgress(BaseModel):
    watched: int
    total: int


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    started_on: date | None
    finished_on: date | None
    undated: bool


class EntrySummary(BaseModel):
    id: int
    status: EntryStatus
    rating: int | None
    owned: bool
    current_season: int | None
    current_episode: int | None
    series_id: int | None
    series_name: str | None
    series_volume: int | None
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
    series_id: int | None = None
    series_volume: Volume | None = None


class SessionIn(BaseModel):
    started_on: date | None = None
    finished_on: date | None = None
    # Finished on an unknown date (a finish date clears it).
    undated: bool = False

    @model_validator(mode="after")
    def _finish_after_start(self):
        if self.started_on and self.finished_on and self.finished_on < self.started_on:
            raise ValueError("finished_on must not be before started_on")
        if self.finished_on is not None:
            self.undated = False
        return self


class JournalEntry(BaseModel):
    """One start or finish of a session, for the journal."""

    date: date
    event: JournalEvent
    session_id: int
    entry: EntrySummary


class CoverFromUrl(BaseModel):
    url: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]


class SeriesIn(BaseModel):
    name: SeriesName


class SeriesOut(BaseModel):
    id: int
    name: str
    volumes: int
    read: int
    owned: int
    cover_item: MediaItemOut | None


class SeriesDetail(SeriesOut):
    entries: list[EntrySummary]


class SeriesMark(BaseModel):
    """Bulk change on the series' volumes in a range (none = all of them)."""

    from_volume: Volume | None = None
    to_volume: Volume | None = None
    read: Literal[True] | None = None
    owned: bool | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.read is None and self.owned is None:
            raise ValueError("Nothing to do: send read and/or owned")
        if (
            self.from_volume is not None
            and self.to_volume is not None
            and self.from_volume > self.to_volume
        ):
            raise ValueError("from_volume must not be after to_volume")
        return self
