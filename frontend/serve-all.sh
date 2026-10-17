#!/bin/sh
# Runs `ng serve` for every app (or only those in $APPS, e.g. APPS="cards auth")
# in parallel, each on its own port from angular.json (4600-4604). Used by the
# dev `frontend` container; exits as soon as any one of them dies.
set -e
APPS="${APPS:-portfolio workout cards media auth}"
for app in $APPS; do
  npx ng serve "$app" --host 0.0.0.0 --poll 2000 &
done
wait -n
