#!/usr/bin/env bash
# Deployt public/ nach t-bk.de -- nur wenn es auf origin/main einen neuen Commit gibt.
# Manuell (als root):
#   runuser -u ctnutzerone -- bash /home/users/ctnutzerone/git/tbk-webseite/deploy.sh
# Automatisch: per Cron alle 2 Minuten (siehe Einrichtung).
set -euo pipefail

REPO_DIR="/home/users/ctnutzerone/git/tbk-webseite"
DOCROOT="/home/users/ctnutzerone/www/t-bk.de/"

cd "$REPO_DIR"
git fetch --quiet origin main

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

# Nichts Neues -> still beenden (haelt das Cron-Log sauber).
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

git merge --ff-only origin/main

# public/ -> DocumentRoot spiegeln. --delete raeumt Entferntes weg,
# --exclude schuetzt die ACME-Challenge von Let's Encrypt.
rsync -a --delete --exclude='.well-known/' "$REPO_DIR/public/" "$DOCROOT"

echo "$(date '+%F %T') deployed ${REMOTE:0:7} -> $DOCROOT"
