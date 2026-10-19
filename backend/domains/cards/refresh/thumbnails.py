"""Refresh step `generate_thumbnails`: a 300px JPEG of each standard scan, at
the same name in the set's `thumbnails/` folder (no column: the path is the
scan's with `/thumbnails/` instead of `/cards/`). Other prints have none."""

import logging
from collections.abc import Callable
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from domains.cards import models as m
from domains.cards.refresh.scans import is_pending

logger = logging.getLogger(__name__)

WIDTH = 300
QUALITY = 75


def thumbnail_for(scan: Path) -> Path:
    return scan.parent.parent / "thumbnails" / scan.name


def make_thumbnail(scan: Path) -> bool:
    """Create the scan's thumbnail if missing; True when one was written."""
    dest = thumbnail_for(scan)
    if dest.exists():
        return False
    try:
        with Image.open(scan) as img:
            img = img.convert("RGB")
            height = max(1, round(img.height * WIDTH / img.width))
            dest.parent.mkdir(parents=True, exist_ok=True)
            img.resize((WIDTH, height), Image.Resampling.LANCZOS).save(
                dest, "JPEG", quality=QUALITY
            )
        return True
    except Exception:
        logger.exception("Thumbnail failed for %s", scan)
        return False


def generate_thumbnails(
    db: Session, data_dir: Path, on_progress: Callable[[int, int], None] | None = None
) -> dict:
    """Thumbnails for every downloaded standard scan (EN and FR) lacking one."""
    paths = sorted(
        {
            path
            for pair in db.execute(
                select(m.CardCatalog.image_path, m.CardCatalog.image_path_fr)
            )
            for path in pair
            if path and not is_pending(path)
        }
    )
    # Resizing takes minutes; no pooled connection is held meanwhile.
    db.close()
    generated = 0
    for index, path in enumerate(paths, 1):
        scan = data_dir / path
        if scan.is_file() and make_thumbnail(scan):
            generated += 1
        if on_progress:
            on_progress(index, len(paths))
    logger.info("generate_thumbnails: %d of %d scan(s)", generated, len(paths))
    return {"thumbnails_generated": generated}
