"""Catalog management, admins only: stats, the refresh pipeline (all steps or
one, in the background, polled), the catalog metadata export/import and the
images export/import. Plus the public variant badges."""

import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from core.deps import require_admin
from core.models import User
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import not_found
from domains.cards.refresh import archive, jobs, metadata, variant_icons

router = APIRouter(prefix="/catalog", tags=["cards"])
public_router = APIRouter(prefix="/public/variant-icons", tags=["cards"])


def _busy() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "Another catalog job is already running"
    )


def _data_dir() -> Path:
    return Path(settings.cards_data_dir)


# ── stats ────────────────────────────────────────────────────────────────────


@router.get("/stats", response_model=s.CatalogStats)
def catalog_stats(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    totals = db.execute(
        select(
            func.count(m.CardCatalog.id),
            func.count(distinct(m.CardCatalog.set_code)),
            func.count(distinct(m.CardCatalog.name)),
        )
    ).one()
    variant_type = m.CardCatalogVariant.variant_type
    counts = db.execute(select(variant_type, func.count()).group_by(variant_type)).all()
    return s.CatalogStats(
        total_cards=totals[0],
        total_sets=totals[1],
        distinct_card_names=totals[2],
        variant_counts=dict(counts),
    )


# ── refresh ──────────────────────────────────────────────────────────────────


@router.post(
    "/refresh", response_model=s.JobStarted, status_code=status.HTTP_202_ACCEPTED
)
def refresh_catalog(_: User = Depends(require_admin)):
    """Every step in order, in the background; poll /refresh/status."""
    if not jobs.try_start(jobs.ALL, total_steps=len(jobs.STEPS)):
        raise _busy()
    jobs.spawn(jobs.run_all)
    return s.JobStarted()


@router.get("/refresh/status", response_model=s.JobStatus)
def refresh_status(_: User = Depends(require_admin)):
    return jobs.get_state(jobs.ALL)


def _step(step_key: str) -> str:
    if step_key not in jobs.STEPS:
        raise not_found("Refresh step")
    return step_key


@router.post(
    "/refresh/steps/{step_key}",
    response_model=s.JobStarted,
    status_code=status.HTTP_202_ACCEPTED,
)
def refresh_step(step_key: str, _: User = Depends(require_admin)):
    """One step alone, in the background; poll its status."""
    if not jobs.try_start(_step(step_key)):
        raise _busy()
    jobs.spawn(jobs.run_step, step_key)
    return s.JobStarted()


@router.get("/refresh/steps/{step_key}/status", response_model=s.JobStatus)
def refresh_step_status(step_key: str, _: User = Depends(require_admin)):
    return jobs.get_state(_step(step_key))


# ── catalog metadata ─────────────────────────────────────────────────────────


@router.get("/export", response_model=s.CatalogFile)
def export_catalog(
    response: Response,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    response.headers["Content-Disposition"] = (
        'attachment; filename="cards_metadata.json"'
    )
    return metadata.export_catalog(db)


@router.post("/import/metadata", response_model=s.CatalogImportResult)
def import_catalog(
    body: s.CatalogFile,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """`cards_metadata.json` as the body. Refused while another job runs."""
    if not jobs.try_start(jobs.IMPORT_METADATA):
        raise _busy()
    try:
        result = metadata.import_catalog(db, body)
    except HTTPException as exc:
        jobs.fail(jobs.IMPORT_METADATA, str(exc.detail))
        raise
    except Exception:
        jobs.fail(jobs.IMPORT_METADATA, "Catalog import failed")
        raise
    jobs.finish(jobs.IMPORT_METADATA, **result.model_dump())
    return result


# ── images ───────────────────────────────────────────────────────────────────


def _selection(
    french: bool = True,
    english: bool = True,
    standard: bool = True,
    variants: bool = True,
    logos: bool = True,
    symbols: bool = True,
    set_code: list[str] | None = Query(default=None),
) -> archive.Selection:
    return archive.Selection(
        french=french,
        english=english,
        standard=standard,
        variants=variants,
        logos=logos,
        symbols=symbols,
        set_codes=frozenset(set_code) if set_code else None,
    )


@router.get("/export/images")
def export_images(
    selection: archive.Selection = Depends(_selection),
    _: User = Depends(require_admin),
):
    """The selected files as `card_images.zip`, streamed."""
    files = archive.selected_files(_data_dir(), selection)
    if not files:
        raise not_found("Image")
    return StreamingResponse(
        archive.stream_zip(files),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="card_images.zip"'},
    )


@router.post(
    "/import/images", response_model=s.JobStarted, status_code=status.HTTP_202_ACCEPTED
)
async def import_images(
    request: Request,
    selection: archive.Selection = Depends(_selection),
    _: User = Depends(require_admin),
):
    """The zip as the raw body. It is saved inside CARDS_DATA_DIR, then the
    selected entries are restored in the background (files already there
    kept) and pending catalog scans linked; poll /import/images/status."""
    key = jobs.IMPORT_IMAGES
    if not jobs.try_start(key, total_steps=len(archive.IMPORT_STEPS)):
        raise _busy()
    data_dir = _data_dir()
    upload = data_dir / f"{archive.UPLOAD_PREFIX}{secrets.token_hex(8)}.zip"
    try:
        jobs.set_step(key, "upload", archive.IMPORT_LABELS["upload"], 1)
        expected = int(request.headers.get("content-length") or 0)
        received = 0
        await run_in_threadpool(data_dir.mkdir, parents=True, exist_ok=True)
        # Leftovers of an upload interrupted by a restart.
        for stale in data_dir.glob(f"{archive.UPLOAD_PREFIX}*"):
            stale.unlink(missing_ok=True)
        with upload.open("wb") as out:
            async for chunk in request.stream():
                await run_in_threadpool(out.write, chunk)
                received += len(chunk)
                jobs.set_progress(key, received, max(expected, received))
        if not await run_in_threadpool(archive.is_zip, upload):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "The body is not a zip archive"
            )
    except BaseException as exc:
        upload.unlink(missing_ok=True)
        detail = exc.detail if isinstance(exc, HTTPException) else "Upload failed"
        jobs.fail(key, str(detail))
        raise
    jobs.spawn(archive.run_import, upload, data_dir, selection)
    return s.JobStarted()


@router.get("/import/images/status", response_model=s.JobStatus)
def image_import_status(_: User = Depends(require_admin)):
    return jobs.get_state(jobs.IMPORT_IMAGES)


# ── public variant badges ────────────────────────────────────────────────────


@public_router.get("/{filename}")
def get_variant_icon(filename: str):
    """No auth (share pages show them too). Only the known badge files; a
    missing one gets a neutral placeholder, never cached."""
    if filename not in variant_icons.sources():
        raise not_found("Variant badge")
    root = _data_dir().resolve()
    path = (root / variant_icons.FOLDER / filename).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return Response(
            variant_icons.fallback_svg(filename),
            media_type="image/svg+xml",
            headers={"Cache-Control": "no-store"},
        )
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})
