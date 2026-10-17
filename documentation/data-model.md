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

The projects shown on `alanbignon.com`, written by hand by an admin. No user FK: there is only one portfolio, and only admins write to it (`require_admin`). Models in `backend/domains/portfolio/models.py`.

### `portfolio.projects`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `name` | text, not null | 1–100 chars, trimmed. Unique case-insensitively (`uq_projects_name_lower`, unique index on `lower(name)`). Not translated (a proper noun). |
| `description_fr` | text, not null | 1–1000 chars, trimmed. |
| `description_en` | text, not null | 1–1000 chars, trimmed. |
| `repo_url` | text, null | Source code link, any `https://` URL (GitHub, GitLab…), ≤ 300 chars. Empty → null. |
| `featured` | boolean, not null, default `false` | Visual highlight only, doesn't change the order. |
| `position` | integer, not null, default `0` | Manual order, lowest first, 0–10000 (`ck_projects_position` checks ≥ 0). |
| `created_at` | timestamptz, not null, default `now()` | |
| `updated_at` | timestamptz, not null, default `now()` | Set to `now()` on every update. |

### `portfolio.tags`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `name` | text, not null | 1–30 chars, trimmed. Unique case-insensitively (`uq_tags_name_lower`). Keeps the casing it was first typed with. |

### `portfolio.project_tags`

| Column | Type | Notes |
|---|---|---|
| `project_id` | integer, PK, FK → `portfolio.projects.id` `ON DELETE CASCADE` | |
| `tag_id` | integer, PK, FK → `portfolio.tags.id` `ON DELETE CASCADE` | |

### Rules

- Tags are free text, attached by name: a name matching an existing tag case-insensitively reuses it, any other creates a tag. Repeats within one project are dropped. At most 10 tags per project.
- A tag with no project left (after an update or a delete) is deleted in the same transaction, so `tags` only holds tags in use.
- Public order: `position` ascending, then newest (`id` descending) on ties. A project's tags are sorted case-insensitively.

## `workout`

No tables yet.

## `cards`

No tables yet.

## `media`

No tables yet.

## Business rules (cross-schema)

- A table in an app schema may have a foreign key to `core` (e.g. `core.users.id`), never to another app's schema — apps stay independent of each other.
