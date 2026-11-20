"""Covers a user sets on an entry: an uploaded file or an image URL.

They replace the shared catalog cover (`media.covers`), for every user who has
the item. Only raster formats are accepted: an SVG served from our origin could
run script.
"""

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx2

from domains.media.sources import MAX_COVER_BYTES, http

ALLOWED_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
)
MAX_REDIRECTS = 3


class CoverError(Exception):
    """The image is unusable; the message is shown to the user."""


def check(content_type: str | None, data: bytes) -> tuple[str, bytes]:
    """(content_type, data) when it's a storable cover, else CoverError."""
    content_type = (content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise CoverError("The cover must be a JPEG, PNG, WebP, GIF or AVIF image")
    if not data:
        raise CoverError("The image is empty")
    if len(data) > MAX_COVER_BYTES:
        raise CoverError("The image is larger than 2 MB")
    return content_type, data


def resolve(host: str) -> list[str]:
    """The host's IP addresses (tests replace this)."""
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


def _check_url(url: str) -> None:
    """Public http(s) hosts only, so a URL can't reach the server's network."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise CoverError("The URL must start with http:// or https://")
    try:
        addresses = resolve(parts.hostname)
    except OSError as exc:
        raise CoverError("That address can't be reached") from exc
    if not addresses or not all(
        ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses
    ):
        raise CoverError("That address can't be reached")


def download(url: str) -> tuple[str, bytes]:
    """Fetches the image, checking every redirect hop against `_check_url`."""
    with http.client(follow_redirects=False) as c:
        for _ in range(MAX_REDIRECTS + 1):
            _check_url(url)
            try:
                with c.stream("GET", url) as r:
                    if r.is_redirect and "location" in r.headers:
                        url = urljoin(url, r.headers["location"])
                        continue
                    if r.status_code != 200:
                        raise CoverError("The image couldn't be downloaded")
                    return check(r.headers.get("content-type"), _read_capped(r))
            except httpx2.HTTPError as exc:
                raise CoverError("The image couldn't be downloaded") from exc
    raise CoverError("Too many redirects")


def _read_capped(r: httpx2.Response) -> bytes:
    """The body, stopping one byte past the limit so `check` refuses it."""
    data = bytearray()
    for chunk in r.iter_bytes():
        data += chunk
        if len(data) > MAX_COVER_BYTES:
            break
    return bytes(data)
