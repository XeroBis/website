# Ideas

Possibilities that are deferred, undecided or ruled out. When one becomes a
decision, move it to the right file and delete it here.

- **Card Scan** (left out of the cards port, see decisions "Cards: port plan"): point the camera at a card to see if it's owned, by CLIP image-embedding match (`../pokemon_cards`'s Scan page, `/api/scan/identify`, `image_embedding(_fr)` columns, embeddings import/export and refresh step). It needs torch/open_clip (+1–2 GB), so if it comes back: a separate internal `cards-ml` container built from a `scan` uv dependency group, which the backend calls, rather than torch in the main backend image.
- **Cards extras**: a service worker (app-shell caching, as the old app had; it would replace the safety worker at `/ngsw-worker.js`, see decisions.md), a design-system reference page like the old `/design`, and an export/import for shopping lists (the old app has none, so they aren't carried over at cutover).
- **Prerendering the portfolio** (`@angular/ssr` prerender for that app only) for SEO and link previews.
- **Portfolio extras**, left out of step 3: screenshots (an image URL field or uploads, which would need storage on a volume and backups), a live-site URL, start/end years, a status badge, a per-project detail page (slug + long write-up), tag colours or a managed tag list, per-route `<title>`s, and an email link in the footer (dropped for now to avoid scrapers).
- **`api.alanbignon.com`** as an extra API entry point if a non-browser client (mobile app) ever needs it — see decisions "API exposed as `/api` on every host".
- **Nx**, if builds or tests ever get slow enough that affected-only runs matter.
- **Offsite backups**: the weekly dump stays on the VPS and is emailed only while under 20 MB (`infra/backups/backup.sh`). If it outgrows that, or for the `cards_data` images, an S3-compatible bucket through `rclone`.
- **Building images in CI** (push to GHCR, the VPS only pulls) if building the five Angular apps on the VPS runs out of memory or gets too slow.
- **Redirecting the old workout URLs**: workout lived at `alanbignon.com` before cutover; its paths (`/workouts`, `/stats`, …) now land on the portfolio. Ruled out at cutover (2026-10-18): its few users are told the new address instead.
- **Password reset** (by email). For now, `make prod-seed-user` resets the admin's password, `make seed-basic-user EMAIL=… PASSWORD=…` resets any dev account's, and other prod accounts need a manual DB update.
- **Language picker on the login page** for logged-out visitors (`LanguageService.set` already exists).
- **Shared rate-limit storage** (Redis, via slowapi's `storage_uri`) if the backend ever runs several workers or replicas. Limits are per process today.
- **MFA / OAuth login, audit log of logins**: only if there is ever more than one real user (carried over from auth-service's ideas).
- **Users admin extras**: promoting/demoting admins and deleting accounts from `/admin/users`, a "request access" button on the account page, per-app roles beyond yes/no.
- **Media extras** (carried over from media's ideas): public share links (an entry or a whole library, revocable token, read-only page outside `appGuard`, served without an auth dependency); a year-in-review page (media's unused `/api/dashboard` computed this-year counts and was dropped); "new season available" from TMDB; an ordered watch/read queue; tags/shelves and loan tracking; a "what tonight?" random picker; streaming availability (TMDB/JustWatch, must be credited); per-session rating/notes; ISBN barcode scan; Goodreads / Letterboxd / TV Time CSV import; collections and sagas; Google Books as a fallback source (needs a key); French genre names and posters, a French title field on the manual form.
- **Media import/export** of an old `../media` library (JSON), if re-entering it by hand turns out too long.
- **Workout extras**: a service worker (offline session logging, then sync; the old app had `@angular/service-worker` but nothing worked offline; it would replace the safety worker at `/ngsw-worker.js`), a configurable rest timer (fixed at 90 s), per-user opt-out of the read-only sharing, sharing saved circuits, server-side exercise search/pagination if the catalog ever gets large, personal records ("new PR!") highlighted in the session, a seed command for the catalog.
