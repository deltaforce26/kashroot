import { chromium } from "playwright";
import { startCapture, resample } from "./capture.mjs";
const BASE = "http://127.0.0.1:5198";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAPTIONS = [
  { id: "cap1", h: "מגדירים את הסטנדרט שלכם פעם אחת", s: "בוחרים את גופי הכשרות שאתם מקבלים" },
  { id: "cap2", h: "כל מסעדה מקבלת תשובה, לא ציון", s: "מתאים לך · לא מאומת — לפי מה שכתוב בתעודה" },
  { id: "cap3", h: "כל שורה נסמכת על התעודה עצמה", s: "מי נתן אותה, מה כתוב בה, ועד מתי היא בתוקף" },
];
const browser = await chromium.launch();
async function animated(name, seconds) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${name}.html`); await page.evaluate(() => document.fonts.ready); await sleep(300);
  const cap = await startCapture(page, `frames/${name}`, { maxWidth: 1080, maxHeight: 1080, quality: 95 });
  await page.evaluate(() => document.body.classList.add("go")); await sleep(seconds * 1000);
  const meta = await cap.stop(); await ctx.close();
  console.log(name, resample(meta, `frames/${name}30`, { fps: 30, start: 0, end: seconds }));
}
await animated("intro-sq", 4.0);
await animated("outro-sq", 5.5);
{ const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 } }); const page = await ctx.newPage();
  await page.goto(`${BASE}/frame-sq.html`); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "frames/frame-sq.png", omitBackground: true }); await ctx.close(); }
{ const ctx = await browser.newContext({ viewport: { width: 520, height: 420 } }); const page = await ctx.newPage();
  for (const c of CAPTIONS) { await page.goto(`${BASE}/caption-sq.html?h=${encodeURIComponent(c.h)}&s=${encodeURIComponent(c.s)}`);
    await page.evaluate(() => document.fonts.ready); await sleep(100);
    await page.screenshot({ path: `frames/${c.id}-sq.png`, omitBackground: true }); }
  await ctx.close(); }
await browser.close(); console.log("sq cards done");
