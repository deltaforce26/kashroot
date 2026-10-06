/* Kashroot winter-5787 — Hanukkah 5787 additions on top of screens.js (needs K).
   The hanukkiah is a clean-SVG brass menorah: eight flames of IDENTICAL size and brightness
   plus a raised shamash. Equal flames is a brand rule — nothing may read as a ranking of certifiers. The
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
   * Classic brass menorah, viewBox 400×430: a knopped central stem on a fluted dome base,
   * four pairs of concentric semicircular engraved arms rising to a straight row of eight
   * goblet cups at one height, and a raised shamash cup. Candles are twisted wax in a
   * SYMMETRIC colour order (blue, white, orange, yellow | shamash | mirrored), so no position
   * reads as special except the shamash. Every one of the eight flames is the same path,
   * the same gradient, the same glow radius. `.flame` groups carry `data-i` so a timeline can
   * light them one after another; `transform-origin` sits on the wick so a scale-in grows
   * from the candle. Drawn, not traced.
   */
  K.hanukkiah = function (opts) {
    const o = Object.assign({ w: 520, id: 'hk', cls: '', style: '' }, opts || {});
    const W = 400, H = 430, N = 9, SH = 4, g = o.id, CX = 200;
    const xs = Array.from({ length: N }, (_, i) => 60 + i * 40);
    const CUP = 150, SHAM_CUP = 118, ARM_Y = 165, CANDLE_H = 70, CANDLE_W = 9;
    const BASE_TOP = 366, FOOT_Y = 404;
    const WAX = { blue: '#2f5fb3', white: '#f4f1ea', yellow: '#e8b63a', orange: '#e0892a' };
    const order = ['blue', 'white', 'orange', 'yellow', 'blue', 'yellow', 'orange', 'white', 'blue'];
    const brass = `url(#${g}-bv)`, dark = '#6b4a14';
    let p = '';
    // ambient candle glow behind everything (amber, very soft)
    p += `<ellipse cx="${CX}" cy="110" rx="230" ry="110" fill="url(#${g}-amb)"/>`;
    // --- base: stepped foot, ornamental ring, fluted dome ---
    p += `<ellipse cx="${CX}" cy="${FOOT_Y + 12}" rx="84" ry="11" fill="url(#${g}-bv)" stroke="${dark}" stroke-width="1"/>`;
    p += `<ellipse cx="${CX}" cy="${FOOT_Y + 4}" rx="76" ry="10" fill="url(#${g}-dome)" stroke="${dark}" stroke-width="1"/>`;
    p += `<ellipse cx="${CX}" cy="${FOOT_Y + 2}" rx="68" ry="6.5" fill="none" stroke="#f1dc9a" stroke-opacity=".6" stroke-width="1.2" stroke-dasharray="2.5 3"/>`;
    p += `<path d="M${CX - 56} ${FOOT_Y} C${CX - 56} ${BASE_TOP + 12} ${CX - 30} ${BASE_TOP} ${CX} ${BASE_TOP} C${CX + 30} ${BASE_TOP} ${CX + 56} ${BASE_TOP + 12} ${CX + 56} ${FOOT_Y} Z" fill="url(#${g}-dome)" stroke="${dark}" stroke-width="1"/>`;
    for (let k = -5; k <= 5; k++) { // flutes
      const x0 = CX + k * 9, x1 = CX + k * 10.5;
      p += `<path d="M${x0} ${BASE_TOP + 4 + Math.abs(k) * 0.9} L${x1} ${FOOT_Y - 1}" stroke="${k % 2 ? '#f1dc9a' : dark}" stroke-opacity="${k % 2 ? .5 : .45}" stroke-width="1.2"/>`;
    }
    // --- stem with three knops and a bulb above the base ---
    p += `<rect x="${CX - 6}" y="${SHAM_CUP + 14}" width="12" height="${BASE_TOP - SHAM_CUP - 14}" fill="url(#${g}-bh)" stroke="${dark}" stroke-width=".8"/>`;
    p += `<ellipse cx="${CX}" cy="${BASE_TOP - 22}" rx="17" ry="19" fill="url(#${g}-knop)" stroke="${dark}" stroke-width="1"/>`;
    for (const ky of [196, 244, 296]) p += `<ellipse cx="${CX}" cy="${ky}" rx="11.5" ry="8.5" fill="url(#${g}-knop)" stroke="${dark}" stroke-width="1"/>`;
    p += `<ellipse cx="${CX}" cy="${BASE_TOP - 46}" rx="9" ry="3.5" fill="url(#${g}-knop)" stroke="${dark}" stroke-width=".8"/>`;
    // --- four pairs of concentric semicircular arms (flat engraved brass bands) ---
    for (const r of [140, 100, 60, 20]) {
      const d = `M${CX - r} ${ARM_Y} A${r} ${r} 0 0 0 ${CX + r} ${ARM_Y}`;
      p += `<path d="${d}" stroke="${dark}" stroke-width="13" stroke-linecap="butt"/>`;
      p += `<path d="${d}" stroke="${brass}" stroke-width="10.5" stroke-linecap="butt"/>`;
      p += `<path d="${d}" stroke="#f1dc9a" stroke-opacity=".55" stroke-width="1.3" stroke-dasharray="2.5 3"/>`;
    }
    // --- cups, candles, flames ---
    xs.forEach((x, i) => {
      const sham = i === SH, top = sham ? SHAM_CUP : CUP;
      // goblet cup: bowl, foot ring, short neck down to the arm / stem
      p += `<rect x="${x - 3.5}" y="${top + 14}" width="7" height="${(sham ? 0 : ARM_Y - top - 14) + 2}" fill="url(#${g}-bh)"/>`;
      p += `<path d="M${x - 10} ${top} h20 l-3.5 14 h-13 z" fill="${brass}" stroke="${dark}" stroke-width=".9" stroke-linejoin="round"/>`;
      p += `<ellipse cx="${x}" cy="${top}" rx="10" ry="2.6" fill="#e9c96f" stroke="${dark}" stroke-width=".8"/>`;
      p += `<rect x="${x - 6.5}" y="${top + 2.5}" width="2.4" height="9" rx="1" fill="#f6e6ad" fill-opacity=".55"/>`;
      p += `<ellipse cx="${x}" cy="${top + 15}" rx="6.5" ry="2.4" fill="url(#${g}-knop)" stroke="${dark}" stroke-width=".8"/>`;
      // candle (twisted wax), same height for all nine
      const cTop = top - CANDLE_H, wax = WAX[order[i]], lightWax = order[i] === 'white';
      p += `<rect x="${x - CANDLE_W / 2}" y="${cTop}" width="${CANDLE_W}" height="${CANDLE_H + 4}" rx="1.5" fill="${wax}"/>`;
      p += `<rect x="${x - CANDLE_W / 2}" y="${cTop}" width="${CANDLE_W}" height="${CANDLE_H + 4}" rx="1.5" fill="url(#${g}-shade)"/>`;
      let tw = '';
      for (let k = 0; k < 6; k++) { const y0 = cTop + 6 + k * 11; tw += `M${x - 4} ${y0 + 7} L${x + 4} ${y0}`; }
      p += `<path d="${tw}" stroke="${lightWax ? '#b9b2a3' : '#ffffff'}" stroke-opacity="${lightWax ? .55 : .28}" stroke-width="1" stroke-linecap="round"/>`;
      p += `<path d="M${x} ${cTop} v-5" stroke="#4a3a22" stroke-width="1.4" stroke-linecap="round"/>`;
      // flame — identical for all eight; the shamash uses the brand gradient
      p += `<g transform="translate(${x} ${cTop - 5})"><g class="flame${sham ? ' shamash' : ''}" data-i="${i}" style="transform-box:view-box;transform-origin:${x}px ${cTop - 5}px">`
        + `<circle cx="0" cy="-12" r="25" fill="url(#${g}-glow)"/>`
        + `<path d="M0 -30 C7.2 -20 11.2 -12 11.2 -4 A11.2 11.2 0 0 1 -11.2 -4 C-11.2 -12 -7.2 -20 0 -30Z" fill="url(#${g}-${sham ? 'fs' : 'ff'})"/>`
        + `<path d="M0 -17 C3.2 -12 5.6 -8 5.6 -3.2 A5.6 5.6 0 0 1 -5.6 -3.2 C-5.6 -8 -3.2 -12 0 -17Z" fill="#fff7dc" fill-opacity=".9"/>`
        + `</g></g>`;
    });
    return `<svg class="hk ${o.cls}" id="${g}" width="${o.w}" height="${Math.round(o.w * H / W)}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" style="${o.style}">
<defs>
<linearGradient id="${g}-bv" gradientUnits="userSpaceOnUse" x1="0" y1="140" x2="0" y2="420"><stop offset="0" stop-color="#c9a04a"/><stop offset=".12" stop-color="#d9b25c"/><stop offset=".26" stop-color="#eacf86"/><stop offset=".5" stop-color="#b8893a"/><stop offset="1" stop-color="#8a6420"/></linearGradient>
<linearGradient id="${g}-bh" gradientUnits="userSpaceOnUse" x1="${CX - 6}" y1="0" x2="${CX + 6}" y2="0"><stop offset="0" stop-color="#8a6420"/><stop offset=".3" stop-color="#d9b25c"/><stop offset=".45" stop-color="#eed59a"/><stop offset=".7" stop-color="#b8893a"/><stop offset="1" stop-color="#8a6420"/></linearGradient>
<radialGradient id="${g}-knop" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#eed59a"/><stop offset=".5" stop-color="#c49a45"/><stop offset="1" stop-color="#8a6420"/></radialGradient>
<radialGradient id="${g}-dome" cx=".4" cy=".2" r=".9"><stop offset="0" stop-color="#e2bf6a"/><stop offset=".55" stop-color="#b8893a"/><stop offset="1" stop-color="#8a6420"/></radialGradient>
<linearGradient id="${g}-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".3" stop-color="#fff" stop-opacity=".18"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<linearGradient id="${g}-ff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d98c"/><stop offset=".55" stop-color="#e6bd5e"/><stop offset="1" stop-color="#c9a94e"/></linearGradient>
<linearGradient id="${g}-fs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ccb56"/><stop offset=".6" stop-color="#e6bd5e"/><stop offset="1" stop-color="#c9a94e"/></linearGradient>
<radialGradient id="${g}-glow"><stop offset="0" stop-color="#e6bd5e" stop-opacity=".55"/><stop offset=".55" stop-color="#e6bd5e" stop-opacity=".18"/><stop offset="1" stop-color="#e6bd5e" stop-opacity="0"/></radialGradient>
<radialGradient id="${g}-amb"><stop offset="0" stop-color="#e6bd5e" stop-opacity=".22"/><stop offset="1" stop-color="#e6bd5e" stop-opacity="0"/></radialGradient>
</defs>${p}</svg>`;
  };
})(window);
