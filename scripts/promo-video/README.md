# Promo video pipeline

Records the real Kashroot web app with Playwright and composes a vertical (1080x1920) and
square (1080x1080) MP4 with branded Hebrew intro/outro cards and the campaign QR code.

    ./make.sh                      # mock API on :5199, full rebuild
    KASHROOT_BASE=https://kashroot.app node record-app.mjs   # record the live site instead

Pieces: `record-app.mjs` (walkthrough, writes frames/app + marks), `capture.mjs` (CDP screencast
at DPR 3, resampled to 30 fps), `render-cards*.mjs` (intro/outro/captions from `www/*.html`
using the repo's self-hosted fonts), `compose.py` (ffmpeg overlays, fades, concat).
Never use ffmpeg drawtext for Hebrew; all text is rendered in Chromium.
