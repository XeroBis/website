"""Re-fetch every TMDB / Open Library catalog row: `make media-refresh`
(`make prod-media-refresh` on the VPS).

Fills fields added after an item was stored and picks up corrected source
data. Manual items and covers are left alone; a source error skips that row.
"""

import logging

from sqlalchemy import select

from core import models as core_models  # noqa: F401  (registers core.users for the FKs)
from core.database import SessionLocal
from domains.media import catalog, sources
from domains.media.models import MediaItem, MediaSource

logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    # Items stay loaded across commits, so no transaction (and no pooled
    # connection) stays open while a source answers.
    with SessionLocal(expire_on_commit=False) as db:
        items = db.scalars(
            select(MediaItem)
            .where(MediaItem.source != MediaSource.manual)
            .order_by(MediaItem.id)
        ).all()
        db.commit()
        refreshed = 0
        for item in items:
            try:
                details = sources.details(item.source, item.type, item.external_id)
            except sources.SourceError as exc:
                logger.warning("Skipped #%d %s: %s", item.id, item.title, exc)
                continue
            catalog.apply_details(item, details)
            db.commit()
            refreshed += 1
            logger.info("#%d %s / %s", item.id, item.title, item.title_fr)
        logger.info("Refreshed %d of %d items", refreshed, len(items))


if __name__ == "__main__":
    main()
