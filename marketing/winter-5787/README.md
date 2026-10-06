# Winter 5787 — בין הזמנים campaign assets

Static image (square + story) and a silent 15 s video for the *bein hazmanim* /
tiyul-season push. Everything is rendered deterministically from HTML with
Playwright, so a copy tweak is an edit in `src/` and a re-render.

**The phone screens are real captures of the production app** (https://www.kashroot.app,
live data, captured 2026-10-06 by `scripts/capture.mjs`) — not design mockups. See
`src/screens/CAPTURE.md` for the exact profile, restaurant and state of every shot.

## Outputs (`out/`)

| File | What |
|---|---|
| `kashroot-bein-hazmanim-5787-square.png` / `.jpg` | 1080×1080 image (JPG q90 for WhatsApp) |
| `kashroot-bein-hazmanim-5787-story.png` / `.jpg` | 1080×1920 story image |
| `kashroot-bein-hazmanim-5787-story.mp4` | 1080×1920, 15 s, 30 fps, H.264 yuv420p, silent |
| `kashroot-bein-hazmanim-5787-square.mp4` | 1080×1080 cut of the same timeline |
| `kashroot-bein-hazmanim-5787-contact.png` | 10-frame contact sheet of the story video |

## Sources (`src/`)

- `image-square.html`, `image-story.html` — the two stills.
- `video.html` — one page, whole timeline built with the Web Animations API, all
  animations paused; `window.seek(ms)` scrubs to any time, `window.setSquare()`
  switches the layout to the 1080×1080 cut. No `Date.now`, no RAF — frames are
  reproducible.
- `common.css` + `screens.js` — palette tokens (from `design/DESIGN_BRIEF.md`),
  the phone frame (390×844 basis, dynamic island, dark bezel), the brand mark,
  leaves, QR and feature bullets. `K.shot('home.png')` drops a capture into the
  frame; the old hand-ported design screens are gone.
- `screens/` — the app captures, 1170×2532 PNG (390×844 CSS px @3x, no browser
  chrome): `onboarding-preset`, `onboarding-certifiers-{0,1,2}` (the ticking
  sequence), `home` (scroll top), `home-mix` (scrolled to where the verdicts mix),
  `home-noprofile` (widest preset, not used in the cut), `restaurant`,
  `restaurant-evidence`, `search`. `CAPTURE.md` is written by the capture script;
  `boxes.json` holds the evidence/certificate panel positions the video's pulse
  rings use (copied into `video.html` as `BOX`).
- `fonts/` — copy of `web/public/fonts` (Assistant 400–700, Frank Ruhl Libre
  500–700), loaded with relative `@font-face` URLs, so rendering is offline-safe.
- `icon.svg` — the logo mark; `qr-image.svg` / `qr-video.svg` — real QR codes
  (ECC H) for the two UTM-tagged links, generated with the Python `qrcode` lib.

## Re-capture the app screens

Requires Node 18+, Playwright 1.56 with a Chromium build and network access to
production (or a local dev server). The script walks the demo run-sheet: presets →
"מותאם אישית" → un-tick the preselected Badatzim → tick בד״ץ העדה החרדית and
בד״ץ מהדרין — הרב רובין → home near Jerusalem (geolocation granted) → אייס סטורי
(found through the name search) → its evidence panel. It emulates iPhone safe-area
insets (59/34 px) so the app lays out under the frame's island as on a device.

```sh
cd marketing/winter-5787
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
node scripts/capture.mjs                                  # production
CAPTURE_URL=http://127.0.0.1:5199 node scripts/capture.mjs  # local (cd web && npx vite --port 5199)
```

Then check `src/screens/CAPTURE.md`, and if `boxes.json` moved, update `BOX` in
`src/video.html` before re-rendering.

## Re-render

Requires Node 18+, Playwright 1.56 with a Chromium build, and `ffmpeg` on PATH.

```sh
cd marketing/winter-5787
# playwright: the script first tries a local node_modules, then
# $PLAYWRIGHT_MODULE_DIR (default /opt/node-tools/node_modules). To install locally:
#   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.56.1
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers   # where Chromium lives on the build box

node scripts/render.mjs images    # stills -> out/*.png + *.jpg
node scripts/render.mjs video     # frames -> out/*.mp4 + contact sheet
node scripts/render.mjs all
```

Video frames go to `frames/` (git-ignored) or to `$FRAMES_DIR` if set. The
encode is `ffmpeg -framerate 30 -i f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart`.

Regenerate the QR codes (if the links change):

```sh
python3 -c "import qrcode, qrcode.image.svg as s; q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0); q.add_data('https://kashroot.app/?utm_source=whatsapp&utm_medium=image&utm_campaign=bein-hazmanim-5787'); q.make(fit=True); q.make_image(image_factory=s.SvgPathImage).save('src/qr-image.svg')"
```
