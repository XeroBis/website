# Decisions

Newest at the bottom. Each entry: what was chosen, over what, and why.

## Monorepo replacing the per-app repos (2026-10-17)

`auth-service`, `vps-edge`, `pokemon_cards`, `workout` and `media` are merged into this one repo, with a single backend, a single frontend workspace and a single database. Chosen over keeping separate repos because every app already shared the same stack, conventions and deploy target, and changes that crossed repos (auth header contract, CORS lists, nginx blocks, backups) had to be made in up to five places. **No git history is carried over**: the old repos stay as archives.

## Backend: FastAPI, Python 3.14, uv, SQLAlchemy 2.1 + psycopg 3 (2026-10-17)

Same framework as every old app. The baseline is `media`'s backend (the newest): `core/` + `domains/` layout, SQLAlchemy 2.1, psycopg 3 (`postgresql+psycopg://` URLs) rather than psycopg2. Settings use `pydantic-settings` (env vars, typed defaults). `uv` for everything Python. The test client uses `httpx2` (Starlette deprecated `httpx`).

## One database, one schema per app (2026-10-17)

One Postgres database with schemas `core`, `portfolio`, `workout`, `cards`, `media`, one Alembic history for all of them (`alembic_version` in `core`). Chosen over:
- one database per app (the old setup): you can't have a real foreign key to a shared `users` table, and you get five backups and five migration histories;
- all tables mixed in `public`: no namespacing, and name clashes (`tags`, `projects`) between apps.

Each app's tables stay grouped, readable and droppable on their own, and `core.users` is a real FK target for everyone.

## Auth verified by the backend, not the proxy (2026-10-17)

The backend checks the session cookie itself through a FastAPI dependency. The old flow is removed: nginx `auth_request` to `auth-service`'s `/internal/validate`, then `X-User-*` headers, then a per-app shadow `users` row. With one backend there is no separate service to ask, and a dependency is testable and visible in the code, where the old check was hidden in proxy config. The dependencies are `get_current_user`, `get_optional_user`, `require_admin` and `require_app` in `core/deps.py`; see architecture.md "Session".

## API exposed as `/api` on every host, not `api.alanbignon.com` (2026-10-17)

Every host's nginx server block proxies `/api/` to the same backend, and the frontend uses relative `/api/...` URLs. Chosen over a dedicated `api.alanbignon.com` because same-origin calls need no CORS configuration, no preflight `OPTIONS` round-trips and no `withCredentials`, and dev (Angular dev-server proxy) behaves exactly like prod. Backend routes are namespaced by domain (`/api/cards/...`), so it doesn't matter which host a request arrives on. An `api.` host can still be added later as an extra entry point (e.g. for a mobile client) without changing anything.

## Frontend: one Angular CLI workspace, one application per site (2026-10-17)

`frontend/` is a single Angular 22 workspace with a `shared` library and five applications (`portfolio`, `workout`, `cards`, `media`, `auth`), each building its own bundle served on its own host. Chosen over one single application that switches routes by `window.location.hostname`, because each site needs its own `index.html` title/meta, favicon, PWA manifest and service worker, and the public portfolio may want prerendering on its own. A single app would have to fake all of that at runtime and couple every site's routing together. A shared `node_modules` and `package.json` still give one Angular version and one upgrade for all.

## Plain Angular CLI, not Nx (2026-10-17)

Nx adds affected-only builds, caching and boundary lint rules, but replaces `angular.json` with its own config, has its own upgrade cadence, and is one more layer to debug. With one developer, five small apps and esbuild builds that take seconds, it doesn't pay for itself. `nx init` can be added onto a plain workspace later if that changes.

## `@shared` consumed from source (2026-10-17)

`tsconfig.json` maps `@shared` to `projects/shared/src/public-api.ts` instead of the generator's default `dist/shared`, so apps compile the library's source directly: no `ng build shared` before serving or building an app, and edits show up live in `ng serve`. The library keeps its own `ng test shared` target. It would only need to be built with ng-packagr if it were ever published as a package.

## One edge nginx replacing vps-edge and per-app frontend nginx (2026-10-17)

`infra/nginx` is the only proxy. It terminates TLS, serves every app's static bundle (built into its image by a multi-stage Dockerfile) by `Host`, and proxies `/api` to the backend. Previously a request crossed two nginx hops (vps-edge, then each app's own frontend nginx) over an external `edge_net` network. That existed only because independent stacks couldn't share ports 80/443, which no longer applies. `resolver 127.0.0.11` with a variable upstream lets the edge start even when the backend isn't up.

## One multi-SAN TLS certificate (2026-10-17)

One Let's Encrypt cert covering every hostname, at `infra/ssl/alanbignon.com/`, referenced once from `snippets/tls.conf`. The old box already used a multi-SAN cert but copied it into one directory per domain; a single path removes that duplication. See `deployment.md`.

## Postgres 18, Node 24 (2026-10-17)

The new database starts on Postgres 18. The old stacks were on 16, but since data moves via the apps' export/import rather than `pg_dump`, there's no version constraint. Volumes mount `/var/lib/postgresql`, as the 18 image expects. Node 24 (current LTS) runs in every frontend container. Angular CLI 22 needs at least Node 22.22, newer than the host's 22.16, so `ng` commands run in the container (`docker compose exec frontend npx ng …`).

## No production data migration (2026-10-17)

Old data is not copied database-to-database. Workout and cards already have export/import features, which get ported with their apps and are used to reload data after cutover. Media data is re-entered or gets an import later, and auth accounts are recreated. This avoids writing one-off migration scripts across differently-shaped schemas.

## Auth libraries: PyJWT + pwdlib (argon2), not python-jose + passlib (2026-10-17)

auth-service used `python-jose` and `passlib[bcrypt]`, with `bcrypt` pinned to 3.2.2 because passlib breaks on newer bcrypt. Both are effectively unmaintained. PyJWT is maintained and does everything needed here (HS256, `exp`/`nbf`/`iss`/`aud` checks, required claims). pwdlib is the maintained successor to passlib, by the FastAPI user-auth authors, and its recommended hasher is argon2id. No password hashes are carried over (accounts are recreated, see "No production data migration"), so there was no reason to stay on bcrypt.

## Session: httpOnly JWT cookies + double-submit CSRF, as before (2026-10-17)

Kept from auth-service, over a `Authorization: Bearer` token in localStorage, because httpOnly cookies can't be read by injected JS, and one cookie on `.alanbignon.com` logs the user into every app with no SSO redirect dance. Changes from auth-service:
- Cookies renamed `session` / `refresh` / `csrf` (were `auth_token` / `refresh_token` / `csrf_token`).
- Lifetimes 15 min access / 30 days refresh (refresh was 7 days), so a monthly visit is enough to stay logged in.
- `refresh` has `Path=/api/auth`, so the long-lived token is only sent to the two endpoints that use it.
- The `session` cookie lives as long as the refresh token, longer than the JWT inside it. An expired token still reaches the backend, which answers 401 and makes the frontend refresh. With a cookie dying with its token, `get_optional_user` would silently treat a logged-in user as anonymous on public routes.
- A session cookie that is present but invalid gives 401 even on `get_optional_user` routes, for the same reason.
- `Domain`/`Secure` come from `COOKIE_DOMAIN`/`COOKIE_SECURE`. Dev: no Domain, so cookies are host-only on `localhost` and shared by every port. Prod: `.alanbignon.com` and Secure. `SameSite=Lax` everywhere.
- The backend refuses to start without `SECRET_KEY` (≥ 32 chars) and `REGISTER_SECRET` (≥ 16 chars). Dev compose sets fixed fake ones, and prod reads them from `.env`.
- JWT `iss`/`aud` are fixed to `alanbignon.com`. Dev and prod are told apart by their different secrets.

## Invite-only sign-up kept; no dev auth bypass, `make seed-user` instead (2026-10-17)

`POST /api/auth/register` still needs the `REGISTER_SECRET` as `X-Register-Secret`: the site has one real user, and open sign-up would only attract spam accounts. Other apps don't get a `REQUIRE_AUTH=false`-style bypass for dev. A dev bypass is one more code path that could end up enabled in prod, and it hides real auth bugs. Instead, `make seed-user` creates or updates an admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_PSEUDO` (dev defaults in compose), and `make prod-seed-user` does the same in prod. It's also the only way to set `is_admin`.

## Rate limiting: slowapi, on login and register only (2026-10-17)

Same library as auth-service (in-memory, per client IP, one uvicorn worker in prod). Only the endpoints worth brute-forcing are limited: login 10/minute, register 20/hour. auth-service also limited every endpoint plus a 120/minute default, which mostly risked throttling the user's own refresh/me calls. `core/rate_limit.py` is shared, so another domain can limit a route with `@limiter.limit(...)`.

## Frontend environment: one shared pair of environment files (2026-10-17)

App URLs (the login page for guards, the portfolio as the default post-login target, links on the account page) and the prod/dev redirect rule come from `projects/shared/src/lib/environment/environment{,.development}.ts`, swapped per build by `fileReplacements`, read through an `ENVIRONMENT` token. Chosen over deriving them from `window.location.hostname` at runtime because the build states which URLs it targets. One pair in `@shared` rather than one per app, because every app needs the same URLs.

## i18n: ngx-translate in `@shared`, translations bundled (2026-10-17)

Same library as auth-service. `provideI18n({ en, fr })` from `@shared` sets it up with the app's own JSON files imported into the bundle (a static loader, no HTTP fetch for translations). `LanguageService` follows the logged-in user's `language`; logged out, it uses the last language used on that site (localStorage), then the browser's, then French.

## Portfolio: hand-written projects, bilingual descriptions, free-text tags (2026-10-17)

Projects are created and edited by users with the `portfolio` app (and admins), through `require_app("portfolio")` routes (was `require_admin`, see "Per-user app access"). There is no GitHub sync, and nothing is imported from workout's `projects` table. Changes from workout's version:
- **No `user_id`**: workout scoped projects per user and picked the "portfolio user" from an env var. There is now one portfolio, and write access is decided by the `portfolio` grant.
- **Bilingual descriptions**: `description_fr` and `description_en` columns, both required, shown by the UI language. Chosen over one free-language column because the site is FR/EN everywhere else. The name isn't translated, since it's a proper noun.
- **`repo_url` over `github_link`**: any `https://` URL, not only `github.com`, so a project hosted on another forge can be linked.
- **`featured` + `position`**: the order is `position` only (manual). `featured` only highlights a card. Chosen over "featured first" so there is one ordering rule.
- **Tags**: free text, created on the fly, reused case-insensitively (workout matched case-sensitively), and deleted once unused. There is no tag admin page and no colours, so the form needs nothing more than a comma-separated field.
- **Public routes take no auth dependency**: the list doesn't change with the viewer (admin buttons are a frontend concern), so there is no `get_optional_user`, and a stale session cookie can't turn a public read into a 401.
- **Cards only**: no detail page or slug. `GET /projects/{id}` exists for the admin form.

## Shared header in `@shared`, with its strings shipped by `provideI18n` (2026-10-17)

The top bar (title, app links slot, FR/EN switch, login or account link) is an `@shared` component, `ab-header`, because every app except auth needs the same one. Its few strings live in `@shared` under a `SHARED` key that `provideI18n` merges into each app's translations. Chosen over asking every app to copy the header keys into its own JSON. Only `portfolio` uses it in this step; the other apps adopt it when they are ported. The header links logged-in users to the auth app's account page rather than offering a logout button, so account actions (pseudo, language, logout) stay in one place. `httpStatus` (error → HTTP status) also moved from the auth app to `@shared`, since portfolio needs it too.

## Per-user app access in `core.user_apps`, managed from the auth app (2026-10-17)

Each account starts with access to no app. An admin grants `workout`, `cards`, `media` or `portfolio` per user on the auth app's `/admin/users` page. Choices:
- **A `core.user_apps` join table** (user, app) over an array column on `users` or per-app tables: one row per grant, a check constraint on the app name, and `ON DELETE CASCADE` with the user. It lives in `core` because every app reads it.
- **Admins bypass**: `is_admin` implies every app, so the admin can't lock themselves out and needs no rows. `/api/auth/me` returns the *effective* list (`apps`), so the frontend has one thing to check.
- **Portfolio stays public**: its grant means "may edit projects", replacing the `is_admin` check on its write routes.
- **Enforced on both sides**: `require_app("<app>")` in `core/deps.py` (403 without access) on each app's routes, and `appGuard(app)` in `@shared` on each app's pages. A logged-in user without access is sent to the auth app's account page, which lists only the apps they can open. Chosen over a "no access" page in each app because the account page already is the hub of apps.
- Still only `make seed-user` sets `is_admin`; the users page doesn't toggle it or delete accounts (see ideas.md).

## Media: ported from `../media` with its data model, sources and covers (2026-10-17)

`../media` was already on this stack, so its `domains/media` was adapted rather than rewritten. What changed:
- **Auth**: `core.deps.require_app("media")` (a session, the `media` grant or admin, and CSRF on unsafe routes) replaces the `X-User-*` headers, the `REQUIRE_AUTH=false` dev bypass, the CORS setup and the `users` shadow table. `library_entries.user_id` and `media_items.created_by_user_id` reference `core.users.id`. Every user with access to media has their own library over the shared catalog.
- **Routes** moved under `/api/media/...`. The cover route became `/api/media/items/{id}/cover` (was `/api/media/{id}/cover`). `/api/dashboard` (unused since media's home page was removed) and `/api/users/me` (replaced by `/api/auth/me`) are dropped.
- **No share links**: media had none yet (only an idea, which is why its docs reserved `/api/public/`). They stay in ideas.md.
- **Kept as-is**: the shared catalog + per-user `library_entries` + `reading_sessions` model, the status rules, TMDB (films, series) and Open Library (books) as metadata sources called only by the backend, covers cached in Postgres (`bytea`, so the one database backup includes them), and EN + FR titles/synopses in the catalog. One fresh migration; media's own history is not carried over, and no rows are imported (see "No production data migration").
- **HTTP client**: `httpx2`, already used by the test client, is now also a runtime dependency for the source calls (media used `httpx`, which Starlette deprecated). Tests swap its transport for an `httpx2.MockTransport` that fails on any unregistered URL.
- **TMDB token**: `TMDB_READ_ACCESS_TOKEN` in `core/config.py`, from `.env` in dev and prod. Without it, film and series search answer 502 and books still work. Tests never use a real token.
- **Metadata refresh**: media's `scripts/refresh_metadata.py` became `domains/media/refresh.py`, run with `make media-refresh` / `make prod-media-refresh`.
- **Frontend**: the app uses `@shared`'s `authGuard`, `AuthService`, `LanguageService` (so the header's FR/EN switch now also changes titles, which media couldn't do) and `ab-header`, instead of its own copies. Only the inline-SVG icon component moved to `@shared` (as `ab-icon`); labels, API wrappers, poster, rating and quick actions stay in the media app, since no other app uses them.
- **Look**: "library paper" (cream paper, ink text, Fraunces serif headings, oxblood accent), deliberately unlike portfolio (dark/lime) and auth (neo-brutalist). Films and series get their own accents (teal, ochre) so the app doesn't read as books-only. It replaces media's light indigo look, which matched pokemon_cards.
