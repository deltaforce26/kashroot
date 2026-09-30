// Records the real Kashroot PWA (mock API) walkthrough: preset -> certifiers -> home -> MATCH detail.
import { chromium } from "playwright";
import fs from "node:fs";
import { startCapture, resample } from "./capture.mjs";

const BASE = process.env.KASHROOT_BASE ?? "http://127.0.0.1:5199";
const DIR = "frames/app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--force-device-scale-factor=3"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "he-IL", isMobile: true, hasTouch: true, reducedMotion: "no-preference",
});
const page = await ctx.newPage();
const hide = () => page.addStyleTag({ content: ".mock-ribbon{display:none !important} *{scroll-behavior:auto !important}" });

// The mock's Places photo placeholders carry a "MOCK PLACES PHOTO n" label; serve the same
// SVG art without that label so the promo does not show test copy in the hero.
await page.route("**/mock/places/*.svg", async (route) => {
  const res = await route.fetch();
  const body = (await res.text()).replace(/<text[\s\S]*?<\/text>/g, "");
  await route.fulfill({ response: res, body, headers: { ...res.headers(), "content-type": "image/svg+xml" } });
});

// Fresh storage: onboarding + launch animation from scratch.
await page.goto(BASE + "/onboarding/preset");
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.waitForTimeout(300);

const cap = await startCapture(page, DIR, { maxWidth: 1170, maxHeight: 2532, quality: 92 });
cap.mark("start");
await page.goto(BASE + "/onboarding/preset");
await hide();
cap.mark("preset");                                  // launch animation plays into the preset screen
await sleep(3400);
await page.tap("button[aria-pressed] >> nth=2");     // בד״צים נבחרים בלבד
cap.mark("preset-picked");
await sleep(1300);
await page.tap("button.cta");                         // המשך
await hide();
cap.mark("certifiers");                               // requirements picker is hidden on main now: just the list
await sleep(2600);
await page.tap("button.cta");                         // סיום — הצגת התאמות
await hide();
cap.mark("home");
await page.waitForSelector("a[href='/r/r-hapisga']");
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
await page.tap("a[href='/r/r-hapisga']");            // MATCH: מזנון הפסגה (Badatz Mehadrin — Rubin), has Places photo + hours
await hide();
cap.mark("detail");
await page.waitForSelector("text=למה זה מתאים לך");
await sleep(2600);                                    // hero photo + verdict pill
await scrollBy(300, 1600);                            // evidence panel + certificate card + gallery
cap.mark("detail-scrolled");
await sleep(2100);
await scrollBy(330, 1600);                            // gallery + opening hours; sticky action bar stays
cap.mark("detail-scrolled2");
await sleep(2300);
cap.mark("end");
const meta = await cap.stop();
await browser.close();
const endT = meta.marks.find((m) => m.name === "end").t;
const n = resample(meta, "frames/app30", { fps: 30, start: 0, end: endT });
console.log("captured", meta.frames.length, "frames; resampled", n, "at 30fps; duration", endT.toFixed(2));
console.log(meta.marks.map((m) => `${m.name}@${m.t.toFixed(2)}`).join("  "));
