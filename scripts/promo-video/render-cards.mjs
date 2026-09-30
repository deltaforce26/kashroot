// Renders intro/outro (screencast of CSS animations), the phone frame overlay, and caption PNGs.
import { chromium } from "playwright";
import fs from "node:fs";
import { startCapture, resample } from "./capture.mjs";
const BASE = "http://127.0.0.1:5198";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CAPTIONS = [
  { id: "cap1", h: "מגדירים את הסטנדרט שלכם פעם אחת", s: "בוחרים את גופי הכשרות שאתם מקבלים" },
  { id: "cap2", h: "כל מסעדה מקבלת תשובה, לא ציון", s: "מתאים לך · לא מאומת — לפי מה שכתוב בתעודה" },
  { id: "cap3", h: "כל שורה נסמכת על התעודה עצמה", s: "מי נתן אותה, מה כתוב בה, ועד מתי היא בתוקף" },
];
const browser = await chromium.launch();
async function animated(name, seconds) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${name}.html`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  const cap = await startCapture(page, `frames/${name}`, { maxWidth: 1080, maxHeight: 1920, quality: 95 });
  await page.evaluate(() => document.body.classList.add("go"));
  await sleep(seconds * 1000);
  cap.mark("end");
  const meta = await cap.stop();
  await ctx.close();
  const n = resample(meta, `frames/${name}30`, { fps: 30, start: 0, end: seconds });
  console.log(name, "frames", meta.frames.length, "->", n);
}
await animated("intro", 4.0);
await animated("outro", 5.5);
{
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/frame.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "frames/frame.png", omitBackground: true });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 270 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const c of CAPTIONS) {
    await page.goto(`${BASE}/caption.html?h=${encodeURIComponent(c.h)}&s=${encodeURIComponent(c.s)}`);
    await page.evaluate(() => document.fonts.ready);
    await sleep(100);
    await page.screenshot({ path: `frames/${c.id}.png`, omitBackground: true });
  }
  await ctx.close();
}
await browser.close();
console.log("cards done");
