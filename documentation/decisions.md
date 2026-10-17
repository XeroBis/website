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

The backend checks the session cookie itself through a FastAPI dependency. The old flow is removed: nginx `auth_request` to `auth-service`'s `/internal/validate`, then `X-User-*` headers, then a per-app shadow `users` row. With one backend there is no separate service to ask, and a dependency is testable and visible in the code, where the old check was hidden in proxy config. Details land with the auth domain (`migration-plan.md` step 2).

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
