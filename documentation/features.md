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
- **Header** (`ab-header`, used by portfolio and media): the app title linking home; the app's own links; an FR/EN switch, which saves the language on the account when logged in and otherwise only for that site; then the pseudo with an apps-grid icon button (the old workout navbar's, labelled "My account"), linking to the auth app's account page, which is the only place to log out), or "Log in" (auth app login, coming back to the current page).

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
- Password: at least 12 characters (sign-up and `make seed-user`; not re-checked at login).
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

Placeholder, behind `appGuard`.

## Cards — `cards.alanbignon.com`

Placeholder, behind `appGuard`.

## Media — `media.alanbignon.com`

A personal tracker for books, films and series: what I own, what I've read/watched, what's next. Ported from `../media` (see decisions.md for what changed). Every page is behind `appGuard('media')` (logged out → login; no media access → the auth app's account page); each user has their own library. FR/EN. Tables and rules: data-model.md `media`.

### Look

"Library paper": cream paper background, ink text, Fraunces serif headings, Inter for the UI, an oxblood accent. Each type has its own accent (books oxblood, films teal, series ochre) on its chips, type pill and the placeholder covers. Posters are 2:3 with a soft shadow; without a cover, a placeholder in the item's own hue (stable per item) shows the type icon, title and creators. Icons are inline SVGs (`ab-icon` from `@shared`). The footer credits TMDB ("This product uses the TMDB API but is not endorsed or certified by TMDB", required by TMDB's terms) and Open Library.

### Language

- The UI, titles and synopses follow the current language (`LanguageService`: the header's FR/EN switch changes it live and saves it on the account). French viewers see `title_fr` / `synopsis_fr` when known, else the default (English) ones. The detail page lists the other-language and original titles under the title when they differ.
- Search results on the Add page and the library's title sort use the account's saved language. Genres and creators stay as the source gives them (genres are English).

### Pages

- **Every page**: the shared header (title "Media", links Library and Add) and the credits footer.
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
