"""Refresh step `scrape_images`: download every missing scan (standard and
other prints, EN and FR) from the URLs the HTML import recorded, into
`<series>/<set_code>/cards/` under CARDS_DATA_DIR. Also the deterministic
file names, which the images import uses to link restored files."""

import logging
import time
from collections.abc import Callable, Iterator
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from itertools import groupby
from pathlib import Path

import httpx2
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from domains.cards import models as m
from domains.cards.names import slugify
from domains.cards.refresh import http, source

logger = logging.getLogger(__name__)

CONCURRENCY = 8
# Per worker, after each request: be a reasonable citizen towards the CDN.
REQUEST_DELAY = 0.1
TIMEOUT = 10.0

Progress = Callable[[int, int], None]


def image_path_for(
    row: m.CardCatalog, source_url: str | None, variant_type: str, language: str
) -> str:
    """The scan's path relative to CARDS_DATA_DIR. World Championships keep
    the CDN slot in front of the number (their numbers used to repeat)."""
    slot = ""
    if row.series == source.WORLD_CHAMPIONSHIPS_SERIES:
        slot = f"{source.scan_slot(source_url, row.card_number)}_"
    stem = f"{slot}{row.card_number}_{slugify(row.name)}_{variant_type}"
    return f"{row.series}/{row.set_code}/cards/{stem}_{language.upper()}.jpg"


def is_pending(path: str | None) -> bool:
    return bool(path) and path.startswith(source.PENDING_PREFIX)


def standard_urls(row: m.CardCatalog) -> tuple[str | None, str | None]:
    standard = next((v for v in row.variants if v.variant_type == "standard"), None)
    if standard is None:
        return row.source_url, None
    return standard.source_url_en, standard.source_url_fr


def use_energies_french_fallback(row: m.CardCatalog) -> bool:
    """A few `Energies` cards have no English scan: use the French one, so the
    card can be shown and exported."""
    if (
        row.series == source.ENERGIES_SERIES
        and is_pending(row.image_path)
        and row.image_path_fr
    ):
        row.image_path = row.image_path_fr
        return True
    return False


@dataclass
class _Download:
    url: str
    path: str
    row: m.CardCatalog
    target: object  # the row or variant whose `field` gets `path`
    field: str

    @property
    def is_standard(self) -> bool:
        return self.target is self.row


def _missing(row: m.CardCatalog) -> Iterator[_Download]:
    """Every scan of the card still to download."""
    if is_pending(row.image_path):
        url_en, url_fr = standard_urls(row)
        for url, language, field in (
            (url_en, "en", "image_path"),
            (url_fr, "fr", "image_path_fr"),
        ):
            if url:
                yield _Download(
                    url, image_path_for(row, url, "standard", language), row, row, field
                )
    for variant in row.variants:
        if (
            variant.variant_type == "standard"
            or variant.image_path_us
            or variant.image_path_fr
        ):
            continue
        for url, language, field in (
            (variant.source_url_en, "en", "image_path_us"),
            (variant.source_url_fr, "fr", "image_path_fr"),
        ):
            if url:
                yield _Download(
                    url,
                    image_path_for(row, url, variant.variant_type, language),
                    row,
                    variant,
                    field,
                )


def _fetch(client: httpx2.Client, url: str) -> bytes | None:
    try:
        response = client.get(url)
    except httpx2.HTTPError:
        logger.debug("Scan download failed: %s", url)
        return None
    finally:
        time.sleep(REQUEST_DELAY)
    return response.content if response.status_code == 200 else None


def _fetch_all(client: httpx2.Client, downloads: list[_Download]):
    """(download, bytes | None) as they complete, CONCURRENCY in flight."""
    queue = iter(downloads)
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        pending: dict[Future, _Download] = {}

        def submit() -> None:
            if (download := next(queue, None)) is not None:
                pending[pool.submit(_fetch, client, download.url)] = download

        for _ in range(CONCURRENCY):
            submit()
        while pending:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                yield pending.pop(future), future.result()
                submit()


def scrape_images(
    db: Session,
    data_dir: Path,
    on_standard_saved: Callable[[Path], None] | None = None,
    on_progress: Progress | None = None,
) -> dict:
    """Downloads the missing scans of every set in the source, committing set
    by set. Progress counts scan URLs tried; the result counts cards that got
    at least one scan."""
    set_codes = [code for _, code, _ in source.iter_sets()]
    rows = db.scalars(
        select(m.CardCatalog)
        .where(m.CardCatalog.set_code.in_(set_codes))
        .options(selectinload(m.CardCatalog.variants))
        .order_by(m.CardCatalog.set_code, m.CardCatalog.id)
    ).all()
    by_set = {code: list(group) for code, group in groupby(rows, lambda r: r.set_code)}
    # End the read transaction: downloading a set takes minutes and must not
    # hold a pooled connection. The rows stay loaded and tracked, and each
    # set's commit below flushes its changes in a short transaction.
    db.expire_on_commit = False
    db.commit()
    work = {
        code: [d for row in group for d in _missing(row)]
        for code, group in by_set.items()
    }
    total = sum(len(downloads) for downloads in work.values())
    done = 0
    if on_progress:
        on_progress(done, total)

    downloaded: set[int] = set()
    with http.client(timeout=TIMEOUT) as client:
        for set_code in set_codes:
            downloads = work.get(set_code)
            if downloads:
                logger.info(
                    "scrape_images: %s: %d scan(s) to download",
                    set_code,
                    len(downloads),
                )
                for download, content in _fetch_all(client, downloads):
                    done += 1
                    if on_progress:
                        on_progress(done, total)
                    if content is None:
                        continue
                    path = data_dir / download.path
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                    setattr(download.target, download.field, download.path)
                    downloaded.add(download.row.id)
                    if download.is_standard and on_standard_saved:
                        on_standard_saved(path)
            for row in by_set.get(set_code, ()):
                use_energies_french_fallback(row)
            db.commit()

    logger.info("scrape_images: scans saved for %d card(s)", len(downloaded))
    return {"images_downloaded": len(downloaded)}


def link_existing_files(
    db: Session, data_dir: Path, on_progress: Progress | None = None
) -> int:
    """Fill pending or missing scan paths whose file is already on disk (after
    an images import), with the names scrape_images would have used. Paths
    already set are never changed. Returns how many paths were filled."""
    rows = db.scalars(
        select(m.CardCatalog).options(selectinload(m.CardCatalog.variants))
    ).all()
    total = len(rows)
    if on_progress:
        on_progress(0, total)

    def existing(path: str) -> str | None:
        return path if (data_dir / path).is_file() else None

    linked = 0
    for index, row in enumerate(rows, 1):
        url_en, url_fr = standard_urls(row)
        if is_pending(row.image_path) and url_en:
            if found := existing(image_path_for(row, url_en, "standard", "en")):
                row.image_path = found
                linked += 1
        if row.image_path_fr is None and url_fr:
            if found := existing(image_path_for(row, url_fr, "standard", "fr")):
                row.image_path_fr = found
                linked += 1
        if use_energies_french_fallback(row):
            linked += 1
        for variant in row.variants:
            if variant.variant_type == "standard":
                continue
            for url, language, field in (
                (variant.source_url_en, "en", "image_path_us"),
                (variant.source_url_fr, "fr", "image_path_fr"),
            ):
                if url and getattr(variant, field) is None:
                    path = image_path_for(row, url, variant.variant_type, language)
                    if found := existing(path):
                        setattr(variant, field, found)
                        linked += 1
        if on_progress:
            on_progress(index, total)
    db.commit()
    logger.info("Images import: %d catalog scan path(s) linked", linked)
    return linked
