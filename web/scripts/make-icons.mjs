/**
 * Generates the PWA icon set as PNGs, with no image dependency.
 *
 * The mark is the one in `public/icons/icon.svg` — the green sprout arch on the
 * bone ground — rasterised here so the SVG stays the single source of truth for
 * the geometry. If you edit the SVG, mirror the numbers in MARK below and run
 * `npm run icons`; output lands in public/icons/ and is committed.
 */
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/** icon.svg, read straight off the file: gradient stops, geometry, transform. */
const BONE = { from: [0xf4, 0xf4, 0xef], to: [0xe2, 0xdd, 0xd2] }; // 0,0 -> S,S
const GREEN = { from: [0x9c, 0xcb, 0x56], to: [0x2f, 0x7a, 0x4d] }; // 20,20 -> 100,100 (mark space)
const CORNER = 120 / 512; // rect rx, as a fraction of the canvas
const MARK = {
  translate: 106,
  scale: 2.5,
  strokeWidth: 16,
  // The arch, as drawn: line, cubic, smooth cubic, line — control points expanded.
  arch: [
    { type: "L", a: [24, 46], b: [24, 58] },
    { type: "C", a: [24, 58], c1: [24, 78], c2: [40, 94], b: [60, 94] },
    { type: "C", a: [60, 94], c1: [80, 94], c2: [96, 78], b: [96, 58] },
    { type: "L", a: [96, 58], b: [96, 46] },
  ],
  seed: { c: [60, 20], r: 9 },
  gradient: { from: [20, 20], to: [100, 100] },
};
const SAMPLES = 4; // per axis; 16 samples/pixel is enough at these sizes

function crc32(buf) {
  let c,
    table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA PNG; `rgba(x, y)` returns [r, g, b, a]. */
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = rgba(x, y);
      raw[row + 1 + x * 4] = p[0];
      raw[row + 2 + x * 4] = p[1];
      raw[row + 3 + x * 4] = p[2];
      raw[row + 4 + x * 4] = p[3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp01(t));

/** Position along a linear gradient axis, as SVG's userSpaceOnUse computes it. */
function axisT(px, py, [x0, y0], [x1, y1]) {
  const dx = x1 - x0,
    dy = y1 - y0;
  return clamp01(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy));
}

function segDist(px, py, [x0, y0], [x1, y1]) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const t = clamp01(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy) || 0);
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

const bezier = (a, c1, c2, b, t) => {
  const u = 1 - t;
  return [0, 1].map(
    (i) => u * u * u * a[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * b[i],
  );
};

/** The arch flattened to a polyline once, then reused for every pixel sample. */
const ARCH_POINTS = (() => {
  const pts = [];
  for (const seg of MARK.arch) {
    if (seg.type === "L") {
      pts.push(seg.a, seg.b);
      continue;
    }
    const steps = 48;
    for (let i = 0; i <= steps; i++) pts.push(bezier(seg.a, seg.c1, seg.c2, seg.b, i / steps));
  }
  return pts;
})();

/** Distance from a point in mark space to the arch centreline. */
function archDist(x, y) {
  let d = Infinity;
  for (let i = 1; i < ARCH_POINTS.length; i++) {
    d = Math.min(d, segDist(x, y, ARCH_POINTS[i - 1], ARCH_POINTS[i]));
  }
  return d;
}

/**
 * One icon variant. `corner` is the rect radius as a fraction of the canvas —
 * 0 for the full-bleed variants (maskable, apple-touch) whose host applies its
 * own mask, CORNER for the ones that ship their own silhouette.
 */
function draw(size, corner) {
  const k = size / 512;
  const radius = corner * size;
  const half = MARK.strokeWidth / 2;
  const toMark = (v) => (v / k - MARK.translate) / MARK.scale;

  return (x, y) => {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;

        // rounded-rect ground
        const qx = Math.max(radius - px, px - (size - radius), 0);
        const qy = Math.max(radius - py, py - (size - radius), 0);
        if (Math.hypot(qx, qy) > radius) continue;

        let c = mix(BONE.from, BONE.to, axisT(px, py, [0, 0], [size, size]));

        const mx = toMark(px),
          my = toMark(py);
        const inArch = archDist(mx, my) <= half;
        const inSeed = Math.hypot(mx - MARK.seed.c[0], my - MARK.seed.c[1]) <= MARK.seed.r;
        if (inArch || inSeed) {
          c = mix(GREEN.from, GREEN.to, axisT(mx, my, MARK.gradient.from, MARK.gradient.to));
        }

        r += c[0];
        g += c[1];
        b += c[2];
        a += 255;
      }
    }
    const n = SAMPLES * SAMPLES;
    if (a === 0) return [0, 0, 0, 0];
    // Un-premultiply: the colour is the average of the covered samples only.
    const cov = a / 255;
    return [Math.round(r / cov), Math.round(g / cov), Math.round(b / cov), Math.round(a / n)];
  };
}

fs.mkdirSync(OUT, { recursive: true });
const files = [
  ["icon-192.png", 192, CORNER],
  ["icon-512.png", 512, CORNER],
  ["maskable-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
];
for (const [name, size, corner] of files) {
  fs.writeFileSync(path.join(OUT, name), png(size, draw(size, corner)));
  console.log("wrote", name);
}
