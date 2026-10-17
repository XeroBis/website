"""Shared httpx2 client for the metadata sources.

Tests replace `transport` with an `httpx2.MockTransport`, so no test ever
reaches TMDB or Open Library.
"""

import httpx2

USER_AGENT = "alanbignon-media/1.0 (media.alanbignon.com)"
TIMEOUT = httpx2.Timeout(10.0)

transport: httpx2.BaseTransport | None = None


class SourceError(Exception):
    """The external source failed or is not configured."""


def client(**kwargs) -> httpx2.Client:
    headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
    return httpx2.Client(
        transport=transport,
        timeout=TIMEOUT,
        follow_redirects=True,
        headers=headers,
        **kwargs,
    )
