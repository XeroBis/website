import logging

from fastapi import FastAPI

from core.config import settings
from domains.health import router as health

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

app.include_router(health.router)
