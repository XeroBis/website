# Architecture

One repo, one backend, one frontend workspace, one database, one edge proxy,
serving five sites:

| Host | App (`frontend/projects/<app>`) | Backend domain (`backend/domains/<app>`) | DB schema |
|---|---|---|---|
| `alanbignon.com` | `portfolio` | `portfolio` | `portfolio` |
| `workout.alanbignon.com` | `workout` | `workout` | `workout` |
| `cards.alanbignon.com` | `cards` | `cards` | `cards` |
| `media.alanbignon.com` | `media` | `media` | `media` |
| `auth.alanbignon.com` | `auth` | `auth` | `core` (shared users/sessions) |

`www.alanbignon.com`, `alanbignon.fr` and `www.alanbignon.fr` 301 to `alanbignon.com`.

## Folder structure

```
website/
├── backend/                    # FastAPI, Python 3.14, uv
│   ├── app.py                  # the FastAPI app; includes every domain's router
│   ├── core/                   # config (env), database (engine, Base, SCHEMAS)
│   ├── domains/<name>/         # one package per app (+ health): router.py, models.py, schemas.py, service code
│   ├── alembic/                # ONE migration history for every schema
│   └── tests/
├── frontend/                   # Angular 22 CLI workspace (no Nx)
│   ├── angular.json            # declares the projects below
│   ├── proxy.conf.mjs          # dev: /api → backend
│   ├── serve-all.sh            # dev: one `ng serve` per app, in parallel
│   └── projects/
│       ├── shared/             # library, imported as `@shared` (from source, never built on its own)
│       └── portfolio/ workout/ cards/ media/ auth/   # one application per site
├── infra/
│   ├── nginx/                  # the edge: nginx.conf, snippets/, Dockerfile (builds the frontend into the image)
│   ├── ssl/alanbignon.com/     # prod cert (gitignored *.pem)
│   └── certbot-webroot/        # ACME HTTP-01 webroot
├── docker-compose.yml          # dev
├── docker-compose.prod.yml     # prod
├── Makefile
└── documentation/
```

### Backend conventions

- Every route is under `/api/<domain>/...` (`/api/health`, later `/api/auth`, `/api/cards`, …), so any host can proxy `/api` to the same backend without collisions.
- Every model sets `__table_args__ = {"schema": "<schema>"}` with one of `core.database.SCHEMAS`. A domain may reference `core` tables (e.g. `core.users`) but never another app's schema.
- New domains register their models in `alembic/env.py` (import) and their router in `app.py`.

### Frontend: projects, library, bundles

- Each application has its own `main.ts`, `index.html`, routes, `public/` assets and (later) PWA manifest / service worker, and builds to `frontend/dist/<app>/browser/`.
- `shared` holds what more than one app needs (HTTP services, auth, i18n, layout pieces). Apps import it as `@shared`, which `tsconfig.json` maps to `projects/shared/src/public-api.ts`: the library's source is compiled into each app's bundle at build time, and tree-shaking keeps only the parts that app uses. Nothing is shared at runtime.
- One `package.json`, so the Angular version is the same for every app.

## Request flow

**Prod.** Browser → `edge` (nginx, 443) → by `Host`:
- `/api/...` → `backend:8000`, URI unchanged. Same-origin on every host; the backend checks the session cookie itself (no `auth_request`, no `X-User-*` headers).
- anything else → static files from `/usr/share/nginx/html/<app>`, with unknown paths falling back to `index.html` (Angular routing). Hashed assets are cached for a year, `index.html` is `no-cache`.

**Dev.** Browser → `ng serve` for that app (`localhost:460x`) → its dev-server proxy sends `/api` to the backend (`API_TARGET`, `http://backend:8000` inside compose). Same-origin as in prod. Cookies aren't scoped by port, so a session cookie set on `localhost:4604` (auth) is also sent to `localhost:4602` (cards).

## Environments

| | Dev (`docker-compose.yml`) | Prod (`docker-compose.prod.yml`) |
|---|---|---|
| `db` | Postgres 18, password `website`, published on 5440 | Postgres 18, `POSTGRES_PASSWORD` from `.env`, not published |
| `backend` | `./backend` bind-mounted, `uvicorn --reload`, published on 8400 | baked image, no reload, not published |
| frontend | `frontend` container: one `ng serve` per app (4600–4604), `./frontend` bind-mounted, `--poll 2000` | built into the `edge` image |
| proxy | none (dev servers proxy `/api`) | `edge`: only container publishing 80/443 |

Both stacks run `alembic upgrade head` before starting uvicorn, so migrations apply on every start.

### Local dev ports

Offset from the old per-app repos (5432–5435 / 8000–8300 / 4200–4500) so both can run during the migration.

| Service | Host port |
|---|---|
| Postgres | 5440 (tests use DB `website_test` on the same server) |
| Backend | 8400 |
| portfolio / workout / cards / media / auth | 4600 / 4601 / 4602 / 4603 / 4604 |

Each `ng serve` takes about 1 GB of RAM. `make up APPS="cards auth"` starts only those.
