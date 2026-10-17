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
| `user_apps` | Which apps each user may use (access grants). |
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

### `core.user_apps`

| Column | Type | Notes |
|---|---|---|
| `user_id` | integer, PK, FK → `core.users.id` `ON DELETE CASCADE` | |
| `app` | text, PK | `'portfolio'`, `'workout'`, `'cards'` or `'media'` (`ck_user_apps_app`). |

### `core.revoked_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `jti` | text, unique, not null | ID of a revoked access or refresh JWT. |
| `expires_at` | timestamptz, not null | The token's own `exp`; after it the row is useless. |

### Rules

- Logout revokes the request's access and refresh tokens. Refresh revokes the refresh token it consumed. A revoked token is rejected even before it expires.
- Rows past `expires_at` are deleted on every logout and refresh, so the table only holds tokens that are still live.
- **App access**: a user can use an app only with a `user_apps` row for it. A new account has none (access to 0 apps). Admins (`is_admin`) have every app without rows. `portfolio` is special: the portfolio is public, and the grant only allows creating, editing and deleting projects. The auth app is always open to any logged-in user.
- No shadow `users` table in app schemas: apps FK to `core.users.id` and read pseudo/language from it.

## `portfolio`

The projects shown on `alanbignon.com`, written by hand by its editors. No user FK: there is only one portfolio, and only users with the `portfolio` app (or admins) write to it (`require_app("portfolio")`). Models in `backend/domains/portfolio/models.py`.

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

Workout tracker (ported from `../workout`). One shared catalog of exercises and equipments; everything else belongs to a user (`core.users.id`): logged workouts, templates and saved circuits. Workouts, templates and saved circuits share one shape: an ordered list of **entries**, each either one exercise with its sets, or a circuit (name, duration, rounds) holding exercises with their sets. Models in `backend/domains/workout/models.py`.

### Catalog

#### `workout.exercises`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `name` | text, not null | 1–100 chars, trimmed. Unique case-insensitively (`uq_exercises_name_lower`). Matched case-insensitively by imports. |
| `type` | text, not null | `strength` or `cardio` (`ck_exercises_type`). Only a label/filter: any set field can be used with either. |

#### `workout.exercise_muscles`

| Column | Type | Notes |
|---|---|---|
| `exercise_id` | integer, PK, FK → `workout.exercises.id` `ON DELETE CASCADE` | |
| `muscle` | text, PK | One of the 16 muscles of the body map (`ck_exercise_muscles_muscle`): Abdominals, Biceps, Calves, Chest, Forearms, Front shoulders, Glutes, Hamstrings, Lats, Lower back, Obliques, Quads, Rear shoulders, Traps, Traps middle, Triceps. |
| `intensity` | smallint, not null | 1–3 (`ck_exercise_muscles_intensity`). |

The muscle list is fixed in code (`domains/workout/muscles.py`), so there is no `muscles` table (workout had one, always holding exactly that list).

#### `workout.equipments` / `workout.exercise_equipments`

`equipments`: `id`, `name` (1–100 chars, trimmed, unique case-insensitively, `uq_equipments_name_lower`). `exercise_equipments`: `(exercise_id, equipment_id)` PK, both FKs `ON DELETE CASCADE` (deleting an equipment unlinks it from its exercises).

### Workouts

#### `workout.workouts`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `user_id` | integer, FK → `core.users.id` `ON DELETE CASCADE`, not null | |
| `status` | text, not null, default `completed` | `in_progress` (a live session) or `completed` (`ck_workouts_status`). |
| `date` | date, null | Null only while `in_progress`. |
| `duration_minutes` | integer, null | ≥ 1. Null only while `in_progress`. |
| `started_at` / `ended_at` | timestamptz, null | Set by live sessions only. |

Index `ix_workouts_user_id_date` on `(user_id, date)`. Partial unique index `uq_workouts_one_in_progress` on `user_id` where `status = 'in_progress'`: one live session per user.

#### `workout.workout_circuits`

`id`, `workout_id` (FK `ON DELETE CASCADE`), `name` (≤ 100, null), `duration_minutes` (1–1440, null), `rounds` (1–1000, null), `position` (integer, not null).

#### `workout.workout_exercises`

`id`, `workout_id` (FK `ON DELETE CASCADE`), `exercise_id` (FK → `workout.exercises.id`, **no cascade**: an exercise in use can't be deleted), `circuit_id` (FK → `workout_circuits.id` `ON DELETE CASCADE`, null = a top-level entry), `position` (integer: the entry's place among the workout's top-level entries, or the exercise's place inside its circuit).

#### `workout.workout_sets`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | Sets are ordered by `id`. |
| `workout_exercise_id` | integer, FK `ON DELETE CASCADE`, indexed | |
| `reps` | integer, null | 1–10000 |
| `weight_kg` | double, null | −1500–1500 (negative = assisted) |
| `duration_s` | integer, null | 1–86400 |
| `distance_m` | double, null | 0–100000 |
| `speed_kmh` | double, null | 0–500 |
| `difficulty` | double, null | 0–100 |

Every field is optional, so one set shape covers strength (reps × weight), cardio (duration, distance, speed) and anything in between.

### Templates and saved circuits

Same shape as workouts, per user:
- `workout.templates` (`id`, `user_id` FK `ON DELETE CASCADE`, `name`), `template_circuits`, `template_exercises`, `template_sets`: the same columns as their `workout_*` counterparts, with `template_id`.
- `workout.saved_circuits` (`id`, `user_id`, `name`, `duration_minutes`, `rounds`): one reusable circuit; `saved_circuit_exercises` (`circuit_id`, `exercise_id`, `position`) and `saved_circuit_sets`.

`name` is 1–100 chars, trimmed, unique per user case-insensitively (`uq_templates_user_id_name_lower`, `uq_saved_circuits_user_id_name_lower`).

### Rules

- **Scoping**: every route needs the `workout` app (grant or admin). Writes only ever touch the current user's rows; anyone else's workout, template, circuit or set is a 404.
- **Read-only sharing**: any workout user can read another workout user's completed workouts, stats and templates (not their saved circuits or live session), by passing `user_id`. A `user_id` who can't use workout is a 404.
- **Catalog**: shared by every workout user. Any workout user can add an exercise or equipment; only admins edit or delete them. An exercise used by a workout, template or saved circuit can't be deleted (409).
- **Live session**: starting one creates an `in_progress` workout (409 if one exists). From a template: the template's top-level exercises are copied with their planned sets; circuits are copied with their exercises but no sets (the round counter starts at round 1). **Finish** keeps only the sets the user checked, then removes exercises left without sets and circuits left without exercises, and sets `ended_at`, `date` (the browser's local date, else `started_at`'s UTC date), `duration_minutes` (elapsed, rounded, at least 1) and `status = completed`. **Discard** deletes it.
- **Volume** = Σ reps × weight over sets with both and weight > 0. **Estimated 1RM** = weight × (1 + reps / 30) (Epley).
- **Import** matches exercises by name case-insensitively. A workout identical to one the user already has (same date, duration and entries, including within the same file) is skipped, as is a template or saved circuit whose name the user already uses. An item naming an unknown exercise is skipped and reported.

## `cards`

No tables yet.

## `media`

Books, films and series (ported from `../media`). Metadata lives once in a shared catalog (`media_items`), whoever added it. Everything personal (status, rating, notes, ownership, progress) is in a per-user `library_entries` row, and each read/watch is a `reading_sessions` row. Models in `backend/domains/media/models.py`. Enum types (`media.media_type`, `media.media_source`, `media.entry_status`) live in the schema too.

### `media.media_items`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `type` | enum `book` / `film` / `series` | |
| `title` | text, not null | English title, or the source's default when it has no English one: TMDB `en-US`, an Open Library English edition's title else the work's own title, or as typed for `manual`. |
| `title_fr` | text, null | French title when the source has one: TMDB `fr-FR` (the original title when TMDB has no translation), or a French Open Library edition's title. Null for `manual`. |
| `original_title` | text, null | When it differs from `title` (TMDB only). |
| `year` | smallint, null | Publication / release / first air year. |
| `creators` | text, null | Author(s), director(s) or creator(s), as one comma-separated display string. |
| `genres` | text[], not null, default `{}` | TMDB genre names (English), or up to 5 Open Library subjects (`genre:` tagged ones first, noise filtered out). |
| `synopsis` | text, null | English (TMDB `en-US`, or the Open Library work's description). |
| `synopsis_fr` | text, null | TMDB `fr-FR`; null for books and manual items. |
| `runtime_minutes` | smallint, null | Films only. |
| `isbn` | text, null | Books only (ISBN-13 preferred). |
| `season_episode_counts` | smallint[], null | Series only; index 0 = season 1. Specials and trailing announced seasons with 0 episodes are left out. Null for manual series. |
| `source` | enum `tmdb` / `openlibrary` / `manual` | |
| `external_id` | text, null | TMDB id (`603`) or Open Library work id without `/works/` (`OL20893680W`); null for `manual`. |
| `created_by_user_id` | integer, FK → `core.users.id`, not null | Who first added it. |
| `created_at` / `updated_at` | timestamptz, not null, default `now()` | `updated_at` set on every update. |

Partial unique index `uq_media_items_source_external_id` on `(source, external_id)` where `external_id` is not null: adding the same TMDB/Open Library item twice reuses the row. Books have **no page count**: book progress is status only.

### `media.covers`

Cover image downloaded once when an item is added, kept in Postgres so the database backup includes it (see decisions.md).

| Column | Type | Notes |
|---|---|---|
| `media_item_id` | integer, PK, FK → `media.media_items.id` `ON DELETE CASCADE` | |
| `content_type` | text, not null | e.g. `image/jpeg`. |
| `data` | bytea, not null | ≤ 2 MB (bigger downloads are not stored). |

No row = the frontend draws a generated placeholder.

### `media.library_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `user_id` | integer, FK → `core.users.id`, not null | |
| `media_item_id` | integer, FK → `media.media_items.id`, not null | |
| `status` | enum `want` / `in_progress` / `done` / `dropped`, not null, default `want` | |
| `rating` | smallint, null | 1–10 = 0.5–5 stars (`ck_library_entries_rating`); null = unrated. |
| `notes` | text, null | Trimmed; blank → null. |
| `owned_formats` | text[], not null, default `{}` | `{}` = not owned. Values: `paperback`, `hardcover`, `ebook`, `audiobook`, `dvd`, `bluray`, `bluray_4k`, `digital`. Repeats dropped. |
| `current_season` | smallint, null | Series only, 1–999. |
| `current_episode` | smallint, null | Series only; last episode watched in `current_season` (0 = none yet), 0–9999. |
| `added_at` / `updated_at` | timestamptz, not null, default `now()` | |

Unique `(user_id, media_item_id)` (`uq_library_entries_user_id`).

### `media.reading_sessions`

One read / watch of an entry (also used for films and series). Re-reads and re-watches are extra rows.

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `library_entry_id` | integer, FK → `media.library_entries.id` `ON DELETE CASCADE`, indexed | |
| `started_on` | date, null | |
| `finished_on` | date, null | null = still open. Not before `started_on`. |

Partial unique index `uq_reading_sessions_one_open` on `library_entry_id` where `finished_on` is null.

### Rules

- **Scoping**: every route needs the `media` app (grant or admin). Library routes only see the current user's entries; anyone else's entry is a 404. The catalog and covers are shared by every media user.
- **At most one open session** (`finished_on` null) per entry.
- **Start** (from `want`, `done` or `dropped`; refused when already `in_progress`): status → `in_progress`. Opens a session with `started_on = today` unless one is open (resuming a dropped item reuses it). For series, a new session resets progress to S1 E0.
- **Finish** (from any status but `done`): status → `done`; the open session gets `finished_on = today`, or a finish-only session is created.
- **Drop** (from `want` or `in_progress`): status → `dropped`; the open session stays open.
- **+1 episode** (series, `in_progress`): `current_episode + 1`, rolling to the next season's E1 when the season's count is known and reached. On the last known episode of the last season it is refused (409) and the app offers Finish instead (new seasons may come). With unknown counts it just increments.
- Refused transitions are 409. Editing sessions never changes the status.
- **Initial status** on add goes through the same transitions from `want` (adding as Done records a finish-only session today).
- **Series progress** = episodes of earlier seasons + current episode, over the sum of all seasons; only when every season's count is known.
- **Displayed title** = `title_fr` for French viewers when set, else `title` (same for synopses). Text search matches `title`, `title_fr`, `original_title` and `creators`; the title sort uses the title in the user's saved language (`core.users.language`).
- "Today" is the server's date (UTC in the containers).
- Removing an entry deletes its sessions but keeps the catalog row and its cover.

## Business rules (cross-schema)

- A table in an app schema may have a foreign key to `core` (e.g. `core.users.id`), never to another app's schema — apps stay independent of each other.
