"""The images export/import: a zip of CARDS_DATA_DIR's scans, thumbnails, set
logos and symbols (relative paths kept, so it restores the same layout and
the catalog's paths keep matching), filtered by language, kind and set.

The export is streamed as it is written (the full archive is ~2 GB). The
import receives the zip as the raw request body into a temporary file inside
CARDS_DATA_DIR, then a background job restores the selected entries straight
into place (existing files kept) and links pending catalog paths.
"""

import logging
import shutil
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from core import database
from domains.cards.refresh import jobs, scans

logger = logging.getLogger(__name__)

CHUNK = 1024 * 1024
UPLOAD_PREFIX = ".upload-"
IMPORT_STEPS = ("upload", "restore", "link")
IMPORT_LABELS = {
    "upload": "Receiving the archive",
    "restore": "Restoring the selected files",
    "link": "Linking catalog scans",
}


@dataclass(frozen=True)
class Selection:
    french: bool = True
    english: bool = True
    standard: bool = True
    variants: bool = True
    logos: bool = True
    symbols: bool = True
    set_codes: frozenset[str] | None = None

    def selects(self, path: PurePosixPath) -> bool:
        """Scans and thumbnails (`<series>/<set>/{cards,thumbnails}/…_EN|FR`,
        standard ones named `…_standard_…`), logos (`…_logo_EN|FR`) and
        language-neutral symbols; anything else is never included."""
        if path.parent.name in {"cards", "thumbnails"}:
            if (
                self.set_codes is not None
                and path.parent.parent.name not in self.set_codes
            ):
                return False
            language_ok = (self.english and path.stem.endswith("_EN")) or (
                self.french and path.stem.endswith("_FR")
            )
            if not language_ok:
                return False
            return self.standard if "_standard_" in path.stem else self.variants
        is_logo, is_symbol = "_logo" in path.stem, "_symbol" in path.stem
        if not (is_logo and self.logos) and not (is_symbol and self.symbols):
            return False
        if self.set_codes is not None and path.parent.name not in self.set_codes:
            return False
        if path.stem.endswith("_EN"):
            return self.english
        if path.stem.endswith("_FR"):
            return self.french
        return True


# ── export ───────────────────────────────────────────────────────────────────


def selected_files(data_dir: Path, selection: Selection) -> list[tuple[Path, str]]:
    """(file, archive name) of every selected file, sorted."""
    if not data_dir.is_dir():
        return []
    files = []
    for path in sorted(data_dir.rglob("*")):
        relative = PurePosixPath(path.relative_to(data_dir).as_posix())
        if path.is_file() and selection.selects(relative):
            files.append((path, str(relative)))
    return files


class _Chunks:
    """A write-only sink for ZipFile: no seek/tell, so it writes data
    descriptors and keeps its own offsets, which lets the zip be streamed."""

    def __init__(self):
        self.buffer = bytearray()

    def write(self, data) -> int:
        self.buffer += data
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        data = bytes(self.buffer)
        self.buffer.clear()
        return data


def stream_zip(files: list[tuple[Path, str]]) -> Iterator[bytes]:
    """The archive (stored, not compressed: JPEG/PNG don't shrink), in ~1 MB
    chunks, never held whole in memory or on disk."""
    sink = _Chunks()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, strict_timestamps=False) as zf:
        for path, name in files:
            zf.write(path, name)
            if len(sink.buffer) >= CHUNK:
                yield sink.take()
    yield sink.take()


# ── import ───────────────────────────────────────────────────────────────────


def _safe_name(name: str) -> PurePosixPath | None:
    """An archive entry's relative path, or None if it would leave the folder."""
    path = PurePosixPath(name.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts:
        return None
    return path


def is_zip(path: Path) -> bool:
    return zipfile.is_zipfile(path)


def restore(upload: Path, data_dir: Path, selection: Selection) -> dict:
    """Copy the selected entries not on disk yet into `data_dir`."""
    copied = skipped = 0
    with zipfile.ZipFile(upload) as zf:
        entries = [e for e in zf.infolist() if not e.is_dir()]
        jobs.set_progress(jobs.IMPORT_IMAGES, 0, len(entries))
        for index, entry in enumerate(entries, 1):
            relative = _safe_name(entry.filename)
            if relative is not None and selection.selects(relative):
                dest = data_dir / relative
                if dest.exists():
                    skipped += 1
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    partial = dest.with_name(dest.name + ".part")
                    with zf.open(entry) as src, partial.open("wb") as out:
                        shutil.copyfileobj(src, out, CHUNK)
                    partial.replace(dest)
                    copied += 1
            jobs.set_progress(jobs.IMPORT_IMAGES, index, len(entries))
    return {"copied": copied, "skipped": skipped}


def run_import(upload: Path, data_dir: Path, selection: Selection) -> None:
    """The background part of the images import (the upload is step 1)."""
    key = jobs.IMPORT_IMAGES
    try:
        jobs.set_step(key, "restore", IMPORT_LABELS["restore"], 2)
        result = restore(upload, data_dir, selection)
        jobs.set_step(key, "link", IMPORT_LABELS["link"], 3)
        with database.SessionLocal() as db:
            result["linked"] = scans.link_existing_files(
                db, data_dir, lambda done, total: jobs.set_progress(key, done, total)
            )
        jobs.finish(key, **result)
    except Exception:
        logger.exception("Images import failed")
        jobs.fail(key, "Images import failed, check the server logs")
    finally:
        upload.unlink(missing_ok=True)
