// Captures the real app (production by default) for the winter-5787 campaign. See ../README.md.
//   node scripts/capture.mjs                       -> src/screens/*.png + CAPTURE.md + boxes.json
//   CAPTURE_URL=http://127.0.0.1:5199 node scripts/capture.mjs   (local mock fallback)
//
// Every screenshot is a 390x844 viewport at 3x (1170x2532), no browser chrome. The flow is
// the demo run-sheet's: onboarding -> "מותאם אישית" -> pick certifiers -> home (Jerusalem)
// -> a MATCH restaurant -> its evidence panel. Nothing is drawn by hand; the only thing
// injected is the iPhone safe-area inset (headless Chromium reports env(safe-area-inset-*)
// as 0, so the app's own CSS is re-applied with 59px/34px — the iPhone 14 Pro values —
// which is how the app lays itself out under a dynamic island on a real device).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ['playwright', resolve(process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules', 'playwright')]) {
    try { return req(c); } catch (e) { /* try next */ }
  }
  throw new Error('playwright not found: run `npm i playwright@1.56.1` in marketing/winter-5787 (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)');
}
const { chromium } = loadPlaywright();

const BASE = (process.env.CAPTURE_URL || 'https://www.kashroot.app').replace(/\/$/, '');
const OUT = resolve(ROOT, 'src', 'screens');
mkdirSync(OUT, { recursive: true });
const JERUSALEM = { latitude: 31.7683, longitude: 35.2137 };
const SAFE_TOP = 59, SAFE_BOTTOM = 34;
// Run-sheet certifiers: Badatz Eda Haredit (אייס סטורי) and Badatz Mehadrin (Rubin).
const PICK_CERTIFIERS = [/העדה החרדית/, /רובין/];
const PREFERRED_RESTAURANT = 'אייס סטורי';
const PRESET_CUSTOM = 'מותאם אישית', PRESET_ANY = 'כל תעודת כשרות';

const log = (...a) => console.log('[capture]', ...a);
const notes = [];
const files = [];

const browser = await chromium.launch();
async function newContext() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem', geolocation: JERUSALEM, permissions: ['geolocation'],
    colorScheme: 'light',
  });
  // The PWA install banner is a per-device nag, not a screen; dismiss it as a user would have.
  await ctx.addInitScript(() => { try { localStorage.setItem('kashroot.install.dismissed', '1'); } catch (e) { /* ignore */ } });
  return ctx;
}

/** Re-apply the app's stylesheets with iPhone safe-area insets substituted for env(). */
async function emulateSafeArea(page) {
  await page.evaluate(async ({ top, bottom }) => {
    if (document.getElementById('pw-safe-area')) return;
    let css = '';
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      try { css += await (await fetch(link.href)).text(); } catch (e) { /* ignore */ }
    }
    for (const st of document.querySelectorAll('style:not(#pw-safe-area)')) css += st.textContent;
    const out = css.replace(/env\(safe-area-inset-top\)/g, `${top}px`).replace(/env\(safe-area-inset-bottom\)/g, `${bottom}px`)
      .replace(/env\(safe-area-inset-(left|right)\)/g, '0px');
    const el = document.createElement('style');
    el.id = 'pw-safe-area';
    el.textContent = out;
    document.head.appendChild(el);
  }, { top: SAFE_TOP, bottom: SAFE_BOTTOM });
}

async function settle(page, ms = 600) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  // visible <img>s decoded (restaurant photos come from Google and trickle in)
  await page.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
  await page.waitForTimeout(ms);
}

async function goto(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell', { timeout: 30000 });
  await emulateSafeArea(page);
}

async function shot(page, name, state) {
  await settle(page);
  const file = resolve(OUT, name);
  await page.screenshot({ path: file, type: 'png' });
  files.push({ name, state });
  log('wrote', name, '—', state);
}

async function verdictCounts(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight, c = { match: 0, no_match: 0, unknown: 0 };
    for (const el of document.querySelectorAll('.card .verdict')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) for (const k of Object.keys(c)) if (el.classList.contains('verdict--' + k)) c[k]++;
    }
    return c;
  });
}

async function headerPlace(page) {
  return page.evaluate(() => {
    const h = document.querySelector('.shell__header');
    return h ? h.innerText.replace(/\s+/g, ' ').trim() : '';
  });
}

/** Home must be scoped to Jerusalem: device fix (granted above) or, failing that, the city picker. */
async function ensureJerusalemHome(page) {
  await page.waitForSelector('.card, .load-more, .hint', { timeout: 40000 }).catch(() => {});
  let place = await headerPlace(page);
  if (!/מחפשים ליד|מחפשים בעיר/.test(place) || /כל הארץ/.test(place)) {
    log('device origin not in force (header:', place, ') — picking Jerusalem via the location sheet');
    await page.click('.shell__header .circle.glass');
    await page.fill('.sheet__address .searchbar__input', 'ירושלים');
    await page.press('.sheet__address .searchbar__input', 'Enter');
    await page.waitForSelector('.sheet__result', { timeout: 15000 });
    await page.click('.sheet__result >> nth=0');
    await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 }).catch(() => {});
    place = await headerPlace(page);
  }
  await page.waitForSelector('.card .verdict', { timeout: 40000 });
  await waitForTilePhotos(page);
  return place;
}

/**
 * Every grid tile that announces a Google photo (credit line) has decoded it. The credit
 * itself only appears after a lazy per-tile enrichment fetch, so the condition must hold
 * steadily (1.5 s) rather than once — or 20 s pass and a note is taken.
 */
async function waitForTilePhotos(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const ok = () => page.evaluate(() => [...document.querySelectorAll('.card--grid')]
    .filter(c => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })
    .every(c => !c.querySelector('.tile__credit') || (c.querySelector('.tile__img--in') && c.querySelector('.tile__img').naturalWidth > 0)));
  let stable = 0;
  for (let i = 0; i < 80 && stable < 6; i++) {
    stable = (await ok()) ? stable + 1 : 0;
    await page.waitForTimeout(250);
  }
  if (stable < 6) notesPush('some tile photos had not decoded within 20 s');
}
const notesPush = (n) => notes.push(n);

// ---------------------------------------------------------------------------------------
// A. "any certification" profile -> home (the before-state of the "answer, not score" beat)
// ---------------------------------------------------------------------------------------
{
  const ctx = await newContext();
  const page = await ctx.newPage();
  await goto(page, '/onboarding/preset');
  await page.waitForSelector('.select-row', { timeout: 30000 });
  await page.click(`.select-row:has-text("${PRESET_ANY}")`);
  await page.click('button.cta:not([disabled])');
  await page.waitForURL(u => !u.pathname.startsWith('/onboarding'), { timeout: 30000 });
  await emulateSafeArea(page);
  const place = await ensureJerusalemHome(page);
  const c = await verdictCounts(page);
  await shot(page, 'home-noprofile.png', `home with the widest preset "${PRESET_ANY}" (every certifier whitelisted), header "${place}", pills in view: ${JSON.stringify(c)}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
// B. The run-sheet path: custom profile -> home -> MATCH restaurant -> evidence
// ---------------------------------------------------------------------------------------
const ctx = await newContext();
const page = await ctx.newPage();
await goto(page, '/onboarding/preset');
await page.waitForSelector('.select-row', { timeout: 30000 });
await page.click(`.select-row:has-text("${PRESET_CUSTOM}")`);
await page.waitForSelector(`.select-row[aria-pressed="true"]`);
await shot(page, 'onboarding-preset.png', `presets screen, "${PRESET_CUSTOM}" selected`);
await page.click('button.cta:not([disabled])');
await page.waitForURL(/\/onboarding\/certifiers/, { timeout: 30000 });
await page.waitForSelector('.certifier-row', { timeout: 30000 });
const names = await page.$$eval('.certifier-row__name', els => els.map(e => e.textContent.trim()));
log('certifiers offered:', names.join(' | '));
const picks = [];
for (const re of PICK_CERTIFIERS) {
  const n = names.find(x => re.test(x));
  if (n) picks.push(n); else notes.push(`certifier matching ${re} not offered; fell back to the next row`);
}
while (picks.length < 2) picks.push(names.find(n => !picks.includes(n)));
// "מותאם אישית" arrives with every Badatz pre-checked; a user who wants two un-ticks the rest.
// Clear them all first so the sequence is 0 -> 1 -> 2 ticks, as the storyboard wants.
for (let guard = 0; guard < 40 && await page.locator('.certifier-row[aria-checked="true"]').count() > 0; guard++) {
  await page.locator('.certifier-row[aria-checked="true"]').first().click();
  await page.waitForTimeout(60);
}
await shot(page, 'onboarding-certifiers-0.png', 'certifier picker, nothing selected (the preset pre-checks every Badatz; all un-ticked first)');
for (let i = 0; i < 2; i++) {
  // names carry a double quote (בד"ץ), so no CSS string here — a text filter instead
  await page.locator('.certifier-row').filter({ has: page.locator('.certifier-row__name', { hasText: picks[i] }) }).first().click();
  await page.waitForSelector(`.certifier-row[aria-checked="true"] >> nth=${i}`);
  await shot(page, `onboarding-certifiers-${i + 1}.png`, `certifier picker, selected: ${picks.slice(0, i + 1).join(', ')}`);
}
await page.click('button.cta:not([disabled])');
await page.waitForURL(u => !u.pathname.startsWith('/onboarding'), { timeout: 30000 });
await emulateSafeArea(page);
const homePlace = await ensureJerusalemHome(page);
let counts = await verdictCounts(page);
log('home header:', homePlace, 'pills in view:', counts);
// Results are ordered gate -> fit, so every MATCH precedes every NO_MATCH: the top of the
// list is the places you can eat at (home.png). The verdict mix lives at the boundary,
// further down; home-mix.png is the same list scrolled there.
const homeCards = await page.$$eval('.card', els => els.slice(0, 8).map(e => (e.querySelector('.card__title')?.textContent || '').trim() + ' [' + ([...e.querySelector('.verdict')?.classList || []].find(c => c.startsWith('verdict--')) || '') + ']'));
await shot(page, 'home.png', `home at scroll top, profile = ${picks.join(' + ')}, header "${homePlace}", pills in view: ${JSON.stringify(counts)}; first cards: ${homeCards.join('; ')}`);
{
  let found = false;
  for (let step = 0; step < 80; step++) {
    counts = await verdictCounts(page);
    if (counts.match > 0 && counts.no_match + counts.unknown > 0) { found = true; break; }
    const atEnd = await page.evaluate(() => { const s = document.querySelector('.shell__scroll'); return s.scrollTop + s.clientHeight >= s.scrollHeight - 2; });
    if (atEnd) {
      const more = page.locator('.load-more button');
      if (await more.count() === 0) break;
      await more.click();
      await page.waitForTimeout(1500);
    }
    await page.evaluate(() => document.querySelector('.shell__scroll').scrollBy(0, 220));
    await page.waitForTimeout(250);
  }
  if (found) {
    // nudge so the boundary sits around the middle of the screen, then let the photos land
    await page.evaluate(() => {
      const s = document.querySelector('.shell__scroll');
      const first = [...document.querySelectorAll('.card')].find(c => c.querySelector('.verdict--no_match, .verdict--unknown'));
      const r = first.getBoundingClientRect();
      s.scrollBy(0, r.top - window.innerHeight * 0.585); // one full MATCH row above it, its own row clear of the tab bar
    });
    await page.waitForTimeout(300);
    await waitForTilePhotos(page);
    counts = await verdictCounts(page);
    const st = await page.evaluate(() => document.querySelector('.shell__scroll').scrollTop);
    const mixCards = await page.$$eval('.card', els => els.map(e => ({ n: (e.querySelector('.card__title')?.textContent || '').trim(), v: ([...e.querySelector('.verdict')?.classList || []].find(c => c.startsWith('verdict--')) || ''), r: e.getBoundingClientRect() })).filter(c => c.r.bottom > 0 && c.r.top < innerHeight).map(c => `${c.n} [${c.v}]`));
    await shot(page, 'home-mix.png', `same home list scrolled ${st}px to the MATCH/NO_MATCH boundary, pills in view: ${JSON.stringify(counts)}; cards: ${mixCards.join('; ')}`);
  } else {
    notes.push('no NO_MATCH/UNKNOWN card reachable on the home list; home-mix.png not written');
  }
}

// Restaurant: the run-sheet's MATCH (אייס סטורי) if it is on the list, else the first MATCH card.
await page.evaluate(() => document.querySelector('.shell__scroll').scrollTo(0, 0));
let target = page.locator('.card', { has: page.locator('.verdict--match') }).filter({ hasText: PREFERRED_RESTAURANT }).first();
if (await target.count() === 0) {
  // keep loading pages until it shows up or the list ends (bounded)
  for (let i = 0; i < 6 && await target.count() === 0; i++) {
    const more = page.locator('.load-more button');
    if (await more.count() === 0) break;
    await more.click();
    await page.waitForTimeout(1200);
  }
}
let viaSearch = false;
if (await target.count() === 0) {
  // not within the home radius: try the name search, which covers the whole corpus
  await goto(page, '/search?q=' + encodeURIComponent(PREFERRED_RESTAURANT));
  await page.waitForSelector('.card, .hint', { timeout: 20000 }).catch(() => {});
  await settle(page);
  target = page.locator('.card', { has: page.locator('.verdict--match') }).filter({ hasText: PREFERRED_RESTAURANT }).first();
  viaSearch = await target.count() > 0;
  if (!viaSearch) {
    notes.push(`"${PREFERRED_RESTAURANT}" not on the home list and not a MATCH in name search — used the first MATCH card on home instead`);
    await goto(page, '/');
    await ensureJerusalemHome(page);
    target = page.locator('.card', { has: page.locator('.verdict--match') }).first();
  }
}
const restaurantName = (await target.locator('.card__title').first().textContent()).trim();
const href = await target.locator('a[href^="/r/"]').first().getAttribute('href');
log('restaurant:', restaurantName, href);
await goto(page, href);
await page.waitForSelector('.panel.glass', { timeout: 30000 });
await page.waitForSelector('.evidence__row', { timeout: 30000 });
await page.evaluate(() => document.querySelector('.shell__scroll').scrollTo(0, 0));
const verdictText = await page.evaluate(() => document.querySelector('.verdict')?.textContent.trim() || '');
await shot(page, 'restaurant.png', `restaurant "${restaurantName}" (${href}) at scroll top, verdict pill "${verdictText}"`);
// Evidence: scroll so the "why it matches you" panel and the certificate card are both in view.
const boxes = await page.evaluate(() => {
  const sc = document.querySelector('.shell__scroll');
  const ev = document.querySelector('.evidence')?.closest('section.panel');
  const cert = document.querySelector('.cert-card');
  const evTop = ev.getBoundingClientRect().top + sc.scrollTop;
  const certBottom = cert.getBoundingClientRect().bottom + sc.scrollTop;
  const shellTop = sc.getBoundingClientRect().top;
  // centre the pair in the scroll area, but never above the panel's top
  const want = Math.max(0, Math.min(evTop - shellTop - 24, evTop - shellTop - (sc.clientHeight - (certBottom - evTop)) / 2));
  sc.scrollTo(0, want);
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { scrollTop: sc.scrollTop, evidence: r(ev), certificate: r(cert), viewport: { w: window.innerWidth, h: window.innerHeight } };
});
await page.waitForTimeout(400);
boxes.evidence_lines = await page.$$eval('.evidence__row', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
await shot(page, 'restaurant-evidence.png', `same restaurant scrolled ${boxes.scrollTop}px: evidence panel at y=${boxes.evidence.y}..${boxes.evidence.y + boxes.evidence.h}, certificate card at y=${boxes.certificate.y}..${boxes.certificate.y + boxes.certificate.h} (CSS px of the 390x844 viewport)`);
writeFileSync(resolve(OUT, 'boxes.json'), JSON.stringify(boxes, null, 2));

// Search (optional)
try {
  await goto(page, '/search');
  await page.waitForSelector('.card, .hint, .searchbar', { timeout: 20000 });
  await shot(page, 'search.png', 'search screen, no query');
} catch (e) { notes.push('search.png skipped: ' + e.message.split('\n')[0]); }

await ctx.close();
await browser.close();

const today = new Date().toISOString().slice(0, 10);
const md = `# Campaign screen captures

Real app screens, captured with Playwright by \`scripts/capture.mjs\` — nothing hand-drawn.

- **Captured:** ${today}
- **URL:** ${BASE}${BASE.includes('kashroot.app') ? ' (production, live API)' : ' (local)'}
- **Viewport:** 390×844 CSS px @3x → 1170×2532 PNG, he-IL, Asia/Jerusalem, geolocation = Jerusalem (${JERUSALEM.latitude}, ${JERUSALEM.longitude}), light scheme. iPhone safe-area insets emulated (top ${SAFE_TOP}px, bottom ${SAFE_BOTTOM}px) so the app lays out under the frame's dynamic island as on a device.
- **Profile:** preset "${PRESET_CUSTOM}" → certifiers ${picks.map(p => `"${p}"`).join(' + ')}, no required attributes (the attributes picker is hidden in the current app — see \`web/src/profile/profile.ts\`, so the run-sheet's "require גלאט + חלב ישראל" step is not available today).
- **Restaurant:** ${restaurantName} (${href}), verdict "${verdictText}"
- **Evidence lines:** ${boxes.evidence_lines.map(l => `"${l}"`).join(' · ')}
- **Evidence panel box (CSS px):** ${JSON.stringify(boxes.evidence)}; certificate card: ${JSON.stringify(boxes.certificate)} — also in \`boxes.json\`.

## Files

${files.map(f => `- \`${f.name}\` — ${f.state}`).join('\n')}

${notes.length ? '## Notes\n\n' + notes.map(n => `- ${n}`).join('\n') + '\n' : ''}`;
writeFileSync(resolve(OUT, 'CAPTURE.md'), md);
log('wrote CAPTURE.md');
if (notes.length) log('notes:', notes);
