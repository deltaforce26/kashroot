/* Kashroot winter-5787 campaign — shared markup builders (plain HTML strings, no runtime).
   The app screens are hand-ported from design/screens/3a.html, 3c.html and 3d.html. */
(function (w) {
  const I = {
    pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="#f4f4ef"/><circle cx="15" cy="12" r="2" fill="#f4f4ef"/><circle cx="8" cy="18" r="2" fill="#f4f4ef"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    fork: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v8a3 3 0 0 0 6 0V2M10 2v20M17 2c-2 2-3 5-3 8h3v12"/></svg>',
    shieldS: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="#161616" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    bookmarkOn: '<svg viewBox="0 0 24 24" fill="#161616" stroke="#161616" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
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

  const tabbar = (active) => `<div class="tabbar">
<div class="${active === 'home' ? 'on' : ''}">${I.home}<span>בית</span></div>
<div>${I.map}<span>מפה</span></div>
<div>${I.bookmark.replace('stroke="#161616"', 'stroke="currentColor"')}<span>שמורים</span></div>
<div>${I.user}<span>פרופיל</span></div></div>`;

  // ---- Home list (3a adapted; Tzfat / Galilee flavour) ----
  const HOME_CARDS = [
    { n: 'החצר הישנה', k: 'dairy', m: 'חלבי · 0.4 ק״מ', s: 'ירושלים 12', v: 'ok', bm: true },
    { n: 'מסעדת הגליל', k: 'meat', m: 'בשרי · 0.9 ק״מ', s: 'הפלמ״ח 31', v: 'ok' },
    { n: 'פיצה בצפת', k: 'dairy', m: 'חלבי · 1.2 ק״מ', s: 'העתיקה 8', v: 'ok' },
    { n: 'בית הקפה של רחל', k: 'sweet', m: 'חלבי · 1.6 ק״מ', s: 'הארי 5', v: 'ok' },
    { n: 'שווארמה מירון', k: 'neutral', m: 'בשרי · 2.3 ק״מ', s: 'ויצמן 14', v: 'unk' },
    { n: 'דגי הכנרת', k: 'meat', m: 'דגים · 3.1 ק״מ', s: 'הנשיא 27', v: 'ok' },
  ];
  const PILL = { ok: '<span class="pill">✓ מתאים לך</span>', unk: '<span class="pill unk">? לא מאומת</span>', no: '<span class="pill no">✕ לא מתאים</span>' };

  function homeScreen(opts) {
    const o = Object.assign({ cards: HOME_CARDS, city: 'צפת' }, opts || {});
    const cards = o.cards.map((c, i) => `<div class="card ${c.k}" data-i="${i}">
<div class="top"><div class="name">${c.n}</div>${c.bm ? I.bookmarkOn : I.bookmark}</div>
<div class="meta">${c.m}<br>${c.s}</div>
<span class="photo">צילום מנה</span>${PILL[c.v]}</div>`).join('');
    return `<div class="home">
<div class="hdr"><span class="circ">${I.pin}</span><div class="loc"><div class="l">מסעדות ליד</div><div class="v">${o.city}</div></div><span class="circ">${I.bell}</span></div>
<div class="search">${I.search}<span>חיפוש מקום, עיר או מסעדה…</span></div>
<div class="chips"><span class="chip sq">${I.sliders}<span class="badge">1</span></span><span class="chip">${I.shieldS}כשרות ✓${I.chev}</span><span class="chip">${I.fork}סוג אוכל${I.chev}</span><span class="chip">${I.clock}פתוח עכשיו</span></div>
<div class="grid">${cards}</div>
${tabbar('home')}</div>`;
  }

  // ---- Onboarding whitelist (3c) ----
  const CERTIFIERS = ['בד״ץ העדה החרדית', 'בד״ץ מהדרין — הרב רובין', 'בד״ץ בית יוסף', 'רבנות צפת — מהדרין'];
  function onboardingScreen(opts) {
    const o = Object.assign({ on: [0, 1] }, opts || {});
    const rows = CERTIFIERS.map((n, i) => `<div class="row ${o.on.includes(i) ? 'on' : ''}" data-i="${i}"><span class="tint"></span><span class="chk"><span class="fill">${I.check}</span></span><span class="nm">${n}</span><span class="av"></span></div>`).join('');
    return `<div class="onb">
<div class="steps"><div class="dots"><span class="on"></span><span class="on"></span><span class="on"></span><span></span></div><span class="skip">דילוג</span></div>
<h1>אילו גופי כשרות?</h1>
<div class="lead">מגדירים פעם אחת — ומעכשיו כל מסעדה נבדקת לפי הסטנדרט שלכם.</div>
<div class="list">${rows}<div class="more">עוד 12 גופי כשרות ›</div>
<h2>דרישות נוספות</h2>
<div class="req"><span class="on">חלב ישראל ✓</span><span class="on">פת ישראל ✓</span><span>גלאט</span><span>בישול ישראל</span><span>ישן</span></div></div>
<div class="cta">סיום — הצגת התאמות</div>
<div class="foot">האפליקציה לא פוסקת הלכה — אתם בוחרים, אנחנו מציגים עובדות ומקורות.</div></div>`;
  }

  // ---- Restaurant page (3d) ----
  function restaurantScreen() {
    return `<div class="rest">
<div class="hdr"><span class="circ">${I.back}</span><div style="display:flex;gap:8px"><span class="circ">${I.share}</span><span class="circ">${I.heart}</span></div></div>
<div class="body">
<div class="hero"><span class="photo">צילום מנה</span><span class="pill">✓ מתאים לפרופיל שלך</span></div>
<div><div class="ttl">החצר הישנה</div><div class="sub">מסעדה חלבית · ירושלים 12, צפת · ₪₪ · <b>פתוח עד 23:00</b></div></div>
<div class="panel"><div class="ph"><span class="dot">${I.check}</span><span>למה זה מתאים לך</span></div>
<div class="lines"><span>✓ בד״ץ מהדרין (רובין) — ברשימה שלך</span><span>✓ חלב ישראל · ✓ פת ישראל</span><span>✓ תעודה בתוקף עד 30/09/26 · אומתה לפני 6 ימים</span></div></div>
<div class="panel cert" id="certCard"><div class="img">צילום<br>תעודה</div><div class="txt"><div class="h">תעודת הכשר</div><span>בד״ץ מהדרין — הרב רובין</span><span>בתוקף עד 30/09/26 · אומת ע״י מנהל תוכן</span><span class="ver">אומת לפני 6 ימים</span></div></div>
<div class="panel hours"><div><span>שישי (ערב שבת)</span><span>8:00–13:30 · סגירה מוקדמת</span></div><div><span>מוצ״ש</span><span>שעה לאחר צאת השבת</span></div></div>
<div class="acts"><span class="nav">ניווט</span><span class="circ">${I.phone}</span><span class="circ">${I.bookmark.replace('stroke="#161616"', 'stroke="currentColor"')}</span></div>
<div class="report">משהו לא מדויק? דיווח על עסק ›</div>
</div></div>`;
  }

  w.K = { I, MARK, leaf, qr, feature, FEATURES, phone, homeScreen, onboardingScreen, restaurantScreen, HOME_CARDS, PILL };
})(window);
