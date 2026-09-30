#!/usr/bin/env bash
# Rebuilds kashroot-sukkot-2026.mp4 (+ square) from scratch by recording the live site (KASHROOT_BASE,
# default https://kashroot.app). Needs: node (playwright installed here), python3 + PIL, the
# pip-installed ffmpeg under ./py, and the repo checkout (read only, for fonts/icons).
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(git rev-parse --show-toplevel)"
VDIR="$PWD"
[ -d py/imageio_ffmpeg ] || pip install --quiet --target ./py imageio-ffmpeg
[ -d node_modules/playwright ] || npm install --no-audit --no-fund playwright@1.56
cp -r "$REPO/web/public/fonts" "$REPO/web/public/icons" www/

BASE="${KASHROOT_BASE:-https://kashroot.app}"
curl -sfL -o /dev/null "$BASE/" || { echo "cannot reach $BASE" >&2; exit 1; }
for i in 1 2 3; do curl -sf -o /dev/null "$BASE/v1/certifiers" || true; done   # wake the API (Render free tier sleeps)
( cd "$VDIR/www" && python3 -m http.server 5198 --bind 127.0.0.1 >"$VDIR/www.log" 2>&1 & echo $! > "$VDIR/www.pid" )
trap 'kill $(cat www.pid) 2>/dev/null || true' EXIT
KASHROOT_BASE="$BASE" node record-app.mjs
node render-cards.mjs
node render-cards-sq.mjs
python3 compose.py
python3 compose.py --square
