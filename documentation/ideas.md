# Ideas

Possibilities that are deferred, undecided or ruled out. When one becomes a
decision, move it to the right file and delete it here.

- **Pokemon card scanning as a separate worker.** It needs torch/open_clip, which would make the backend image huge. Could become an optional dependency group or its own container in this repo. Decide when cards is migrated.
- **Prerendering the portfolio** (`@angular/ssr` prerender for that app only) for SEO and link previews.
- **Portfolio extras**, left out of step 3: screenshots (an image URL field or uploads, which would need storage on a volume and backups), a live-site URL, start/end years, a status badge, a per-project detail page (slug + long write-up), tag colours or a managed tag list, per-route `<title>`s, and an email link in the footer (dropped for now to avoid scrapers).
- **`api.alanbignon.com`** as an extra API entry point if a non-browser client (mobile app) ever needs it — see decisions "API exposed as `/api` on every host".
- **Nx**, if builds or tests ever get slow enough that affected-only runs matter.
- **CI**: lint + backend tests + frontend tests on push, then SSH deploy (the old repos each had their own `lint.yml`/`deploy.yml`).
- **DB backups**: port `vps-edge/backups/backup.sh`/`restore.sh` (weekly `pg_dump`, emailed via msmtp). Now one database instead of three, and per-schema restore with `pg_dump -n <schema>`.
- **Password reset** (by email). For now, `make prod-seed-user` resets the admin's password, and any other account needs a manual DB update.
- **Language picker on the login page** for logged-out visitors (`LanguageService.set` already exists).
- **Shared rate-limit storage** (Redis, via slowapi's `storage_uri`) if the backend ever runs several workers or replicas. Limits are per process today.
- **MFA / OAuth login, audit log of logins**: only if there is ever more than one real user (carried over from auth-service's ideas).
- **Users admin extras**: promoting/demoting admins and deleting accounts from `/admin/users`, a "request access" button on the account page, per-app roles beyond yes/no.
- **Media extras** (carried over from media's ideas): public share links (an entry or a whole library, revocable token, read-only page outside `appGuard`, served without an auth dependency); a year-in-review page (media's unused `/api/dashboard` computed this-year counts and was dropped); "new season available" from TMDB; an ordered watch/read queue; tags/shelves and loan tracking; a "what tonight?" random picker; streaming availability (TMDB/JustWatch, must be credited); per-session rating/notes; ISBN barcode scan; Goodreads / Letterboxd / TV Time CSV import; collections and sagas; Google Books as a fallback source (needs a key); French genre names and posters, a French title field on the manual form.
- **Media import/export** of an old `../media` library (JSON), if re-entering it by hand turns out too long.
