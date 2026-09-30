# Promo video pipeline

Records the real Kashroot web app with Playwright and composes a vertical (1080x1920) and
square (1080x1080) MP4 with branded Hebrew intro/outro cards and the campaign QR code.

    ./make.sh                                   # records https://kashroot.app, full rebuild
    KASHROOT_BASE=http://127.0.0.1:5199 ./make.sh   # record a local dev server instead
    KASHROOT_ROUTE_VIA_NODE=1 ./make.sh             # behind a TLS-intercepting proxy Chromium does not trust

`KASHROOT_ROUTE_VIA_NODE=1` serves the page's requests through Playwright's Node-side fetch
(verified against `NODE_EXTRA_CA_CERTS`, via `HTTPS_PROXY`) instead of Chromium's own TLS stack.

The walkthrough (`record-app.mjs`) grants a Jerusalem geolocation (`KASHROOT_LAT`/`KASHROOT_LON`)
so the home grid is Jerusalem, and opens `KASHROOT_RESTAURANT` (default אייס סטורי, a MATCH
under the third onboarding preset — the `badatz` whitelist, titled "מותאם אישית" on the live
site — with Google Places photos and hours) for the detail shot.

Pieces: `record-app.mjs` (walkthrough, writes frames/app + marks), `capture.mjs` (CDP screencast
at DPR 3, resampled to 30 fps), `render-cards*.mjs` (intro/outro/captions from `www/*.html`
using the repo's self-hosted fonts), `compose.py` (ffmpeg overlays, fades, concat).
Never use ffmpeg drawtext for Hebrew; all text is rendered in Chromium.
