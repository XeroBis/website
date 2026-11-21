"""Downloaded card files (scans, thumbnails, set logos/symbols) from
CARDS_DATA_DIR, for cards users only. Public share pages have their own
token-scoped routes."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from core.models import User
from domains.cards.access import cards_user, not_found

router = APIRouter(tags=["cards"])

# Files never change in place (a new download gets the same path only when
# the old one was missing), so browsers may keep them.
CACHE_CONTROL = "private, max-age=31536000, immutable"


def data_file(relative_path: str) -> Path:
    """`relative_path` inside CARDS_DATA_DIR, else 404 (missing file, or a
    path escaping the folder)."""
    root = Path(settings.cards_data_dir).resolve()
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise not_found("Image")
    return path


def image_file(relative_path: str, cache_control: str) -> FileResponse:
    """The file, with `cache_control`. A thumbnail not made yet (the step runs
    after downloads) falls back to its full scan, uncached so the browser
    picks up the thumbnail once it exists."""
    try:
        path = data_file(relative_path)
    except HTTPException:
        if "/thumbnails/" not in relative_path:
            raise
        scan = relative_path.replace("/thumbnails/", "/cards/", 1)
        return FileResponse(data_file(scan), headers={"Cache-Control": "no-cache"})
    return FileResponse(path, headers={"Cache-Control": cache_control})


@router.get("/images/{relative_path:path}")
def get_image(
    relative_path: str, _: User = Depends(cards_user), db: Session = Depends(get_db)
):
    # The session checking the user (the same one, dependencies are cached)
    # would otherwise keep its pooled connection while the file streams.
    db.close()
    return image_file(relative_path, CACHE_CONTROL)
