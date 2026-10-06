# Winter 5787 — בין הזמנים campaign assets

Two asset sets live here, one visual system: the **bein-hazmanim** set (this section) and the
**Hanukkah 5787** set (see [Hanukkah 5787 set](#hanukkah-5787-set) below). `scripts/render.mjs`
takes the campaign name as its first argument; with none it renders bein-hazmanim exactly as before.

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
node scripts/render.mjs hanukkah [images|video|all]   # the Hanukkah set, see below
```

Video frames go to `frames/` (git-ignored; a named campaign uses its own sub-folder there)
or to `$FRAMES_DIR` if set. The
encode is `ffmpeg -framerate 30 -i f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart`.

Regenerate the QR codes (if the links change):

```sh
python3 -c "import qrcode, qrcode.image.svg as s; q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=0); q.add_data('https://kashroot.app/?utm_source=whatsapp&utm_medium=image&utm_campaign=bein-hazmanim-5787'); q.make(fit=True); q.make_image(image_factory=s.SvgPathImage).save('src/qr-image.svg')"
```

## Hanukkah 5787 set

"שמונה לילות, שמונה סטנדרטים" — at one Hanukkah table (4–12 Dec 2026) every person has
their own kashrut standard, and Kashroot gives each of them an answer, never a score. Same
cream + sage system with a warm amber candle glow (`#e6bd5e` / `#c9a94e`, the brief's gold);
no snow, no red/white. The hanukkiah is a classic brass menorah drawn as clean SVG
(`K.hanukkiah()` in `src/hanukkah.js`, not a traced photo): knopped stem on a fluted dome
base, four pairs of concentric engraved semicircular arms to a straight row of eight goblet
cups, raised shamash cup, twisted-wax candles in a symmetric blue / white / orange / yellow
order, and **eight flames of identical size and brightness** — equal flames is a brand rule,
nothing may read as a ranking of certifiers. Only the shamash flame carries the logo mark's
green→amber as a quiet brand tie-in.

### Outputs (`out/`)

| File | What |
|---|---|
| `kashroot-hanukkah-5787-square.png` / `.jpg` | 1080×1080 image |
| `kashroot-hanukkah-5787-story.png` / `.jpg` | 1080×1920 story image |
| `kashroot-hanukkah-5787-story.mp4` | 1080×1920, 15 s, 30 fps, H.264 yuv420p, silent |
| `kashroot-hanukkah-5787-square.mp4` | 1080×1080 cut of the same timeline |
| `kashroot-hanukkah-5787-contact.png` | 10-frame contact sheet of the story video |

### Sources (`src/`)

- `hanukkah-image-square.html`, `hanukkah-image-story.html` — the stills; phone shows `home-p1`.
- `hanukkah-video.html` — five beats, `window.seek(ms)` / `window.setSquare()` as in `video.html`:
  (1) the hanukkiah lighting flame by flame, shamash first; (2) "סבא" chip, certifier picker
  with בד״ץ העדה החרדית ticked → his home list; (3) "הגיסה", בית יוסף → her list;
  (4) "בן הדוד", the "כל תעודת כשרות" preset → his list; (5) end card with QR.
- `hanukkah.js` (brass menorah, persona chip, the three Hanukkah bullets) + `hanukkah.css`
  (amber tokens, chip, canvas glow), loaded after `screens.js` / `common.css`.
- `qr-hanukkah-image.svg` / `qr-hanukkah-video.svg` — real QR codes (ECC H) for
  `utm_campaign=hanukkah-5787`, `utm_medium=image` / `video`.
- `screens/hanukkah/` — real production captures under **three profiles** (made by
  `scripts/capture-hanukkah.mjs`, same rig as `capture.mjs`): `certifiers-p1` + `home-p1`
  (בד״ץ העדה החרדית only), `certifiers-p2` + `home-p2` (בית יוסף only), `preset-p3` +
  `home-p3` (widest preset), `restaurant-p1` (אייס סטורי, a MATCH under P1). `CAPTURE.md`
  records date, URL, profiles, the first cards of every list and the pills in view;
  `profiles.json` is the same in machine form. **Guardrail:** the script refuses a home shot
  that shows any ✕ / ? pill — a named restaurant is never shamed in an ad — and falls back to
  הרבנות המקומית ירושלים for P2 if בית יוסף cannot produce a MATCH-only list (it could, so
  no fallback was needed; the video's beat-3 subline is hard-coded to the certifier used).

### Re-capture and re-render

```sh
cd marketing/winter-5787
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
node scripts/capture-hanukkah.mjs                  # -> src/screens/hanukkah/ (+ CAPTURE.md, profiles.json)
node scripts/render.mjs hanukkah                   # everything -> out/kashroot-hanukkah-5787-*
node scripts/render.mjs hanukkah images            # stills only
FRAMES_DIR=/path/to/video-frames-hanukkah node scripts/render.mjs hanukkah video
```

If the capture picked a different P2 certifier (see `CAPTURE.md`), change the beat-3 subline
in `src/hanukkah-video.html` ("בית יוסף — ורק הוא") to match before rendering.
