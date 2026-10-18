"""Catalog jobs: the refresh steps (alone or all in a row), the metadata import
and the images import, with their progress kept in memory.

The backend runs one process (decisions.md), so a module-level dict is the
job store: no table, nothing survives a restart (`last_run_*` included). One
job at a time: starting another while one runs is refused (409 in the
router). The full refresh records each step's own state too, so a step's
"last run" is right however it was started.
"""

import logging
import queue
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from core import database
from core.config import settings
from domains.cards.refresh import (
    card_details,
    html_import,
    scans,
    set_assets,
    thumbnails,
    variant_icons,
)

logger = logging.getLogger(__name__)

ALL = "__all__"
IMPORT_METADATA = "import_metadata"
IMPORT_IMAGES = "import_images"

Progress = Callable[[int, int], None]


@dataclass
class JobState:
    status: str = "idle"  # idle | running | done | error
    # Full refresh / images import: the current step.
    step: str | None = None
    step_label: str | None = None
    step_index: int = 0
    total_steps: int = 0
    percent: int = 0
    sub_done: int = 0
    sub_total: int = 0
    result: dict = field(default_factory=dict)
    error: str | None = None
    last_run_at: str | None = None
    last_run_result: dict | None = None


_lock = threading.Lock()
_states: dict[str, JobState] = {}
_running: str | None = None


def _get(key: str) -> JobState:
    return _states.setdefault(key, JobState())


def _recompute_percent(state: JobState) -> None:
    fraction = state.sub_done / state.sub_total if state.sub_total else 0.0
    if state.total_steps:
        completed = max(state.step_index - 1, 0)
        state.percent = min(99, round((completed + fraction) / state.total_steps * 100))
    elif state.sub_total:
        state.percent = min(99, round(fraction * 100))


def get_state(key: str) -> dict:
    with _lock:
        return asdict(_get(key))


def running() -> str | None:
    with _lock:
        return _running


def try_start(key: str, total_steps: int = 0) -> bool:
    """Start `key` unless a job is already running."""
    global _running
    with _lock:
        if _running is not None:
            return False
        _running = key
        previous = _get(key)
        _states[key] = JobState(
            status="running",
            total_steps=total_steps,
            last_run_at=previous.last_run_at,
            last_run_result=previous.last_run_result,
        )
    logger.info("Catalog job %r: started", key)
    return True


def set_step(key: str, step: str, label: str, index: int) -> None:
    with _lock:
        state = _get(key)
        state.step, state.step_label, state.step_index = step, label, index
        state.sub_done = state.sub_total = 0
        _recompute_percent(state)
    logger.info("Catalog job %r: step %d/%d, %s", key, index, state.total_steps, label)


def set_progress(key: str, done: int, total: int) -> None:
    with _lock:
        state = _get(key)
        state.sub_done, state.sub_total = done, total
        _recompute_percent(state)


def _close(key: str, status: str, result: dict | None, error: str | None) -> None:
    state = _get(key)
    state.status = status
    state.error = error
    if status == "done":
        state.step = state.step_label = None
        state.percent = 100
        state.result = result or {}
        state.last_run_at = datetime.now(UTC).isoformat()
        state.last_run_result = state.result


def finish(key: str, **result) -> None:
    """End a job (or, during the full refresh, one of its steps) as done."""
    global _running
    with _lock:
        _close(key, "done", result, None)
        if _running == key:
            _running = None
    logger.info("Catalog job %r: done, %s", key, result)


def fail(key: str, message: str) -> None:
    global _running
    with _lock:
        _close(key, "error", None, message)
        if _running == key:
            _running = None
    logger.error("Catalog job %r: failed, %s", key, message)


def begin_substep(key: str) -> None:
    """A step of the full refresh starts: its own state shows it running."""
    with _lock:
        previous = _get(key)
        _states[key] = JobState(
            status="running",
            last_run_at=previous.last_run_at,
            last_run_result=previous.last_run_result,
        )


def spawn(target: Callable, *args) -> None:
    """Run a job in the background (tests replace this to run it inline)."""
    threading.Thread(target=target, args=args, daemon=True).start()


def reset() -> None:
    """Forget every job (tests)."""
    global _running
    with _lock:
        _states.clear()
        _running = None


# ── refresh steps ────────────────────────────────────────────────────────────


def _data_dir() -> Path:
    return Path(settings.cards_data_dir)


def _reporter(key: str) -> Progress:
    """Progress of a step, mirrored on the full refresh while it runs."""

    def report(done: int, total: int) -> None:
        set_progress(key, done, total)
        if running() == ALL:
            set_progress(ALL, done, total)

    return report


StepFn = Callable[[Session, Progress], dict]

STEPS: dict[str, tuple[str, StepFn]] = {
    "import_html": (
        "Importing the source HTML into the catalog",
        lambda db, progress: html_import.import_html(db),
    ),
    "import_card_details": (
        "Importing card details from TCGdex",
        lambda db, progress: card_details.import_details(db, _data_dir(), progress),
    ),
    "scrape_images": (
        "Downloading card scans (every print, EN and FR)",
        lambda db, progress: scans.scrape_images(db, _data_dir(), on_progress=progress),
    ),
    "generate_thumbnails": (
        "Generating missing thumbnails",
        lambda db, progress: thumbnails.generate_thumbnails(db, _data_dir(), progress),
    ),
    "scrape_logos_symbols": (
        "Downloading set logos and symbols",
        lambda db, progress: set_assets.scrape_logos_symbols(_data_dir()),
    ),
    "download_variant_icons": (
        "Downloading variant badges",
        lambda db, progress: variant_icons.download_variant_icons(_data_dir()),
    ),
}


def run_step(key: str) -> None:
    """One step on its own (background thread, own session)."""
    try:
        with database.SessionLocal() as db:
            result = STEPS[key][1](db, _reporter(key))
        finish(key, **result)
    except Exception:
        logger.exception("Catalog refresh step %r failed", key)
        fail(key, "Refresh step failed, check the server logs")


def _scans_and_thumbnails() -> tuple[dict, dict, Exception | None]:
    """Downloads scans while a second thread thumbnails each new standard scan,
    then catches up on older ones. Either can fail without stopping the
    other."""
    saved: queue.Queue[Path | None] = queue.Queue()
    results: dict[str, dict] = {}
    errors: dict[str, Exception] = {}
    data_dir = _data_dir()

    def download() -> None:
        try:
            with database.SessionLocal() as db:
                results["scrape_images"] = scans.scrape_images(
                    db,
                    data_dir,
                    on_standard_saved=saved.put,
                    on_progress=_reporter("scrape_images"),
                )
        except Exception as exc:
            logger.exception("Scan download failed")
            errors["scrape_images"] = exc
        finally:
            saved.put(None)

    def thumbnail() -> None:
        try:
            generated = 0
            while (scan := saved.get()) is not None:
                generated += thumbnails.make_thumbnail(scan)
            with database.SessionLocal() as db:
                catch_up = thumbnails.generate_thumbnails(db, data_dir)
            results["generate_thumbnails"] = {
                "thumbnails_generated": generated + catch_up["thumbnails_generated"]
            }
        except Exception as exc:
            logger.exception("Thumbnail generation failed")
            errors["generate_thumbnails"] = exc

    threads = [threading.Thread(target=f, daemon=True) for f in (download, thumbnail)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    for key in ("scrape_images", "generate_thumbnails"):
        if key in errors:
            with _lock:
                _close(key, "error", None, "Step failed, check the server logs")
        else:
            finish(key, **results[key])
    error = errors.get("scrape_images") or errors.get("generate_thumbnails")
    return (
        results.get("scrape_images", {}),
        results.get("generate_thumbnails", {}),
        error,
    )


def run_all() -> None:
    """Every step in order; scans and thumbnails run side by side. Stops at
    the first failure."""
    aggregate: dict = {}
    try:
        keys = list(STEPS)
        for index, key in enumerate(keys, 1):
            if key == "generate_thumbnails":
                continue  # runs with scrape_images
            label, step = STEPS[key]
            set_step(ALL, key, label, index)
            begin_substep(key)
            if key == "scrape_images":
                begin_substep("generate_thumbnails")
                images, thumbs, error = _scans_and_thumbnails()
                set_step(
                    ALL,
                    "generate_thumbnails",
                    STEPS["generate_thumbnails"][0],
                    index + 1,
                )
                aggregate |= images | thumbs
                if error:
                    raise error
                continue
            try:
                with database.SessionLocal() as db:
                    result = step(db, _reporter(key))
            except Exception:
                with _lock:
                    _close(key, "error", None, "Step failed, check the server logs")
                raise
            finish(key, **result)
            aggregate |= result
        finish(ALL, **aggregate)
    except Exception:
        logger.exception("Catalog refresh failed")
        fail(ALL, "Catalog refresh failed, check the server logs")
