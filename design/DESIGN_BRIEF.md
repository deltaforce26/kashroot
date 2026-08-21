# Kashroot Mobile — design brief (Track C source of truth)

Imported 17 Aug 2026 from Claude Design project `62ba0aec-246a-465d-8a3a-5ade3ad6127a`
("Mobile app design requirements"). Source files in this directory:

| File | What it is | Implement? |
|---|---|---|
| `Kashroot Mobile.dc.html` | The design doc — 8 screens, one design language | **Yes — this is the spec** |
| `screens/3a…3h.html` | The same 8 screens, split one per file | **Yes** |
| `ios-frame.jsx` | Mock iOS 26 bezel: dynamic island, status bar, home indicator, keyboard | **No — canvas chrome** |
| `support.js` | Generated `dc-runtime`: renders `<x-dc>` templates, resolves `<x-import>` | **No — doc runtime** |

`ios-frame.jsx` and `support.js` exist to *display* the design inside Claude Design. The
PWA runs full-bleed on a real phone; drawing a fake bezel, a fake status bar or a fake iOS
keyboard around it would be wrong. Take from `ios-frame.jsx` only the **390×844 viewport
basis** and the glass recipe (`backdrop-filter: blur(12px) saturate(180%)` + inset
highlight + hairline border) — that recipe is genuinely reused by the real screens.

---

## The 8 screens → routes

Design turn: *"Full flow in the 2a language — food-tinted gradients, glass circles, tinted cards."*

| # | Screen | Route | POC task |
|---|---|---|---|
| 3b | Onboarding step 2 — presets on glass | `/onboarding/preset` | C3 |
| 3c | Onboarding step 3 — whitelist + requirements | `/onboarding/certifiers` | C3 |
| 3a | Home — tinted list cards, verdict pill + certifier evidence | `/` | C4 |
| 3e | Search — filter chips, result cards | `/search` | C4 |
| 3d | Restaurant — tinted hero, glass verdict panel | `/r/:id` | C5 |
| 3f | Saved lists — tinted covers, offline chips | `/saved` | C6 |
| 3g | Map — glass toggle, tinted carousel card | `/map` | C9 *(cuttable)* |
| 3h | Profile — English UI, same language | `/profile` | C3 |

Hebrew is the primary UI language (3a–3g). **3h is the same design rendered in English** —
that is the RTL/LTR proof, not a separate design. Build the string layer so both come from
one component tree with `dir` flipped.

---

## Design language

**Type.** `Assistant` (400/500/600/700) for UI — covers Hebrew and Latin.
`Frank Ruhl Libre` (500/600/700) for Hebrew display/headings. The design loads both from
Google Fonts; **self-host them in `web/public/fonts`** — the PWA must render offline and a
blocked CDN would fall back to a non-Hebrew system font.

**Palette** (extracted from the doc — put these in CSS custom properties, do not scatter hex):

- Paper / surfaces: `#f0eee9` (app ground), `#f4f4ef`, `#efede8`, `#eceae5`, `#e8e6e1`
- Ink: `#161616` (primary), `#12130f`, `#1a1a1a`
- Dark surfaces: `#1a1b16`, `#1f201a`, `#26271f`, `#2e2f27`
- Muted text: `#6b6b6b`, `#8a8a8a`, `#9d9c93`, `#b7b7b4`
- **Match green:** `#84d5a4`, `#2f7a4d`, `#4c5c50`
- **Badatz gold:** `#c9a94e`, `#e6bd5e`, `#96721c`

**Food tints.** Cards carry a `linear-gradient(160deg, …)` tinted to the food category —
dairy `rgba(74,124,90,.5)` / `rgba(215,240,215,.9)`, meat `rgba(134,86,54,.5)`, bakery
`rgba(250,225,205,.9)`, ice cream `rgba(250,242,200,.9)`, olive `rgba(132,116,46,.48)`.
This is the "2a language" the turn name refers to — keep it.

**Photo placeholders.** The 45° stripe gradients (`#e8e6e1`/`#efede8` light,
`#1a1b16`/`#1f201a` dark) behind `צילום מנה` ("dish photo") are **placeholders**, not
decoration. We have no restaurant photography, so ship the stripe treatment as the real
empty state rather than pulling stock images.

**Glass.** Circles, pills and the verdict panel use the blur+tint+inset-shine recipe.
`backdrop-filter` needs a `-webkit-` prefix for iOS Safari, and a solid-colour fallback for
browsers without it.

---

## Verdict presentation — the part that must not drift

The design shows verdicts as **pills with a glyph and a word**, never a number:

- **MATCH** — `✓ מתאים לך` ("matches you"), green
- **UNKNOWN** — `? לא מאומת` ("not verified"), neutral/grey
- **NO_MATCH** — **absent from the design.** See gap below.

3d's evidence panel is the product's core claim and must be reproduced faithfully:

```
✓ מתאים לפרופיל שלך          ← verdict pill
למה זה מתאים לך               ← "why this matches you"
  ✓ בד״ץ מהדרין (רובין) — ברשימה שלך     certifier + "on your list"
  ✓ חלב ישראל · ✓ פת ישראל               the required attributes, individually
  ✓ תעודה בתוקף עד 30/09/26 · אומתה לפני 6 ימים   expiry + when verified
  [צילום תעודה]                          certificate photo
```

Every line is a fact traceable to a Certificate row. Render this from the API's reason
codes and provenance — **never compose the sentence client-side from an inferred rule.**

3f carries the fail-safe in the UI: a banner saying a certificate expired on 14/08 and the
status *dropped* to "not verified" until renewal. Degradation is a first-class, visible
state — not an error.

### Gaps to close (design does not cover these)

1. **NO_MATCH has no visual.** Needed on 3d at minimum. Design a red/negative sibling of
   the MATCH pill with an inverted evidence panel ("why this does not match you" — this
   certifier is not on your list / required attribute absent). Match the existing language;
   do not invent a new one.
2. **No loading, error, or offline-stale states** beyond 3f's "זמין אופליין" chip.
3. **No empty state** for "no restaurants match your profile here" — which, given the data,
   the demo will hit. Write it as honest and calm, in the design's voice.
4. **English strings exist only for 3h.** Everything else needs an English pass for the
   language toggle to work end to end.

---

## Non-negotiables carried from CLAUDE.md

- Kashrut is **never** a percentage, a score, a star rating, or a sorted "kashrut ranking".
  The Fit Score (0–100) ranks soft preferences only and must be visually separate from the
  verdict pill. If a screen ever shows them adjacent, they must not read as one metric.
- The app never ranks certifiers or rules on halacha. 3c presents certifiers as a flat
  selectable list — keep it flat. No "recommended", no ordering by stringency.
- Doubt → UNKNOWN. A missing attribute renders as UNKNOWN, never as a quiet MATCH.
