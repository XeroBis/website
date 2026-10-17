"""Metadata sources: TMDB (films, series) and Open Library (books).

Only the backend talks to these APIs (see documentation/decisions.md's
"Metadata sources"). Each source returns results already normalized to
`media_items` fields.
"""

import httpx2

from domains.media.models import MediaSource, MediaType
from domains.media.sources import http, openlibrary, tmdb
from domains.media.sources.http import SourceError
from domains.media.sources.types import Details, SearchHit

__all__ = [
    "Details",
    "SearchHit",
    "SourceError",
    "details",
    "download_cover",
    "language",
    "search",
    "source_for",
]

# Covers stored in Postgres are resized server-side by the CDN; these stay in
# the tens of KB. Anything bigger is refused rather than stored.
MAX_COVER_BYTES = 2 * 1024 * 1024


def source_for(media_type: MediaType) -> MediaSource:
    return MediaSource.openlibrary if media_type == MediaType.book else MediaSource.tmdb


def language(user_language: str | None) -> str:
    """The app's languages are English and French: `fr`, `fr-FR`… → `fr`."""
    return "fr" if (user_language or "").lower().startswith("fr") else "en"


def search(media_type: MediaType, query: str, lang: str) -> list[SearchHit]:
    """Result titles in `lang` ("en" / "fr") where the source has them."""
    if media_type == MediaType.book:
        return openlibrary.search(query, lang)
    return tmdb.search(media_type, query, "fr-FR" if lang == "fr" else "en-US")


def details(source: MediaSource, media_type: MediaType, external_id: str) -> Details:
    """Catalog fields in English, plus the French title/synopsis when known."""
    if source == MediaSource.openlibrary:
        return openlibrary.details(external_id)
    if source == MediaSource.tmdb:
        return tmdb.details(media_type, external_id)
    raise SourceError(f"No details for source {source}")


def download_cover(url: str) -> tuple[str, bytes] | None:
    """(content_type, bytes), or None when there's no usable image."""
    try:
        with http.client() as c:
            r = c.get(url)
    except httpx2.HTTPError:
        return None
    content_type = r.headers.get("content-type", "").split(";")[0].strip()
    if (
        r.status_code != 200
        or not content_type.startswith("image/")
        or not r.content
        or len(r.content) > MAX_COVER_BYTES
    ):
        return None
    return content_type, r.content
