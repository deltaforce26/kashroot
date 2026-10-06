// Captures the real app (production by default) for the Hanukkah 5787 set. See ../README.md.
//   node scripts/capture-hanukkah.mjs                      -> src/screens/hanukkah/*.png + CAPTURE.md + profiles.json
//   CAPTURE_URL=http://127.0.0.1:5199 node scripts/capture-hanukkah.mjs   (local dev server)
//
// Same rig as capture.mjs (390x844 @3x, he-IL, Bayit VeGan geolocation, iPhone safe-area
// insets emulated, PWA banner dismissed) but three kashrut profiles, so the video can show
// three people at one table getting three different — real — answers:
//   P1 "סבא"     custom preset, certifiers = בד"ץ העדה החרדית only
//   P2 "הגיסה"   custom preset, certifiers = בית יוסף only (falls back to the Jerusalem
//                local Rabbanut if the app cannot produce a MATCH-only home list for it)
//   P3 "בן הדוד" the widest preset, "כל תעודת כשרות"
// Guardrail: no screen used in an ad may show a named restaurant with a ✕/? pill, so every
// home shot is checked to have MATCH pills only in view; otherwise it is not written.
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
const OUT = resolve(ROOT, 'src', 'screens', 'hanukkah');
mkdirSync(OUT, { recursive: true });
const JERUSALEM = { latitude: 31.7655, longitude: 35.1805 }; // Bayit VeGan, Jerusalem
const SAFE_TOP = 59, SAFE_BOTTOM = 34;
const PRESET_CUSTOM = 'מותאם אישית', PRESET_ANY = 'כל תעודת כשרות';
const PREFERRED_RESTAURANT = 'אייס סטורי';
// Each profile: preferred certifier regexes in order; the first one offered by the app is used.
const PROFILES = [
  { id: 'p1', persona: 'סבא', preset: PRESET_CUSTOM, want: [/העדה החרדית/] },
  { id: 'p2', persona: 'הגיסה', preset: PRESET_CUSTOM, want: [/בית יוסף/, /רבנות.*ירושלים/] },
  { id: 'p3', persona: 'בן הדוד', preset: PRESET_ANY, want: [] },
];

const log = (...a) => console.log('[capture-hanukkah]', ...a);
const notes = [];
const files = [];
const result = { captured: new Date().toISOString().slice(0, 10), url: BASE, profiles: {} };

const browser = await chromium.launch();
async function newContext() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'he-IL', timezoneId: 'Asia/Jerusalem', geolocation: JERUSALEM, permissions: ['geolocation'],
    colorScheme: 'light',
  });
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
  await page.screenshot({ path: resolve(OUT, name), type: 'png' });
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

const cardList = (page, n = 8) => page.$$eval('.card', (els, n) => els.slice(0, n).map(e => (e.querySelector('.card__title')?.textContent || '').trim() + ' [' + ([...e.querySelector('.verdict')?.classList || []].find(c => c.startsWith('verdict--')) || '') + ']'), n);

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
  await page.waitForSelector('.card .verdict', { timeout: 40000 }).catch(() => {});
  await waitForTilePhotos(page);
  return place;
}

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
  if (stable < 6) notes.push('some tile photos had not decoded within 20 s');
}

/** Onboarding with the given preset (+ exactly one custom certifier); returns the page on home. */
async function onboard(page, profile, certRe) {
  await goto(page, '/onboarding/preset');
  await page.waitForSelector('.select-row', { timeout: 30000 });
  await page.click(`.select-row:has-text("${profile.preset}")`);
  await page.waitForSelector('.select-row[aria-pressed="true"]');
  let picked = null;
  if (profile.preset === PRESET_CUSTOM) {
    await page.click('button.cta:not([disabled])');
    await page.waitForURL(/\/onboarding\/certifiers/, { timeout: 30000 });
    await page.waitForSelector('.certifier-row', { timeout: 30000 });
    const names = await page.$$eval('.certifier-row__name', els => els.map(e => e.textContent.trim()));
    log('certifiers offered:', names.join(' | '));
    picked = names.find(x => certRe.test(x));
    if (!picked) throw new Error(`certifier matching ${certRe} not offered`);
    // "מותאם אישית" arrives with every Badatz pre-checked; this person accepts exactly one.
    for (let guard = 0; guard < 40 && await page.locator('.certifier-row[aria-checked="true"]').count() > 0; guard++) {
      await page.locator('.certifier-row[aria-checked="true"]').first().click();
      await page.waitForTimeout(60);
    }
    const row = page.locator('.certifier-row').filter({ has: page.locator('.certifier-row__name', { hasText: picked }) }).first();
    await row.click();
    await page.waitForSelector('.certifier-row[aria-checked="true"]');
    // keep the ticked row in view (the list may be longer than the screen)
    await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
    await shot(page, `certifiers-${profile.id}.png`, `certifier picker, selected: ${picked} (only)`);
  } else {
    await shot(page, `preset-${profile.id}.png`, `presets screen, "${profile.preset}" selected`);
  }
  await page.click('button.cta:not([disabled])');
  await page.waitForURL(u => !u.pathname.startsWith('/onboarding'), { timeout: 30000 });
  await emulateSafeArea(page);
  return picked;
}

// ---------------------------------------------------------------------------------------
// Three profiles -> home at scroll top (MATCH pills only, or the shot is refused)
// ---------------------------------------------------------------------------------------
let p1 = null; // kept open for the restaurant shot
for (const profile of PROFILES) {
  const tries = profile.preset === PRESET_CUSTOM ? profile.want : [null];
  let done = false;
  // two attempts per certifier: the first navigation of a run can hit a cold production start
  for (const certRe of tries.flatMap(t => [t, t])) {
    const ctx = await newContext();
    const page = await ctx.newPage();
    let picked;
    try { picked = await onboard(page, profile, certRe); } catch (e) { notes.push(`${profile.id}: ${e.message.split('\n')[0]} — retried`); await ctx.close(); continue; }
    const place = await ensureJerusalemHome(page);
    await page.evaluate(() => document.querySelector('.shell__scroll')?.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const counts = await verdictCounts(page);
    const cards = await cardList(page);
    log(profile.id, picked || profile.preset, 'header:', place, 'pills in view:', counts);
    if (counts.match === 0 || counts.no_match + counts.unknown > 0) {
      // Not usable in an ad: either empty, or a named restaurant with a ✕/? pill in view.
      notes.push(`${profile.id} with ${picked || profile.preset}: home top showed ${JSON.stringify(counts)} — not usable (MATCH-only rule); ${certRe && tries.indexOf(certRe) < tries.length - 1 ? 'trying the next certifier' : 'retrying'}`);
      files.pop(); // drop the certifier/preset shot of this attempt from the list (file is overwritten by the next try)
      await ctx.close();
      continue;
    }
    await shot(page, `home-${profile.id}.png`, `home at scroll top, profile = ${picked ? `"${picked}" only` : `preset "${profile.preset}"`}, header "${place}", pills in view: ${JSON.stringify(counts)}; first cards: ${cards.join('; ')}`);
    result.profiles[profile.id] = { persona: profile.persona, preset: profile.preset, certifier: picked, fallback: certRe ? tries.indexOf(certRe) > 0 : false, header: place, pills: counts, cards };
    if (profile.id === 'p1') p1 = { ctx, page }; else await ctx.close();
    done = true;
    break;
  }
  if (!done) notes.push(`${profile.id}: no usable home capture`);
}

// ---------------------------------------------------------------------------------------
// restaurant-p1: a MATCH restaurant under סבא's profile (אייס סטורי if it is a MATCH)
// ---------------------------------------------------------------------------------------
if (p1) {
  const { ctx, page } = p1;
  let target = page.locator('.card', { has: page.locator('.verdict--match') }).filter({ hasText: PREFERRED_RESTAURANT }).first();
  for (let i = 0; i < 6 && await target.count() === 0; i++) {
    const more = page.locator('.load-more button');
    if (await more.count() === 0) break;
    await more.click();
    await page.waitForTimeout(1200);
  }
  if (await target.count() === 0) {
    await goto(page, '/search?q=' + encodeURIComponent(PREFERRED_RESTAURANT));
    await page.waitForSelector('.card, .hint', { timeout: 20000 }).catch(() => {});
    await settle(page);
    target = page.locator('.card', { has: page.locator('.verdict--match') }).filter({ hasText: PREFERRED_RESTAURANT }).first();
    if (await target.count() === 0) {
      notes.push(`"${PREFERRED_RESTAURANT}" not a MATCH under p1 — used the first MATCH card on home instead`);
      await goto(page, '/');
      await ensureJerusalemHome(page);
      target = page.locator('.card', { has: page.locator('.verdict--match') }).first();
    }
  }
  const restaurantName = (await target.locator('.card__title').first().textContent()).trim();
  const href = await target.locator('a[href^="/r/"]').first().getAttribute('href');
  await goto(page, href);
  await page.waitForSelector('.panel.glass', { timeout: 30000 });
  await page.waitForSelector('.evidence__row', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.shell__scroll').scrollTo(0, 0));
  const verdictText = await page.evaluate(() => document.querySelector('.verdict')?.textContent.trim() || '');
  if (!/match/.test(await page.evaluate(() => [...document.querySelector('.verdict')?.classList || []].join(' ')) || '') || /no_match/.test(await page.evaluate(() => document.querySelector('.verdict')?.className || ''))) {
    notes.push(`restaurant "${restaurantName}" is not a MATCH on its detail page (pill "${verdictText}") — restaurant-p1.png not written`);
  } else {
    await shot(page, 'restaurant-p1.png', `restaurant "${restaurantName}" (${href}) under p1 at scroll top, verdict pill "${verdictText}"`);
    result.restaurant = { name: restaurantName, href, verdict: verdictText };
  }
  await ctx.close();
}
await browser.close();

writeFileSync(resolve(OUT, 'profiles.json'), JSON.stringify(result, null, 2));
const P = result.profiles;
const prof = (id) => P[id] ? (P[id].certifier ? `preset "${P[id].preset}" → certifier "${P[id].certifier}" only${P[id].fallback ? ' (fallback — the preferred certifier gave no MATCH-only home list)' : ''}` : `preset "${P[id].preset}" (every certifier whitelisted)`) : '— not captured';
const md = `# Hanukkah 5787 screen captures

Real app screens, captured with Playwright by \`scripts/capture-hanukkah.mjs\` — nothing hand-drawn.

- **Captured:** ${result.captured}
- **URL:** ${BASE}${BASE.includes('kashroot.app') ? ' (production, live API)' : ' (local)'}
- **Viewport:** 390×844 CSS px @3x → 1170×2532 PNG, he-IL, Asia/Jerusalem, geolocation = Jerusalem (${JERUSALEM.latitude}, ${JERUSALEM.longitude}), light scheme. iPhone safe-area insets emulated (top ${SAFE_TOP}px, bottom ${SAFE_BOTTOM}px).
- **Profiles** (no required attributes; the attributes picker is hidden in the current app):
  - **P1 "סבא":** ${prof('p1')}
  - **P2 "הגיסה":** ${prof('p2')}
  - **P3 "בן הדוד":** ${prof('p3')}
- **Restaurant (P1):** ${result.restaurant ? `${result.restaurant.name} (${result.restaurant.href}), verdict "${result.restaurant.verdict}"` : '— not captured'}
- **Guardrail:** every home shot was checked to show MATCH pills only in view (a named restaurant with a ✕/? pill is never used in an ad). Machine-readable summary in \`profiles.json\`.

## Files

${files.map(f => `- \`${f.name}\` — ${f.state}`).join('\n')}

${notes.length ? '## Notes\n\n' + notes.map(n => `- ${n}`).join('\n') + '\n' : ''}`;
writeFileSync(resolve(OUT, 'CAPTURE.md'), md);
log('wrote CAPTURE.md');
if (notes.length) log('notes:', notes);
