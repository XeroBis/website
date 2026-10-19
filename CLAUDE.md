# alanbignon.com monorepo

One FastAPI backend, one Angular 22 workspace (one app per site), one Postgres database (one schema per app) and one edge nginx, serving `alanbignon.com` (portfolio), `workout.`, `cards.`, `media.` and `auth.alanbignon.com`.

Start with `documentation/architecture.md`.

## Documentation Rule

**`documentation/` is the source of truth. Keep it in sync with every change, in the same step as the code change, never as a follow-up.**

| What changed | Doc file to update |
|---|---|
| Folder structure, environments, ports, request flow | `architecture.md` |
| DB schemas, tables, columns, relationships, business rules | `data-model.md` (section of that schema) |
| Tech stack, library or architecture choice | `decisions.md` (dated entry at the bottom: what, over what, why) |
| User-facing behaviour, validation rules | `features.md` (section of that app) |
| Deferred / undecided / ruled-out possibilities | `ideas.md` |
| Prod runbook (cert, `.env`, bring-up) | `deployment.md` |

This table is the only copy of the routing; `documentation/README.md` and the `plan-and-document` skill point here.

For any change in how something works, is built or is structured, use the `plan-and-document` skill: ask first, then document.

## Commits

Conventional commits, scoped by app: `feat(cards): …`, `fix(workout): …`, `style(media): …`. Scopes are the app names plus `infra` and `backend`; no scope for a change spanning several apps.

## Python Tooling Rule

**Always use `uv` inside `backend/`** (`uv run`, `uv add`, `uv sync`), never `pip`/`python` directly.

- Tests / lint: `make b-test`, `make lint` (tests need the dev `db` up, on `localhost:5440`: `docker compose up -d db`)
- New migration: `cd backend && uv run alembic revision --autogenerate -m "..."` (dev `db` up). Every model must set `__table_args__ = {"schema": ...}` and be imported in `alembic/env.py`.

The app itself runs in Docker (`make up`). The backend container runs `alembic upgrade head` and then `uvicorn --reload` on every start.

## Frontend Rule

- The host's Node is too old for Angular CLI 22. Run `ng`/`npm` inside the container: `docker compose exec frontend npx ng …`. `make f-test` runs every project's tests in a throwaway container, so they don't compete for RAM with the dev servers.
- To check a change, read the dev server logs (`docker compose logs -f frontend`); each `ng serve` rebuilds on save. A separate local build is unnecessary.
- Code used by more than one app goes in `projects/shared` and is exported from its `public-api.ts`. Apps import it as `@shared`, never from another app's folder.
- All API calls use relative `/api/<domain>/...` URLs (same-origin in dev and prod).

## No `run` Skill

**Never invoke the `run` skill in this project.** To verify a change, use the test suites, the container logs, or ask the user how they'd like it checked.
