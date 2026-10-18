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
| `theme` | text, not null, default `'system'` | `'system'`, `'light'` or `'dark'` (`ck_users_theme`). Shared by every app. |
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

Pokémon cards (ported from `../pokemon_cards`, migration-plan.md step 6). One shared catalog of every card and the print variants it comes in, imported from saved pokecardex HTML. Everything else belongs to a user: the collection (a quantity per owned print), decks and upgrade drafts, purchases, share links and shopping lists. Combats are the one log shared between cards users. Models in `backend/domains/cards/models.py`, migration `0007` (it also enables the `pg_trgm` extension). Image paths are relative to `CARDS_DATA_DIR` (architecture.md).

### `cards.card_catalog`

One card slot of a set. Reference data, written by the catalog import; only `name` can be corrected (admin).

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `name` | text, not null, indexed | English name. `Basic <X> Energy` is stored as the generic `X Energy`; prints in the dedicated `Energies` set keep a dated name (`Water Energy (2022) /104`). |
| `display_name` | text, not null, indexed | French name; equals `name` when the French page has none. |
| `series` | text, null | The source folder the set came from (`Scarlet & Violet`, `World Championships`, …): the Sets page grouping and the first segment of the set's image paths. A French label may come from the folder's `name.txt`. |
| `set_name` / `set_name_fr` | text, not null / null | Set titles. |
| `set_code` | text, not null, indexed | The set folder name (`SVI`, `MEW`). |
| `card_number` | text, not null | Number within the set, from the scan URL (`Energies`: position on the page). Not unique within a set. |
| `details` | json, null | TCGdex text, `{"en": {...}, "fr": {...}}`: HP, types, stage, evolveFrom, attacks, abilities, effect, weaknesses, resistances, retreat, illustrator, regulationMark. |
| `image_path` | text, not null, unique | English scan, e.g. `Scarlet & Violet/SVI/cards/001_sprigatito_standard_EN.jpg`; `__pending__/<set>/<slot>_<number>` until downloaded. Its thumbnail is the same path with `/thumbnails/` instead of `/cards/`. The identity collection export/import matches by. |
| `image_path_fr` | text, null | French scan. |
| `supertype` | text, null, indexed | `Pokémon` / `Trainer` / `Energy`, from the set's `rarity.txt`. |
| `source_url` | text, null | CDN URL of the English standard scan; also how the HTML import recognises a row whose number changed. |
| `rarity` | text, null, indexed | Raw value from `rarity.txt` (grouped into categories by the frontend). |
| `card_count` / `release_date` | integer / date, null | Set-level, copied on each card of the set. |
| `created_at` | timestamptz, default `now()` | |

GIN trigram index `ix_card_catalog_stripped_name_trgm` on `name` without `’ ' . :`, for the leading-wildcard name search. Logos and symbols have no column: `<series>/<set_code>/<set_code>_logo_EN.png` / `_logo_FR.png` / `_symbol.png`.

### `cards.card_catalog_variants`

A print a catalog card comes in: `standard` always, plus `reverse`, the ball patterns (`reverse_pokeball` … `reverse_masterball`) and special prints (stamps, staff, holo finishes, …). The full list and display order is `domains/cards/variant_order.py` (unknown types sort last).

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `card_catalog_id` | integer, FK → `card_catalog.id` `ON DELETE CASCADE` | |
| `variant_type` | text, not null | Unique with `card_catalog_id`. |
| `source_url_en` / `source_url_fr` | text, null | Scan URLs from the English / French page. Only the HTML import writes them (the metadata file doesn't carry them). |
| `image_path_us` / `image_path_fr` | text, null | Downloaded scans. Always null for `standard` (its scans are on `card_catalog`). |

### `cards.cards`, `cards.card_variant_quantities`

A catalog card in a user's collection (unique `(user_id, catalog_id)`), and how many copies of each print they own (unique `(card_id, variant_type)`, `quantity ≥ 1`).

| Column | Type | Notes |
|---|---|---|
| `cards.id` | integer, PK | |
| `cards.user_id` | integer, FK → `core.users.id` `ON DELETE CASCADE` | |
| `cards.catalog_id` | integer, FK → `card_catalog.id` | |
| `card_variant_quantities.card_id` | integer, FK → `cards.id` `ON DELETE CASCADE`, indexed | |
| `card_variant_quantities.variant_type` | text, not null | Must be one of the card's catalog variants. |
| `card_variant_quantities.quantity` | integer, not null | ≥ 1; a print going to 0 deletes its row. |
| `created_at` | timestamptz, default `now()` | Both tables. |

### `cards.collection_history`

Audit log of ownership changes, one row per (card, print) change, never edited or deleted. Indexed on `(user_id, created_at)`.

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `user_id` | integer, FK → `core.users.id` `ON DELETE CASCADE` | |
| `catalog_id` | integer, FK → `card_catalog.id` | |
| `variant_type` | text, not null, default `standard` | |
| `action` | text, not null | `added` / `increased` / `decreased` / `removed`. An unchanged quantity logs nothing. |
| `source` | text, not null | `manual` / `import`. |
| `old_quantity` / `new_quantity` | integer, null | Null for `added` / `removed` respectively. |
| `created_at` | timestamptz, default `now()` | |

### `cards.decks`, `cards.deck_cards`, `cards.deck_history`

| Column | Type | Notes |
|---|---|---|
| `decks.id` | integer, PK | |
| `decks.user_id` | integer, FK → `core.users.id` `ON DELETE CASCADE` | Name unique per owner. |
| `decks.name` / `decks.description` | text, not null / null | |
| `decks.deck_type` | text, not null, default `normal` | `normal` or `phantom` (a want-list); set at creation only. |
| `decks.has_wdc_cards` | boolean, default false | Display tag: some card is from a `World Championships` set. Recomputed after every card change. |
| `deck_cards.deck_id` | integer, FK → `decks.id` `ON DELETE CASCADE` | |
| `deck_cards.card_id` | integer, null, FK → `cards.id` `ON DELETE CASCADE`, indexed | Normal decks: the owned copy. |
| `deck_cards.catalog_id` | integer, null, FK → `card_catalog.id` | Phantom decks: the catalog card (may be owned 0 times). Exactly one of `card_id` / `catalog_id` is set. |
| `deck_cards.variant_type` | text, not null, default `standard` | The print allocated. Unique per `(deck_id, card_id, variant_type)` and `(deck_id, catalog_id, variant_type)` (partial indexes). |
| `deck_cards.quantity_in_deck` | integer, not null | ≥ 1 (wanted count for phantom rows). |
| `deck_cards.poster_slot` | smallint, null | 0–2 for the deck's up to 3 poster cards; unique per deck. Freed with its row. |
| `deck_history` | | `deck_id` (`ON DELETE CASCADE`), `action` (`created`, `renamed`, `description_changed`, `copied`, `card_added`, `card_quantity_changed`, `card_removed`), `detail`, `old_value`, `new_value`, `variant_type`, `created_at`. |

### `cards.deck_upgrade_drafts`, `cards.deck_upgrade_draft_cards`

A named "what if" diff against a normal deck (unique name per deck, `ON DELETE CASCADE` with it, deleted once applied), and its lines: `(draft_id, catalog_id, variant_type)` unique, `quantity_delta` a nonzero signed change on the deck's current quantity of that print. `updated_at` moves on every change.

### `cards.combats`

| Column | Type | Notes |
|---|---|---|
| `id` | integer, PK | |
| `deck_a_id` / `deck_b_id` | integer, null, FK → `decks.id` `ON DELETE SET NULL` | Any user's normal decks, may be the same. |
| `player_a_id` / `player_b_id` | integer, FK → `core.users.id` `ON DELETE CASCADE` | Need not own the deck, may be the same. |
| `winner` | text, not null | `a` or `b`. |
| `loser_score` | integer, not null | Prizes the loser still had, 1–6. |
| `played_at` | timestamptz, not null | Date only (midnight UTC); the list order. |
| `deck_a_snapshot` / `deck_b_snapshot` | json, not null | Each side's card list when the deck was set, English values: `[{card_id, variant_type, quantity_in_deck, name, set_name, image_path, supertype}]` (`card_id` is the owned card then; meaningless after an import). |
| `deck_a_name_snapshot` / `deck_b_name_snapshot` | text, not null | The deck names then, shown once the deck is deleted (while it exists, its current name is shown). |
| `created_at` | timestamptz, default `now()` | |

### `cards.purchases`

"What I Paid": `user_id` (`ON DELETE CASCADE`, indexed), `product_name`, `price` numeric(10,2) ≥ 0 (the entry's total, one currency), `quantity` ≥ 1 (informational), `purchased_at` (date only), `source` and `description` (free text, null), `sets` text[] of set codes (default `{}`, not FKs), `created_at`.

### `cards.set_shares`

A public read-only link to one set of a user's collection: `user_id` (`ON DELETE CASCADE`, indexed), `set_code`, `token` (unique, `secrets.token_urlsafe(24)`), `expires_at`, `revoked_at` (null until revoked), `created_at`. Active = not revoked and not expired. Ownership is recomputed on each read.

### `cards.shopping_lists`, `cards.shopping_list_cards`

A shopping-round checklist (name unique per owner, `updated_at` moves on every change) and its cards: unique `(shopping_list_id, catalog_id)`, `quantity_needed` (from the pasted decklist), `quantity_owned` (a manual tally, 0…`quantity_needed`, default 0). Not linked to the collection.

### Rules

- **Scoping**: every route needs the `cards` app (grant or admin), except the public share routes. Collection, decks, drafts, purchases, shares and shopping lists only see the current user's rows (anyone else's is a 404). The catalog is shared. Combats are shared between cards users, and their deck pickers list every cards user's normal decks. Catalog administration (import, refresh, name fix) needs `core.users.is_admin`.
- **Totals**: owned = Σ the card's variant quantities; allocated = Σ `quantity_in_deck` over normal decks; available = owned − allocated (also per print). Phantom rows never count as allocated. Computed in grouped queries over a whole page of cards (no per-card query).
- **Deck building** (normal decks): ≤ 60 cards, ≤ 4 copies per card over its prints except Basic Energy (recognised by name), allocated ≤ owned per print. The first two are checked when a change raises them. A card in a deck can't be deleted, and its quantity can't go below what decks use. Phantom decks skip all three limits; their owned/available counts are computed live per print. Deck names are unique per owner and the type is fixed at creation (a copy keeps it).
- **Drafts**: normal decks only. A line is a nonzero signed change to one (catalog card, print); its result (deck quantity of that print + delta) stays within 0–4 (Basic Energy unlimited). A pasted decklist diffs against the deck's standard prints. Every proposed addition keeps one owned copy back for the binder (shown `available`, `can_apply`, apply, the `reserve_singles` export). Applying re-checks every rule against the deck as it is, all or nothing, logs each change and deletes the draft. The combined export pools demand per print over the drafts before comparing with owned copies.
- **Deleting decks**: a deck's cards, history and drafts go with it; combats keep their snapshots (`deck_*_id` set to null). Only the collection's delete-all also deletes the combats.
- **Combats**: decks are any cards user's normal decks (the same one twice is fine), players any cards users (not necessarily the owners). A side's snapshot and deck name are taken when its deck is set, at creation or when an edit changes that side's deck; an edit leaving it unchanged keeps the snapshot. A side whose deck was deleted can stay without one. Any cards user may edit or delete any combat. Delete-all removes the combats the user played (either side); for an admin, every combat. Import matches players by email and decks by name + owner email among cards users (the oldest deck of that name when the file has no email); a side whose deck isn't found keeps its snapshot with no deck. `played_at` / `purchased_at` are stored at midnight UTC of the given day (a datetime keeps its UTC date).
- **Shares**: active = not revoked and not expired; the public routes answer an unknown, expired or revoked token with the same 404. They only expose the shared set (English values, ownership recomputed per read, nothing about the owner), and their image route only serves scans and thumbnails of that set's cards and prints, plus its logo and symbol, inside `CARDS_DATA_DIR`, uncached. Revoking keeps the row.
- **Shopping lists**: filled from pasted decklists matched like the converter (unmatched lines dropped; a paste matching nothing is refused). A paste adds onto `quantity_needed` of a card already listed (its tally untouched) or adds it at 0 owned, so nothing is ever lowered. The tally is set by hand within 0…`quantity_needed`; removing a card or deleting the list is the only way down.
- **Catalog refresh and imports** (admin, one job at a time):
  - *HTML import*: a source slot matches an existing card by its English standard scan URL (CDN query string ignored), else by `(set_code, card_number)` unless that card was saved with another scan URL (a stale number its own slot repairs). Every field is rewritten from the source, prints are added (their scan URLs updated), and cards or prints no longer in the source are kept. A new card gets `image_path` `__pending__/<set_code>/<cdn slot>_<number>`; a card whose number is corrected keeps its id and scans (a placeholder follows the number). All sets in one transaction.
  - *Scan downloads* fill only pending standard paths and print paths with neither scan, from the recorded URLs, as `<series>/<set_code>/cards/<number>_<slug of name>_<variant>_<EN|FR>.jpg` (World Championships: `<cdn slot>_` in front). A failed download stays pending for the next run. An `Energies` card with no English scan takes its French one as `image_path`. Thumbnails (standard scans, EN and FR, 300 px wide) are made when missing, never overwritten.
  - *TCGdex details* are only fetched for cards without any, never for World Championships, `Energies` or promo sets; a card's set must match exactly one TCGdex set by name and its number one card, and the fetched card must name that set and number, or nothing is written.
  - *Metadata import*: merges by `(set_code, card_number)`, keeping ids (so collections, decks and drafts keep their cards); cards and prints missing from the file are kept; all or nothing. Refused: duplicates in the file, unknown prints, an image path belonging to another card, a pair matching several existing cards. A file without `display_name` keeps the French names stored (new cards get the English one).
  - *Images import* never overwrites a file, and only fills pending or missing scan paths whose file is now present under the name the downloader would have used.
- **Logging**: every ownership change writes `collection_history`, every deck change `deck_history`, in the same transaction.
- **Collection**: adding puts copies on top of what's owned (one `cards` row per catalog card and user, created on the first copy); an edit sets one print's quantity (only a print of the catalog card, never below that print's copies in decks); a print at 0 is deleted, and the card with its last print. A card in a deck can't be deleted. An import matches by `image_path` and replaces each listed print's quantity (unlisted prints kept, never below what decks use), all or nothing. Delete-all removes the user's cards and decks plus every combat that used one of those decks (even with another player's deck on the other side), logging each print as removed first.
- **Language**: display responses use `display_name`, `set_name_fr` and `image_path_fr` for French users (`core.users.language`) when set; exports and share pages always use the English values.
- Deleting an account deletes all its cards data and the combats it played.

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
