"""Refresh step `scrape_logos_symbols`: each set's EN/FR logo and symbol from
the URLs in its header HTML, as `<series>/<set_code>/<set_code>_logo_EN.png`,
`_logo_FR.png` and `_symbol.png` (display.set_asset_paths)."""

import logging
from pathlib import Path

from domains.cards.refresh import http, source

logger = logging.getLogger(__name__)


def scrape_logos_symbols(data_dir: Path) -> dict:
    """Downloads the files not on disk yet; returns how many sets got one."""
    updated = 0
    with http.client(follow_redirects=True) as client:
        for series, set_code, set_dir in source.iter_sets():
            try:
                header = source.parse_set_header(set_dir, set_code)
            except FileNotFoundError:
                continue
            folder = data_dir / series / set_code
            changed = False
            for url, name in (
                (header.logo_url_en, f"{set_code}_logo_EN.png"),
                (header.logo_url_fr, f"{set_code}_logo_FR.png"),
                (header.symbol_url, f"{set_code}_symbol.png"),
            ):
                if url and not (folder / name).exists():
                    changed = http.download(client, url, folder / name) or changed
            updated += changed
    logger.info("scrape_logos_symbols: new file(s) for %d set(s)", updated)
    return {"set_logos_updated": updated}
