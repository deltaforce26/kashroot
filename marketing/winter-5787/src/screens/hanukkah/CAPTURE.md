# Hanukkah 5787 screen captures

Real app screens, captured with Playwright by `scripts/capture-hanukkah.mjs` — nothing hand-drawn.

- **Captured:** 2026-10-06
- **URL:** https://www.kashroot.app (production, live API)
- **Viewport:** 390×844 CSS px @3x → 1170×2532 PNG, he-IL, Asia/Jerusalem, geolocation = Jerusalem (31.7655, 35.1805), light scheme. iPhone safe-area insets emulated (top 59px, bottom 34px).
- **Profiles** (no required attributes; the attributes picker is hidden in the current app):
  - **P1 "סבא":** preset "מותאם אישית" → certifier "בד"ץ העדה החרדית" only
  - **P2 "הגיסה":** preset "מותאם אישית" → certifier "בית יוסף" only
  - **P3 "בן הדוד":** preset "כל תעודת כשרות" (every certifier whitelisted)
- **Restaurant (P1):** אייס סטורי (/r/f56be1e8-5f5b-4126-931d-a294e23b960d), verdict "✓מתאים לפרופיל שלך"
- **Guardrail:** every home shot was checked to show MATCH pills only in view (a named restaurant with a ✕/? pill is never used in an ad). Machine-readable summary in `profiles.json`.

## Files

- `certifiers-p1.png` — certifier picker, selected: בד"ץ העדה החרדית (only)
- `home-p1.png` — home at scroll top, profile = "בד"ץ העדה החרדית" only, header "מחפשים ליד המיקום שלך", pills in view: {"match":4,"no_match":0,"unknown":0}; first cards: פיצה שמש [verdict--match]; סושי בייגלס [verdict--match]; אייס סטורי [verdict--match]; ביג בייט [verdict--match]; פיצה טראמפ [verdict--match]; פיצה ירושלים [verdict--match]; היימישע בייגל [verdict--match]; פיצה אורי [verdict--match]
- `certifiers-p2.png` — certifier picker, selected: בית יוסף (only)
- `home-p2.png` — home at scroll top, profile = "בית יוסף" only, header "מחפשים ליד המיקום שלך", pills in view: {"match":4,"no_match":0,"unknown":0}; first cards: קפה גן סיפור [verdict--match]; בורגרס בר - תלפיות [verdict--match]; בורגרס בר [verdict--match]; בורגרס בר - המושבה הגרמנית [verdict--match]; פיצה שמש [verdict--match]; ג'פאן ג'פאן [verdict--match]; בורגרס בר [verdict--match]; ג'וי [verdict--match]
- `preset-p3.png` — presets screen, "כל תעודת כשרות" selected
- `home-p3.png` — home at scroll top, profile = preset "כל תעודת כשרות", header "מחפשים ליד המיקום שלך", pills in view: {"match":4,"no_match":0,"unknown":0}; first cards: קצפת [verdict--match]; סושי בית וגן [verdict--match]; פיצה שמש [verdict--match]; מזנון הפסגה [verdict--match]; נוגטין [verdict--match]; פיצה האט [verdict--match]; קפה שלוה [verdict--match]; מאפיית לחם פיינגולד [verdict--match]
- `restaurant-p1.png` — restaurant "אייס סטורי" (/r/f56be1e8-5f5b-4126-931d-a294e23b960d) under p1 at scroll top, verdict pill "✓מתאים לפרופיל שלך"

