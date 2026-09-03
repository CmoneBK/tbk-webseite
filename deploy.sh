#!/usr/bin/env bash
# Deployt den Inhalt von public/ nach t-bk.de.
# Aufruf auf dem Server (als root):
#   runuser -u ctnutzerone -- bash /home/users/ctnutzerone/git/tbk-webseite/deploy.sh
set -euo pipefail

REPO_DIR="/home/users/ctnutzerone/git/tbk-webseite"
DOCROOT="/home/users/ctnutzerone/www/t-bk.de/"

cd "$REPO_DIR"
git pull --ff-only

# public/ -> DocumentRoot spiegeln. --delete raeumt Entferntes weg,
# --exclude schuetzt die ACME-Challenge von Let's Encrypt.
rsync -a --delete --exclude='.well-known/' "$REPO_DIR/public/" "$DOCROOT"

echo "Deployed commit $(git rev-parse --short HEAD) -> $DOCROOT"
