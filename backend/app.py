import logging

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core.config import settings
from core.rate_limit import limiter
from domains.auth import router as auth
from domains.health import router as health
from domains.media import router as media
from domains.portfolio import router as portfolio
from domains.workout import router as workout

logging.basicConfig(
    level=settings.log_level, format="%(asctime)s - %(levelname)s - %(message)s"
)

# Schema is managed by Alembic migrations (run via `alembic upgrade head`
# before the app starts, see Dockerfile / docker-compose.prod.yml) rather
# than created here.
#
# No CORS middleware: every host serves its frontend and proxies `/api` to
# this backend, so browsers only ever make same-origin calls (see
# documentation/decisions.md "API exposed as /api on every host").

app = FastAPI(title="alanbignon.com")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(portfolio.router)
app.include_router(media.router)
app.include_router(workout.router)
