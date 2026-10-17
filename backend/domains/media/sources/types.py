"""Source results, normalized to `media_items` fields."""

from dataclasses import dataclass, field

from domains.media.models import MediaSource, MediaType


@dataclass
class SearchHit:
    source: MediaSource
    external_id: str
    type: MediaType
    title: str
    year: int | None
    creators: str | None
    thumb_url: str | None


@dataclass
class Details:
    type: MediaType
    title: str
    title_fr: str | None = None
    original_title: str | None = None
    year: int | None = None
    creators: str | None = None
    genres: list[str] = field(default_factory=list)
    synopsis: str | None = None
    synopsis_fr: str | None = None
    runtime_minutes: int | None = None
    isbn: str | None = None
    season_episode_counts: list[int] | None = None
    cover_url: str | None = None
