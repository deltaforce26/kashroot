# Issue: home search placeholder shows an Arabic area name in the Hebrew UI

**Observed:** 6 Oct 2026, production (https://www.kashroot.app), Hebrew UI, device location granted.
**Severity:** medium. Cosmetic, but it is the first line of the home screen and the audience notices.

## Symptom
With the device located in the Old City of Jerusalem (31.7683, 35.2137), the home screen's search
field placeholder read:

```
מסעדות ליד القدس…
```

Expected: a Hebrew area name (`מסעדות ליד העיר העתיקה…` or `מסעדות ליד ירושלים…`), or the generic
fallback `מסעדות ליד המיקום שלך…`.

Reproduced deterministically with Playwright (locale `he-IL`, geolocation set to the point above).
From Bayit VeGan (31.7655, 35.1805) the same flow yields `מסעדות ליד ירושלים…`, so it is location
dependent, not a general i18n fault.

## Root cause
The placeholder is built from a Google reverse-geocode lookup and the result is used without
checking which script it is in.

Code path (all under `web/src/`):

1. `components/SearchBar.tsx` — `fieldPlaceholder` is
   `t.search.nearPlaceholder(areaName ?? t.map.youAreHere)` (around line 243).
   `areaName` comes from `areaOf(deviceFix, lang)` which calls `reverseGeocodeArea` once per
   device fix and caches the promise in a `WeakMap` (lines ~99–112). The result is cached even if
   it is unusable, so a bad name sticks for the life of the fix.
2. `map/useGoogleMaps.ts` — `reverseGeocodeArea(point, language)` (around line 162):
   geocodes the point, then walks `AREA_COMPONENT_TYPES = ["neighborhood", "sublocality", "locality"]`
   (line 147) over `results[0].address_components` and returns the **first** `long_name` it finds.
   There is no check that the name is in the UI's script.
3. The Maps loader is configured with `language: "he"` and `region: "IL"` (`configure()`, line ~57).
   Google honours that where it has Hebrew data. For the Old City and much of East Jerusalem,
   Google's Hebrew coverage of neighbourhood/sublocality components is incomplete and it returns
   the local Arabic name (`القدس`, `الحي النصارى`, …) even in a `he` session. The app then prints it.

Secondary cause: `configure()` runs once per page load with whatever language the first caller
had, so a user who switches HE→EN after the map or geocoder loaded keeps the first language for
every later lookup. Not what produced this report, but the same function.

## Fix proposal
Keep the lookup; harden the selection in `reverseGeocodeArea` (or in `areaOf`):

- Accept a component name only if it is in the script of the requested language:
  Hebrew → contains at least one character in `א–ת`; English → contains a Latin letter.
  Otherwise continue to the next type in `AREA_COMPONENT_TYPES`; if none passes, return `null`
  so the caller falls back to `t.map.youAreHere` (`המיקום שלך`).
- Prefer `short_name`/`long_name` of the **locality** when the finer component fails the script
  check, instead of giving up entirely. For the Old City this yields `ירושלים`.
- Optional: pass `language` explicitly on the geocode request (`geocoder.geocode({ location, language })`)
  so a late language toggle gets the right script regardless of how the loader was configured.
- Do not cache a `null` produced by the script check forever if the UI language changes;
  key the `WeakMap` entry on `(fix, language)` or store the raw components and format per language.

Suggested helper:

```ts
const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;
function inScript(name: string, language: "he" | "en"): boolean {
  return (language === "he" ? HEBREW : LATIN).test(name);
}
```

## Tests to add (`web/src/test/searchBar.test.tsx` already mocks `reverseGeocodeArea`)
1. Components `[neighborhood: "القدس", locality: "ירושלים"]`, language `he` → placeholder uses `ירושלים`.
2. Components `[neighborhood: "القدس"]` only, language `he` → placeholder uses `המיקום שלך`.
3. Components `[neighborhood: "בית וגן"]`, language `he` → `בית וגן` (unchanged behaviour).
4. Same fix, language `en`, components `[neighborhood: "בית וגן", locality: "Jerusalem"]` → `Jerusalem`.

## Repro script
`marketing/winter-5787/scripts/capture.mjs` drives production with Playwright. Set `JERUSALEM`
(line 29) to `{ latitude: 31.7683, longitude: 35.2137 }`, run
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/capture.mjs`, and read the placeholder in
`src/screens/home.png`. The script does not need to be changed for the fix.

## Out of scope
Chip labels truncating to `כ…` / `סו…` / `פתוח …` at 390 px width is a separate layout issue.
