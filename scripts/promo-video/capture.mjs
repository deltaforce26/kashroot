// CDP screencast capture -> JPEG frames with wall-clock timestamps, plus named marks.
// resample() turns the variable-rate frames into a fixed-fps symlink sequence for ffmpeg.
import fs from "node:fs";
import path from "node:path";

export async function startCapture(page, dir, { maxWidth, maxHeight, quality = 92 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const marks = [];
  let n = 0;
  let stopped = false;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    if (!stopped) {
      const file = path.join(dir, `f${String(n++).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      frames.push({ file, ts: metadata.timestamp });
    }
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth, maxHeight, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  return {
    t0,
    now: () => Date.now() / 1000 - t0,
    mark: (name) => { marks.push({ name, t: Date.now() / 1000 - t0 }); },
    stop: async () => {
      stopped = true;
      await cdp.send("Page.stopScreencast").catch(() => {});
      const meta = { t0, frames: frames.map((f) => ({ file: f.file, t: f.ts - t0 })), marks };
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
      return meta;
    },
  };
}

/** Fixed-fps symlink sequence from [start, end] seconds of a capture. Returns frame count. */
export function resample(meta, outDir, { fps = 30, start = 0, end } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const frames = meta.frames;
  if (!frames.length) throw new Error("no frames captured");
  const last = end ?? Math.max(...meta.marks.map((m) => m.t), frames[frames.length - 1].t);
  const count = Math.round((last - start) * fps);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const t = start + k / fps;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    fs.symlinkSync(path.resolve(frames[j].file), path.join(outDir, `o${String(k).padStart(5, "0")}.jpg`));
  }
  return count;
}
