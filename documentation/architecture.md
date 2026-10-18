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
│   ├── core/                   # what every domain uses:
│   │   ├── config.py           #   env settings (DB URL, log level, TMDB token)
│   │   ├── database.py         #   engine, Base, SCHEMAS, get_db
│   │   ├── models.py           #   `core` tables: User, RevokedToken
│   │   ├── security.py         #   AuthSettings (secrets, cookies), passwords, JWTs, session cookies
│   │   ├── deps.py             #   get_current_user / get_optional_user / require_admin / require_app
│   │   └── rate_limit.py       #   shared slowapi limiter
│   ├── domains/<name>/         # one package per app (+ health): router.py, models.py, schemas.py, service code
│   │   ├── auth/               #   /api/auth routes, schemas, seed.py (`make seed-user`, `seed-basic-user`)
│   │   ├── portfolio/          #   /api/portfolio routes, `portfolio` schema models
│   │   ├── media/              #   /api/media routes, `media` schema models, rules.py (status transitions),
│   │   │                       #   catalog.py, sources/ (TMDB + Open Library via httpx2), refresh.py (`make media-refresh`)
│   │   ├── cards/              #   /api/cards (being ported, migration-plan step 6): `cards` schema models,
│   │   │                       #   variant_order.py (print variants + display order), access.py, names.py (name
│   │   │                       #   normalization), display.py (FR/EN display fields), search.py (name match + sorts),
│   │   │                       #   routers/ (catalog, catalog_admin, images, collection, decks, …),
│   │   │                       #   refresh/ (catalog jobs: source.py parses the saved HTML, html_import, scans,
│   │   │                       #   thumbnails, set_assets, variant_icons, card_details via http.py (httpx2), jobs.py
│   │   │                       #   = in-memory job state + runner, archive.py = images zip, metadata.py = catalog file),
│   │   │                       #   source/ (saved pokecardex HTML, CARDS_SOURCE_DIR)
│   │   └── workout/            #   /api/workout routes (routers/: catalog, workouts, templates, circuits, session,
│   │                           #   stats, transfer = import/export, admin), `workout` schema models, muscles.py,
│   │                           #   entries.py (shared build/serialize of workout/template/circuit entries), stats.py, transfer.py
│   ├── alembic/                # ONE migration history for every schema
│   └── tests/
├── frontend/                   # Angular 22 CLI workspace (no Nx)
│   ├── angular.json            # declares the projects below
│   ├── proxy.conf.mjs          # dev: /api → backend
│   ├── serve-all.sh            # dev: one `ng serve` per app, in parallel
│   └── projects/
│       ├── shared/             # library, imported as `@shared` (from source, never built on its own):
│       │                       #   auth (AuthService, guards, interceptor), i18n, environment, http (httpStatus),
│       │                       #   layout (`ab-header`), icon (`ab-icon`), placeholder;
│       │                       #   public/ngsw-worker.js: safety worker copied into cards' and workout's builds
│       └── portfolio/ workout/ cards/ media/ auth/   # one application per site
├── infra/
│   ├── nginx/                  # the edge: nginx.conf, snippets/, Dockerfile (builds the frontend into the image)
│   ├── ssl/alanbignon.com/     # prod cert (gitignored *.pem)
│   ├── certbot-webroot/        # ACME HTTP-01 webroot
│   ├── certbot/deploy-hook.sh  # prod: copies a renewed cert into ssl/, reloads the edge
│   └── backups/                # prod: backup.sh (weekly pg_dump + email), restore.sh (whole DB or one schema),
│                               #   msmtprc.template, dumps/ (gitignored)
├── .github/workflows/ci.yml    # lint + backend + frontend tests; on main, then SSH deploy
├── docker-compose.yml          # dev
├── docker-compose.prod.yml     # prod
├── Makefile
└── documentation/
```

### Backend conventions

- Every route is under `/api/<domain>/...` (`/api/health`, later `/api/auth`, `/api/cards`, …), so any host can proxy `/api` to the same backend without collisions.
- Every model sets `__table_args__ = {"schema": "<schema>"}` with one of `core.database.SCHEMAS`. A domain may reference `core` tables (e.g. `core.users`) but never another app's schema.
- `core` tables' models live in `core/models.py`, not in `domains/auth`, because `core/deps.py` needs `User` and `core` never imports from `domains`.
- Protected routes take `Depends(get_current_user)` (or `get_optional_user` for public routes that change with the viewer, `require_admin` for admin-only ones, `require_app("<app>")` for an app's users) from `core/deps.py`. They return the `core.users` row, and also enforce CSRF on unsafe methods.
- New domains register their models in `alembic/env.py` (import) and their router in `app.py`.

### Frontend: projects, library, bundles

- Each application has its own `main.ts`, `index.html`, routes, `public/` assets (and optionally a web manifest), and builds to `frontend/dist/<app>/browser/`.
- **Browser icons** (`public/`): every app has a `favicon.ico` and a 180px `apple-touch-icon.png`; each also has a `favicon.svg`, which browsers that support it use instead. Cards keeps the old repo's Poké Ball. Portfolio, workout, media and auth have new ones matching their look: workout a white dumbbell on its rose-brown, portfolio a lime `>_` prompt on its near-black, auth a 2×2 apps grid (it's the hub for every app; yellow/white squares with hard black shadows) on its cobalt, media three spines on a shelf (book oxblood, film teal, series ochre) on its cream paper. Their `.ico`/`.png` are rasterized from the same shapes as the SVG. Workout also has a web manifest (`manifest.webmanifest` + `icons/`, rasterized from the same dumbbell, plus a maskable one with the dumbbell shrunk into the safe zone) so it can be installed to a phone's home screen. Cards likewise keeps the Poké Ball manifest, regular/maskable icons and a 180px Apple touch icon. No app has a real service worker. Cards and workout serve `/ngsw-worker.js` only as a safety worker that removes their old repos' Angular service worker (`projects/shared/public/ngsw-worker.js`, added to their `assets` in `angular.json`; see decisions.md "Safety worker"). Workout's body-map SVGs (`front.svg`, `back.svg`) are fetched at runtime from its `public/`.
- `shared` holds what more than one app needs (HTTP services, auth, i18n, layout pieces). Apps import it as `@shared`, which `tsconfig.json` maps to `projects/shared/src/public-api.ts`: the library's source is compiled into each app's bundle at build time, and tree-shaking keeps only the parts that app uses. Nothing is shared at runtime.
- One `package.json`, so the Angular version is the same for every app.
- **Environment**: `projects/shared/src/lib/environment/environment.ts` is the prod build's (`production: true`, the `https://*.alanbignon.com` app URLs). Each app's `development` build configuration (`ng serve`) swaps in `environment.development.ts` (the `http://localhost:460x` URLs) through `fileReplacements` in `angular.json`. Code reads it through the `ENVIRONMENT` injection token, which tests override.
- **Auth wiring**: every app registers `provideHttpClient(withInterceptors([authInterceptor]))`. Apps with translated UI add `provideI18n({ en, fr })` with their own `src/i18n/*.json` (`auth`, `portfolio`, `media`, `workout` and `cards`). `provideI18n` merges in the `SHARED` strings used by `@shared` components (`lib/i18n/shared-translations.ts`), so an app's JSON only holds its own keys.
- **Icons**: `ab-icon` (`@shared`) draws inline-SVG icons (Lucide paths, ISC license) at 1em in `currentColor`, by name. No icon font or package.
- **Layout**: `ab-header` (`@shared`) is the top bar: app title linking to `/`, the app's own links as projected content, FR/EN switch, theme button, pseudo + an apps-grid icon linking to the auth app's account page (as on the old workout navbar) (no logout button: logging out happens there) or a log in link. It needs `provideI18n`. Used by `portfolio`, `media`, `workout` and `cards`; `auth` keeps its centred-card layout. It reads the `--ab-border`/`--ab-surface`/`--ab-accent`/`--ab-text`/`--ab-muted` CSS custom properties, with fallbacks, so each app can theme it.
- **Theme**: `ThemeService` (`@shared`, started by `provideI18n`) resolves System/Light/Dark (account, then the `theme` cookie, then System), sets `data-theme="light|dark"` on `<html>` (removed for System) and rewrites the `theme` cookie (Domain from `Environment.cookieDomain`: `.alanbignon.com` in prod, none in dev; one year; not HttpOnly). An inline script in every `index.html` sets `data-theme` from the cookie before Angular boots, and updates the `theme-color` metas. Each app's `styles.scss` puts its default tokens on `:root` (light, except portfolio: dark) and the other theme's in a `@mixin`, included under `:root[data-theme="<other>"]` and `@media (prefers-color-scheme: <other>) { :root:not([data-theme="<default>"]) }`.

## Request flow

**Prod.** Browser → `edge` (nginx, 443) → by `Host`:
- `/api/...` → `backend:8000`, URI unchanged. Same-origin on every host; the backend checks the session cookie itself (no `auth_request`, no `X-User-*` headers).
  It's a `location ^~ /api/`, so the static-asset regex never catches an API path ending in `.jpg`/`.png`/`.svg` (card images, variant badges). 20 MB body limit, except two exact-match locations for cards' images archive: `POST /api/cards/catalog/import/images` (4 GB body, passed on unbuffered as it arrives) and `GET /api/cards/catalog/export/images` (response unbuffered).
- anything else → static files from `/usr/share/nginx/html/<app>`, with unknown paths falling back to `index.html` (Angular routing). Hashed assets are cached for a year, `index.html` and `/ngsw-worker.js` are `no-cache`.

**Dev.** Browser → `ng serve` for that app (`localhost:460x`) → its dev-server proxy sends `/api` to the backend (`API_TARGET`, `http://backend:8000` inside compose). Same-origin as in prod. Cookies aren't scoped by port, so a session cookie set on `localhost:4604` (auth) is also sent to `localhost:4602` (cards).

**Outbound calls.** Only the backend talks to TMDB (films, series; Bearer `TMDB_READ_ACCESS_TOKEN`) and Open Library (books), for media's search and details, and it downloads covers into `media.covers` when an item is added. The one exception: search result thumbnails on media's Add page are `<img>`s pointing at those CDNs, since nothing is stored before an item is added. Stored covers are always served by `/api/media/items/{id}/cover`. Cards' catalog refresh (admin-triggered only, never while browsing) downloads scans, set logos/symbols and variant badges from pokecardex's CDN and card text from TCGdex (`api.tcgdex.net`) into `CARDS_DATA_DIR`.

### Cards frontend

`projects/cards` uses standalone zoneless Angular 22, OnPush views, lazy routes, and signals for page and staging-queue state. The API wrappers live in `services/`; models, set/variant/rarity/sort/deck-visual helpers stay local. All URLs are relative `/api/cards/...`. Collection and deck image helpers use `/images/` (thumbnails replace the `/cards/` folder); `/shared/:token` uses public token-scoped image/logo/symbol routes and sits outside `appGuard('cards')`. Catalog Management has `adminGuard` in addition to the app guard; name edits are admin-only in the UI too.

The shared language switch saves the account then explicitly reloads the current route so its API display fields follow the new language. Route recreation also handles set/deck/list id changes; ordinary same-URL navigation is ignored to preserve draft-modal back-button behavior. `readJson`/`downloadBlob` in `@shared` serve browser file transfers, and `httpErrorMessage` formats backend validation details. JSON imports send the parsed value. Cards opts into HttpClient's XHR backend for image-upload progress: ZIP import sends the File as `application/zip`, receives 202 after upload and polls restoration/linking. ZIP export is an anchor download, never an in-memory Blob. The admin page probes every job status on entry and polls while mounted, with teardown on navigation. Styling exposes `--color-*` and header `--ab-*` variables, which the 6.8 look sets.

### Background jobs

Cards' catalog jobs (refresh steps, the full refresh, the images import's restore) run in a daemon thread started by the request, which answers 202; the page polls a status route. Their state lives in a module-level dict (`domains/cards/refresh/jobs.py`), which works because the backend runs one process; it is lost on restart (a job interrupted that way can just be run again: every step only fills what's missing). One catalog job at a time.

### Session

One login for every app. The cookies are set by `/api/auth/login` (or `/register`), with Domain `.alanbignon.com` in prod and host-only `localhost` in dev:

| Cookie | Holds | HttpOnly | Path | Max-Age |
|---|---|---|---|---|
| `session` | access JWT (15 min) | yes | `/` | 30 days |
| `refresh` | refresh JWT (30 days) | yes | `/api/auth` | 30 days |
| `csrf` | random token | no | `/` | 30 days |

1. An app's route guard (`authGuard`/`adminGuard`/`appGuard(app)` from `@shared`) calls `/api/auth/me`. Without a session it sends the browser to the portfolio's home page (a router navigation when already on the portfolio). Only the header's "Log in" link opens `<auth app>/login?redirect=<current URL>`. `appGuard` also checks the user's `apps` and sends a user without access to the auth app's account page.
2. After login, the auth app follows `redirect` if it's allowed, otherwise goes to the portfolio. See `features.md` "Auth".
3. Every `/api` call carries the cookies. The backend dependency decodes `session`, checks the `jti` isn't in `core.revoked_tokens`, loads the user, and on unsafe methods compares the `x-csrf-token` header to the `csrf` cookie.
4. When the access token expires, the backend answers 401. The `@shared` interceptor then calls `POST /api/auth/refresh` once (rotating both tokens) and retries the request. If the refresh fails, the user is cleared and the 401 is passed on.

## Environments

| | Dev (`docker-compose.yml`) | Prod (`docker-compose.prod.yml`) |
|---|---|---|
| `db` | Postgres 18, password `website`, published on 5440 | Postgres 18, `POSTGRES_PASSWORD` from `.env`, not published |
| `backend` | `./backend` bind-mounted, `uvicorn --reload`, published on 8400 | baked image, no reload, not published |
| cards files | `cards_data` volume at `/data/cards` (`CARDS_DATA_DIR`) | same |
| auth env | fixed fake `SECRET_KEY`/`REGISTER_SECRET`, no `COOKIE_DOMAIN`, `COOKIE_SECURE=false`, `ADMIN_*` defaults for `make seed-user`; `TMDB_READ_ACCESS_TOKEN` from the root `.env` (optional) | `SECRET_KEY`/`REGISTER_SECRET` from `.env` (required), `COOKIE_DOMAIN=.alanbignon.com`, `COOKIE_SECURE=true`, `TMDB_READ_ACCESS_TOKEN` from `.env` |
| frontend | `frontend` container: one `ng serve` per app (4600–4604), `./frontend` bind-mounted, `--poll 2000` | built into the `edge` image |
| proxy | none (dev servers proxy `/api`) | `edge`: only container publishing 80/443 |

Both stacks run `alembic upgrade head` before starting uvicorn, so migrations apply on every start.

`CARDS_DATA_DIR` holds cards' downloaded files (~2 GB), the old app's layout: `<series>/<set_code>/{cards,thumbnails}/…` (scans, thumbnails), `<series>/<set_code>/<set_code>_{logo_EN,logo_FR,symbol}.png`, `variant-icons/` (badges), `card-details/` (TCGdex response cache), plus a `.upload-*.zip` while an images import is being received. It is a named volume in both stacks, outside the `./backend` bind mount, so it survives rebuilds and stays out of the image; `docker compose down -v` deletes it. The saved pokecardex HTML the catalog is imported from is tracked in the repo (`CARDS_SOURCE_DIR`, default `domains/cards/source`: one folder per series with its `name.txt`, one per set with `{code}_{en,fr}{,_header}.html` and `{code}_rarity.txt`, 41 MB) and baked into the backend image.

### Local dev ports

Offset from the old per-app repos (5432–5435 / 8000–8300 / 4200–4500) so both can run during the migration.

| Service | Host port |
|---|---|
| Postgres | 5440 (tests use DB `website_test` on the same server, `website_test_gw0`, `_gw1`, … one per pytest-xdist worker) |
| Backend | 8400 |
| portfolio / workout / cards / media / auth | 4600 / 4601 / 4602 / 4603 / 4604 |

Each `ng serve` takes about 1 GB of RAM. `make up APPS="cards auth"` starts only those.
