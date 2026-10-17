# Features

User-facing behaviour per app. Every app currently shows a placeholder page
(its name and whether `/api/health` answers) until it is migrated — see
`migration-plan.md`.

## Shared

- `GET /api/health` → `{"status": "ok"}` when the backend can reach the database (500 otherwise). Available on every host.
- **One login for every app** (see architecture.md "Session"). A page behind `authGuard` sends a logged-out visitor to the auth app's login page, and they come back to that page afterwards. `adminGuard` does the same, and sends a logged-in non-admin to the app's root.
- **Language**: the logged-in user's saved language (FR/EN). Logged out: the last language used on that site, then the browser's language if it's French or English, then French.
- Placeholder pages show who is logged in (pseudo and email) or a "Log in" link.

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

Placeholder. Planned: a public list of projects Alan has made, added and edited manually by an admin (no GitHub sync). Nothing is imported from the old workout `projects` table.

## Workout — `workout.alanbignon.com`

Placeholder.

## Cards — `cards.alanbignon.com`

Placeholder.

## Media — `media.alanbignon.com`

Placeholder.
