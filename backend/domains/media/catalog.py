"""Filling catalog rows from the metadata sources."""

from domains.media.models import MediaItem
from domains.media.sources import Details


def apply_details(item: MediaItem, details: Details) -> None:
    """Copy a source's normalized fields onto a catalog row (new or refreshed)."""
    item.title = details.title
    item.title_fr = details.title_fr
    item.original_title = details.original_title
    item.year = details.year
    item.creators = details.creators
    item.genres = details.genres
    item.synopsis = details.synopsis
    item.synopsis_fr = details.synopsis_fr
    item.runtime_minutes = details.runtime_minutes
    item.isbn = details.isbn
    item.season_episode_counts = details.season_episode_counts
