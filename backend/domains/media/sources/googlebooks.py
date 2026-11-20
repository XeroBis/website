"""Google Books client (books). Needs `GOOGLE_BOOKS_API_KEY`.

The key goes in the `X-Goog-Api-Key` header, so it never appears in logged
URLs. A volume is one edition in one language: `external_id` is its volume id
(e.g. `zyTCAlFPjgYC`), and its title and description are stored as the
edition has them, with no separate French fields.
"""

import html
import re

import httpx2

from core.config import settings
from domains.media.models import MediaSource, MediaType
from domains.media.sources import http
from domains.media.sources.http import SourceError
from domains.media.sources.types import Details, SearchHit

API = "https://www.googleapis.com/books/v1"
SEARCH_LIMIT = 20
MAX_GENRES = 5
VOLUME_ID = re.compile(r"^[\w-]{4,32}$")
# Largest first; search results only carry the two thumbnails.
COVER_SIZES = ("medium", "small", "thumbnail", "smallThumbnail")
_ISBN_SEPARATORS = re.compile(r"[\s-]")
_TAG = re.compile(r"<[^>]+>")
_BREAK = re.compile(r"<\s*(br|/p|/div|/li)\s*/?>", re.IGNORECASE)


def _get(path: str, **params) -> dict:
    if not settings.google_books_api_key:
        raise SourceError("GOOGLE_BOOKS_API_KEY is not configured")
    params = {k: v for k, v in params.items() if v is not None}
    try:
        with http.client(
            base_url=API, headers={"X-Goog-Api-Key": settings.google_books_api_key}
        ) as c:
            r = c.get(path, params=params)
            r.raise_for_status()
    except httpx2.HTTPError as exc:
        raise SourceError(f"Google Books request failed: {exc}") from exc
    return r.json()


def _year(date: str | None) -> int | None:
    return int(date[:4]) if date and date[:4].isdigit() else None


def _creators(info: dict) -> str | None:
    return ", ".join(dict.fromkeys(info.get("authors", []))) or None


def _image_url(info: dict, sizes: tuple[str, ...]) -> str | None:
    """HTTPS, without the page-curl effect Google adds to thumbnails."""
    links = info.get("imageLinks", {})
    url = next((links[s] for s in sizes if links.get(s)), None)
    if not url:
        return None
    return url.replace("http://", "https://", 1).replace("&edge=curl", "")


def _genres(categories: list[str]) -> list[str]:
    """Categories are BISAC paths ("Fiction / Fantasy / General"): each part
    once, without "General"."""
    genres: list[str] = []
    for category in categories:
        for part in category.split("/"):
            part = part.strip()
            if not part or part.lower() == "general":
                continue
            if part.lower() in (g.lower() for g in genres):
                continue
            genres.append(part)
            if len(genres) == MAX_GENRES:
                return genres
    return genres


def _isbn(info: dict) -> str | None:
    ids = {
        i.get("type"): i.get("identifier") for i in info.get("industryIdentifiers", [])
    }
    return ids.get("ISBN_13") or ids.get("ISBN_10")


def normalize_isbn(value: str) -> str | None:
    """An ISBN-10 or ISBN-13 without hyphens or spaces, or None when the
    length or the check digit is wrong."""
    isbn = _ISBN_SEPARATORS.sub("", value).upper()
    if re.fullmatch(r"\d{9}[\dX]", isbn):
        digits = [10 if c == "X" else int(c) for c in isbn]
        total = sum((10 - i) * d for i, d in enumerate(digits))
        return isbn if total % 11 == 0 else None
    if re.fullmatch(r"\d{13}", isbn):
        total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(isbn))
        return isbn if total % 10 == 0 else None
    return None


def _text(description: str | None) -> str | None:
    """The description is HTML: plain text, paragraphs on their own lines."""
    if not description:
        return None
    text = html.unescape(_TAG.sub("", _BREAK.sub("\n", description)))
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip() or None


def search(
    query: str, lang: str, page: int = 1, isbn: str | None = None
) -> list[SearchHit]:
    """Editions in `lang` ("en" / "fr"); `page` is 1-based, SEARCH_LIMIT each.
    With `isbn` (normalized), only that edition, in whatever language."""
    data = _get(
        "/volumes",
        q=f"isbn:{isbn}" if isbn else query,
        langRestrict=None if isbn else lang,
        printType="books",
        startIndex=(page - 1) * SEARCH_LIMIT,
        maxResults=SEARCH_LIMIT,
    )
    hits = []
    for volume in data.get("items", []):
        info = volume.get("volumeInfo", {})
        hits.append(
            SearchHit(
                source=MediaSource.googlebooks,
                external_id=volume["id"],
                type=MediaType.book,
                title=info.get("title") or "",
                year=_year(info.get("publishedDate")),
                creators=_creators(info),
                thumb_url=_image_url(info, ("thumbnail", "smallThumbnail")),
                publisher=info.get("publisher") or None,
                language=info.get("language") or None,
                isbn=_isbn(info),
            )
        )
    return hits


def details(external_id: str) -> Details:
    if not VOLUME_ID.match(external_id):
        raise SourceError(f"Not a Google Books volume id: {external_id}")
    info = _get(f"/volumes/{external_id}").get("volumeInfo", {})
    return Details(
        type=MediaType.book,
        title=info.get("title") or "",
        year=_year(info.get("publishedDate")),
        creators=_creators(info),
        genres=_genres(info.get("categories", [])),
        synopsis=_text(info.get("description")),
        isbn=_isbn(info),
        cover_url=_image_url(info, COVER_SIZES),
    )
