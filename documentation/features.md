# Features

User-facing behaviour per app. Every app currently shows a placeholder page
(its name and whether `/api/health` answers) until it is migrated — see
`migration-plan.md`.

## Shared

- `GET /api/health` → `{"status": "ok"}` when the backend can reach the database (500 otherwise). Available on every host.

## Auth — `auth.alanbignon.com`

Placeholder.

## Portfolio — `alanbignon.com`

Placeholder. Planned: a public list of projects Alan has made, added and edited manually by an admin (no GitHub sync). Nothing is imported from the old workout `projects` table.

## Workout — `workout.alanbignon.com`

Placeholder.

## Cards — `cards.alanbignon.com`

Placeholder.

## Media — `media.alanbignon.com`

Placeholder.
