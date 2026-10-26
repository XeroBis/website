FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /usr/local/bin/

# Keep the venv outside /app: docker-compose bind-mounts ./backend over /app in
# dev, and `uv sync` there would otherwise create/overwrite .venv on the host.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

# Run unprivileged. uid 1000 matches the usual host user, so files the dev
# container writes into the ./backend bind mount stay the host user's. The
# code and venv stay root-owned (read-only to the app); only CARDS_DATA_DIR is
# writable, and a fresh cards_data volume takes this folder's owner.
RUN useradd --uid 1000 --user-group --no-create-home app \
    && mkdir -p /data/cards \
    && chown app:app /data/cards
USER app

EXPOSE 8000

# Dev default (live reload). docker-compose.prod.yml overrides `command`
# without --reload.
CMD ["/bin/sh", "-c", "/opt/venv/bin/alembic upgrade head && /opt/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000 --reload"]
