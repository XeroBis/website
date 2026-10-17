# Data Model

One Postgres database (`website`), one schema per app, plus `core` for what
every app shares. See `decisions.md` "One database, one schema per app".

All constraint/index names follow `core.database.NAMING_CONVENTION`
(`pk_<table>`, `fk_<table>_<col>_<referred>`, `uq_<table>_<col>`, `ix_…`, `ck_…`).

## `core`

| Table | Notes |
|---|---|
| `alembic_version` | Alembic's single migration pointer for the whole database. |
| `users` | Every account, for every app. |
| `revoked_tokens` | JWT denylist (logout, refresh rotation). |

Models in `backend/core/models.py`.

### `core.users`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | The FK target for every app's per-user rows (`core.users.id`). |
| `email` | text, unique, not null | Login identifier. Stored lowercased, so uniqueness is case-insensitive. |
| `hashed_password` | text, not null | argon2id (pwdlib). |
| `pseudo` | text, not null | Display name, 1–50 chars after trimming. Required at sign-up. |
| `language` | text, not null, default `'fr'` | `'en'` or `'fr'` (`ck_users_language`). |
| `is_admin` | boolean, not null, default `false` | Set only by `make seed-user`; read by `require_admin`. |
| `created_at` | timestamptz, not null, default `now()` | |

### `core.revoked_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `jti` | text, unique, not null | ID of a revoked access or refresh JWT. |
| `expires_at` | timestamptz, not null | The token's own `exp`; after it the row is useless. |

### Rules

- Logout revokes the request's access and refresh tokens. Refresh revokes the refresh token it consumed. A revoked token is rejected even before it expires.
- Rows past `expires_at` are deleted on every logout and refresh, so the table only holds tokens that are still live.
- No shadow `users` table in app schemas: apps FK to `core.users.id` and read pseudo/language from it.

## `portfolio`

No tables yet.

## `workout`

No tables yet.

## `cards`

No tables yet.

## `media`

No tables yet.

## Business rules (cross-schema)

- A table in an app schema may have a foreign key to `core` (e.g. `core.users.id`), never to another app's schema — apps stay independent of each other.
