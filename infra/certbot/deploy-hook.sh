#!/bin/bash
# Certbot deploy hook: copies the renewed multi-SAN cert to the one path the
# edge reads (infra/ssl/alanbignon.com/) and reloads nginx. Installed once as
# a symlink, so it always runs the repo's current version:
#   sudo ln -s ~/website/infra/certbot/deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/website.sh
# Also run it by hand (sudo) right after issuing or expanding the cert.
# See documentation/deployment.md "TLS certificate".
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)"
# certbot sets RENEWED_LINEAGE for deploy hooks; by hand, the cert's live dir.
LINEAGE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/multi-alanbignon}"
DEST="$REPO_DIR/infra/ssl/alanbignon.com"

# -L: certbot's live/ entries are symlinks into archive/.
cp -L "$LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
cp -L "$LINEAGE/privkey.pem" "$DEST/privkey.pem"
chmod 600 "$DEST/privkey.pem"
echo "Copied the cert from $LINEAGE to $DEST"

# The certs are bind-mounted as a directory, so a reload picks them up. Skip it
# when the edge isn't running (before the first `make prod`).
cd "$REPO_DIR"
if [ -n "$(docker compose -f docker-compose.prod.yml ps -q --status running edge)" ]; then
  docker compose -f docker-compose.prod.yml exec -T edge nginx -s reload
  echo "Reloaded the edge"
fi
