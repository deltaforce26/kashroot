# Winter 5787 campaign — בין הזמנים → זמן חורף → חנוכה

Status: draft, 6 Oct 2026. Assets in `out/`, sources in `src/`, re-render with `scripts/render.mjs` (see README).

## Goal
Waitlist sign-ups at kashroot.app that convert to **completed kashrut profiles** once the app is public.
KPI is profile completion, not installs or QR scans. Every asset carries its own UTM so WhatsApp,
Instagram and print traffic can be separated.

## Calendar (the campaign is shaped by it)
| Window | Dates (2026) | What is happening | Our message |
|---|---|---|---|
| Phase 0 — tail of Tishrei bein hazmanim | 6 – 11 Oct | Last tiyul days; yeshivot return Rosh Chodesh Cheshvan (11–12 Oct) | **יוצאים לטיול? הסטנדרט שלכם נוסע איתכם.** (image) |
| Phase 1 — זמן חורף | 12 Oct – 3 Dec | Bochurim and avreichim back in Jerusalem and Bnei Brak; Thursday-night cholent; Cheshvan has no chagim | **בין הזמנים נגמר? הסטנדרט נשאר.** (video end card carries this; cutdowns run all phase) |
| Phase 2 — Hanukkah | 4 – 12 Dec (first candle Fri 4 Dec; real going-out peak Motzei Shabbat 5 Dec – 12 Dec, school break) | Most cross-sector holiday in Israel | "שמונה לילות, שמונה סטנדרטים" — separate asset set, same visual system |

Hard rule: nothing is posted on Shabbat or before ~21:00 on Motzei Shabbat.

## Coverage precondition (owner: data)
The Phase 0 travel message promises results in bein hazmanim destinations. Before the square image goes
out, the corpus must have list-verified coverage for: Tzfat, Tiberias, Meron area, Dead Sea / Ein Bokek,
and ideally Katzrin and Nahariya. The image names only צפת on the mock screen and says "גם בצפון";
if northern coverage is not live by publish time, swap the mock location to ירושלים and drop "גם בצפון"
(one string in `src/image-square.html` / `src/image-story.html`). Do not promise a place the app will
show as UNKNOWN.

## Audience and channels
1. **Yeshiva / kollel WhatsApp groups** (primary). Square image, forwardable, QR works from a screen.
   Ask 10–20 seed contacts to forward with one personal line; the ask is "תביאו את החברותא".
2. **WhatsApp Status + Instagram Stories/Reels**: story image and 15 s video.
3. **Haredi and dati news sites and apps** (banner slots): square image, static.
4. **Print (optional, cheap)**: A5 flyer on yeshiva notice boards in Jerusalem and Bnei Brak in Phase 1,
   same square artwork, QR with `utm_source=print`.

## Copy bank (Hebrew, final strings in the assets)
- Tagline: כשרות לפי הסטנדרט שלך
- Image headline: יוצאים לטיול? הסטנדרט שלכם נוסע איתכם.
- Image subline: בין הזמנים תשפ"ז · מסעדות כשרות בכל מקום בארץ
- Bullets: מסעדות עם תעודות — מגופים מוכרים / סינון לפי סוגי כשרות — בשר, חלב, פרווה ועוד / פתוח עכשיו, גם בצפון — חיפוש לפי מיקום או חיפוש חופשי
- Video beats: בין הזמנים. טיול. איפה אוכלים? → מגדירים את הסטנדרט שלכם פעם אחת → כל מסעדה מקבלת תשובה, לא ציון → כל שורה נסמכת על התעודה עצמה → בין הזמנים נגמר? הסטנדרט נשאר.
- CTA: הצטרפו עכשיו · kashroot.app
- Phase 1 alternates (for posts, not in assets): "חוזרים לזמן. הסטנדרט של הבית בא איתכם." / "ליל שישי. צ'ולנט. בלי ספקות." / "אין חגים בחשוון. יש מסעדות."

## Brand guardrails (from CLAUDE.md / PRD)
- Never call any certifier "mehadrin", "better" or rank agencies. Certifier chips are equal size, unordered.
- Verdicts are words, never numbers: מתאים לך / לא מתאים / לא מאומת.
- The app reports what the certificate says; copy must never imply a halachic ruling.
- Privacy line for posts: the kashrut profile is never sold and never used for ads.

## UTM scheme
`https://kashroot.app/?utm_source=<whatsapp|instagram|print|site>&utm_medium=<image|video|banner|flyer>&utm_campaign=bein-hazmanim-5787`
Phase 1 reuses the same assets with `utm_campaign=zman-choref-5787`; Phase 2 gets its own.

## Measurement
Weekly: scans per source → landing visits → waitlist sign-ups → (post-launch) profile completions.
Kill rule: if the Phase 0 image under-performs the Sukkot image on sign-ups per 1,000 views by week 1,
move the budget to Phase 1 early rather than extending the travel message past 12 Oct.
