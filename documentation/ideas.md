# Ideas

Possibilities that are deferred, undecided or ruled out. When one becomes a
decision, move it to the right file and delete it here.

- **Pokemon card scanning as a separate worker.** It needs torch/open_clip, which would make the backend image huge. Could become an optional dependency group or its own container in this repo. Decide when cards is migrated.
- **Prerendering the portfolio** (`@angular/ssr` prerender for that app only) for SEO and link previews.
- **`api.alanbignon.com`** as an extra API entry point if a non-browser client (mobile app) ever needs it — see decisions "API exposed as `/api` on every host".
- **Nx**, if builds or tests ever get slow enough that affected-only runs matter.
- **CI**: lint + backend tests + frontend tests on push, then SSH deploy (the old repos each had their own `lint.yml`/`deploy.yml`).
- **DB backups**: port `vps-edge/backups/backup.sh`/`restore.sh` (weekly `pg_dump`, emailed via msmtp). Now one database instead of three, and per-schema restore with `pg_dump -n <schema>`.
