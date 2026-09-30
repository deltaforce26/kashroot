// Records the live Kashroot PWA walkthrough: preset -> certifiers -> home (Jerusalem) -> MATCH detail.
//   KASHROOT_BASE=https://kashroot.app node record-app.mjs
// Defaults target the live site; point KASHROOT_BASE at a dev server to record a local build.
import { chromium } from "playwright";
import { startCapture, resample } from "./capture.mjs";

const BASE = process.env.KASHROOT_BASE ?? "https://kashroot.app";
// The MATCH restaurant opened in the last shot. Default: אייס סטורי (Badatz Eda Haredit, שמגר 14,
// Jerusalem) — verdict `match` under the "בד״צים נבחרים" preset, 10 Google Places photos, hours.
const RESTAURANT = process.env.KASHROOT_RESTAURANT ?? "f56be1e8-5f5b-4126-931d-a294e23b960d";
// Where the device "is": the app has no city picker, it searches around the device position,
// so the home grid is Jerusalem because the granted geolocation says so. Default: next to the
// restaurant above, which puts it first in the grid.
const ORIGIN = {
  latitude: Number(process.env.KASHROOT_LAT ?? 31.7936),
  longitude: Number(process.env.KASHROOT_LON ?? 35.2096),
};
const DIR = "frames/app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--force-device-scale-factor=3"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "he-IL", isMobile: true, hasTouch: true, reducedMotion: "no-preference",
  geolocation: ORIGIN, permissions: ["geolocation"],
});
const page = await ctx.newPage();
const hide = () => page.addStyleTag({ content: "*{scroll-behavior:auto !important}" });

// Fresh storage: onboarding + launch animation from scratch (the launch screen keys off sessionStorage).
await page.goto(BASE + "/onboarding/preset");
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.waitForTimeout(300);

const cap = await startCapture(page, DIR, { maxWidth: 1170, maxHeight: 2532, quality: 92 });
cap.mark("start");
await page.goto(BASE + "/onboarding/preset");
await hide();
cap.mark("preset");                                  // launch animation plays into the preset screen
await sleep(3400);
await page.tap("button[aria-pressed] >> nth=2");     // בד״צים נבחרים בלבד (PRESET_ORDER: any, mehadrin, badatz, custom)
cap.mark("preset-picked");
await sleep(1300);
await page.tap("button.cta");                         // המשך
await hide();
cap.mark("certifiers");                               // certifier list only; no requirements picker on this step
await page.waitForSelector("button.cta:not([disabled])");
await sleep(2600);
await page.tap("button.cta");                         // סיום — הצגת התאמות
await hide();
cap.mark("home");
const cardLink = `a.card__link[href='/r/${RESTAURANT}']`;
await page.waitForSelector(cardLink, { timeout: 20000 });   // live API answered; verdict pills are on the cards
await sleep(2200);
const scrollBy = async (dy, ms) => {
  await page.evaluate(async ({ dy, ms }) => {
    const cands = [document.scrollingElement, ...document.querySelectorAll("*")].filter(
      (e) => e && e.scrollHeight > e.clientHeight + 4 && ["auto", "scroll"].includes(getComputedStyle(e).overflowY) || e === document.scrollingElement && e.scrollHeight > e.clientHeight + 4,
    );
    const el = cands.sort((a, b) => b.clientHeight - a.clientHeight)[0] || document.scrollingElement;
    let pulse = document.getElementById("__pulse");
    if (!pulse) { pulse = document.createElement("div"); pulse.id = "__pulse"; pulse.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;background:#000;opacity:0.01;z-index:99999"; document.body.appendChild(pulse); }
    const from = el.scrollTop; const t0 = performance.now(); let tick = 0;
    const ease = (x) => 0.5 - Math.cos(Math.PI * x) / 2;
    await new Promise((res) => {
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        el.scrollTop = from + dy * ease(p);
        pulse.style.opacity = (++tick % 2) ? "0.012" : "0.011";
        if (p < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }, { dy, ms });
};
await scrollBy(330, 1400);
cap.mark("home-scrolled");
await sleep(1200);
await scrollBy(-330, 1000);
await sleep(900);
await page.tap(cardLink);                             // MATCH detail: hero photo + verdict pill
await hide();
cap.mark("detail");
await page.waitForSelector("text=למה זה מתאים לך");
// Hold the hero only once the Google Places photo has actually painted (second, slower request).
await page.waitForFunction(
  () => { const i = document.querySelector("img.detail-hero__img"); return Boolean(i && i.complete && i.naturalWidth > 0); },
  null, { timeout: 8000 },
).catch(() => console.warn("hero photo did not load in time; continuing"));
await sleep(2500);                                    // hero photo + verdict pill
await scrollBy(300, 1600);                            // evidence panel (למה זה מתאים לך) + certificate card
cap.mark("detail-scrolled");
await sleep(2100);
await scrollBy(330, 1600);                            // gallery + opening hours; sticky Waze / Maps bar stays
cap.mark("detail-scrolled2");
await sleep(2300);
cap.mark("end");
const meta = await cap.stop();
await browser.close();
const endT = meta.marks.find((m) => m.name === "end").t;
const n = resample(meta, "frames/app30", { fps: 30, start: 0, end: endT });
console.log("captured", meta.frames.length, "frames; resampled", n, "at 30fps; duration", endT.toFixed(2));
console.log(meta.marks.map((m) => `${m.name}@${m.t.toFixed(2)}`).join("  "));
