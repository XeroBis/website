# Features

User-facing behaviour per app.

## Shared

- `GET /api/health` → `{"status": "ok"}` when the backend can reach the database (500 otherwise). Available on every host.
- **One login for every app** (see architecture.md "Session"). A page behind `authGuard` sends a logged-out visitor to the portfolio's home page (`alanbignon.com`), never to the login page; they log in from the header's "Log in" link. `adminGuard` does the same, and sends a logged-in non-admin to the app's root. `appGuard(app)` does the same, and sends a logged-in user without access to that app to the auth app's account page.
- **App access**: a new account can use no app. An admin grants apps per user (auth app, `/admin/users`). Admins can use every app. Workout, cards and media are entirely behind their grant (pages and API). The portfolio is public; its grant only allows editing projects.
- **Language**: the logged-in user's saved language (FR/EN). Logged out: the last language used on that site, then the browser's language if it's French or English, then French.
- **Theme**: System (follows the device), Light or Dark, one choice for every app. The logged-in user's saved theme; logged out, the last one picked on any `*.alanbignon.com` site (a cookie), else System. Every app has both a light and a dark look.
- Placeholder pages show who is logged in (pseudo and email) or a "Log in" link.
- **Header** (`ab-header`, used by portfolio, media, workout and cards): the app title linking home; the app's own links; an FR/EN switch, which saves the language on the account when logged in and otherwise only for that site; a theme button cycling System → Light → Dark (monitor, sun, moon icons; its label names the current theme), saved on the account when logged in and in a cookie for every site either way; then the pseudo with an apps-grid icon button (the old workout navbar's, labelled "My account"), linking to the auth app's account page, which is the only place to log out), or "Log in" (auth app login, coming back to the current page). On phones (≤ 720px) only the title and a menu button stay in the bar; the button opens a panel with the links (one per line), the FR/EN switch, the theme button and the session. Tapping a link, the title or Escape closes it.

## Auth — `auth.alanbignon.com`

### Look

Neo-brutalist: a cobalt grid background (midnight blue in dark), one card per page with thick borders and hard shadows, yellow buttons. The card is centred, and scrolls from its top when taller than the screen. On phones (≤ 480px) the card is tighter, inputs use 16px text (no zoom on focus), buttons, links and the users page's app checkboxes are about 44px tall (the checkboxes two per line), the language and theme buttons share the card's width under their label, and long pseudos and emails wrap. Hover effects on the account page's app links only apply with a mouse.

### Pages

- `/login`: email + password. On success, goes to `?redirect=` if it is allowed, otherwise to the portfolio (`alanbignon.com`). Allowed in prod: `https://alanbignon.com` or `https://<anything>.alanbignon.com`, no port, no credentials in the URL. Allowed in dev: `http://localhost:4600`–`4604`. A visitor who is already logged in is sent on right away. Errors: invalid credentials, too many attempts, generic.
- `/signup` (invite-only): email, password (12+ chars), pseudo (required, ≤ 50), sign-up code. Success logs the user in and follows the same redirect rule. Errors: wrong code, email taken, invalid fields, too many attempts. `?redirect=` is kept when switching between login and sign-up.
- `/` (account, logged in only, otherwise the portfolio): pseudo and email, inline pseudo editing, language picker (Français/English, applied at once), theme picker (System/Light/Dark, applied at once), links to the portfolio (always) and to the workout/cards/media apps the user has access to ("No other app yet" when none), a "Users" link for admins, log out (then `/login`).
- `/admin/users` (behind `adminGuard`: logged out → portfolio, not an admin → `/`): every user, oldest first, with pseudo, email and sign-up date. Each non-admin row has one checkbox per app (Portfolio (edit), Workout, Cards, Media); a click saves at once (the box is disabled while saving, and reverts with an error if the save fails). Admin rows show "Admin: all apps" instead of checkboxes.
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
| `PATCH /me/theme` | session + CSRF | `{theme: "system"\|"light"\|"dark"}` → user | 401, 403, 422 |
| `GET /users` | admin | → every user (with `created_at`), oldest first | 401, 403 |
| `PUT /users/{id}/apps` | admin + CSRF | `{apps: string[]}` (full replace) → user (with `created_at`) | 401, 403, 404, 422 |

A user is `{id, email, pseudo, language, theme, is_admin, apps}`. `apps` is what the user can use, sorted: their grants, or every app for an admin.

### Validation

- Email: valid address, compared and stored lowercased. A malformed email at login is just a 401.
- Password: at least 12 characters (sign-up, `make seed-user` and `make seed-basic-user`; not re-checked at login).
- Pseudo: trimmed, 1–50 characters, required.
- Language: `en` or `fr`.
- Theme: `system`, `light` or `dark`.
- Apps: each one of `portfolio`, `workout`, `cards`, `media`; repeats are dropped. Setting an admin's apps is allowed but changes nothing they can use.
- CSRF: every unsafe request with a session needs `x-csrf-token` equal to the `csrf` cookie. The `@shared` interceptor adds it.

## Portfolio — `alanbignon.com`

A public list of the projects Alan has made, added and edited by hand by its editors: users with the `portfolio` app, and admins (no GitHub sync). Nothing is imported from the old workout `projects` table. FR/EN.

### Pages

- **Every page**: the shared header (title "Alan Bignon"). Editors also get a "+ Project" link to `/admin/projects/new`. The footer links to GitHub (`github.com/XeroBis`) and LinkedIn (`linkedin.com/in/alan-bignon`). The intro, contact URLs and UI strings live in `src/i18n/*.json` and `app.ts`, not the database.
- `/` (public): name, subtitle and a short bio (from workout's old home page), then the projects in their public order (see data-model.md). Each card shows the name, a "Featured" badge when featured (the card is also highlighted), the description in the current language, tags, and a "Source code" link when there is one.
  - **Tag filter**: a chip row with "All" and every tag in use. Clicking a chip (or a tag on a card) sets `?tag=<name>` and shows only matching projects (case-insensitive). With no match, "No project with this tag". Filtering happens in the browser.
  - **Editors only**: "Edit" (→ `/admin/projects/:id`) and "Delete" on each card. Delete asks for confirmation and removes the card.
- `/admin/projects/new`, `/admin/projects/:id` (behind `appGuard('portfolio')`: logged out → the portfolio's home page, not an editor → auth app's account page): one form with name, FR description, EN description, source code link, tags (comma-separated, with existing tags offered as clickable suggestions), position and featured. Save goes back to `/`. Errors: name taken, invalid fields, session expired or not an editor, generic. An unknown id shows "Project not found".
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

A workout log: workouts made of exercises with their sets (and circuits), a shared exercise catalog, templates, saved circuits, a live session mode for the gym, a stats dashboard, and import/export. Ported from `workout` (see decisions.md for what changed). Every page is behind `appGuard('workout')` (logged out → portfolio; no workout access → the auth app's account page). FR/EN. Tables and rules: data-model.md `workout`.

### Look

"Old style, modernised": the old app's warm grey background and rose-brown accent, with white cards, soft warm shadows and rounded corners. Buttons, period pickers, badges and header links are pills, and calendar days are round. Manrope everywhere, with tabular digits so numbers line up. Dashboard totals are centred, in rose. Light (warm grey, white cards) or dark, per the shared theme switch (warm near-black, lighter rose accent). Strength is rose-brown, cardio sage green, circuits plum, on their badges and charts. Big tap targets on the session page. Installable to the phone's home screen (web manifest, the old app's "AB" icons), without a service worker. A browser still running the old app's cached copy switches to this one on its next visit, with one automatic reload.

### Shared parts

- **Header**: the shared header (title "Workout", links Dashboard, Workouts, Templates, Circuits, Exercises, Equipments, Data, and Admin for admins). The FR/EN switch saves the language on the account (the old app only showed it logged out).
- **Viewing someone else**: the Dashboard, Workouts and Templates pages have a "Viewing" select listing every workout user (pseudo), the current user first. Picking someone else shows their data read-only: no edit, delete, new or session buttons. Templates offer "Copy to my templates" instead. The choice is in the URL (`?user=<id>`); the exercises page's history shows your own sets.
- **Set display**: `12 reps @ 40 kg · 1min 30s · 9 km/h · difficulty 6 · 1.5km`, showing only the fields set. Durations as `1h 2min 3s`, distances in m under 1000, else km.
- **Muscle map**: front and back body SVGs, muscles shaded by intensity (1–3). Muscle names are translated. In forms, clicking a muscle cycles 1 → 2 → 3 → off; as a filter it toggles; read-only on details and the dashboard, where hovering (tapping on mobile) a muscle lists the exercises that worked it.
- **Exercise picker**: type-ahead over exercise names and muscles (every word must match).

### Pages

- `/` → `/dashboard`. Any other path → `/dashboard`.
- `/dashboard`: range presets 1 month / 3 months (default) / 6 months / 1 year (whole calendar months ending this month) / all, or custom from–to dates. Then: totals (workouts, exercises, volume as kg / t / Mt), an activity calendar (one month per card, days with a workout highlighted; clicking one opens `/workouts` scrolled to it), workouts per week and volume per week bar charts (scrolled together, year separators), strength progression for a picked exercise (max weight and estimated 1RM lines, needs two dates), top exercises (by times done), workouts per weekday, and the muscle map of the period. "No workout in this period" when empty.
- `/workouts`: completed workouts newest first, 20 at a time with infinite scroll, grouped by year / month (default) / week (toggles, combinable, collapsible groups with counts; with weeks on, a week sits only under the month and year of its Monday). **Filters** (a toolbar on/off icon button; open on arrival when the URL already filters, turning it off clears them): a row with an exercise (the exercise picker) and a from–to date range, with **Clear**; kept in the URL (`?exercise=<id>&from=<date>&to=<date>`, next to `?user=`). Each card starts collapsed: the date, then a line with the duration and the exercise and circuit names, truncated; tapping it shows its entries (the duration line stays, without the names) (circuits with their name, duration and rounds, sets). With an exercise filter, that exercise is highlighted in the names line and the entries. Buttons: **Repeat** (any workout, yours or the viewed user's: starts a live session from its entries, like a template, and opens `/session`; refused with a message while a session is running), and for your own **Edit** (both icon-only, named on hover), then a **⋯** menu with **Details** (muscle map + equipment of the selected exercises), **Save as template** (new, or replace one of yours) and **Delete**; someone else's card has **Details** next to **Repeat**. Delete removes the card at once and shows a "Workout deleted · **Undo**" bar for 6 s; the workout is deleted on the server only when the bar goes away (or the page is left), so Undo just puts the card back. Clicking an exercise name opens its history (every set of that exercise, newest first, for the viewed user). Toolbar: **Live session** and **New workout**.
- `/workouts/new`, `/workouts/:id/edit`: date, duration (minutes), optionally start from one of your templates, then the entries editor. Errors are shown per row ("Exercise 2: pick an exercise"). Someone else's or an unknown id: "Workout not found".
- **Entries editor** (workout, template and circuit forms): rows of exercise (picker + sets) or circuit (name, duration, rounds, its own exercise rows), reorderable with ▲▼, removable; sets show reps + weight (strength) or duration + distance (cardio) with **More fields** for the rest; **+ Set** copies the last one; **Insert saved circuit**. The form's **Save** sits next to **+ Exercise** / **+ Circuit**; on phones (≤ 560px) that bar stays at the bottom of the screen while scrolling the rows.
- `/session` (live session): with none running, pick one of your templates (or **Start blank**). Running: the elapsed time, **Finish** and **Discard** (each confirmed). The focused entry is shown large, the others as compact rows below (tap to focus; done ones get a ✓):
  - an exercise: a table of its sets with editable values and a ✓ button each; checking a set saves its edited values and starts a 90 s rest timer (with a bar and **Skip**); a checked set stays editable (saved on change); **+ Set**, remove a set, remove the exercise;
  - a circuit: "Round N / rounds", the member exercise currently up with its inputs and **Round done → next** (logs a checked set and moves to the next member), member pips to jump, the rounds logged so far, **+ Exercise** into the circuit; no rest timer;
  - **+ Exercise**, **+ Circuit** (blank, or a saved circuit);
  - when every standalone exercise is done, an "All done" banner with **Finish**.
  - Finish keeps only checked sets (see data-model.md) and opens `/workouts`. Checked sets are remembered in the browser, so reloading the page during a session keeps them.
- `/templates`: the viewed user's templates by name, collapsed by default (name, entry count and buttons; click the name to show or hide its entries), with a search box above them (every word must appear in the template's name, a circuit's name or an exercise's name). Each has **Details**, and for your own **Start session**, **Edit**, **Delete**; for someone else's, **Copy to my templates** (named like the original, with " (2)", " (3)"… if you already use that name). **New template** → `/templates/new`. `/templates/new`, `/templates/:id`: name + entries editor.
- `/circuits`: your saved circuits (name, duration, rounds, exercises with planned sets), **Edit**, **Delete**. `/circuits/new`, `/circuits/:id`: name (required), duration, rounds, exercise rows.
- `/exercises`: the catalog, filtered in the browser by name, type and muscles (map in toggle mode). Each row: name (opens its history), type badge, **Details** (muscle map and equipment). **New exercise** (any workout user, `/exercises/new`): name, type, muscles with intensity, equipment checkboxes. Admins also get **Edit** (`/exercises/:id`, same form) and **Delete** (refused with a message while the exercise is used).
- `/equipments`: the equipment list with a name filter; **New equipment** for everyone, inline **Edit** and **Delete** (confirmed) for admins.
- `/data`: your own import/export, one section each for workouts, templates and saved circuits: **Export** downloads `workouts.json` / `templates.json` / `circuits.json`; **Import** reads such a file (checked in the browser first, with the path of the first problem), then shows "N imported, M skipped" and the list of skipped items with the reason.
- `/admin` (admins; others → `/`): catalog import/export (`exercises.json`, `equipments.json`); workouts, templates and saved circuits import/export for the users ticked in a checklist (multi-user files, the old app's `[{user_email, workouts}]` / `[{user_email, templates}]`, and `[{user_email, circuits}]` (new)); **Delete all** workouts / templates / saved circuits of the ticked users, all exercises, all equipments (each confirmed).

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
| `POST /session` | `{template_id?}` or `{workout_id?, user_id?}` (a completed workout, yours or `user_id`'s) → 201 session | 404 template / workout, 409 one running, 422 both given |
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
| `GET /admin/circuits/export?user_ids` · `POST /admin/circuits/import` | admin; same for saved circuits | 403, 422 |
| `GET /admin/exercises/export` · `POST /admin/exercises/import` | admin; creates or updates by name → `{created, updated, skipped, ignored}` | 403, 422 |
| `GET /admin/equipments/export` · `POST /admin/equipments/import` | admin; existing names skipped | 403, 422 |
| `DELETE /admin/workouts?user_ids` · `DELETE /admin/templates?user_ids` · `DELETE /admin/circuits?user_ids` | admin → 204 | 403 |
| `DELETE /admin/exercises` · `DELETE /admin/equipments` | admin → 204 | 403, 409 an exercise is used |

A workout is `{id, user_id, status, date, duration_minutes, started_at, ended_at, exercises: [entry]}`; an entry is `{id, type: "exercise", exercise_id, exercise, sets: [{id, …set}]}` or `{id, type: "circuit", name, duration_minutes, rounds, exercises: [exercise entry]}`. Templates are `{id, user_id, name, exercises}`, saved circuits `{id, name, duration_minutes, rounds, exercises}`.

Stats: `{date_from, date_to` (the range used: the query's, else first and last workout), `workouts, exercises, volume_kg, days: [{date, workout_ids}], weeks: [{week_start, workouts, volume_kg}]` (every week of the range, Monday first, zeros included), `weekdays: [7 counts, Monday first], top_exercises: [{name, count}], muscles: [{name, total, exercises: [{name, count}]}], progression: [{exercise_id, name, points: [{date, max_weight_kg, est_1rm_kg}]}]}` (exercises with at least one weighted set, by name).

### Validation

- Exercise / equipment / template / circuit name: trimmed, 1–100 chars; exercise and equipment names unique case-insensitively, template and saved-circuit names per user (409).
- Exercise: type `strength` or `cardio`; muscles from the list, intensity 1–3, no repeats; at most 30 muscles and 20 equipments.
- Workout: date required, duration ≥ 1 minute; 1–100 entries; an exercise entry has 1–100 sets; a circuit 1–50 exercises, duration 1–1440 minutes, rounds 1–1000, name ≤ 100. Templates the same without date/duration. Sets: see the ranges in data-model.md. The forms check the same before sending.
- Import: a file must be a JSON list of the expected shape (422 otherwise); items failing per-item checks (unknown exercise, duplicate, unknown email, unknown muscle) are skipped and listed rather than failing the whole file.

## Cards — `cards.alanbignon.com`

A private card collection and deck tracker, ported from `pokemon_cards`. Personal pages require `appGuard('cards')`; catalog management also requires `adminGuard`. FR/EN interface and server-localized names/images follow the account's language. The web manifest and Poké Ball icons support home-screen installation, with no service worker. A browser still running the old app's cached copy switches to this one on its next visit, with one automatic reload; before, it looped between cards and the login page.

### Pages

- **Header**: the shared header titled "Pokemon Card Collection" (French: "Collection de cartes Pokémon"), with the old app's navbar, aligned right next to the FR/EN switch: Browse, Sets, Collection, then dropdowns Play (Decks, Combats), Track (What I Paid, Purchase lists, Missing cards), Tools (Converter, Shares) and, set apart by a divider, Manage (Catalog for admins, Gestion). The active page and its dropdown are underlined in the accent. One dropdown opens at a time; a link, a click outside or Escape closes it. On phones the dropdowns expand inline in the shared header's menu. Hidden on `/shared/:token` (no session, no way into the app).
- **Tab title**: "<page> · <app title>", both in the current language (detail pages use their section's: Sets, Decks, Purchase lists).
- `/browse`: catalog search, persisted set/name/number/type/rarity/print filters (the rarity and print rows are the set page's: the same icon buttons, each row led by an "all" button, nothing selected = all; the print row shows only Reverse and the ball reverses, plus any selected print; a "+N" button shows the others and "−" hides them again), server sorting and pagination, grid/table and variant display, card details, collection staging and batch add (optionally directly into a normal deck). Only admins can correct a catalog name.
- `/sets`, `/sets/:setCode`: series groups and completion, rarity/print filters, set cards in grid/checklist/nine-pocket views, exact-print quantities, duplicates/missing filters, missing-card text exports, and creating a share. The missing-cards export is one modal, opened from a set page (that set alone, with its missing count and %) or from the Sets page's header (several sets): prints (multi-select, Standard preselected) and rarities (multi-select, none = all), format, language, "Exclude cards in decks" and "Count incoming as owned"; on the Sets page, under the options, a set search and the set logos grouped by series (Sets page order), each with its missing count and % for those options, listing only sets with something missing and updating as the options change; any number of sets ticked. A series is collapsed by default (its header shows ticked/total sets and its missing count, a click opens it; a search opens every series with a match) and its checkbox ticks or unticks all its sets. The export, copied to the clipboard, is split into lists to import one at a time: a main list with the standard lines and the lines Cardmarket can tell apart (a print sold as an Additionals product, `(V.1) (<Set>: Additionals)`), then one list per other print (e.g. a plain reverse, whose line reads like the standard one, so its print is set by hand in Cardmarket; in TCGplayer format every non-standard print). Within a list, cards go by set, newest first, then by number. Each list is cut into blocks of 150 cards headed "<prints> i/n" (e.g. "Standard + Reverse Pokeball 1/2", "Reverse 2/3"), separated by a blank line. `/missing` lists missing numeric intervals for in-store checks. Cards on an incoming purchase list count as owned in the set page's missing filter, its missing exports and `/missing`; a "Count incoming as owned" toggle (on by default, remembered per browser, shared by those pages: a truck button next to the set page's missing filter, a checkbox in both missing exports, a chip on `/missing`) turns that off. On a set page a card with incoming copies of the shown print gets an "Incoming ×N" badge (French: "En route ×N"). The filter panel's top row holds the name search and a sort select, above the rarity and print rows; the sort orders the cards by number (default), name (as displayed) or quantity (owned copies across every print, minus deck copies while those are hidden), with an ascending/descending button (quantity starts most first); remembered per browser. A + or − leaves the order alone until the sort or the filters change, so the card doesn't jump away.
- `/collection`: search, filters (rarity and owned-print rows as on Browse, without the "+N" collapse), availability, variants, grid/table, quantity editing and deletion, card details/deck usage, and a staging panel for deck allocations. Collection history is in Gestion's Collection section.
- `/decks`, `/decks/:id`: normal/phantom decks, pasted decklists, posters, history, copy/rename/delete, per-print deck rows, phantom ownership/availability views, exports, and a locally sampled starting hand. Normal decks also have named upgrade drafts with editable deltas, paste/JSON diff, apply and single/combined text exports. `/convert` converts TCGplayer/Cardmarket lists with a card preview.
- `/combats`: log/edit/delete shared games, deck/player pickers, winner/prizes/date and frozen card snapshots. Deleted decks keep their historical snapshots and their combats remain editable.
- `/purchases`: What I Paid, with add/edit/delete, name search, sorting and a running total. `/purchase-lists` ("Liste d'achat"): the user's purchase lists, incoming first, then received, newest first, with their card count, status and total. "New list" asks for a name and an optional total, creates an empty list and opens it, to add its cards by hand. "Import Cardmarket order" picks a saved order page (`.html`, the article table), shows what it read (cards matched, lines not matched, Σ prices) in a dialog with the list name (default "Cardmarket <date>") and total (pre-filled with Σ prices, editable to add shipping), and the lines it couldn't match (to add by hand later), then creates the list and opens it. Neither creating nor receiving a list adds a What I Paid entry. `/purchase-lists/:id`: the cards, filtered in one panel: a top row with the name search and the sort, then the set pages' icons: a row of rarity categories, a row of prints, and a row of set symbols when the list spans several sets (each multi-select, offering only what's on the list, nothing selected = all; the view switch sits beside the panel). The sort is by number (the list's set-then-number order, default), name or quantity (a tile's copies across its prints, a line's own in the list view) with an ascending/descending button (quantity starts most first), remembered per browser and kept while a line's quantity changes. Three views, remembered per browser: grid (one tile per card with a badge per print bought, e.g. "×1" standard and "R×1" reverse, since one order can have the same card in both), list (one row per print with scan, name, set and number, print and quantity) and by set (the grid in one section per set with its card count, sets in the list's order, the sort applying within each). While incoming, in the list view each line's quantity and print can be changed or the line removed, a card added by hand (a wide dialog of fixed size: catalog search by name, a set picker and multi-select rarity and print chips (Standard, Reverse and the ball reverses; the other prints behind a "+N" button, "−" hides them again), any of which starts a search, with the previous results kept dimmed while the next load; then print, preselected when one print is filtered on, and quantity), the list renamed, and "Mark received" (with a confirmation) adds them to the collection. Received lists are read-only. Either can be deleted.
- `/shares`: create/list/revoke expiring set links (also available from Sets). `/shared/:token` is public, outside the app guard, with read-only cards and token-scoped scans/logo/symbol; unavailable links show the same message whether unknown, expired or revoked.
- `/gestion`: per-user collection, single/all-deck, combat and purchase JSON import/export, collection history and delete-all actions with two confirmations. Files are read as JSON before submission; malformed files and backend 409/422 refusals are shown. Combat bulk deletion is limited to the user's games except for admins.
- `/catalog-management` (admin): catalog counts (cards, sets, distinct names) as one line under the title, then three sections laid out alike (a header with its actions on the right, then rows under dividers). **Catalog refresh**: the full refresh is the header's button, each step a row with its status badge and Run button; while running a progress bar, then the run's counts as one muted line with the last run date (the previous run's after a reload; unavailable variant badges in amber). **Metadata**: import/export buttons. **Images**: filtered ZIP import/export; languages and image types as toggle chips, sets as a checkbox list in columns grouped by series (select all / clear). ZIP downloads stream through a normal link; uploads send the raw File with progress, then poll restoration/linking through completion. Opening the page reattaches to any running refresh/step/image job. All six steps remain available; Scan, embeddings and `/design` are absent.

### Look

"Old red, modernised": the old app's light grey and Poké Ball red (`#d6262a`), made more polished, light or dark per the shared theme switch (dark: neutral near-black, lighter red for text). White cards with soft shadows and rounded corners; buttons, inputs, view toggles and header links are pills. Fredoka for headings and the header title (with the Poké Ball beside it), Figtree for text, JetBrains Mono for card numbers. On hover a card tile lifts and a holo foil sweeps over the scan, different on each hover: a random pattern (rainbow band, light glare, rainbow stripes, prism or glitter), angle, colour shift and direction (no movement with reduced motion). Cards not owned are dimmed and greyed. A set page's grid view uses bigger cards than Browse and Collection (110px): up to 150px wide, the same whether only the standard print is selected or several prints show side by side in each card's group. The binder view shows three pages a row, sharing the page's full width (two below 1000px, one on phones); in a pocket the white − and + buttons sit on the card's left and right edges, centred on the scan (on hover with a mouse, always on touch screens), the ×N badge giving the count. The Poké Ball favicon and icons are kept.

### API (`/api/cards`)

Implemented: catalog, images, collection, decks, upgrade drafts, the decklist converter, combats, purchases, purchase lists, share links and catalog management, with the frontend above. Every route needs a session (401) and the `cards` app (403); unsafe ones also need CSRF (403). Catalog management needs an admin instead (403). The `public/...` routes need neither. Display fields (`name`, `set_name`, `image_path`) are in the user's language: French name / set title / scan when known, else English. Refused business rules are 409, invalid input 422.

An owned card (`/collection` responses) is `{id, catalog_id, quantity, created_at, name, set_name, set_code, card_number, image_path, supertype, rarity, series, card_count, release_date, variants: [{variant_type, quantity, image_path_fr, image_path_us}], allocated, allocated_variants: {print: copies}, available, decks: [{deck_id, deck_name, quantity_in_deck}]}`: `quantity` sums its prints, `allocated` the copies in normal decks, `available` = `quantity − allocated`; each print's scans come from its catalog variant (null for `standard`); `decks` sums each deck's copies over prints, by deck name.

A deck row (`DeckCardOut`) is `{id, card_id, catalog_id, variant_type, quantity_in_deck, poster_slot, name, set_name, set_code, card_number, image_path, supertype, available, owned, allocated_decks}`. Normal rows: `card_id` is the owned card, `available` = copies of that print outside every normal deck, `owned` null. Phantom rows: `card_id` null, `owned` = copies of that print owned, `available` = those not in a normal deck, `allocated_decks` = the normal decks holding them. A deck (`DeckOut`) is `{id, name, description, deck_type, has_wdc_cards, created_at, total_cards, poster_cards}` (poster rows by slot); `DeckDetailOut` adds `cards`. Deck limits (normal decks): ≤ 60 cards, ≤ 4 copies per card over its prints (Basic Energy unlimited), ≤ the print's available copies; refusals name the card. Pasted decklists (TCGplayer/PTCGL or Cardmarket, auto-detected) only keep matched lines, as the standard print. Text exports are English and render through the converter.

| Endpoint | Body / query → result | Errors |
|---|---|---|
| `GET /catalog?search=&set_code=&set_name=&supertype=&rarity=&card_number=&variant_type=&sort=&page=&page_size=` | → `{total, page, page_size, items}` (page size 1–200, default 50), each card with its `variants`. `search`: partial, case- and punctuation-insensitive (`’ ' . :`), on the English or French name; leading `^` / trailing `$` anchor it. `set_name` and `card_number` are partial; `supertype`, `rarity` (raw values) and `variant_type` (cards printed in it) are repeatable, OR within a filter, AND across. `sort`: `name_asc` (default) / `name_desc` / `card_number_asc` / `card_number_desc` / `set_release_asc` / `set_release_desc` / `set_name_asc` / `set_name_desc`; names sort by the displayed name, numbers numerically (non-numeric last), undated sets as the oldest; ties by number, name, then catalog id, so pages never overlap. | |
| `GET /catalog/sets?rarity=&variant_type=&reverse=` | → every set, newest first with World Championships sets last: `{set_code, set_name, set_name_fr, series, series_display_name, card_count, release_date, logo_path, logo_path_fr, symbol_path, completion_percent}`. Completion is the user's, over the selected cards (data-model.md `cards` "Rules"): by default normal numbering owned in any print (with `rarity`: all numbering); with `variant_type` each selected existing print counts on its own and needs that exact print; `reverse` does that over every print. `null` when nothing matches. | 422 unknown variant |
| `GET /catalog/sets/{set_code}/cards` | → the set's cards by number | 404 |
| `GET /catalog/missing-intervals?rarity=&variant_type=&reverse=&include_incoming=` | → per set with a missing selected card, sorted by set name: `{set_code, set_name, series, symbol_path, missing_count, intervals: [{start_number, end_number}], missing_numbers, owned_numbers, excluded_numbers}`. Numeric numbers only. Missing selected cards start and end intervals; other rarities can only bridge two of them; an owned selected card or a gap in the numbering cuts. A number shared by several cards stays missing until all are owned. `variant_type` (or `reverse` = `reverse`) only considers cards printed in it, owned in that exact print. `include_incoming` (default true): copies on incoming purchase lists count as owned. | 422 unknown variant |
| `GET /catalog/supertypes`, `/catalog/rarities` | → distinct values, sorted | |
| `GET /catalog/variant-types` | → non-standard prints present in the catalog, in display order | |
| `GET /catalog/{id}`, `/catalog/{id}/variants` | → one card (with `details`) / its prints | 404 |
| `PATCH /catalog/{id}` | `{name}` → the card. **Admin only**: corrects the English name (trimmed, not blank); the French one is untouched. | 403, 404, 422 |
| `GET /catalog/{id}/deck-usage` | → `{allocated_decks, phantom_decks}` of `{deck_id, deck_name, quantity_in_deck}`: the user's normal decks holding owned copies (summed over prints) and their phantom decks wanting it | 404 |
| `GET /collection?set_code=` | → every owned card (or one set's), unpaginated, by set then number | |
| `GET /collection/search?search=&set_code=&set_name=&supertype=&rarity=&card_number=&variant_type=&available=&sort=&page=&page_size=` | → `{total, page, page_size, total_quantity, collection_total_quantity, items}`: the catalog browse's filters and sorts over the user's cards, plus `variant_type` (owned in one of these prints) and `available` (`available`: a copy outside decks / `unavailable`: none). `total_quantity` sums the copies of every match, `collection_total_quantity` the whole collection's. | 422 |
| `GET /collection/filter-options` | → `{sets: [{set_code, set_name}], rarities, owned_variant_types}` over the whole collection, whatever the filters (sets by displayed name, prints other than `standard` in display order) | |
| `POST /collection` | `{catalog_id, variant_type = standard, quantity ≥ 1 = 1, all_variants}` → 201 the card. Adds on top of what's owned; `all_variants` adds `quantity` of every print the card comes in. | 404 card, 422 not a print of the card |
| `POST /collection/bulk` | `{items: [same as above], deck_id?}` → 201 each card once, in queue order. All or nothing; a card or print queued twice adds up. With `deck_id` (one of the user's normal decks) every added copy also goes into the deck in the same transaction (a print already there is raised), under the deck limits: ≤ 60 cards, ≤ 4 copies per card over its prints (Basic Energy unlimited), ≤ the print's available copies. | 404 card or deck, 409 a deck limit (naming the card), 422 unknown print, phantom deck, no items |
| `GET /collection/{id}` | → the card | 404 |
| `PUT /collection/{id}` | `{variant_type = standard, quantity ≥ 0}` → the card, or `null` once its last print is removed. Sets one print's quantity; 0 removes the print. | 404, 409 below the copies of that print in decks, 422 a positive quantity for a print the card doesn't come in |
| `DELETE /collection/{id}` | → 204, every print logged as removed | 404, 409 in a deck |
| `GET /collection/history?search=&page=&page_size=` | → `{total, page, page_size, items}` newest first (page size 1–200, default 50): `{id, catalog_id, variant_type, action, source, old_quantity, new_quantity, created_at, name, set_name, image_path}`. `search` matches the English or French name like the catalog search. | |
| `GET /collection/export` | → `collection.json`: `{cards: [{name, set_name, set_code, card_number, image_path, variants: [{variant_type, quantity}]}]}`, English values, by set then number | |
| `POST /collection/import` | that file as the JSON body → `{imported, imported_quantity}` (distinct cards, sum of their imported quantities). All or nothing. Matched by `image_path`; each listed print's quantity **replaces** the owned one, unlisted prints are kept; a repeated card or print: the last one wins. The old app's files import unchanged (their extra null `image_path_fr/us` are ignored). Refusals are logged. | 409 a quantity below what decks use, 422 empty file, unknown card or print, quantity < 1 (naming the card) |
| `DELETE /collection` | → `{deleted_cards, deleted_decks}`. Full reset: every owned card (each print logged as removed first), every deck of the user (with its cards, history and drafts) and every combat that used one of those decks, whoever played it. Other users' cards and decks are untouched. | |
| `GET /catalog/sets/missing/summary?rarity=&variant_type=&set_code=&exclude_deck_allocated=&include_incoming=` | → `[{set_code, missing, total, completion_percent}]`, one row per set with something missing (optionally only `set_code`s), counting one per (card, print) over the selected prints (default `standard`): `total` cards of the selected rarities printed in them, `missing` those the export below would list | 422 unknown variant |
| `POST /catalog/sets/missing/text?rarity=&variant_type=&format=&language=&exclude_deck_allocated=&include_incoming=` | `{set_codes}` → `text/plain`: for each selected print (default `standard`), one copy of every card of those sets printed in it that the user owns 0 times in that exact print, as a `cardmarket` (default) or `tcgplayer` list. Standard lines and Cardmarket lines naming an Additionals product share the main list; every other print has its own, after it, in display order. Lines by set (newest first, World Championships last, as on the Sets page), number, then print; each list cut into blocks of 150 headed `<Prints> i/n` (the prints present, joined by ` + `), separated by a blank line (empty when nothing is missing). `language` (`en` default / `fr`) picks the card names; moves and set titles stay English. A Cardmarket Additionals print (e.g. a ball reverse) names its version and Additionals expansion (data-model.md `cards` "Cardmarket Additionals"). `exclude_deck_allocated`: copies (of that print) in normal decks don't count. `include_incoming` (default true): copies on incoming purchase lists count as owned. | 404 naming the unknown sets, 422 no set or unknown variant |
| `GET /decks` | → the user's decks by name (`DeckOut`) | |
| `POST /decks` | `{name, description?, deck_type = normal \| phantom, decklist_text?}` → 201 `DeckOut`. Name trimmed, unique per user. With `decklist_text`, the matched cards go in, each in its line's print (standard unless a Cardmarket Additionals line names one) (normal: owned and under the limits, all or nothing; phantom: anything). The type can't change later. | 409 name taken, a limit, a card not owned; 422 blank name |
| `DELETE /decks` | → `{deleted_decks}`: every deck of the user, with its cards, history and drafts. Combats that used them keep their snapshots (deck set to null). The collection is untouched. | |
| `GET /decks/export` | → `decks.json`: `{decks: [deck file]}` by name. A deck file is `{name, description, deck_type, cards: [{name, set_code, card_number, variant_type, quantity_in_deck, poster_slot?}], drafts?: [{name, entries: [{name, set_code, card_number, variant_type, quantity_delta}]}]}`, English names, `drafts` left out when empty, `poster_slot` (0–2) only on the deck's poster cards (the hand fan). | |
| `POST /decks/import` | a deck file as the JSON body → 201 `DeckOut`. All or nothing. Cards matched by `(set_code, card_number)` (a repeated number: the lowest catalog id), then (normal) to the owned card; repeated cards add up. `deck_type` other than `phantom` (missing in old files, an old `wdc`) imports as normal. Drafts are recreated, each line's result within 0–4. Poster cards get their `poster_slot` back; a slot outside 0–2, already taken by an earlier card, or on a card already given one is ignored (the deck still imports). Old files import unchanged (extra `set_name`/`image_path` ignored). | 409 name taken, card not owned, a deck limit, a draft result outside 0–4; 422 unknown card or print, drafts on a phantom deck, two drafts with one name |
| `POST /decks/import-all` | `decks.json` as the body → 201 `[DeckOut]`, in file order, all or nothing; decks of the file share the available copies | same, plus 422 no decks / a name twice in the file |
| `GET /decks/{id}` | → `DeckDetailOut` | 404 |
| `PUT /decks/{id}` | `{name?, description?, poster_card_ids?}` → `DeckOut`. Only the fields sent change; a blank or null description clears it. `poster_card_ids`: up to 3 distinct row ids of this deck, in slot order (`[]` clears). Renames and description changes are logged. | 404, 409 name taken, 422 blank name, bad posters |
| `DELETE /decks/{id}` | → 204 (cards, history, drafts follow; combats keep their snapshots) | 404 |
| `GET /decks/{id}/history?page=&page_size=` | → `{total, page, page_size, items: [{id, deck_id, action, detail, old_value, new_value, variant_type, created_at}]}` newest first | 404 |
| `POST /decks/{id}/copy` | `{name}` → 201 `DeckOut`: same type, description and cards (not drafts or posters), logged as `copied`. A normal deck's copies must be available a second time, all or nothing. | 404, 409 name taken or not enough copies |
| `GET /decks/{id}/export?mode=` | → the deck file. `mode` (phantom decks only): `full` (default), `missing` (the shortfall against owned copies of each print), `not_available` (against copies outside normal decks); a covered card is left out | 404, 422 |
| `GET /decks/{id}/export/text?format=&mode=` | → `text/plain` TCGplayer/PTCGL (`tcgplayer`) or Cardmarket (`cardmarket`) list, same `mode` | 404, 422 |
| `POST /decks/{id}/cards` | `{card_id` (normal) or `catalog_id` (phantom)`, variant_type = standard, quantity_in_deck ≥ 1 = 1}` → 201 the row. Normal: under the deck limits. | 404 deck or card, 409 the print is already in the deck or a limit, 422 wrong key, not a print of the card |
| `POST /decks/{id}/cards/bulk` | `{items: [{card_id, variant_type, all_variants, quantity_in_deck}]}` → 201 `DeckDetailOut`: owned cards into a normal deck, all or nothing; repeats add up, a print already there is raised | 404 a card, 409 a limit, 422 phantom deck or a bad print |
| `POST /decks/{id}/cards/from-paste` | `{decklist_text}` → 201 `DeckDetailOut`: matched cards added on top, each in its line's print (normal: that print owned, under the limits, all or nothing) | 409, 422 nothing matched |
| `PUT /decks/{id}/cards/{row_id}` | `{quantity_in_deck ≥ 1}` → the row (phantom: the wanted count, no limits) | 404, 409 a limit |
| `DELETE /decks/{id}/cards/{row_id}` | → 204, frees its copies and poster slot | 404 |
| `GET /decks/{id}/drafts` | → `[{id, deck_id, name, created_at, updated_at, entry_count}]` last changed first. Drafts are for normal decks only. | 404, 422 phantom deck |
| `POST /decks/{id}/drafts` | `{name, decklist_text?}` → 201 the draft detail. With `decklist_text` (a decklist or a deck file's JSON), the lines are the diff, per print, turning the deck into that list (a plain line is the standard print, a Cardmarket Additionals line its ball or reverse, a deck file's card its `variant_type`); the 0–4 check counts a card's prints together. Name trimmed, unique per deck. | 404, 409 name taken or a result outside 0–4, 422 blank name, nothing matched |
| `GET /decks/{id}/drafts/{draft_id}` | → `{id, deck_id, name, created_at, updated_at, current_cards: [DeckCardOut], entries: [{catalog_id, variant_type, name, set_name, image_path, supertype, baseline_quantity, quantity_delta, result_quantity, owned, available}], result_cards: [{catalog_id, variant_type, name, set_name, image_path, supertype, quantity_in_deck}], result_total, can_apply}`. `available` keeps one copy back for the binder; `can_apply` = some line, ≤ 60 cards, every addition covered. | 404 |
| `PUT /decks/{id}/drafts/{draft_id}` | `{name}` → the draft summary | 404, 409, 422 |
| `DELETE /decks/{id}/drafts/{draft_id}` | → 204 | 404 |
| `PUT /decks/{id}/drafts/{draft_id}/paste` | `{decklist_text}` → detail: the lines replaced by the diff | 404, 409 a result outside 0–4, 422 nothing matched |
| `PUT /decks/{id}/drafts/{draft_id}/entries/{catalog_id}?variant_type=` | `{quantity_delta ≠ 0}` → detail: sets the line of that print of any catalog card; deck quantity + delta within 0–4 (Basic Energy unlimited) | 404 draft or card, 409 out of range, 422 zero, not a print |
| `DELETE /decks/{id}/drafts/{draft_id}/entries/{catalog_id}?variant_type=` | → detail | 404 |
| `POST /decks/{id}/drafts/{draft_id}/apply` | → `DeckDetailOut`: every line applied to the deck as it is now, all or nothing, under the deck limits, an addition also keeping the binder copy back; each change logged, the draft deleted | 404, 409 naming the card (out of date, not owned, a limit, no lines) |
| `GET /decks/{id}/drafts/{draft_id}/export/text?format=&mode=&include_sets=` | → `text/plain`: the proposed additions still needed (removals never listed). `mode` (required): `full`, `missing` (minus owned copies), `not_available` (minus copies outside normal decks), `reserve_singles` (the same minus the binder copy). `include_sets` (default true) only affects Cardmarket. | 404, 422 |
| `GET /drafts` | → every draft of the user's normal decks, last changed first: `{id, deck_id, deck_name, name, updated_at, result_total}` (the deck's count once applied) | |
| `POST /drafts/export/text?format=&mode=&include_sets=&language=` | `{draft_ids}` → the same export over several drafts (any of the user's decks), demand pooled per print before comparing with owned copies, so one copy never covers two drafts. `language` (`en` / `fr`) picks the card names. | 404 a draft not the user's, 422 |
| `POST /convert/decklist` | `{text, include_sets = true}` → `{detected_format: tcgplayer \| cardmarket \| null, converted_text, entries: [{quantity, matched, name, set_name, set_code, card_number, image_path, catalog_id}]}`. Read-only. Lines matched against the catalog (TCGplayer by set code + number, padding and case ignored; Cardmarket by name, then set code or title, then the bracketed moves, a tie going to the latest print, lowest number; a `(V.n) (<Set>: Additionals)` line is that set's card in the print its version names, see data-model.md `cards` "Cardmarket Additionals") and rendered in the other format, English (an unmatched line keeps its parsed name, `??? ?` in TCGplayer). `entries` show cards in the user's language. Text in neither format → null and nothing. | 422 |
| `GET /images/{path}` | → a file under `CARDS_DATA_DIR` (scan, thumbnail, logo, symbol), `Cache-Control: private, max-age=31536000, immutable` | 404 missing, or a path leaving the folder |
| `GET /decks/combat-options` | → every cards user's normal decks, for the combat deck pickers: `[{id, name, deck_type, has_wdc_cards, owner_id, owner_label}]` (`owner_label` = the owner's pseudo), by name then owner; never their cards | |
| `GET /users` | → `[{id, pseudo}]`: everyone with the `cards` app (grant or admin), current user first, then by pseudo. For the combat player pickers. | |
| `GET /combats` | → every combat (the log is shared between cards users), played date newest first: `{id, deck_a_id, deck_a_name, player_a_id, player_a_pseudo, deck_b_id, deck_b_name, player_b_id, player_b_pseudo, winner, loser_score, played_at, created_at, deck_a_snapshot, deck_b_snapshot}`. `deck_*_name` is the deck's current name, or the name it had when it was set once deleted (`deck_*_id` null). Snapshot cards `{card_id, variant_type, quantity_in_deck, name, set_name, image_path, supertype}` are in the user's language (matched to the catalog by `image_path`; unknown ones stay as stored). | |
| `POST /combats` | `{deck_a_id, player_a_id, deck_b_id, player_b_id, winner: a \| b, loser_score 1–6, played_at?}` → 201 the combat. Any cards user's normal decks (the same one twice is fine) and any cards users as players (not necessarily the owners). Each side's cards and deck name are frozen now. `played_at`: a date (a datetime keeps its UTC date), default today. | 404 deck or player (also one without the `cards` app), 422 phantom deck, score, winner |
| `PUT /combats/{id}` | every field, as above (`played_at` required) → the combat. Any cards user may edit any combat. A side whose deck changes is snapshotted again; an unchanged side keeps its snapshot. `deck_*_id` null only for a side whose deck was deleted. | 404, 422 |
| `DELETE /combats/{id}` | → 204 (any cards user) | 404 |
| `DELETE /combats` | → `{deleted_combats}`: the combats the user played (either side); an admin deletes every combat. Decks and the collection are untouched. | |
| `GET /combats/export` | → `combats.json`: `{combats: [{deck_a_name, deck_a_owner_email, player_a_email, player_a_pseudo, deck_b_…, winner, loser_score, played_at, deck_a_snapshot, deck_b_snapshot}]}`, every combat newest first, snapshots as stored (English); a deleted deck has no owner email | |
| `POST /combats/import-all` | that file as the body → 201 the combats, in file order, all or nothing. Players matched by email (case-insensitive) among cards users; decks among cards users' normal decks by name + owner email (no email, as in old files: the oldest deck of that name). A side whose deck isn't found imports from its snapshot with no deck; a missing snapshot is taken from the matched deck. A snapshot card whose `image_path` isn't in the catalog (old files still carry the old app's pre-reset scraper paths, `images/<Set>_<CODE>_<CODE>/<Name>_<CODE>_<number>[_US].jpg`) is pointed at a scanned catalog card: same set code and number if the names agree (or both are energies), else the same name in that set, else in the newest set (names compared ignoring `’`/`'`, hyphens and dropped suffixes like "Professor Sada" or "SWSH154"). Unmatched cards and every other field import unchanged. | 422 naming the combat (unknown player, unknown deck without a snapshot), bad score/winner/date, no combats |
| `GET /purchases` | → the user's purchases, purchase date newest first: `{id, product_name, price, quantity, purchased_at, source, description, sets, created_at}` (`price` a decimal string) | |
| `POST /purchases` | `{product_name, price ≥ 0 (≤ 2 decimals, the entry's total), quantity ≥ 1 = 1, purchased_at? (date, default today), source?, description?, sets: [set code]}` → 201. Texts trimmed, blank → null; sets trimmed, blanks and repeats dropped, not checked against the catalog. | 422 |
| `PUT /purchases/{id}` | every field (`quantity`, `purchased_at` required) → the purchase | 404, 422 |
| `DELETE /purchases/{id}` | → 204 | 404 |
| `DELETE /purchases` | → `{deleted_purchases}`: every purchase of the user | |
| `GET /purchases/export` | → `purchases.json`: `{purchases: [{product_name, price, quantity, purchased_at, source, description, sets}]}` newest first | |
| `POST /purchases/import-all` | that file as the body → 201 the new purchases, in file order, all or nothing (same validation, `purchased_at` required). Old files import unchanged. | 422 |
| `GET /purchase-lists` | → the user's lists, incoming first then received, newest first: `{id, name, created_at, updated_at, received_at, price, total_cards, total_quantity}` (distinct lines, Σ quantity; `price` the total entered, or null) | |
| `POST /purchase-lists` | `{name, price?}` → 201 the detail, empty. Name trimmed, unique per user. | 409 name taken, 422 blank name, bad price |
| `GET /purchase-lists/incoming?set_code=` | → `[{catalog_id, variant_type, quantity}]`: incoming copies per print over every incoming list (or one set's) | |
| `POST /purchase-lists/cardmarket/preview` | `{html}` → `{total_quantity, total_price, set_codes, lines: [{quantity, unit_price, label, matched, catalog_id, variant_type, name, set_code, card_number, image_path}]}`: the order read as the import would, nothing saved (`label` is Cardmarket's name, `name` the catalog's in the user's language) | 422 no article rows |
| `POST /purchase-lists/cardmarket` | `{html, name, price}` → 201 `{purchase_list, unmatched: [{quantity, label, reason}]}`: the list (`PurchaseListDetailOut`). Name trimmed, unique per user. | 409 name taken, 422 no article rows, nothing matched, blank name, bad price |
| `GET /purchase-lists/{id}` | → the list plus `cards: [{id, catalog_id, variant_type, quantity, name, set_name, set_code, card_number, image_path, supertype, rarity, variants: [print]}]` by set then number (`variants`: the prints the card comes in) | 404 |
| `PUT /purchase-lists/{id}` | `{name}` → the detail | 404, 409 name taken, 422 |
| `DELETE /purchase-lists/{id}` | → 204; its cards follow | 404 |
| `POST /purchase-lists/{id}/cards` | `{catalog_id, variant_type = standard, quantity ≥ 1 = 1}` → 201 the detail; adds onto a line of that print | 404 list or card, 409 received, 422 not a print of the card |
| `PUT /purchase-lists/{id}/cards/{row_id}` | `{variant_type, quantity ≥ 1}` → the detail; a new print merges into that print's line | 404, 409 received, 422 not a print of the card |
| `DELETE /purchase-lists/{id}/cards/{row_id}` | → 204 | 404, 409 received |
| `POST /purchase-lists/{id}/receive` | → the detail: every line added to the collection (history source `purchase`), `received_at` set, all or nothing | 404, 409 already received |
| `POST /shares` | `{set_code, duration_days: 1 \| 3 \| 7 \| 30}` → 201 `{id, set_code, set_name, token, created_at, expires_at, revoked_at, status: active \| expired \| revoked}` (`set_name` in the user's language) | 404 set, 422 duration |
| `GET /shares` | → the user's links, newest first, any status | |
| `DELETE /shares/{id}` | → the link, revoked (again: unchanged). The row is kept. | 404 not the user's |
| `GET /public/shares/{token}` | **No auth.** → `{set_code, set_name, series, card_count, release_date, expires_at, cards: [{id, name, set_code, set_name, card_number, image_path, rarity, supertype, quantity_owned, variants: [{variant_type, quantity, image_path_fr, image_path_us}], print_variants: [{variant_type, image_path_fr, image_path_us}]}]}`: the set by number with what the owner has now, English values, nothing about the owner | 404 unknown, expired or revoked (identical) |
| `GET /public/shares/{token}/images/{path}`, `/logo`, `/symbol` | **No auth.** → a scan or thumbnail of a card or print of that set (thumbnail = its scan's path with `/thumbnails/`), the set logo (English, else French) or symbol; `Cache-Control: private, max-age=300`, so they stop showing within 5 minutes of the link expiring or being revoked (the set itself is never cached) | 404 as above, a file of another set, missing, or leaving `CARDS_DATA_DIR` |
| `GET /catalog/stats` | **Admin.** → `{total_cards, total_sets, distinct_card_names, variant_counts: {print: catalog prints}}` (`standard` included) | 403 |
| `POST /catalog/refresh` | **Admin.** → 202 `{status: "started"}`: every refresh step in order in the background (scans and thumbnails side by side); stops at the first failing step. Poll the status. One catalog job at a time (refresh step, full refresh, metadata or images import). | 409 a job running |
| `GET /catalog/refresh/status`, `/catalog/refresh/steps/{step}/status`, `/catalog/import/images/status` | **Admin.** → `{status: idle \| running \| done \| error, step, step_label, step_index, total_steps, percent, sub_done, sub_total, result, error, last_run_at, last_run_result}` (in memory, reset on restart). The full refresh shows its current step and N/6, plus that step's done/total; each step's own status is kept up to date however it was started. `result` holds the step's counters. | 404 unknown step |
| `POST /catalog/refresh/steps/{step}` | **Admin.** → 202, one step alone in the background: `import_html` (catalog + prints from the saved HTML, no network → `{sets_processed, cards_upserted}`), `import_card_details` (TCGdex text, cards without details → `{matched, unmatched, skipped, failed, french_missing}`), `scrape_images` (missing scans, every print, EN + FR → `{images_downloaded}` cards), `generate_thumbnails` (→ `{thumbnails_generated}`), `scrape_logos_symbols` (→ `{set_logos_updated}` sets), `download_variant_icons` (badges the HTML shows → `{variant_icons_downloaded, variant_icons_unavailable: [file]}`). Every step only fills what's missing, so a rerun is safe. | 404 unknown step, 409 a job running |
| `GET /catalog/export` | **Admin.** → `cards_metadata.json`: `{total_cards, cards: [{pokemon_name, display_name, details, set_name, set_name_fr, set_code, card_number, local_path, card_page_url, supertype, rarity, series, card_count, release_date, image_path_fr, variants: [{variant_type, image_path_fr, image_path_us}]}]}` by id, the old app's format | |
| `POST /catalog/import/metadata` | **Admin.** That file as the JSON body → `{created, updated}`. All or nothing; merged by `(set_code, card_number)`, ids kept, cards and prints missing from the file kept (data-model.md `cards` "Rules"). Old files import unchanged (without `display_name`: stored French names kept). | 409 an image path of another card, a pair matching several cards, a job running; 422 empty file, `total_cards` ≠ the cards, blank name/set/number/path, a card or path twice, unknown or repeated print |
| `GET /catalog/export/images?french=&english=&standard=&variants=&logos=&symbols=&set_code=` | **Admin.** → `card_images.zip`, streamed as it's written (stored, not compressed), the files' paths under `CARDS_DATA_DIR` kept. Filters (all `true` by default, `set_code` repeatable, default every set): language (`_EN` / `_FR`), `standard` = standard scans + their thumbnails, `variants` = other prints' scans, `logos`, `symbols` (language-neutral). Badges and the TCGdex cache are never included. | 404 nothing selected |
| `POST /catalog/import/images?<same filters>` | **Admin.** The zip itself as the raw body (`Content-Type: application/zip`, up to 4 GB through nginx) → 202 once received; then in the background (poll the status): the selected entries are restored (files already there kept, entries leaving the folder skipped) and pending or missing catalog scan paths linked to restored files. Status steps `upload` (bytes received / `Content-Length`), `restore` (entries), `link` (cards); result `{copied, skipped, linked}`. | 409 a job running, 422 not a zip |
| `GET /public/variant-icons/{file}` | **No auth.** → a print badge (`standard.svg`, `reverse.svg`, `<print>.png`), `Cache-Control: public, max-age=86400`; while not downloaded yet, a grey placeholder SVG with the pokecardex version id, `no-store` | 404 not a known badge |

## Media — `media.alanbignon.com`

A personal tracker for books, films and series: what I own, what I've read/watched, what's next. Ported from `media` (see decisions.md for what changed). Every page is behind `appGuard('media')` (logged out → portfolio; no media access → the auth app's account page); each user has their own library. FR/EN. Tables and rules: data-model.md `media`.

### Look

"Library paper": cream paper background, ink text, Fraunces serif headings, Inter for the UI, an oxblood accent. Dark ("library at night"): ink-brown paper, cream text, lighter oxblood, teal and ochre. Each type has its own accent (books oxblood, films teal, series ochre) on its chips, type pill and the placeholder covers. Posters are 2:3 with a soft shadow; without a cover, a placeholder in the item's own hue (stable per item) shows the type icon, title and creators. Icons are inline SVGs (`ab-icon` from `@shared`). The footer credits TMDB ("This product uses the TMDB API but is not endorsed or certified by TMDB", required by TMDB's terms) and Open Library.

### Language

- The UI, titles and synopses follow the current language (`LanguageService`: the header's FR/EN switch changes it live and saves it on the account). French viewers see `title_fr` / `synopsis_fr` when known, else the default (English) ones. The detail page lists the other-language and original titles under the title when they differ.
- Search results on the Add page and the library's title sort use the account's saved language. Genres and creators stay as the source gives them (genres are English).

### Pages

- **Every page**: the shared header (title "Media", links Library and Add) and the credits footer. On phones the links are in the shared header's menu.
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
