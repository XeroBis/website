"""TMDB client (films and series).

Auth is the v4 Read Access Token as a Bearer header, so it never appears in
logged URLs. Results use the user's language when known.
"""

from concurrent.futures import ThreadPoolExecutor

import httpx2

from core.config import settings
from domains.media.models import MediaSource, MediaType
from domains.media.sources import http
from domains.media.sources.http import SourceError
from domains.media.sources.types import Details, SearchHit

API = "https://api.themoviedb.org/3"
IMAGES = "https://image.tmdb.org/t/p"
SEARCH_LIMIT = 10


def _client() -> httpx2.Client:
    if not settings.tmdb_read_access_token:
        raise SourceError("TMDB_READ_ACCESS_TOKEN is not configured")
    return http.client(
        base_url=API,
        headers={"Authorization": f"Bearer {settings.tmdb_read_access_token}"},
    )


def _get(c: httpx2.Client, path: str, **params) -> dict:
    params = {k: v for k, v in params.items() if v is not None}
    try:
        r = c.get(path, params=params)
        r.raise_for_status()
    except httpx2.HTTPError as exc:
        raise SourceError(f"TMDB request failed: {exc}") from exc
    return r.json()


def _kind(media_type: MediaType) -> str:
    return "movie" if media_type == MediaType.film else "tv"


def _year(date: str | None) -> int | None:
    return int(date[:4]) if date and date[:4].isdigit() else None


def _creators(data: dict, media_type: MediaType) -> str | None:
    if media_type == MediaType.film:
        crew = data.get("credits", {}).get("crew", [])
        names = [c["name"] for c in crew if c.get("job") == "Director"]
    else:
        names = [c["name"] for c in data.get("created_by", [])]
    return ", ".join(dict.fromkeys(names)) or None


def _episode_counts(seasons: list[dict]) -> list[int] | None:
    """Episode count per season, index 0 = season 1.

    Specials (season 0) are skipped, and trailing announced seasons with no
    episodes yet are dropped so "+1 episode" doesn't roll into an empty season.
    """
    by_number = {
        s["season_number"]: s.get("episode_count") or 0
        for s in seasons
        if s.get("season_number", 0) > 0
    }
    if not by_number:
        return None
    counts = [by_number.get(n, 0) for n in range(1, max(by_number) + 1)]
    while counts and counts[-1] == 0:
        counts.pop()
    return counts or None


def search(media_type: MediaType, query: str, language: str | None) -> list[SearchHit]:
    kind = _kind(media_type)
    with _client() as c:
        data = _get(
            c, f"/search/{kind}", query=query, language=language, include_adult="false"
        )
        results = data.get("results", [])[:SEARCH_LIMIT]

        # Search results don't include directors/creators: fetch them in parallel.
        def creators_for(result: dict) -> str | None:
            try:
                if media_type == MediaType.film:
                    return _creators(
                        {"credits": _get(c, f"/movie/{result['id']}/credits")},
                        media_type,
                    )
                return _creators(_get(c, f"/tv/{result['id']}"), media_type)
            except SourceError:
                return None

        with ThreadPoolExecutor(max_workers=SEARCH_LIMIT) as pool:
            creators = list(pool.map(creators_for, results))

    title_key = "title" if media_type == MediaType.film else "name"
    date_key = "release_date" if media_type == MediaType.film else "first_air_date"
    return [
        SearchHit(
            source=MediaSource.tmdb,
            external_id=str(r["id"]),
            type=media_type,
            title=r.get(title_key) or "",
            year=_year(r.get(date_key)),
            creators=creator,
            thumb_url=(
                f"{IMAGES}/w154{r['poster_path']}" if r.get("poster_path") else None
            ),
        )
        for r, creator in zip(results, creators, strict=True)
    ]


def _title(data: dict, media_type: MediaType) -> tuple[str | None, str | None]:
    """(localized title, original title)."""
    if media_type == MediaType.film:
        return data.get("title"), data.get("original_title")
    return data.get("name"), data.get("original_name")


def details(media_type: MediaType, external_id: str) -> Details:
    """English data (the catalog's default), plus the French title and
    synopsis from a second fr-FR request."""
    kind = _kind(media_type)
    append = "credits" if media_type == MediaType.film else None
    with _client() as c:
        data = _get(
            c, f"/{kind}/{external_id}", language="en-US", append_to_response=append
        )
        fr = _get(c, f"/{kind}/{external_id}", language="fr-FR")

    title, original = _title(data, media_type)
    title = title or original or ""
    date = data.get(
        "release_date" if media_type == MediaType.film else "first_air_date"
    )

    return Details(
        type=media_type,
        title=title,
        # TMDB falls back to the original title when it has no French one.
        title_fr=_title(fr, media_type)[0] or None,
        original_title=original if original and original != title else None,
        year=_year(date),
        creators=_creators(data, media_type),
        genres=[g["name"] for g in data.get("genres", [])],
        synopsis=data.get("overview") or None,
        synopsis_fr=fr.get("overview") or None,
        runtime_minutes=(
            (data.get("runtime") or None) if media_type == MediaType.film else None
        ),
        season_episode_counts=(
            _episode_counts(data.get("seasons", []))
            if media_type == MediaType.series
            else None
        ),
        cover_url=(
            f"{IMAGES}/w342{data['poster_path']}" if data.get("poster_path") else None
        ),
    )
