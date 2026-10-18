"""Shared httpx2 client for the refresh downloads (pokecardex CDN, TCGdex).

Tests replace `transport` with an `httpx2.MockTransport`, so no test ever
reaches the network.
"""

import logging
from pathlib import Path

import httpx2

logger = logging.getLogger(__name__)

USER_AGENT = "alanbignon-cards/1.0 (cards.alanbignon.com)"
TIMEOUT = httpx2.Timeout(30.0)

transport: httpx2.BaseTransport | None = None


def client(**kwargs) -> httpx2.Client:
    return httpx2.Client(
        transport=transport,
        timeout=kwargs.pop("timeout", TIMEOUT),
        headers={"User-Agent": USER_AGENT},
        **kwargs,
    )


def download(http: httpx2.Client, url: str, dest: Path) -> bool:
    """Save `url` to `dest` (folders created); False on any failure."""
    try:
        response = http.get(url)
        response.raise_for_status()
    except httpx2.HTTPError as exc:
        logger.warning("Download failed for %s: %s", url, exc)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(response.content)
    return True
