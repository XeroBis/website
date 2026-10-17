FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Keep the venv outside /app: docker-compose bind-mounts ./backend over /app in
# dev, and `uv sync` there would otherwise create/overwrite .venv on the host.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

EXPOSE 8000

# Dev default (live reload). docker-compose.prod.yml overrides `command`
# without --reload.
CMD ["/bin/sh", "-c", "/opt/venv/bin/alembic upgrade head && /opt/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000 --reload"]
