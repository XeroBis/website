#!/bin/bash
# Weekly Postgres backup of the whole `website` database, run from the host
# crontab (see documentation/deployment.md "Backups"). One pg_dump in custom
# format (compressed, and restore.sh can pull a single schema out of it), the
# newest 7 kept in dumps/, the latest emailed via msmtp.
#
# The dump is only attached if it's under MAX_ATTACH_BYTES: Gmail rejects
# messages over ~25 MB and base64 adds ~37%. A bigger dump stays on disk and
# the email just says so.
#
# Not covered: the `cards_data` volume (card scans, ~2 GB of files, not rows).
# Keep the catalog image export zip somewhere as its copy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Overridable for testing against the dev stack:
#   COMPOSE_FILE=docker-compose.yml NO_EMAIL=1 infra/backups/backup.sh
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DUMP_DIR="${DUMP_DIR:-$SCRIPT_DIR/dumps}"
RECIPIENT="${RECIPIENT:-alanbignon2@gmail.com}"
MAX_ATTACH_BYTES="${MAX_ATTACH_BYTES:-20971520}" # 20 MB
TIMESTAMP="$(date +%Y%m%d)"
OUT="$DUMP_DIR/website-$TIMESTAMP.dump"

mkdir -p "$DUMP_DIR"

# Written to a temp name first, so a failed dump never replaces a good one.
(cd "$REPO_DIR" && docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U website -Fc website) > "$OUT.partial"
mv "$OUT.partial" "$OUT"

# keep only the newest 7
ls -1t "$DUMP_DIR"/website-*.dump | tail -n +8 | xargs -r rm --

SIZE="$(stat -c %s "$OUT")"
echo "$OUT ($SIZE bytes)"

if [ -n "${NO_EMAIL:-}" ]; then
  exit 0
fi

if [ "$SIZE" -le "$MAX_ATTACH_BYTES" ]; then
  NOTE="- $(basename "$OUT") ($SIZE bytes): attached"
  ATTACHMENT="$(printf -- '--BOUNDARY\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="%s"\nContent-Transfer-Encoding: base64\n\n%s\n\n' \
    "$(basename "$OUT")" "$(base64 "$OUT")")"
else
  NOTE="- $(basename "$OUT") ($SIZE bytes): too large to email, left on disk at $OUT"
  ATTACHMENT=""
fi

msmtp -a default "$RECIPIENT" <<EOF
From: $RECIPIENT
To: $RECIPIENT
Subject: Weekly DB backup - $TIMESTAMP
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY"

--BOUNDARY
Content-Type: text/plain

Weekly backup of the website database for $TIMESTAMP:

$NOTE

Restore: infra/backups/restore.sh {all|portfolio|workout|cards|media} <file>

$ATTACHMENT
--BOUNDARY--
EOF
