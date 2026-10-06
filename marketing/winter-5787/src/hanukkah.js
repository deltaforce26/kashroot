/* Kashroot winter-5787 — Hanukkah 5787 additions on top of screens.js (needs K).
   The hanukkiah is clean SVG: eight flames of IDENTICAL size and brightness plus a raised
   shamash. Equal flames is a brand rule — nothing may read as a ranking of certifiers. The
   shamash flame alone carries the logo mark's green→amber as a quiet brand tie-in. */
(function (w) {
  const K = w.K;
  K.I.fUsers = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20v-1.5a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14.5h.5a4 4 0 0 1 4 4V20"/></svg>';
  K.I.fClock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

  K.HFEATURES = [
    K.feature(K.I.fUsers, 'סבא, הגיסה ובן הדוד', 'כל אחד לפי הסטנדרט שלו'),
    K.feature(K.I.fSliders, 'סינון לפי סוגי כשרות', 'בשר, חלב, פרווה ועוד'),
    K.feature(K.I.fClock, 'פתוח עכשיו', 'גם בערבי חנוכה'),
  ];

  /** Small amber persona label ("סבא", "הגיסה", "בן הדוד"). */
  K.chip = (text, id, cls) => `<div class="chip ${cls || ''}"${id ? ` id="${id}"` : ''}><span class="dot"></span>${text}</div>`;

  /**
   * Hanukkiah, viewBox 400×260. Nine candles on one bar: index 4 (centre) is the shamash,
   * raised by 32 units. Every one of the eight flames is the same path, the same gradient,
   * the same glow radius. `.flame` groups carry `data-i` so a timeline can light them one
   * after another; `transform-origin` is set to the wick so a scale-in grows from the candle.
   */
  K.hanukkiah = function (opts) {
    const o = Object.assign({ w: 520, id: 'hk', cls: '', style: '' }, opts || {});
    const W = 400, H = 260, N = 9, SH = 4, g = o.id;
    const xs = Array.from({ length: N }, (_, i) => 40 + i * 40);
    const baseY = 212, armTop = 158, shamTop = 126, candleH = 44;
    let p = '';
    // ambient candle glow behind everything (amber, very soft)
    p += `<ellipse cx="200" cy="96" rx="230" ry="96" fill="url(#${g}-amb)"/>`;
    // stand: bar, stem, foot
    p += `<path d="M${xs[0] - 16} ${baseY} H${xs[N - 1] + 16}" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>`;
    p += `<path d="M200 ${baseY} V${baseY + 24}" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>`;
    p += `<path d="M158 ${baseY + 28} H242" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>`;
    xs.forEach((x, i) => {
      const sham = i === SH, top = sham ? shamTop : armTop, cTop = top - 10 - candleH;
      p += `<path d="M${x} ${baseY} V${top}" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>`;
      p += `<rect x="${x - 9}" y="${top - 10}" width="18" height="10" rx="3" fill="currentColor"/>`;
      p += `<rect x="${x - 5}" y="${cTop}" width="10" height="${candleH}" rx="2.5" fill="#f7f0dd" stroke="currentColor" stroke-opacity=".6" stroke-width="1.2"/>`;
      p += `<path d="M${x} ${cTop} v-5" stroke="#5c4b2a" stroke-width="1.5" stroke-linecap="round"/>`;
      p += `<g transform="translate(${x} ${cTop - 5})"><g class="flame${sham ? ' shamash' : ''}" data-i="${i}" style="transform-box:view-box;transform-origin:${x}px ${cTop - 5}px">`
        + `<circle cx="0" cy="-15" r="30" fill="url(#${g}-glow)"/>`
        + `<path d="M0 -38 C9 -25 14 -15 14 -5 A14 14 0 0 1 -14 -5 C-14 -15 -9 -25 0 -38Z" fill="url(#${g}-${sham ? 'fs' : 'ff'})"/>`
        + `<path d="M0 -21 C4 -15 7 -10 7 -4 A7 7 0 0 1 -7 -4 C-7 -10 -4 -15 0 -21Z" fill="#fff7dc" fill-opacity=".9"/>`
        + `</g></g>`;
    });
    return `<svg class="hk ${o.cls}" id="${g}" width="${o.w}" height="${Math.round(o.w * H / W)}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:var(--green);${o.style}">
<defs>
<linearGradient id="${g}-ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d98c"/><stop offset=".55" stop-color="#e6bd5e"/><stop offset="1" stop-color="#c9a94e"/></linearGradient>
<linearGradient id="${g}-fs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ccb56"/><stop offset=".6" stop-color="#e6bd5e"/><stop offset="1" stop-color="#c9a94e"/></linearGradient>
<radialGradient id="${g}-glow"><stop offset="0" stop-color="#e6bd5e" stop-opacity=".55"/><stop offset=".55" stop-color="#e6bd5e" stop-opacity=".18"/><stop offset="1" stop-color="#e6bd5e" stop-opacity="0"/></radialGradient>
<radialGradient id="${g}-amb"><stop offset="0" stop-color="#e6bd5e" stop-opacity=".22"/><stop offset="1" stop-color="#e6bd5e" stop-opacity="0"/></radialGradient>
</defs>${p}</svg>`;
  };
})(window);
