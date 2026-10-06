# Campaign screen captures

Real app screens, captured with Playwright by `scripts/capture.mjs` — nothing hand-drawn.

- **Captured:** 2026-10-06
- **URL:** https://www.kashroot.app (production, live API)
- **Viewport:** 390×844 CSS px @3x → 1170×2532 PNG, he-IL, Asia/Jerusalem, geolocation = Jerusalem (31.7655, 35.1805), light scheme. iPhone safe-area insets emulated (top 59px, bottom 34px) so the app lays out under the frame's dynamic island as on a device.
- **Profile:** preset "מותאם אישית" → certifiers "בד"ץ העדה החרדית" + "בד"ץ מהדרין - הרב רובין", no required attributes (the attributes picker is hidden in the current app — see `web/src/profile/profile.ts`, so the run-sheet's "require גלאט + חלב ישראל" step is not available today).
- **Restaurant:** אייס סטורי (/r/f56be1e8-5f5b-4126-931d-a294e23b960d), verdict "✓מתאים לפרופיל שלך"
- **Evidence lines:** "✓בד"ץ העדה החרדית — ברשימה שלך"
- **Evidence panel box (CSS px):** {"x":20,"y":281,"w":350,"h":79}; certificate card: {"x":20,"y":372,"w":350,"h":216} — also in `boxes.json`.

## Files

- `home-noprofile.png` — home with the widest preset "כל תעודת כשרות" (every certifier whitelisted), header "מחפשים ליד המיקום שלך", pills in view: {"match":4,"no_match":0,"unknown":0}
- `onboarding-preset.png` — presets screen, "מותאם אישית" selected
- `onboarding-certifiers-0.png` — certifier picker, nothing selected (the preset pre-checks every Badatz; all un-ticked first)
- `onboarding-certifiers-1.png` — certifier picker, selected: בד"ץ העדה החרדית
- `onboarding-certifiers-2.png` — certifier picker, selected: בד"ץ העדה החרדית, בד"ץ מהדרין - הרב רובין
- `home.png` — home at scroll top, profile = בד"ץ העדה החרדית + בד"ץ מהדרין - הרב רובין, header "מחפשים ליד המיקום שלך", pills in view: {"match":4,"no_match":0,"unknown":0}; first cards: קצפת [verdict--match]; סושי בית וגן [verdict--match]; פיצה שמש [verdict--match]; מזנון הפסגה [verdict--match]; נוגטין [verdict--match]; פיצה האט [verdict--match]; מאפיית לחם פיינגולד [verdict--match]; קצפת [verdict--match]
- `home-mix.png` — same home list scrolled 8183px to the MATCH/NO_MATCH boundary, pills in view: {"match":6,"no_match":0,"unknown":2}; cards: אנטריקוט [verdict--match]; מיט סטיישן [verdict--match]; פאפס [verdict--match]; פיצה מוצרלה [verdict--match]; פיצה שמש [verdict--match]; סושי טוקיו [verdict--match]; המעדנייה לייזרוביץ [verdict--unknown]; מפגש האש [verdict--unknown]; קוריץ [verdict--unknown]; מסעדת הבית לה קאזה [verdict--unknown]
- `restaurant.png` — restaurant "אייס סטורי" (/r/f56be1e8-5f5b-4126-931d-a294e23b960d) at scroll top, verdict pill "✓מתאים לפרופיל שלך"
- `restaurant-evidence.png` — same restaurant scrolled 98px: evidence panel at y=281..360, certificate card at y=372..588 (CSS px of the 390x844 viewport)
- `search.png` — search screen, no query

