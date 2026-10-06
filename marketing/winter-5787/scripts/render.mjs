// Renders the winter-5787 campaign assets with Playwright + ffmpeg. See ../README.md.
//   node scripts/render.mjs images   -> out/*.png + *.jpg
//   node scripts/render.mjs video    -> frames -> out/*.mp4 + contact sheet
//   node scripts/render.mjs all
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// playwright: local node_modules first, then the preinstalled global copy (PLAYWRIGHT_MODULE_DIR).
const req = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ['playwright', resolve(process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules', 'playwright')]) {
    try { return req(c); } catch (e) { /* try next */ }
  }
  throw new Error('playwright not found: run `npm i playwright@1.56.1` in marketing/winter-5787 (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)');
}
const { chromium } = loadPlaywright();
const SRC = resolve(ROOT, 'src');
const OUT = resolve(ROOT, 'out');
const FRAMES = process.env.FRAMES_DIR || resolve(ROOT, 'frames');
const NAME = 'kashroot-bein-hazmanim-5787';
const FPS = 30, DURATION_MS = 15000;
const what = process.argv[2] || 'all';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
async function open(file, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(SRC, file)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}
async function stillImage(file, w, h, suffix) {
  const page = await open(file, w, h);
  const png = resolve(OUT, `${NAME}-${suffix}.png`);
  await page.screenshot({ path: png, type: 'png' });
  await page.screenshot({ path: resolve(OUT, `${NAME}-${suffix}.jpg`), type: 'jpeg', quality: 90 });
  await page.close();
  console.log('wrote', png);
}
async function video(file, w, h, suffix, square) {
  const dir = resolve(FRAMES, suffix);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await open(file, w, h);
  if (square) await page.evaluate(() => window.setSquare && window.setSquare());
  const n = Math.round(DURATION_MS / 1000 * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((ms) => window.seek(ms), i * 1000 / FPS);
    await page.screenshot({ path: resolve(dir, `f_${String(i).padStart(4, '0')}.png`), type: 'png' });
    if (i % 60 === 0) console.log(`frame ${i}/${n}`);
  }
  await page.close();
  const mp4 = resolve(OUT, `${NAME}-${suffix}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', resolve(dir, 'f_%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log('wrote', mp4);
  if (!square) {
    // contact sheet: 10 evenly spaced frames, 5x2 tiles
    const step = Math.floor(n / 10);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4,
      '-vf', `select='not(mod(n\\,${step}))',scale=324:-1,tile=5x2:padding=8:margin=8:color=0xf0eee9`, '-frames:v', '1',
      resolve(OUT, `${NAME}-contact.png`)], { stdio: 'inherit' });
    console.log('wrote contact sheet');
  }
}

if (what === 'images' || what === 'all') {
  await stillImage('image-square.html', 1080, 1080, 'square');
  await stillImage('image-story.html', 1080, 1920, 'story');
}
if (what === 'video' || what === 'all') {
  await video('video.html', 1080, 1920, 'story', false);
  if (what === 'all' || process.env.SQUARE !== '0') await video('video.html', 1080, 1080, 'square', true);
}
if (what === 'square-image') await stillImage('image-square.html', 1080, 1080, 'square');
if (what === 'story-image') await stillImage('image-story.html', 1080, 1920, 'story');
await browser.close();
