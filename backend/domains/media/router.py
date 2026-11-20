"""`/api/media`: search, library, sessions and covers.

Every route needs the `media` app (`require_app`), and every library route is
scoped to the current user: anyone else's entry is a 404.
"""

import calendar
import logging
from datetime import date
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import any_, func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, selectinload

from core.database import get_db
from core.deps import require_app
from core.models import User
from domains.media import catalog, covers, rules, schemas, sources
from domains.media.models import (
    BookSeries,
    Cover,
    EntryStatus,
    LibraryEntry,
    MediaItem,
    MediaSource,
    MediaType,
    ReadingSession,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

# A session with the `media` app (or admin), plus CSRF on unsafe methods.
media_user = require_app("media")


# ── helpers ──────────────────────────────────────────────────────────────────


def _summary_fields(entry: LibraryEntry) -> dict:
    progress = rules.series_progress(entry)
    finished = [s.finished_on for s in entry.sessions if s.finished_on]
    return dict(
        id=entry.id,
        status=entry.status,
        rating=entry.rating,
        owned=entry.owned,
        current_season=entry.current_season,
        current_episode=entry.current_episode,
        series_id=entry.series_id,
        series_name=entry.series.name if entry.series else None,
        series_volume=entry.series_volume,
        added_at=entry.added_at,
        updated_at=entry.updated_at,
        last_finished_on=max(finished, default=None),
        progress=(
            schemas.SeriesProgress(watched=progress[0], total=progress[1])
            if progress
            else None
        ),
        at_last_known_episode=rules.at_last_known_episode(entry),
        item=schemas.MediaItemOut.model_validate(entry.media_item),
    )


def _summary(entry: LibraryEntry) -> schemas.EntrySummary:
    return schemas.EntrySummary(**_summary_fields(entry))


def _detail(entry: LibraryEntry) -> schemas.EntryDetail:
    return schemas.EntryDetail(
        **_summary_fields(entry),
        notes=entry.notes,
        sessions=[schemas.SessionOut.model_validate(s) for s in entry.sessions],
    )


def _entries(db: Session, user: User):
    """The user's entries, with media item and sessions loaded."""
    return (
        db.query(LibraryEntry)
        .join(LibraryEntry.media_item)
        .options(
            contains_eager(LibraryEntry.media_item),
            selectinload(LibraryEntry.sessions),
        )
        .filter(LibraryEntry.user_id == user.id)
    )


def _get_entry(db: Session, user: User, entry_id: int) -> LibraryEntry:
    entry = _entries(db, user).filter(LibraryEntry.id == entry_id).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


def _commit_detail(db: Session, entry: LibraryEntry) -> schemas.EntryDetail:
    db.commit()
    db.refresh(entry)
    return _detail(entry)


def _get_series(db: Session, user: User, series_id: int) -> BookSeries:
    series = db.get(BookSeries, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="Series not found")
    return series


def _create_entry(
    db: Session, user: User, item: MediaItem, options: schemas._AddOptions
) -> LibraryEntry:
    series = (
        _get_series(db, user, options.series_id)
        if options.series_id is not None
        else None
    )
    entry = LibraryEntry(
        user_id=user.id,
        media_item=item,
        status=EntryStatus.want,
        owned=options.owned,
        series=series,
        series_volume=options.series_volume,
        sessions=[],
    )
    rules.apply_initial_status(entry, options.status, date.today(), options.undated)
    db.add(entry)
    return entry


def _item_from_source(
    db: Session, user: User, body: schemas.AddFromSearch
) -> MediaItem:
    """The catalog row for a search result, created (with its cover) if new."""
    existing = (
        db.query(MediaItem)
        .filter(
            MediaItem.source == body.source, MediaItem.external_id == body.external_id
        )
        .first()
    )
    if existing is not None:
        return existing

    # The source calls can take seconds each: release the pooled connection
    # first (`user` stays readable, detached), and only write afterwards.
    db.close()
    try:
        details = sources.details(body.source, body.type, body.external_id)
    except sources.SourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    cover = sources.download_cover(details.cover_url) if details.cover_url else None

    item = MediaItem(
        type=body.type,
        source=body.source,
        external_id=body.external_id,
        created_by_user_id=user.id,
    )
    catalog.apply_details(item, details)
    try:
        with db.begin_nested():
            db.add(item)
    except IntegrityError:
        # Someone added the same item concurrently: reuse theirs.
        return (
            db.query(MediaItem)
            .filter(
                MediaItem.source == body.source,
                MediaItem.external_id == body.external_id,
            )
            .one()
        )

    if cover is not None:
        db.add(Cover(media_item_id=item.id, content_type=cover[0], data=cover[1]))
    elif details.cover_url:
        logger.info("No cover stored for %s %s", body.source, body.external_id)
    return item


# ── search & add ─────────────────────────────────────────────────────────────


@router.get("/search", response_model=list[schemas.SearchResult])
def search(
    type: MediaType,
    q: str | None = Query(default=None, min_length=1, max_length=200),
    isbn: str | None = Query(default=None, max_length=30),
    page: int = Query(default=1, ge=1, le=100),
    lang: Literal["en", "fr"] | None = None,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """`page` > 1 (the next 20 Google Books results) is for books only.
    `lang` picks the books' edition language (default: the user's); films and
    series always use the user's language. `isbn` (books) overrides `q` and
    `lang`."""
    if type != MediaType.book and (page > 1 or lang is not None or isbn is not None):
        raise HTTPException(
            status_code=422,
            detail="Only book searches have pages, a language and an ISBN",
        )
    normalized_isbn = None
    if isbn is not None:
        normalized_isbn = sources.normalize_isbn(isbn)
        if normalized_isbn is None:
            raise HTTPException(status_code=422, detail="Not a valid ISBN")
    elif q is None or not q.strip():
        raise HTTPException(status_code=422, detail="Search text or ISBN required")
    language = lang or sources.language(user.language)
    # Not held while the source answers (see _item_from_source).
    db.close()
    try:
        hits = sources.search(type, (q or "").strip(), language, page, normalized_isbn)
    except sources.SourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    source = sources.source_for(type)
    in_library = {
        row.external_id: row
        for row in db.query(
            MediaItem.external_id,
            LibraryEntry.id,
            LibraryEntry.status,
            LibraryEntry.owned,
            LibraryEntry.series_id,
        )
        .join(LibraryEntry, LibraryEntry.media_item_id == MediaItem.id)
        .filter(
            LibraryEntry.user_id == user.id,
            MediaItem.source == source,
            MediaItem.external_id.in_([h.external_id for h in hits]),
        )
        .all()
    }
    results = []
    for h in hits:
        row = in_library.get(h.external_id)
        results.append(
            schemas.SearchResult(
                **vars(h),
                library_entry_id=row.id if row else None,
                library_status=row.status if row else None,
                library_owned=row.owned if row else None,
                library_series_id=row.series_id if row else None,
            )
        )
    return results


@router.post("/library/from-search", response_model=schemas.EntryDetail)
def add_from_search(
    body: schemas.AddFromSearch,
    response: Response,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """201 with the new entry, or 200 with the existing one if it's already in
    the library."""
    if body.series_id is not None:
        _get_series(db, user, body.series_id)  # 404 before any slow source call
    item = _item_from_source(db, user, body)
    existing = _entries(db, user).filter(LibraryEntry.media_item_id == item.id).first()
    if existing is not None:
        return _detail(existing)
    entry = _create_entry(db, user, item, body)
    response.status_code = status.HTTP_201_CREATED
    return _commit_detail(db, entry)


@router.post(
    "/library/manual",
    response_model=schemas.EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_manual(
    body: schemas.AddManual,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    item = MediaItem(
        type=body.type,
        title=body.title,
        year=body.year,
        creators=(body.creators or "").strip() or None,
        genres=list(dict.fromkeys(body.genres)),
        source=MediaSource.manual,
        external_id=None,
        created_by_user_id=user.id,
    )
    db.add(item)
    entry = _create_entry(db, user, item, body)
    return _commit_detail(db, entry)


# ── library ──────────────────────────────────────────────────────────────────


@router.get("/library", response_model=list[schemas.EntrySummary])
def list_library(
    shelf: schemas.Shelf | None = None,
    type: MediaType | None = None,
    status: EntryStatus | None = None,
    owned: bool | None = None,
    genre: str | None = None,
    q: str | None = None,
    sort: schemas.LibrarySort = "added",
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    query = _entries(db, user)
    if shelf is not None:
        query = query.filter(MediaItem.type.in_(schemas.SHELF_TYPES[shelf]))
    if type is not None:
        query = query.filter(MediaItem.type == type)
    if status is not None:
        query = query.filter(LibraryEntry.status == status)
    if owned is not None:
        query = query.filter(LibraryEntry.owned.is_(owned))
    if genre:
        query = query.filter(literal(genre) == any_(MediaItem.genres))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(
                MediaItem.title.ilike(pattern),
                MediaItem.title_fr.ilike(pattern),
                MediaItem.original_title.ilike(pattern),
                MediaItem.creators.ilike(pattern),
            )
        )

    last_finished = (
        select(func.max(ReadingSession.finished_on))
        .where(ReadingSession.library_entry_id == LibraryEntry.id)
        .correlate(LibraryEntry)
        .scalar_subquery()
    )
    # The title the viewer sees: French when known for French viewers.
    shown_title = (
        func.coalesce(MediaItem.title_fr, MediaItem.title)
        if sources.language(user.language) == "fr"
        else MediaItem.title
    )
    newest = (LibraryEntry.added_at.desc(), LibraryEntry.id.desc())
    order = {
        "added": newest,
        "title": (func.lower(shown_title), LibraryEntry.id),
        "year": (MediaItem.year.desc().nulls_last(), func.lower(shown_title)),
        "rating": (LibraryEntry.rating.desc().nulls_last(), *newest),
        "finished": (last_finished.desc().nulls_last(), *newest),
    }[sort]
    return [_summary(e) for e in query.order_by(*order).all()]


@router.get("/library/genres", response_model=list[str])
def library_genres(
    shelf: schemas.Shelf | None = None,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """Distinct genres across the user's library (or one shelf), for the genre
    filter."""
    genre = func.unnest(MediaItem.genres).label("genre")
    query = (
        db.query(genre)
        .join(LibraryEntry, LibraryEntry.media_item_id == MediaItem.id)
        .filter(LibraryEntry.user_id == user.id)
    )
    if shelf is not None:
        query = query.filter(MediaItem.type.in_(schemas.SHELF_TYPES[shelf]))
    rows = query.distinct().all()
    return sorted((r.genre for r in rows), key=str.lower)


@router.get("/library/{entry_id}", response_model=schemas.EntryDetail)
def get_entry(
    entry_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _detail(_get_entry(db, user, entry_id))


@router.patch("/library/{entry_id}", response_model=schemas.EntryDetail)
def update_entry(
    entry_id: int,
    body: schemas.EntryUpdate,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, user, entry_id)
    changes = body.model_dump(exclude_unset=True)
    if {"current_season", "current_episode"} & changes.keys():
        if entry.media_item.type != MediaType.series:
            raise HTTPException(
                status_code=422, detail="Season and episode are for series only"
            )
    book = entry.media_item.type == MediaType.book
    if "owned" in changes:
        changes["owned"] = bool(changes["owned"])
        if changes["owned"] and not book:
            raise HTTPException(status_code=422, detail=schemas.OWNED_BOOKS_ONLY)
    if {"series_id", "series_volume"} & changes.keys():
        if not book and (changes.get("series_id") or changes.get("series_volume")):
            raise HTTPException(status_code=422, detail=schemas.SERIES_BOOKS_ONLY)
        if changes.get("series_id") is not None:
            _get_series(db, user, changes["series_id"])
    if "notes" in changes:
        changes["notes"] = (changes["notes"] or "").strip() or None
    for field, value in changes.items():
        setattr(entry, field, value)
    return _commit_detail(db, entry)


@router.delete("/library/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """Deletes the entry and its sessions; the catalog item stays."""
    db.delete(_get_entry(db, user, entry_id))
    db.commit()


# ── status actions ───────────────────────────────────────────────────────────


def _act(db: Session, user: User, entry_id: int, action) -> schemas.EntryDetail:
    entry = _get_entry(db, user, entry_id)
    try:
        action(entry)
    except rules.RuleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _commit_detail(db, entry)


@router.post("/library/{entry_id}/start", response_model=schemas.EntryDetail)
def start(
    entry_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _act(db, user, entry_id, lambda e: rules.start(e, date.today()))


@router.post("/library/{entry_id}/finish", response_model=schemas.EntryDetail)
def finish(
    entry_id: int,
    undated: bool = False,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """`undated`: finished on an unknown date."""
    return _act(db, user, entry_id, lambda e: rules.finish(e, date.today(), undated))


@router.post("/library/{entry_id}/drop", response_model=schemas.EntryDetail)
def drop(
    entry_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _act(db, user, entry_id, rules.drop)


@router.post("/library/{entry_id}/next-episode", response_model=schemas.EntryDetail)
def next_episode(
    entry_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _act(db, user, entry_id, rules.next_episode)


# ── sessions ─────────────────────────────────────────────────────────────────


def _check_single_open(
    entry: LibraryEntry, body: schemas.SessionIn, editing_id: int | None = None
) -> None:
    if body.finished_on is not None or body.undated:
        return
    other_open = [
        s
        for s in entry.sessions
        if s.finished_on is None and not s.undated and s.id != editing_id
    ]
    if other_open:
        raise HTTPException(
            status_code=409, detail="This entry already has an open session"
        )


def _get_session(entry: LibraryEntry, session_id: int) -> ReadingSession:
    session = next((s for s in entry.sessions if s.id == session_id), None)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post(
    "/library/{entry_id}/sessions",
    response_model=schemas.EntryDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_session(
    entry_id: int,
    body: schemas.SessionIn,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, user, entry_id)
    _check_single_open(entry, body)
    entry.sessions.append(
        ReadingSession(
            started_on=body.started_on,
            finished_on=body.finished_on,
            undated=body.undated,
        )
    )
    return _commit_detail(db, entry)


@router.put(
    "/library/{entry_id}/sessions/{session_id}", response_model=schemas.EntryDetail
)
def update_session(
    entry_id: int,
    session_id: int,
    body: schemas.SessionIn,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, user, entry_id)
    session = _get_session(entry, session_id)
    _check_single_open(entry, body, editing_id=session.id)
    session.started_on, session.finished_on = body.started_on, body.finished_on
    session.undated = body.undated
    return _commit_detail(db, entry)


@router.delete(
    "/library/{entry_id}/sessions/{session_id}", response_model=schemas.EntryDetail
)
def delete_session(
    entry_id: int,
    session_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, user, entry_id)
    entry.sessions.remove(_get_session(entry, session_id))
    return _commit_detail(db, entry)


# ── series ───────────────────────────────────────────────────────────────────


def _volume_order(entry: LibraryEntry):
    # By number, unnumbered last by title.
    volume = entry.series_volume
    return (volume is None, volume or 0, entry.media_item.title.lower(), entry.id)


def _series_out(series: BookSeries, entries: list[LibraryEntry]) -> dict:
    entries = sorted(entries, key=_volume_order)
    cover = next((e for e in entries if e.media_item.has_cover), None) or next(
        iter(entries), None
    )
    return dict(
        id=series.id,
        name=series.name,
        volumes=len(entries),
        read=sum(e.status == EntryStatus.done for e in entries),
        owned=sum(e.owned for e in entries),
        cover_item=(
            schemas.MediaItemOut.model_validate(cover.media_item) if cover else None
        ),
    )


def _series_detail(db: Session, user: User, series: BookSeries):
    entries = sorted(
        _entries(db, user).filter(LibraryEntry.series_id == series.id).all(),
        key=_volume_order,
    )
    return schemas.SeriesDetail(
        **_series_out(series, entries), entries=[_summary(e) for e in entries]
    )


def _save_series(db: Session, series: BookSeries) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="You already have a series with that name"
        ) from exc


@router.get("/series", response_model=list[schemas.SeriesOut])
def list_series(user: User = Depends(media_user), db: Session = Depends(get_db)):
    all_series = (
        db.query(BookSeries)
        .filter(BookSeries.user_id == user.id)
        .order_by(func.lower(BookSeries.name), BookSeries.id)
        .all()
    )
    by_series: dict[int, list[LibraryEntry]] = {s.id: [] for s in all_series}
    for entry in _entries(db, user).filter(LibraryEntry.series_id.isnot(None)):
        by_series[entry.series_id].append(entry)
    return [schemas.SeriesOut(**_series_out(s, by_series[s.id])) for s in all_series]


@router.post(
    "/series", response_model=schemas.SeriesOut, status_code=status.HTTP_201_CREATED
)
def create_series(
    body: schemas.SeriesIn,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    series = BookSeries(user_id=user.id, name=body.name)
    db.add(series)
    _save_series(db, series)
    return schemas.SeriesOut(**_series_out(series, []))


@router.get("/series/{series_id}", response_model=schemas.SeriesDetail)
def get_series(
    series_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _series_detail(db, user, _get_series(db, user, series_id))


@router.patch("/series/{series_id}", response_model=schemas.SeriesDetail)
def rename_series(
    series_id: int,
    body: schemas.SeriesIn,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    series = _get_series(db, user, series_id)
    series.name = body.name
    _save_series(db, series)
    return _series_detail(db, user, series)


@router.delete("/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_series(
    series_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """The volumes stay in the library, outside any series."""
    db.delete(_get_series(db, user, series_id))
    db.commit()


# ── journal ──────────────────────────────────────────────────────────────────


@router.get("/journal", response_model=list[schemas.JournalEntry])
def journal(
    year: int = Query(ge=1, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    type: MediaType | None = None,
    event: schemas.JournalEvent | None = None,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """Each session's start and finish inside the month (or the whole year),
    newest first."""
    if month is None:
        first, last = date(year, 1, 1), date(year, 12, 31)
    else:
        first = date(year, month, 1)
        last = date(year, month, calendar.monthrange(year, month)[1])

    query = _entries(db, user).filter(
        LibraryEntry.sessions.any(
            or_(
                ReadingSession.started_on.between(first, last),
                ReadingSession.finished_on.between(first, last),
            )
        )
    )
    if type is not None:
        query = query.filter(MediaItem.type == type)

    events: list[schemas.JournalEntry] = []
    for entry in query.all():
        summary = _summary(entry)
        for s in entry.sessions:
            for kind, day in (("started", s.started_on), ("finished", s.finished_on)):
                if day and first <= day <= last and event in (None, kind):
                    events.append(
                        schemas.JournalEntry(
                            date=day, event=kind, session_id=s.id, entry=summary
                        )
                    )
    # Newest first; on the same day a finish before a start, then newest session.
    events.sort(
        key=lambda e: (e.date, e.event == "finished", e.session_id), reverse=True
    )
    return events


# ── covers ───────────────────────────────────────────────────────────────────


def _set_cover(
    db: Session, user: User, entry_id: int, get_image
) -> schemas.EntryDetail:
    """Replaces the entry's catalog cover, for everyone who has the item."""
    entry = _get_entry(db, user, entry_id)
    try:
        content_type, data = get_image()
    except covers.CoverError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    item = entry.media_item
    row = db.get(Cover, item.id)
    if row is None:
        db.add(Cover(media_item_id=item.id, content_type=content_type, data=data))
    else:
        row.content_type, row.data = content_type, data
    # New `updated_at` = new cover URL, past the immutable cache.
    item.updated_at = func.now()
    db.commit()
    db.expire_all()
    return _detail(_get_entry(db, user, entry_id))


@router.put("/library/{entry_id}/cover", response_model=schemas.EntryDetail)
async def upload_cover(
    entry_id: int,
    request: Request,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """The body is the image itself, with its `Content-Type`."""
    # Not held for the upload (see _item_from_source).
    await run_in_threadpool(db.close)
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > sources.MAX_COVER_BYTES:
            break
    content_type = request.headers.get("content-type")
    return await run_in_threadpool(
        _set_cover,
        db,
        user,
        entry_id,
        lambda: covers.check(content_type, bytes(data)),
    )


@router.post("/library/{entry_id}/cover/from-url", response_model=schemas.EntryDetail)
def cover_from_url(
    entry_id: int,
    body: schemas.CoverFromUrl,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    _get_entry(db, user, entry_id)  # 404 before fetching anything
    # Not held while the image downloads (see _item_from_source).
    db.close()
    try:
        image = covers.download(body.url)
    except covers.CoverError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _set_cover(db, user, entry_id, lambda: image)


@router.get("/items/{media_item_id}/cover")
def cover(
    media_item_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    row = db.get(Cover, media_item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No cover")
    # Its URL carries the item's `updated_at`, which a new cover changes.
    return Response(
        content=row.data,
        media_type=row.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
