"""Shared slowapi limiter, keyed by client IP.

In-memory, so limits are per backend process (prod runs one uvicorn worker).
Behind the edge nginx, uvicorn's --proxy-headers makes `request.client` the
real client rather than nginx. Usage: `@limiter.limit("10/minute")` on a route
that takes a `request: Request` parameter.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
