/* Kashroot winter-5787 campaign — shared markup builders (plain HTML strings, no runtime).
   The app screens are real captures of the production app (src/screens/, made by
   scripts/capture.mjs); `shot()` drops one into the phone frame. */
(function (w) {
  const I = {
    // feature bullet icons (line style, like the inspiration)
    fShield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    fSliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><circle cx="8" cy="6" r="2.2" fill="#eef4ee"/><circle cx="15" cy="12" r="2.2" fill="#eef4ee"/><circle cx="10" cy="18" r="2.2" fill="#eef4ee"/></svg>',
    fPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  };

  const MARK = (size, id) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id || 'mg'}" x1="20" y1="20" x2="100" y2="100" gradientUnits="userSpaceOnUse"><stop stop-color="#9ccb56"/><stop offset="1" stop-color="#2f7a4d"/></linearGradient></defs><path d="M24 46v12c0 20 16 36 36 36s36-16 36-36V46" stroke="url(#${id || 'mg'})" stroke-width="16" stroke-linecap="round" fill="none"/><circle cx="60" cy="20" r="9" fill="url(#${id || 'mg'})"/></svg>`;

  // Soft botanical branch: one curved stem with alternating leaflets. Low contrast. `flip` mirrors it.
  function leaf(opts) {
    const o = Object.assign({ w: 420, x: 0, y: 0, rot: 0, flip: false, op: .55, cls: '' }, opts || {});
    const t = `${o.flip ? 'scaleX(-1) ' : ''}rotate(${o.rot}deg)`;
    // leaflets: [cx, cy, angle, rx, ry, opacity]
    const L = [[52,160,-50,30,12,.32],[70,118,-62,36,14,.4],[98,84,-58,38,15,.48],[126,56,-50,34,13,.52],[150,34,-40,26,10,.55],
               [82,150,-10,34,13,.28],[112,112,-16,38,15,.36],[142,80,-20,34,13,.42],[168,52,-28,26,10,.45]];
    const els = L.map(([cx,cy,a,rx,ry,op]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${a} ${cx} ${cy})" fill="currentColor" fill-opacity="${op}"/><path d="M${cx-rx*Math.cos(a*Math.PI/180)} ${cy-rx*Math.sin(a*Math.PI/180)} L${cx+rx*Math.cos(a*Math.PI/180)} ${cy+rx*Math.sin(a*Math.PI/180)}" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>`).join('');
    return `<svg class="leaf ${o.cls}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.w}px;opacity:${o.op};transform:${t}" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M20 196 C 60 150, 110 90, 184 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity=".6"/>${els}</svg>`;
  }

  const qr = (file, size) => `<div class="qr" style="width:${size}px;height:${size}px"><img class="code" src="${file}" alt=""><span class="qr-logo"><img src="icon.svg" alt=""></span></div>`;

  const feature = (icon, t, d) => `<div class="feat"><span class="ic">${icon}</span><div><div class="t">${t}</div><div class="d">${d}</div></div></div>`;
  const FEATURES = [
    feature(I.fShield, 'מסעדות עם תעודות', 'מגופים מוכרים'),
    feature(I.fSliders, 'סינון לפי סוגי כשרות', 'בשר, חלב, פרווה ועוד'),
    feature(I.fPin, 'פתוח עכשיו, גם בצפון', 'חיפוש לפי מיקום או חיפוש חופשי'),
  ];

  function phone(inner, cls) {
    return `<div class="device ${cls || ''}"><span class="btn l1"></span><span class="btn l2"></span><span class="btn l3"></span><span class="btn r1"></span>
<div class="screen">
<div class="island"></div>
<div class="status"><span>9:41</span><span class="icons">
<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".8" fill="#161616"/><rect x="5" y="5.5" width="3" height="6.5" rx=".8" fill="#161616"/><rect x="10" y="3" width="3" height="9" rx=".8" fill="#161616"/><rect x="15" y="0" width="3" height="12" rx=".8" fill="#161616"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#161616" stroke-width="1.7" stroke-linecap="round"><path d="M1.5 4.2a9.5 9.5 0 0 1 13 0M4 7a6 6 0 0 1 8 0M6.5 9.6a2.5 2.5 0 0 1 3 0"/></svg>
<svg width="27" height="12" viewBox="0 0 27 12"><rect x=".5" y=".5" width="22" height="11" rx="3" stroke="#161616" stroke-opacity=".4" fill="none"/><rect x="2" y="2" width="19" height="8" rx="1.8" fill="#161616"/><rect x="24" y="4" width="2" height="4" rx="1" fill="#161616" fill-opacity=".4"/></svg>
</span></div>
${inner}
<div class="home-ind"></div>
</div></div>`;
  }

  /** A real app capture (390×844 CSS px @3x) filling the phone's screen area. */
  const shot = (file, id, cls) => `<img class="shot ${cls || ''}"${id ? ` id="${id}"` : ''} src="screens/${file}" alt="">`;

  w.K = { I, MARK, leaf, qr, feature, FEATURES, phone, shot };
})(window);
