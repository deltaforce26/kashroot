/**
 * Generates the PWA icon set as PNGs, with no image dependency.
 *
 * The mark is the verdict check from the design language: paper-white stroke on
 * the ink ground (#161616), green (#2f7a4d) rule underneath. Run `npm run icons`
 * to regenerate; output lands in public/icons/ and is committed.
 */
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const INK = [0x16, 0x16, 0x16];
const PAPER = [0xf4, 0xf4, 0xef];
const GREEN = [0x2f, 0x7a, 0x4d];

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

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = rgb(x, y);
      raw[row + 1 + x * 3] = p[0];
      raw[row + 2 + x * 3] = p[1];
      raw[row + 3 + x * 3] = p[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** Rounded-square ink tile with the check mark, drawn in unit coordinates. */
function draw(size, inset) {
  const s = size;
  const pad = inset * s;
  const box = s - 2 * pad;
  const radius = box * 0.22;
  return (x, y) => {
    const cx = x + 0.5,
      cy = y + 0.5;
    // rounded-rect coverage
    const qx = Math.max(pad + radius - cx, cx - (s - pad - radius), 0);
    const qy = Math.max(pad + radius - cy, cy - (s - pad - radius), 0);
    const outside = Math.hypot(qx, qy) - radius;
    const inTile = 1 - Math.max(0, Math.min(1, outside + 0.5));
    if (inTile <= 0) return PAPER;

    let c = INK;
    // green rule along the bottom of the tile
    const ruleTop = s - pad - box * 0.14;
    if (cy > ruleTop) c = mix(c, GREEN, Math.min(1, (cy - ruleTop) / 2));

    // check mark
    const w = box * 0.115;
    const d = Math.min(
      segDist(cx, cy, pad + box * 0.26, pad + box * 0.5, pad + box * 0.44, pad + box * 0.68),
      segDist(cx, cy, pad + box * 0.44, pad + box * 0.68, pad + box * 0.76, pad + box * 0.3),
    );
    const stroke = 1 - Math.max(0, Math.min(1, d - w + 0.5));
    c = mix(c, PAPER, stroke);

    return mix(PAPER, c, inTile);
  };
}

fs.mkdirSync(OUT, { recursive: true });
const files = [
  ["icon-192.png", 192, 0.0],
  ["icon-512.png", 512, 0.0],
  ["maskable-512.png", 512, 0.14],
  ["apple-touch-icon.png", 180, 0.0],
];
for (const [name, size, inset] of files) {
  fs.writeFileSync(path.join(OUT, name), png(size, draw(size, inset)));
  console.log("wrote", name);
}
