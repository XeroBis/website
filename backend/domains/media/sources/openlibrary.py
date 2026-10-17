"""Open Library client (books). No key needed.

`external_id` is the work id without its `/works/` prefix (e.g. `OL20893680W`).
"""

import re

import httpx2

from domains.media.models import MediaSource, MediaType
from domains.media.sources import http
from domains.media.sources.http import SourceError
from domains.media.sources.types import Details, SearchHit

API = "https://openlibrary.org"
COVERS = "https://covers.openlibrary.org/b/id"
SEARCH_LIMIT = 20
SEARCH_FIELDS = (
    "key,title,author_name,first_publish_year,cover_i,isbn,subject,"
    "editions,editions.title,editions.language"
)
# Open Library's MARC language codes for the languages the app shows.
MARC_LANGUAGE = {"en": "eng", "fr": "fre"}
MAX_GENRES = 5
WORK_ID = re.compile(r"^OL\d+W$")

# Subjects that describe the edition/library or a list, not the book.
_NOISE = {
    "accessible book",
    "protected daisy",
    "in library",
    "large type books",
    "new york times bestseller",
    "open library staff picks",
}


def _get(path: str, **params) -> dict:
    try:
        with http.client(base_url=API) as c:
            r = c.get(path, params=params)
            r.raise_for_status()
    except httpx2.HTTPError as exc:
        raise SourceError(f"Open Library request failed: {exc}") from exc
    return r.json()


def _work_id(key: str) -> str:
    return key.rsplit("/", 1)[-1]


def _cover_url(cover_id: int | None, size: str) -> str | None:
    # default=false makes a missing cover a 404 instead of a blank placeholder.
    return f"{COVERS}/{cover_id}-{size}.jpg?default=false" if cover_id else None


def _genres(subjects: list[str]) -> list[str]:
    """Open Library subjects are free-form: tagged `genre:x` ones come first,
    then plain subjects, skipping other tags (`nyt:…`, `form:…`) and noise."""
    tagged = [s.split(":", 1)[1] for s in subjects if s.startswith("genre:")]
    plain = [s for s in subjects if ":" not in s and "=" not in s]
    genres: list[str] = []
    for subject in tagged + plain:
        subject = subject.strip()
        subject = subject[:1].upper() + subject[1:]
        if not subject or len(subject) > 40 or subject.lower() in _NOISE:
            continue
        if subject.lower() in (g.lower() for g in genres):
            continue
        genres.append(subject)
        if len(genres) == MAX_GENRES:
            break
    return genres


def _isbn(isbns: list[str]) -> str | None:
    thirteen = [i for i in isbns if len(i) == 13]
    return (thirteen or isbns or [None])[0]


def _edition_title(doc: dict, lang: str) -> str | None:
    """Title of the edition Open Library picked for `lang=`, only if it really
    is in that language (it falls back to any edition otherwise)."""
    for edition in doc.get("editions", {}).get("docs", []):
        if MARC_LANGUAGE[lang] in edition.get("language", []) and edition.get("title"):
            return edition["title"]
    return None


def _work_doc(external_id: str, lang: str) -> dict:
    docs = _get(
        "/search.json",
        q=f"key:/works/{external_id}",
        fields=SEARCH_FIELDS,
        lang=lang,
        limit=1,
    ).get("docs", [])
    return docs[0] if docs else {}


def search(query: str, lang: str) -> list[SearchHit]:
    """Titles in the viewer's language when an edition in it exists."""
    data = _get(
        "/search.json", q=query, fields=SEARCH_FIELDS, lang=lang, limit=SEARCH_LIMIT
    )
    return [
        SearchHit(
            source=MediaSource.openlibrary,
            external_id=_work_id(doc["key"]),
            type=MediaType.book,
            title=_edition_title(doc, lang) or doc.get("title") or "",
            year=doc.get("first_publish_year"),
            creators=", ".join(doc.get("author_name", [])) or None,
            thumb_url=_cover_url(doc.get("cover_i"), "M"),
        )
        for doc in data.get("docs", [])
    ]


def details(external_id: str) -> Details:
    """`title` is an English edition's title (else the work's own title) and
    `title_fr` a French edition's, when one exists."""
    if not WORK_ID.match(external_id):
        raise SourceError(f"Not an Open Library work id: {external_id}")
    # The search index has authors/year/ISBNs and a per-language edition; the
    # work record has the description.
    doc = _work_doc(external_id, "en")
    doc_fr = _work_doc(external_id, "fr")
    work = _get(f"/works/{external_id}.json")
    work_title = doc.get("title") or work.get("title") or ""

    description = work.get("description")
    if isinstance(description, dict):
        description = description.get("value")
    cover_id = doc.get("cover_i") or next(
        (c for c in work.get("covers", []) if c and c > 0), None
    )

    return Details(
        type=MediaType.book,
        title=_edition_title(doc, "en") or work_title,
        title_fr=_edition_title(doc_fr, "fr"),
        year=doc.get("first_publish_year"),
        creators=", ".join(doc.get("author_name", [])) or None,
        genres=_genres(doc.get("subject") or work.get("subjects", [])),
        synopsis=(description or "").strip() or None,
        isbn=_isbn(doc.get("isbn", [])),
        cover_url=_cover_url(cover_id, "M"),
    )
