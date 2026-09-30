#!/usr/bin/env bash
# Rebuilds kashroot-sukkot-2026.mp4 (+ square) from scratch. Needs: node (playwright installed here),
# python3 + PIL, the pip-installed ffmpeg under ./py, and the repo checkout (read only).
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(git rev-parse --show-toplevel)"
VDIR="$PWD"
[ -d py/imageio_ffmpeg ] || pip install --quiet --target ./py imageio-ffmpeg
[ -d node_modules/playwright ] || npm install --no-audit --no-fund playwright@1.56
cp -r "$REPO/web/public/fonts" "$REPO/web/public/icons" www/

( cd "$REPO/web" && VITE_API_MODE=mock npx vite --port 5199 --host 127.0.0.1 --strictPort >"$VDIR/vite.log" 2>&1 & echo $! > "$VDIR/vite.pid" )
( cd "$VDIR/www" && python3 -m http.server 5198 --bind 127.0.0.1 >"$VDIR/www.log" 2>&1 & echo $! > "$VDIR/www.pid" )
trap 'kill $(cat vite.pid) $(cat www.pid) 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:5199/ && break; sleep 1; done
node record-app.mjs
node render-cards.mjs
node render-cards-sq.mjs
python3 compose.py
python3 compose.py --square
