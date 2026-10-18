# Migration Plan

Moving the old sibling repos (`../auth-service`, `../vps-edge`,
`../pokemon_cards`, `../workout`, `../media`) into this monorepo. Ordered by
dependency and risk: auth first because everything depends on it, the
biggest app (cards) last.

| # | Step | Status |
|---|---|---|
| 1 | **Skeleton**: backend (health, config, DB, one schema per app, Alembic, tests), Angular workspace (`shared` + 5 placeholder apps), dev/prod compose, edge nginx, docs | ✅ done 2026-10-17 |
| 2 | **Auth**: `core.users` (+ revoked tokens), register/login/refresh/logout/me, cookie JWT + CSRF, `get_current_user` dependency, `auth` app (login, signup, account: pseudo, language), shared `AuthService`/guard/interceptor/i18n in `@shared` | ✅ done 2026-10-17 |
| 3 | **Portfolio**: `portfolio` schema (projects, tags), public list, admin CRUD, `portfolio` app | ✅ done 2026-10-17 |
| 4 | **Media**: port `../media` (already on the target stack) | ✅ done 2026-10-17 |
| 5 | **Workout**: port `../workout` (FastAPI 0.115 → current, flat → `domains/`, Angular 21 → 22) incl. its import | ✅ done 2026-10-17 |
| 6 | **Cards**: port `../pokemon_cards` (one fresh migration instead of its 43, card images now auth-checked by the backend instead of nginx, Card Scan left out) incl. its import | ✅ done 2026-10-18, plan below |
| 7 | **Cutover**: cert expanded with `workout.alanbignon.com`, prod `.env`, stop old stacks, start this one, re-import data, port backups, CI | ⏳ in progress, plan below |

Step 2 notes: `auth-service`'s `/internal/validate` (nginx `auth_request`) and its CORS setup are dropped. Its `revoked_tokens` and pseudo/language features are kept. See decisions.md for what changed (libraries, cookie names and lifetimes, rate limits).

Step 3 notes: written from scratch rather than ported, with workout's `projects` feature as the reference. No rows imported. Changes from workout are in decisions.md ("Portfolio: hand-written projects…"). The shared header `ab-header` and `httpStatus` were added to `@shared`.

Step 4 notes: `domains/media` adapted rather than rewritten (models in the `media` schema with FKs to `core.users`, `require_app("media")` instead of `X-User-*` headers, no shadow `users` table, no CORS, no dev auth bypass), one fresh migration (`0005`), routes under `/api/media`. `/api/dashboard` and `/api/users/me` dropped; share links weren't built in `../media` and stay in ideas.md. Tests ported to `tests/media/` (own conftest with a fake TMDB / Open Library). `ab-icon` added to `@shared`. No rows imported. See decisions.md "Media: ported from `../media`…".

## Step 6 plan: cards

Decisions are in decisions.md "Cards: port plan". Done as one step: every part of `../pokemon_cards` except Card Scan (and its CLIP embeddings), the `/design` page and the service worker. Worked in this order, each part landing with its tests:

| # | Part | Status |
|---|---|---|
| 6.1 | **Foundation**: `domains/cards` package, every model in the `cards` schema (user FKs to `core.users`), one fresh migration (also `CREATE EXTENSION pg_trgm` and the trigram name index), settings `CARDS_SOURCE_DIR` / `CARDS_DATA_DIR`, `cards_data` volume in both compose files, `tests/cards/` conftest | ✅ 2026-10-18 |
| 6.2 | **Catalog + images**: browse/search/sort, card detail + name fix (admin), sets + completion, set detail, missing intervals, variant types, deck usage, `GET /api/cards/images/{path}` | ✅ 2026-10-18 |
| 6.3 | **Collection**: owned cards + variant quantities, search/filter-options, add (incl. add-to-deck in one batch), edit/delete, history, import/export, delete-all | ✅ 2026-10-18 |
| 6.4 | **Decks**: normal + phantom decks, deck cards, posters, history, copy, start hand (frontend only), upgrade drafts (single + combined export), decklist converter, text/JSON exports, import / import-all; the set missing-cards text exports (`/catalog/sets/{code}/missing/text`, `POST /catalog/sets/missing/text`), which render through the converter | ✅ 2026-10-18 |
| 6.5 | **Combats, purchases, shopping lists, shares**: combat log with snapshots + import/export, What I Paid, shopping lists, share links + public token-scoped routes | ✅ 2026-10-18 |
| 6.6 | **Catalog management** (admin): copy `../pokemon_cards/DATA/` into `backend/domains/cards/source/`, port the refresh steps (HTML import, scan download, thumbnails, logos/symbols, variant icons, TCGdex details; no embeddings step), job state + polling, stats, metadata and images import/export, `GET /public/variant-icons/{file}` (needs the import's variant mapping) | ✅ 2026-10-18 |
| 6.7 | **Frontend**: `projects/cards` rewritten zoneless with signals, every page above, `@shared` auth/i18n/header/icons, FR/EN JSON, web manifest + Poké Ball icons | ✅ 2026-10-18 |
| 6.8 | **Look**: "old red, modernised" (see features.md Cards) | ✅ 2026-10-18 |
| 6.9 | **Data-load rehearsal**: the "Data load" below, run in dev from the old prod's exports | ✅ 2026-10-18 (by hand) |

6.7 notes: every old page except Scan and `/design` is available through lazy routes. Component and staging-queue state use signals; HTTP wrappers and debounced input events use RxJS only for I/O. Shared auth, language, header and icons replace the old app wiring. JSON files are read on the page; image archives upload as raw ZIPs with XHR progress and poll through restoration, while export is a streaming anchor download. Catalog Management reattaches to active jobs; public shares use token-scoped images outside the app guard. Neutral CSS tokens left the look for 6.8.

6.8 notes: styling only, no behaviour change. Global tokens in `projects/cards/src/styles.scss` (light + `prefers-color-scheme: dark`), pill buttons, inputs, toggles and nav links, white shadowed card tiles with a random holo foil on hover (`util/foil.util.ts` + the global `.card-tile`), Fredoka header title with the Poké Ball. Google Fonts loaded from `index.html`, as in workout and media. The "collector's binder" look first planned here was built, then swapped for this one the same day.

**Route mapping** (everything under `/api/cards`):

| Old | New |
|---|---|
| `/api/catalog/...` | `/api/cards/catalog/...` |
| `/api/cards/...` (collection) | `/api/cards/collection/...` |
| `/api/decks/...`, `/api/drafts/...`, `/api/convert/...` | `/api/cards/decks/...`, `/api/cards/drafts/...`, `/api/cards/convert/...` |
| `/api/combats`, `/api/purchases`, `/api/shopping-lists`, `/api/shares` | same names under `/api/cards/` |
| `/api/public/shares/{token}...`, `/api/public/variant-icons/{file}` | `/api/cards/public/shares/{token}...`, `/api/cards/public/variant-icons/{file}` (no auth dependency) |
| `/card-images/{path}` (static mount, nginx-gated) | `/api/cards/images/{path}` (`require_app("cards")`) |
| `/api/users` (shadow table) | `/api/cards/users` (users with cards access, for the combat player pickers) |
| `/api/scan/identify`, `/api/catalog/{import,export}/embeddings`, refresh step `update_embeddings` | dropped (ideas.md) |

**Data load** (rehearsed in dev at 6.9, repeated at cutover, step 7.4). From the old prod, in this order:
1. Admin, Catalog Management: **Import catalog** (`cards_metadata.json` from the old `GET /api/catalog/export`), then **Import images** (zip from the old `GET /api/catalog/export/images`; the volume needs room for the uploaded zip on top of the restored files, ~4 GB at peak), then the **Import HTML** refresh step (the old export has no variant scan URLs, which later scan downloads need). The image paths keep the old layout, so collection exports still match by `image_path`.
2. Each user, Gestion: collection (`collection.json`), decks (`decks.json`, incl. drafts), purchases (`purchases.json`).
3. Combats (`combats.json`): matched by deck name + owner email and player email, so every account must exist and have cards access first.
4. Not carried over: shopping lists (the old app has no export for them), share links (short-lived), collection/deck history (rebuilt from the imports onward).

## Step 7 plan: cutover

The runbook is deployment.md "Cutover"; decisions in decisions.md "Cutover tooling".

| # | Part | Status |
|---|---|---|
| 7.1 | **Repo**: `infra/backups/` (`backup.sh`, `restore.sh`, `msmtprc.template`, `make prod-backup` / `prod-restore`), `infra/certbot/deploy-hook.sh`, `.github/workflows/ci.yml` (lint, backend, frontend, deploy), deployment.md runbook | ✅ 2026-10-18 |
| 7.2 | **GitHub**: `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` secrets on `XeroBis/website` | |
| 7.3 | **VPS prep**, old stacks still serving: DNS check, cert expanded through the old webroot, clone + `.env`, cert copied, images pre-built, disk/memory checked | |
| 7.4 | **Cutover day**: exports from the old apps, last old backup, old stacks stopped, `make prod`, accounts + app grants, cards and workout re-imported | |
| 7.5 | **After**: cert hook installed + dry-run, backup cron + first run, first CI deploy, old repos' deploy workflows disabled; a week later old volumes removed and repos archived | |

## Per-app port checklist

For each of steps 3–6:
1. Read the old repo's `documentation/` (or `CLAUDE.md`) and decide what changes; record it in this repo's docs first (`plan-and-document` skill).
2. Models into `backend/domains/<app>/models.py` with `schema="<app>"`, user FKs to `core.users.id`. A fresh autogenerated migration (old histories are not carried over).
3. Routers under `/api/<app>/...`, using `core.deps` (`get_current_user`, `get_optional_user`, `require_admin`): no `X-User-*` headers, no shadow `users` table.
4. Tests ported to the shared `tests/` setup.
5. Frontend into `frontend/projects/<app>`; anything another app also needs goes into `@shared`. Use `authGuard`/`adminGuard`/`AuthService` from `@shared`, `provideI18n` with the app's own `src/i18n/{en,fr}.json`, and the shared `ab-header` for the top bar.
6. Update `architecture.md`, `data-model.md`, `features.md`.
