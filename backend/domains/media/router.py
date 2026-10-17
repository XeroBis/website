"""`/api/media`: search, library, sessions and covers.

Every route needs the `media` app (`require_app`), and every library route is
scoped to the current user: anyone else's entry is a 404.
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import any_, func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, selectinload

from core.database import get_db
from core.deps import require_app
from core.models import User
from domains.media import catalog, rules, schemas, sources
from domains.media.models import (
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
        owned_formats=entry.owned_formats,
        current_season=entry.current_season,
        current_episode=entry.current_episode,
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


def _create_entry(
    db: Session,
    user: User,
    item: MediaItem,
    initial_status: EntryStatus,
    owned_formats: list[str],
) -> LibraryEntry:
    entry = LibraryEntry(
        user_id=user.id,
        media_item=item,
        status=EntryStatus.want,
        owned_formats=list(dict.fromkeys(owned_formats)),
        sessions=[],
    )
    rules.apply_initial_status(entry, initial_status, date.today())
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

    try:
        details = sources.details(body.source, body.type, body.external_id)
    except sources.SourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

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

    if details.cover_url:
        cover = sources.download_cover(details.cover_url)
        if cover is not None:
            db.add(Cover(media_item_id=item.id, content_type=cover[0], data=cover[1]))
        else:
            logger.info("No cover stored for %s %s", body.source, body.external_id)
    return item


# ── search & add ─────────────────────────────────────────────────────────────


@router.get("/search", response_model=list[schemas.SearchResult])
def search(
    type: MediaType,
    q: str = Query(min_length=1, max_length=200),
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    try:
        hits = sources.search(type, q.strip(), sources.language(user.language))
    except sources.SourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    source = sources.source_for(type)
    in_library = dict(
        db.query(MediaItem.external_id, LibraryEntry.id)
        .join(LibraryEntry, LibraryEntry.media_item_id == MediaItem.id)
        .filter(
            LibraryEntry.user_id == user.id,
            MediaItem.source == source,
            MediaItem.external_id.in_([h.external_id for h in hits]),
        )
        .all()
    )
    return [
        schemas.SearchResult(**vars(h), library_entry_id=in_library.get(h.external_id))
        for h in hits
    ]


@router.post("/library/from-search", response_model=schemas.EntryDetail)
def add_from_search(
    body: schemas.AddFromSearch,
    response: Response,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    """201 with the new entry, or 200 with the existing one if it's already in
    the library."""
    item = _item_from_source(db, user, body)
    existing = _entries(db, user).filter(LibraryEntry.media_item_id == item.id).first()
    if existing is not None:
        return _detail(existing)
    entry = _create_entry(db, user, item, body.status, body.owned_formats)
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
    entry = _create_entry(db, user, item, body.status, body.owned_formats)
    return _commit_detail(db, entry)


# ── library ──────────────────────────────────────────────────────────────────


@router.get("/library", response_model=list[schemas.EntrySummary])
def list_library(
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
    if type is not None:
        query = query.filter(MediaItem.type == type)
    if status is not None:
        query = query.filter(LibraryEntry.status == status)
    if owned is not None:
        has_formats = func.cardinality(LibraryEntry.owned_formats) > 0
        query = query.filter(has_formats if owned else ~has_formats)
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
def library_genres(user: User = Depends(media_user), db: Session = Depends(get_db)):
    """Distinct genres across the user's library, for the genre filter."""
    genre = func.unnest(MediaItem.genres).label("genre")
    rows = (
        db.query(genre)
        .join(LibraryEntry, LibraryEntry.media_item_id == MediaItem.id)
        .filter(LibraryEntry.user_id == user.id)
        .distinct()
        .all()
    )
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
    if "owned_formats" in changes:
        changes["owned_formats"] = list(dict.fromkeys(changes["owned_formats"] or []))
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
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    return _act(db, user, entry_id, lambda e: rules.finish(e, date.today()))


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
    if body.finished_on is not None:
        return
    other_open = [
        s for s in entry.sessions if s.finished_on is None and s.id != editing_id
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
        ReadingSession(started_on=body.started_on, finished_on=body.finished_on)
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


# ── covers ───────────────────────────────────────────────────────────────────


@router.get("/items/{media_item_id}/cover")
def cover(
    media_item_id: int,
    user: User = Depends(media_user),
    db: Session = Depends(get_db),
):
    row = db.get(Cover, media_item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No cover")
    # A cover never changes once stored.
    return Response(
        content=row.data,
        media_type=row.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
