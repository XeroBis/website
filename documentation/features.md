# Features

User-facing behaviour per app. An app that isn't migrated yet shows a
placeholder page (its name and whether `/api/health` answers) — see
`migration-plan.md`.

## Shared

- `GET /api/health` → `{"status": "ok"}` when the backend can reach the database (500 otherwise). Available on every host.
- **One login for every app** (see architecture.md "Session"). A page behind `authGuard` sends a logged-out visitor to the auth app's login page, and they come back to that page afterwards. `adminGuard` does the same, and sends a logged-in non-admin to the app's root.
- **Language**: the logged-in user's saved language (FR/EN). Logged out: the last language used on that site, then the browser's language if it's French or English, then French.
- Placeholder pages show who is logged in (pseudo and email) or a "Log in" link.
- **Header** (`ab-header`, used by portfolio): the app title linking home; the app's own links; an FR/EN switch, which saves the language on the account when logged in and otherwise only for that site; then the pseudo with an apps-grid icon button (the old workout navbar's, labelled "My account"), linking to the auth app's account page, which is the only place to log out), or "Log in" (auth app login, coming back to the current page).

## Auth — `auth.alanbignon.com`

### Pages

- `/login`: email + password. On success, goes to `?redirect=` if it is allowed, otherwise to the portfolio (`alanbignon.com`). Allowed in prod: `https://alanbignon.com` or `https://<anything>.alanbignon.com`, no port, no credentials in the URL. Allowed in dev: `http://localhost:4600`–`4604`. A visitor who is already logged in is sent on right away. Errors: invalid credentials, too many attempts, generic.
- `/signup` (invite-only): email, password (12+ chars), pseudo (required, ≤ 50), sign-up code. Success logs the user in and follows the same redirect rule. Errors: wrong code, email taken, invalid fields, too many attempts. `?redirect=` is kept when switching between login and sign-up.
- `/` (account, logged in only, otherwise `/login?redirect=` back here): pseudo and email, inline pseudo editing, language picker (Français/English, applied at once), links to portfolio/workout/cards/media, log out (then `/login`).
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

A user is `{id, email, pseudo, language, is_admin}`.

### Validation

- Email: valid address, compared and stored lowercased. A malformed email at login is just a 401.
- Password: at least 12 characters (sign-up and `make seed-user`; not re-checked at login).
- Pseudo: trimmed, 1–50 characters, required.
- Language: `en` or `fr`.
- CSRF: every unsafe request with a session needs `x-csrf-token` equal to the `csrf` cookie. The `@shared` interceptor adds it.

## Portfolio — `alanbignon.com`

A public list of the projects Alan has made, added and edited by hand by an admin (no GitHub sync). Nothing is imported from the old workout `projects` table. FR/EN.

### Pages

- **Every page**: the shared header (title "Alan Bignon"). Admins also get a "+ Project" link to `/admin/projects/new`. The footer links to GitHub (`github.com/XeroBis`) and LinkedIn (`linkedin.com/in/alan-bignon`). The intro, contact URLs and UI strings live in `src/i18n/*.json` and `app.ts`, not the database.
- `/` (public): name, subtitle and a short bio (from workout's old home page), then the projects in their public order (see data-model.md). Each card shows the name, a "Featured" badge when featured (the card is also highlighted), the description in the current language, tags, and a "Source code" link when there is one.
  - **Tag filter**: a chip row with "All" and every tag in use. Clicking a chip (or a tag on a card) sets `?tag=<name>` and shows only matching projects (case-insensitive). With no match, "No project with this tag". Filtering happens in the browser.
  - **Admins only**: "Edit" (→ `/admin/projects/:id`) and "Delete" on each card. Delete asks for confirmation and removes the card.
- `/admin/projects/new`, `/admin/projects/:id` (behind `adminGuard`: logged out → login, non-admin → `/`): one form with name, FR description, EN description, source code link, tags (comma-separated, with existing tags offered as clickable suggestions), position and featured. Save goes back to `/`. Errors: name taken, invalid fields, session expired or not admin, generic. An unknown id shows "Project not found".
- Any other path → `/`.
- SEO: static `<title>`, meta description, Open Graph tags and canonical URL in `index.html`. No prerendering (see ideas.md).

### API (`/api/portfolio`)

| Endpoint | Auth | Body → result | Errors |
|---|---|---|---|
| `GET /projects` | – | → every project, in public order | |
| `GET /projects/{id}` | – | → project | 404 |
| `GET /tags` | – | → names of tags in use, sorted case-insensitively | |
| `POST /projects` | admin + CSRF | project input → 201 project | 401, 403 (not admin / CSRF), 409 name taken, 422 |
| `PUT /projects/{id}` | admin + CSRF | project input (full replace) → project | 401, 403, 404, 409, 422 |
| `DELETE /projects/{id}` | admin + CSRF | → 204 | 401, 403, 404 |

A project is `{id, name, description_fr, description_en, repo_url, featured, position, tags: string[]}`. The input is the same without `id`: `repo_url`, `featured` (false), `position` (0) and `tags` ([]) are optional.

### Validation

- Name: trimmed, 1–100 chars, unique case-insensitively (409).
- Descriptions (FR and EN): both required, trimmed, 1–1000 chars.
- Source code link: optional; blank → none; otherwise `https://` + host, ≤ 300 chars, no spaces.
- Position: integer 0–10000.
- Tags: at most 10, each trimmed and 1–30 chars; repeats (case-insensitive) dropped. The form checks the same rules before sending.

## Workout — `workout.alanbignon.com`

Placeholder.

## Cards — `cards.alanbignon.com`

Placeholder.

## Media — `media.alanbignon.com`

Placeholder.
