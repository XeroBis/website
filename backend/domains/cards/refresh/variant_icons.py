"""Refresh step `download_variant_icons`: pokecardex's own print badges, into
`variant-icons/` under CARDS_DATA_DIR, served publicly by
`/api/cards/public/variant-icons/{file}`."""

import logging
from functools import cache
from pathlib import Path

from domains.cards.refresh import http, source

logger = logging.getLogger(__name__)

BASE_URL = "https://pokecardex.b-cdn.net/assets/images/"
FOLDER = "variant-icons"


@cache
def sources() -> dict[str, str]:
    """Every known badge file name -> its CDN URL (standard and reverse are
    SVGs, the other prints PNGs named after their pokecardex version id)."""
    files = {
        "standard.svg": f"{BASE_URL}card_normale.svg",
        "reverse.svg": f"{BASE_URL}card_reverse.svg",
    }
    for version_id, variant in source.VERSION_ID_TO_VARIANT.items():
        if variant != "reverse":
            files[f"{variant}.png"] = f"{BASE_URL}versions/version_{version_id}.png"
    return files


def download_variant_icons(data_dir: Path, root: Path | None = None) -> dict:
    """Downloads the badges missing on disk whose URL appears in the saved
    HTML; badges gone from the source are skipped, CDN failures reported and
    retried next run."""
    wanted = {
        filename: url
        for filename, url in sources().items()
        if not (data_dir / FOLDER / filename).is_file()
    }
    seen: set[str] = set()
    for path in (root or source.source_root()).rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        seen.update(f for f, url in wanted.items() if f not in seen and url in text)
    downloaded = 0
    failures = []
    with http.client(follow_redirects=True) as client:
        for filename, url in wanted.items():
            dest = data_dir / FOLDER / filename
            if filename not in seen:
                continue
            if http.download(client, url, dest):
                downloaded += 1
            else:
                failures.append(filename)
    if failures:
        logger.warning("Variant badges unavailable (retried next run): %s", failures)
    return {
        "variant_icons_downloaded": downloaded,
        "variant_icons_unavailable": failures,
    }


def fallback_svg(filename: str) -> str:
    """A neutral badge with the version id while the original is missing."""
    variant = filename.rsplit(".", 1)[0]
    label = next(
        (str(k) for k, v in source.VERSION_ID_TO_VARIANT.items() if v == variant),
        "S",
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        "<title>Variant symbol unavailable</title>"
        '<rect x="8" y="4" width="84" height="92" rx="12" '
        'fill="#64748b" stroke="#242424" stroke-width="4"/>'
        '<text x="50" y="60" text-anchor="middle" font-family="sans-serif" '
        f'font-size="30" fill="white">{label}</text></svg>'
    )
