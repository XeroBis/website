#!/bin/bash
# Restore the `website` database, or one app's schema, from a backup.sh dump.
# DESTRUCTIVE: what is restored is dropped first.
#
# Usage:
#   infra/backups/restore.sh all [dump]        # whole database (incl. core: users, alembic_version)
#   infra/backups/restore.sh <schema> [dump]   # portfolio | workout | cards | media only
#
# Without a dump path, the newest dumps/website-*.dump is used.
#
# `core` can't be restored on its own: every app schema has FKs into
# core.users, and dropping it would drop them. Use `all` for it. A single
# schema restore keeps today's users, so rows of a user deleted since the dump
# make it fail (nothing is half-applied: it runs in one transaction).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DUMP_DIR="${DUMP_DIR:-$SCRIPT_DIR/dumps}"
TARGET="${1:-}"

case "$TARGET" in
  all|portfolio|workout|cards|media) ;;
  *)
    echo "Usage: $0 {all|portfolio|workout|cards|media} [path/to/website-YYYYMMDD.dump]" >&2
    exit 1
    ;;
esac

DUMP_FILE="${2:-}"
if [ -z "$DUMP_FILE" ]; then
  DUMP_FILE="$(ls -1t "$DUMP_DIR"/website-*.dump 2>/dev/null | head -n 1)"
  if [ -z "$DUMP_FILE" ]; then
    echo "No dump found in $DUMP_DIR and none given on the command line." >&2
    exit 1
  fi
fi
if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file not found: $DUMP_FILE" >&2
  exit 1
fi
DUMP_FILE="$(cd "$(dirname "$DUMP_FILE")" && pwd)/$(basename "$DUMP_FILE")"

echo "About to restore '$TARGET' from:"
echo "  $DUMP_FILE"
if [ "$TARGET" = all ]; then
  echo "This DROPS the whole 'website' database and replaces it. This cannot be undone."
else
  echo "This DROPS the '$TARGET' schema and replaces it. This cannot be undone."
fi
read -r -p "Type '$TARGET' to confirm: " CONFIRM
if [ "$CONFIRM" != "$TARGET" ]; then
  echo "Confirmation did not match, aborting."
  exit 1
fi

cd "$REPO_DIR"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_db() { compose exec -T db psql -U website -v ON_ERROR_STOP=1 "$@"; }

echo "Stopping backend..."
compose stop backend
# Restart it whatever happens below.
trap 'echo "Starting backend..."; compose start backend' EXIT

if [ "$TARGET" = all ]; then
  echo "Dropping and recreating the database..."
  psql_db -d postgres -c "DROP DATABASE IF EXISTS website WITH (FORCE);"
  psql_db -d postgres -c "CREATE DATABASE website OWNER website;"
  echo "Loading the dump..."
  compose exec -T db pg_restore -U website -d website --no-owner --exit-on-error < "$DUMP_FILE"
else
  # pg_restore -n doesn't create the schema itself. The DROP, CREATE and the
  # restore share one transaction, so a failure leaves the schema as it was.
  echo "Replacing schema '$TARGET'..."
  {
    echo "BEGIN;"
    echo "DROP SCHEMA $TARGET CASCADE;"
    echo "CREATE SCHEMA $TARGET;"
    compose exec -T db pg_restore -n "$TARGET" --no-owner -f - < "$DUMP_FILE"
    echo "COMMIT;"
  } | psql_db -d website -q -o /dev/null
fi

echo "Restore complete."
