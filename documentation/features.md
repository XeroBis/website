# Features

User-facing behaviour per app. An app that isn't migrated yet shows a
placeholder page (its name and whether `/api/health` answers) — see
`migration-plan.md`.

## Shared

- `GET /api/health` → `{"status": "ok"}` when the backend can reach the database (500 otherwise). Available on every host.
- **One login for every app** (see architecture.md "Session"). A page behind `authGuard` sends a logged-out visitor to the auth app's login page, and they come back to that page afterwards. `adminGuard` does the same, and sends a logged-in non-admin to the app's root. `appGuard(app)` does the same, and sends a logged-in user without access to that app to the auth app's account page.
- **App access**: a new account can use no app. An admin grants apps per user (auth app, `/admin/users`). Admins can use every app. Workout, cards and media are entirely behind their grant (pages and API). The portfolio is public; its grant only allows editing projects.
- **Language**: the logged-in user's saved language (FR/EN). Logged out: the last language used on that site, then the browser's language if it's French or English, then French.
- Placeholder pages show who is logged in (pseudo and email) or a "Log in" link.
- **Header** (`ab-header`, used by portfolio, media and workout): the app title linking home; the app's own links; an FR/EN switch, which saves the language on the account when logged in and otherwise only for that site; then the pseudo with an apps-grid icon button (the old workout navbar's, labelled "My account"), linking to the auth app's account page, which is the only place to log out), or "Log in" (auth app login, coming back to the current page).

## Auth — `auth.alanbignon.com`

### Pages

- `/login`: email + password. On success, goes to `?redirect=` if it is allowed, otherwise to the portfolio (`alanbignon.com`). Allowed in prod: `https://alanbignon.com` or `https://<anything>.alanbignon.com`, no port, no credentials in the URL. Allowed in dev: `http://localhost:4600`–`4604`. A visitor who is already logged in is sent on right away. Errors: invalid credentials, too many attempts, generic.
- `/signup` (invite-only): email, password (12+ chars), pseudo (required, ≤ 50), sign-up code. Success logs the user in and follows the same redirect rule. Errors: wrong code, email taken, invalid fields, too many attempts. `?redirect=` is kept when switching between login and sign-up.
- `/` (account, logged in only, otherwise `/login?redirect=` back here): pseudo and email, inline pseudo editing, language picker (Français/English, applied at once), links to the portfolio (always) and to the workout/cards/media apps the user has access to ("No other app yet" when none), a "Users" link for admins, log out (then `/login`).
- `/admin/users` (behind `appGuard('portfolio')`: logged out → login, not an editor → auth app's account page): every user, oldest first, with pseudo, email and sign-up date. Each non-admin row has one checkbox per app (Portfolio (edit), Workout, Cards, Media); a click saves at once (the box is disabled while saving, and reverts with an error if the save fails). Admin rows show "Admin: all apps" instead of checkboxes.
- Any other path → `/`.

### API (`/api/auth`)

| Endpoint | Auth | Body → result | Errors |
|---|---|---|---|
| `POST /register` | `X-Register-Secret` header | `{email, password, pseudo}` → 201 user, session cookies set | 403 wrong secret, 409 email taken, 422 invalid, 429 > 20/hour per IP |
| `POST /login` | – | `{email, password}` → user, session cookies set | 401 wrong credentials, 429 > 10/minute per IP |
| `POST /refresh` | `refresh` cookie + CSRF | → 204, new `session`/`refresh`/`csrf` (old refresh revoked) | 403 CSRF, 401 invalid refresh (cookies cleared) |
| `POST /logout` | CSRF | → 204, both tokens revoked, cookies cleared | 403 CSRF |
| `GET /me` | session | → user | 401 |
| `PATCH /me` | session + CSRF | `{pseudo}` → user | 401, 403, 422 |
| `PATCH /me/language` | session + CSRF | `{language: "en"\|"fr"}` → user | 401, 403, 422 |
| `GET /users` | admin | → every user (with `created_at`), oldest first | 401, 403 |
| `PUT /users/{id}/apps` | admin + CSRF | `{apps: string[]}` (full replace) → user (with `created_at`) | 401, 403, 404, 422 |

A user is `{id, email, pseudo, language, is_admin, apps}`. `apps` is what the user can use, sorted: their grants, or every app for an admin.

### Validation

- Email: valid address, compared and stored lowercased. A malformed email at login is just a 401.
- Password: at least 12 characters (sign-up, `make seed-user` and `make seed-basic-user`; not re-checked at login).
- Pseudo: trimmed, 1–50 characters, required.
- Language: `en` or `fr`.
- Apps: each one of `portfolio`, `workout`, `cards`, `media`; repeats are dropped. Setting an admin's apps is allowed but changes nothing they can use.
- CSRF: every unsafe request with a session needs `x-csrf-token` equal to the `csrf` cookie. The `@shared` interceptor adds it.

## Portfolio — `alanbignon.com`

A public list of the projects Alan has made, added and edited by hand by its editors: users with the `portfolio` app, and admins (no GitHub sync). Nothing is imported from the old workout `projects` table. FR/EN.

### Pages

- **Every page**: the shared header (title "Alan Bignon"). Editors also get a "+ Project" link to `/admin/projects/new`. The footer links to GitHub (`github.com/XeroBis`) and LinkedIn (`linkedin.com/in/alan-bignon`). The intro, contact URLs and UI strings live in `src/i18n/*.json` and `app.ts`, not the database.
- `/` (public): name, subtitle and a short bio (from workout's old home page), then the projects in their public order (see data-model.md). Each card shows the name, a "Featured" badge when featured (the card is also highlighted), the description in the current language, tags, and a "Source code" link when there is one.
  - **Tag filter**: a chip row with "All" and every tag in use. Clicking a chip (or a tag on a card) sets `?tag=<name>` and shows only matching projects (case-insensitive). With no match, "No project with this tag". Filtering happens in the browser.
  - **Editors only**: "Edit" (→ `/admin/projects/:id`) and "Delete" on each card. Delete asks for confirmation and removes the card.
- `/admin/projects/new`, `/admin/projects/:id` (behind `appGuard('portfolio')`: logged out → login, not an editor → auth app's account page): one form with name, FR description, EN description, source code link, tags (comma-separated, with existing tags offered as clickable suggestions), position and featured. Save goes back to `/`. Errors: name taken, invalid fields, session expired or not an editor, generic. An unknown id shows "Project not found".
- Any other path → `/`.
- SEO: static `<title>`, meta description, Open Graph tags and canonical URL in `index.html`. No prerendering (see ideas.md).

### API (`/api/portfolio`)

| Endpoint | Auth | Body → result | Errors |
|---|---|---|---|
| `GET /projects` | – | → every project, in public order | |
| `GET /projects/{id}` | – | → project | 404 |
| `GET /tags` | – | → names of tags in use, sorted case-insensitively | |
| `POST /projects` | editor + CSRF | project input → 201 project | 401, 403 (not an editor / CSRF), 409 name taken, 422 |
| `PUT /projects/{id}` | editor + CSRF | project input (full replace) → project | 401, 403, 404, 409, 422 |
| `DELETE /projects/{id}` | editor + CSRF | → 204 | 401, 403, 404 |

A project is `{id, name, description_fr, description_en, repo_url, featured, position, tags: string[]}`. The input is the same without `id`: `repo_url`, `featured` (false), `position` (0) and `tags` ([]) are optional.

### Validation

- Name: trimmed, 1–100 chars, unique case-insensitively (409).
- Descriptions (FR and EN): both required, trimmed, 1–1000 chars.
- Source code link: optional; blank → none; otherwise `https://` + host, ≤ 300 chars, no spaces.
- Position: integer 0–10000.
- Tags: at most 10, each trimmed and 1–30 chars; repeats (case-insensitive) dropped. The form checks the same rules before sending.

## Workout — `workout.alanbignon.com`

A workout log: workouts made of exercises with their sets (and circuits), a shared exercise catalog, templates, saved circuits, a live session mode for the gym, a stats dashboard, and import/export. Ported from `../workout` (see decisions.md for what changed). Every page is behind `appGuard('workout')` (logged out → login; no workout access → the auth app's account page). FR/EN. Tables and rules: data-model.md `workout`.

### Look

"Scoreboard": deep navy background, slightly lighter panels, signal-orange accent, Barlow Condensed (uppercase) for headings and numbers, Inter for the UI, JetBrains Mono for set values and timers (tabular digits). Strength is orange, cardio cyan, circuits violet, on their badges and charts. Big tap targets on the session page. Installable to the phone's home screen (web manifest, the old app's "AB" icons), without a service worker.

### Shared parts

- **Header**: the shared header (title "Workout", links Dashboard, Workouts, Templates, Circuits, Exercises, Equipments, Data, and Admin for admins). The FR/EN switch saves the language on the account (the old app only showed it logged out).
- **Viewing someone else**: the Dashboard, Workouts and Templates pages have a "Viewing" select listing every workout user (pseudo), the current user first. Picking someone else shows their data read-only: no edit, delete, new or session buttons. Templates offer "Copy to my templates" instead. The choice is in the URL (`?user=<id>`); the exercises page's history shows your own sets.
- **Set display**: `12 reps @ 40 kg · 1min 30s · 9 km/h · difficulty 6 · 1.5km`, showing only the fields set. Durations as `1h 2min 3s`, distances in m under 1000, else km.
- **Muscle map**: front and back body SVGs, muscles shaded by intensity (1–3). Muscle names are translated. In forms, clicking a muscle cycles 1 → 2 → 3 → off; as a filter it toggles; read-only on details and the dashboard, where hovering (tapping on mobile) a muscle lists the exercises that worked it.
- **Exercise picker**: type-ahead over exercise names and muscles (every word must match).

### Pages

- `/` → `/dashboard`. Any other path → `/dashboard`.
- `/dashboard`: range presets 1 month / 3 months (default) / 6 months / 1 year (whole calendar months ending this month) / all, or custom from–to dates. Then: totals (workouts, exercises, volume as kg / t / Mt), an activity calendar (one month per card, days with a workout highlighted; clicking one opens `/workouts` scrolled to it), workouts per week and volume per week bar charts (scrolled together, year separators), strength progression for a picked exercise (max weight and estimated 1RM lines, needs two dates), top exercises (by times done), workouts per weekday, and the muscle map of the period. "No workout in this period" when empty.
- `/workouts`: completed workouts newest first, 20 at a time with infinite scroll, grouped by year / month (default) / week (toggles, combinable, collapsible groups with counts). Each card: date, duration, entries (circuits with their name, duration and rounds), sets. Buttons: **Details** (muscle map + equipment of the selected exercises), and for your own: **Save as template** (new, or replace one of yours), **Edit**, **Delete** (with confirmation). Clicking an exercise name opens its history (every set of that exercise, newest first, for the viewed user). Toolbar: **Live session** and **New workout**.
- `/workouts/new`, `/workouts/:id/edit`: date, duration (minutes), optionally start from one of your templates, then the entries editor. Errors are shown per row ("Exercise 2: pick an exercise"). Someone else's or an unknown id: "Workout not found".
- **Entries editor** (workout, template and circuit forms): rows of exercise (picker + sets) or circuit (name, duration, rounds, its own exercise rows), reorderable with ▲▼, removable; sets show reps + weight (strength) or duration + distance (cardio) with **More fields** for the rest; **+ Set** copies the last one; **Insert saved circuit**.
- `/session` (live session): with none running, pick one of your templates (or **Start blank**). Running: the elapsed time, **Finish** and **Discard** (each confirmed). The focused entry is shown large, the others as compact rows below (tap to focus; done ones get a ✓):
  - an exercise: a table of its sets with editable values and a ✓ button each; checking a set saves its edited values and starts a 90 s rest timer (with a bar and **Skip**); a checked set stays editable (saved on change); **+ Set**, remove a set, remove the exercise;
  - a circuit: "Round N / rounds", the member exercise currently up with its inputs and **Round done → next** (logs a checked set and moves to the next member), member pips to jump, the rounds logged so far, **+ Exercise** into the circuit; no rest timer;
  - **+ Exercise**, **+ Circuit** (blank, or a saved circuit);
  - when every standalone exercise is done, an "All done" banner with **Finish**.
  - Finish keeps only checked sets (see data-model.md) and opens `/workouts`. Checked sets are remembered in the browser, so reloading the page during a session keeps them.
- `/templates`: the viewed user's templates by name, with their entries, **Details**, and for your own **Start session**, **Edit**, **Delete**; for someone else's, **Copy to my templates** (named like the original, with " (2)", " (3)"… if you already use that name). **New template** → `/templates/new`. `/templates/new`, `/templates/:id`: name + entries editor.
- `/circuits`: your saved circuits (name, duration, rounds, exercises with planned sets), **Edit**, **Delete**. `/circuits/new`, `/circuits/:id`: name (required), duration, rounds, exercise rows.
- `/exercises`: the catalog, filtered in the browser by name, type and muscles (map in toggle mode). Each row: name (opens its history), type badge, **Details** (muscle map and equipment). **New exercise** (any workout user, `/exercises/new`): name, type, muscles with intensity, equipment checkboxes. Admins also get **Edit** (`/exercises/:id`, same form) and **Delete** (refused with a message while the exercise is used).
- `/equipments`: the equipment list with a name filter; **New equipment** for everyone, inline **Edit** and **Delete** (confirmed) for admins.
- `/data`: your own import/export, one section each for workouts, templates and saved circuits: **Export** downloads `workouts.json` / `templates.json` / `circuits.json`; **Import** reads such a file (checked in the browser first, with the path of the first problem), then shows "N imported, M skipped" and the list of skipped items with the reason.
- `/admin` (admins; others → `/`): catalog import/export (`exercises.json`, `equipments.json`); workouts and templates import/export for the users ticked in a checklist (old multi-user files, `[{user_email, workouts}]` / `[{user_email, templates}]`); **Delete all** workouts / templates of the ticked users, all exercises, all equipments (each confirmed).

### File formats

Same as the old app, so its exports import as-is:
- `workouts.json`: `[{date, duration_minutes, exercises: [entry]}]`; an entry is `{type: "exercise", exercise_name, sets: [set]}` or `{type: "circuit", name, duration_minutes, rounds, exercises: [{exercise_name, sets}]}`. Older exports' `"strength"` / `"cardio"` entries (and very old cardio entries with `intervals` / `duration_s` / `distance_m` instead of `sets`) are read too. A set has any of `reps, weight_kg, duration_s, distance_m, speed_kmh, difficulty`.
- `templates.json`: `[{name, exercises: [entry]}]`. `circuits.json` (new): `[{name, duration_minutes, rounds, exercises: [{exercise_name, sets}]}]`.
- Admin files: the same lists wrapped as `[{user_email, workouts}]` / `[{user_email, templates}]`; `exercises.json`: `[{name, type, muscles: [{name, intensity}], equipments: [name]}]`; `equipments.json`: `[name]`.
- The catalog is loaded from the admin page (the old repo's `data/exercises.json` and `data/equipments.json`, or a prod export); nothing seeds it automatically.

### API (`/api/workout`)

Every route needs a session (401) and the `workout` app (403); unsafe ones also need CSRF (403). `user_id` on read routes = another workout user (404 if they can't use workout). Writes to anything not yours: 404.

| Endpoint | Body / query → result | Errors |
|---|---|---|
| `GET /users` | → workout users `{id, pseudo}`, current user first, then by pseudo | |
| `GET /muscles` | → the 16 muscle names | |
| `GET /exercises` | → every exercise `{id, name, type, muscles: [{name, intensity}], equipments: [{id, name}]}` by name | |
| `GET /exercises/{id}` | → exercise | 404 |
| `POST /exercises` | `{name, type, muscles, equipments: [name]}` (unknown equipment names are created) → 201 exercise | 409 name taken, 422 |
| `PUT /exercises/{id}` | admin; same body → exercise | 403, 404, 409, 422 |
| `DELETE /exercises/{id}` | admin → 204 | 403, 404, 409 in use |
| `GET /equipments` · `POST /equipments` | → `[{id, name}]` · `{name}` → 201 | 409, 422 |
| `PUT /equipments/{id}` · `DELETE /equipments/{id}` | admin; `{name}` → equipment · → 204 (unlinked from exercises) | 403, 404, 409, 422 |
| `GET /workouts?user_id&date_from&date_to&exercise_id&limit&offset` | → completed workouts, newest first (`limit` 1–100, default 20) | 404, 422 |
| `GET /workouts/{id}?user_id` | → workout | 404 |
| `POST /workouts` | `{date, duration_minutes, exercises: [entry]}` → 201 workout | 404 unknown exercise, 422 |
| `PUT /workouts/{id}` · `DELETE /workouts/{id}` | full replace → workout · → 204 | 404, 422 |
| `GET /stats?user_id&date_from&date_to` | → dashboard aggregates (below) | 404, 422 |
| `GET /templates?user_id` · `GET /templates/{id}?user_id` | → templates by name · template | 404 |
| `POST /templates` · `PUT /templates/{id}` · `DELETE /templates/{id}` | `{name, exercises}` → 201 / template / 204 | 404, 409 name taken, 422 |
| `POST /templates/{id}/copy?user_id` | → 201 your copy | 404 |
| `GET /circuits` · `GET /circuits/{id}` · `POST` · `PUT /{id}` · `DELETE /{id}` | your saved circuits; `{name, duration_minutes, rounds, exercises: [{exercise_id, sets}]}` | 404, 409, 422 |
| `GET /session` | → your live session, or `null` | |
| `POST /session` | `{template_id?}` → 201 session | 404 template, 409 one running |
| `DELETE /session` | discard → 204 | 404 none |
| `POST /session/finish` | `{checked_set_ids, date?}` → completed workout | 404 |
| `POST /session/exercises` · `DELETE /session/exercises/{id}` | `{exercise_id, circuit_id?}` → 201 entry · → 204 | 404 |
| `POST /session/circuits` · `DELETE /session/circuits/{id}` | `{name?, duration_minutes?, rounds?, exercise_ids}` → 201 circuit · → 204 | 404 |
| `POST /session/exercises/{id}/sets` · `PUT /session/sets/{id}` · `DELETE /session/sets/{id}` | set → 201 set · set → set · → 204 | 404, 422 |
| `GET /workouts/export` · `POST /workouts/import` | your workouts file · file → `{created, skipped, ignored: [reason]}` | 422 |
| `GET /templates/export` · `POST /templates/import` | same for templates | 422 |
| `GET /circuits/export` · `POST /circuits/import` | same for saved circuits | 422 |
| `GET /admin/workouts/export?user_ids` · `POST /admin/workouts/import` | admin; multi-user files (unknown email → listed) | 403, 422 |
| `GET /admin/templates/export?user_ids` · `POST /admin/templates/import` | admin; same | 403, 422 |
| `GET /admin/exercises/export` · `POST /admin/exercises/import` | admin; creates or updates by name → `{created, updated, skipped, ignored}` | 403, 422 |
| `GET /admin/equipments/export` · `POST /admin/equipments/import` | admin; existing names skipped | 403, 422 |
| `DELETE /admin/workouts?user_ids` · `DELETE /admin/templates?user_ids` | admin → 204 | 403 |
| `DELETE /admin/exercises` · `DELETE /admin/equipments` | admin → 204 | 403, 409 an exercise is used |

A workout is `{id, user_id, status, date, duration_minutes, started_at, ended_at, exercises: [entry]}`; an entry is `{id, type: "exercise", exercise_id, exercise, sets: [{id, …set}]}` or `{id, type: "circuit", name, duration_minutes, rounds, exercises: [exercise entry]}`. Templates are `{id, user_id, name, exercises}`, saved circuits `{id, name, duration_minutes, rounds, exercises}`.

Stats: `{date_from, date_to` (the range used: the query's, else first and last workout), `workouts, exercises, volume_kg, days: [{date, workout_ids}], weeks: [{week_start, workouts, volume_kg}]` (every week of the range, Monday first, zeros included), `weekdays: [7 counts, Monday first], top_exercises: [{name, count}], muscles: [{name, total, exercises: [{name, count}]}], progression: [{exercise_id, name, points: [{date, max_weight_kg, est_1rm_kg}]}]}` (exercises with at least one weighted set, by name).

### Validation

- Exercise / equipment / template / circuit name: trimmed, 1–100 chars; exercise and equipment names unique case-insensitively, template and saved-circuit names per user (409).
- Exercise: type `strength` or `cardio`; muscles from the list, intensity 1–3, no repeats; at most 30 muscles and 20 equipments.
- Workout: date required, duration ≥ 1 minute; 1–100 entries; an exercise entry has 1–100 sets; a circuit 1–50 exercises, duration 1–1440 minutes, rounds 1–1000, name ≤ 100. Templates the same without date/duration. Sets: see the ranges in data-model.md. The forms check the same before sending.
- Import: a file must be a JSON list of the expected shape (422 otherwise); items failing per-item checks (unknown exercise, duplicate, unknown email, unknown muscle) are skipped and listed rather than failing the whole file.

## Cards — `cards.alanbignon.com`

Placeholder, behind `appGuard`. Being ported from `../pokemon_cards` (migration-plan.md step 6). Until then its behaviour is described in `../pokemon_cards/documentation/features.md`, minus Card Scan, the `/design` page and the service worker.

### Look (planned)

"Collector's binder": a deep binder-blue/near-black page, card tiles drawn as sleeves with a faint holo-foil sheen on hover, Poké Ball red as the accent, a rounded display font for headings. The Poké Ball favicon is kept.

## Media — `media.alanbignon.com`

A personal tracker for books, films and series: what I own, what I've read/watched, what's next. Ported from `../media` (see decisions.md for what changed). Every page is behind `appGuard('media')` (logged out → login; no media access → the auth app's account page); each user has their own library. FR/EN. Tables and rules: data-model.md `media`.

### Look

"Library paper": cream paper background, ink text, Fraunces serif headings, Inter for the UI, an oxblood accent. Each type has its own accent (books oxblood, films teal, series ochre) on its chips, type pill and the placeholder covers. Posters are 2:3 with a soft shadow; without a cover, a placeholder in the item's own hue (stable per item) shows the type icon, title and creators. Icons are inline SVGs (`ab-icon` from `@shared`). The footer credits TMDB ("This product uses the TMDB API but is not endorsed or certified by TMDB", required by TMDB's terms) and Open Library.

### Language

- The UI, titles and synopses follow the current language (`LanguageService`: the header's FR/EN switch changes it live and saves it on the account). French viewers see `title_fr` / `synopsis_fr` when known, else the default (English) ones. The detail page lists the other-language and original titles under the title when they differ.
- Search results on the Add page and the library's title sort use the account's saved language. Genres and creators stay as the source gives them (genres are English).

### Pages

- **Every page**: the shared header (title "Media", links Library and Add) and the credits footer. On phones (≤ 640px) the header's links become two full-width tabs on a second row, under the title, FR/EN switch and session; a long pseudo is cut with an ellipsis.
- `/` → `/library`. Any other path → `/library`.
- `/library`: poster grid, each with its status (or "S1 · E3" for a series in progress), rating, an "owned" dot and a quick action. Controls: type chips (All / Books / Films / Series); status, owned / not owned, genre (from the genres in the library) and sort selects; a text search on titles (EN and FR), original title and creators, applied as you type. Sorts: date added (default, newest first), title (A–Z in the user's language), year (newest first), rating (highest first), last finished (most recent first); unset values last. Filters live in the URL query (`?type=book&status=done`). Nothing matching: "Nothing matches" + a link to Add.
- `/add`: pick a type (Book / Film / Series) and search. Results come from TMDB (films, series; first 10) or Open Library (books; first 20) with a thumbnail (hotlinked from their CDN), title, year and creator. Tapping a result opens a confirm panel: initial status (Want by default, Reading/Watching, Read/Watched) and owned formats (books: paperback / hardcover / ebook / audiobook; films and series: DVD / Blu-ray / 4K Blu-ray / digital), then **Add to library**, which opens the new entry. Results already in the library show "In library →" and open that entry; adding twice returns the existing entry. **Add it by hand** (pre-filled with the search text): title (required), creators, year, comma-separated genres, plus status and formats. If a source fails, the error is shown and nothing is added.
- `/library/:id`: cover, title, other titles, year, creators, runtime / number of seasons / ISBN, genre pills (linking to the library filtered by that genre), synopsis, then:
  - status buttons: Want → **Start** ("Start reading" for books), **Already read/watched**, **Not for me**; In progress → (**+1 episode** for series), **Finish**, **Drop**; Done → **Read again / Watch again**; Dropped → **Resume**, **Finish**. A refused transition shows the server's message;
  - a 0.5–5 star rating with half stars; tapping the current value or **Clear** unrates;
  - notes, saved when the field loses focus ("Saved" for 2 s);
  - owned-format chips, saved on click;
  - series: current season and last episode watched, saved on change, with "of N" and a progress ring when the counts are known. On the last known episode a hint suggests finishing or moving to a new season by hand;
  - **Reads / Watches** history, open one first then newest: editable start/finish dates (saved on change), delete with confirmation, and a form to add a past one;
  - **Remove from library** (with confirmation), then back to `/library`.
  - Someone else's (or an unknown) id: "Entry not found".
- **Quick actions** on library cards: Want → Start; Dropped → Resume; books and films in progress → Finish; series in progress → +1 episode (Finish after the last known episode); nothing for Done.

### API (`/api/media`)

Every route needs a session (401) and the `media` app (403); unsafe ones also need CSRF (403). Library routes answer 404 for an entry (or session) that isn't the current user's.

| Endpoint | Body / query → result | Errors |
|---|---|---|
| `GET /search?type=&q=` | → up to 10 (TMDB) / 20 (Open Library) results `{source, external_id, type, title, year, creators, thumb_url, library_entry_id}` in the user's language | 422, 502 source failed or no TMDB token |
| `POST /library/from-search` | `{source, external_id, type, status?, owned_formats?}` → 201 new entry, or 200 the existing one | 422 (source/type mismatch), 502 |
| `POST /library/manual` | `{type, title, creators?, year?, genres?, status?, owned_formats?}` → 201 entry | 422 |
| `GET /library?type=&status=&owned=&genre=&q=&sort=` | → entry summaries | 422 |
| `GET /library/genres` | → distinct genres in the user's library, sorted case-insensitively | |
| `GET /library/{id}` | → entry detail | 404 |
| `PATCH /library/{id}` | any of `{rating, notes, owned_formats, current_season, current_episode}` (null clears) → entry | 404, 422 (season/episode on a non-series) |
| `DELETE /library/{id}` | → 204 (sessions deleted, catalog row kept) | 404 |
| `POST /library/{id}/start\|finish\|drop\|next-episode` | → entry | 404, 409 refused transition |
| `POST /library/{id}/sessions` | `{started_on?, finished_on?}` → 201 entry | 404, 409 second open session, 422 |
| `PUT /library/{id}/sessions/{sid}` | same → entry | 404, 409, 422 |
| `DELETE /library/{id}/sessions/{sid}` | → entry | 404 |
| `GET /items/{id}/cover` | → image bytes, `Cache-Control: private, max-age=31536000, immutable` | 404 no cover |

An entry summary is `{id, status, rating, owned_formats, current_season, current_episode, added_at, updated_at, last_finished_on, progress: {watched, total} | null, at_last_known_episode, item}`; the detail adds `notes` and `sessions: [{id, started_on, finished_on}]`. `item` is the catalog row (see data-model.md) plus `has_cover`.

### Validation

- Search: `type` one of book/film/series, `q` 1–200 chars. Books only from Open Library, films and series only from TMDB.
- Manual add: title trimmed, required; year 0–9999; genres non-empty, repeats dropped.
- Rating 1–10; formats from the list above; season 1–999, episode 0–9999 (series only).
- Sessions: `finished_on` not before `started_on` (also checked in the page so the message is translated); at most one open session.
