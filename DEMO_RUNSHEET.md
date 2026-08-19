# Kashroot POC — demo run-sheet

**Thursday 20 Aug 2026.** Built from real records in the live database, not invented ones.

> **Not yet rehearsed.** The verdicts below are derived from the actual certificate data
> (attributes, expiry, state) and should hold, but every one needs confirming on screen
> once before Thursday. Rehearse twice — that is task D4 and it is the last real gate.

---

## Pre-flight — 15 minutes before

```powershell
.\run-demo.ps1
```

Brings up containers → migrations → API → web app, and prints the URLs. Then:

- [ ] `curl http://localhost:8000/health` returns ok
- [ ] App loads at `http://localhost:5199/`
- [ ] **Clear site data in the browser** — a profile cached from an earlier session is the
      single most likely cause of a broken-looking first screen. It should self-heal now
      (the profile is versioned and the old key is deleted on load), but clear it anyway.
- [ ] Walk the path below once, fully, before anyone is watching.

**If the map matters:** it needs `VITE_GOOGLE_MAPS_BROWSER_KEY` in `web/.env.local` and a
rebuild. Without it the map screen shows the striped placeholder and an explanation — which
is honest, and fine to skip past. Decide in advance whether you are showing the map at all,
rather than discovering it live.

---

## The path — about 6 minutes

### 1. Onboarding — "define your standard once"

Pick **בד״צים נבחרים** (Selected Badatzim), then require **גלאט** and **חלב ישראל**.

> *"The user defines their standard once. The app never decides what's acceptable — it
> reports what each certificate says against the standard you set."*

This is the whole product thesis, and it is the moment to say it.

### 2. Home — the list

Jerusalem, Bayit VeGan. Results are ordered **gate → fit**: everything you can eat at comes
first, ranked by convenience. Kashrut is never a score.

> *"Fit score ranks distance and convenience. It never touches the kashrut verdict. A
> restaurant is never 80% kosher."*

### 3. MATCH — **אייס סטורי**

Badatz Eda Haredit. Glatt ✓, Chalav Yisrael ✓, Pas Yisrael ✓, Bishul Yisrael ✓.
Certificate valid to 01/06/2027.

Open the detail screen and walk the evidence panel — **this is the money screen**. Every
line traces to a certificate record: which certifier, which attributes, valid until when,
verified when, by whom.

> *"Not 'trust us'. Here is the certificate, here is who verified it, here is when."*

### 4. NO_MATCH — **חומוס אליהו**

Certified by Badatz Mehadrin (Rubin) — a certifier **on the user's list** — but the
certificate records **glatt: false**, and this user requires glatt.

> *"A real certificate from a certifier they accept. It just doesn't meet their standard.
> We're not ruling on the restaurant — we're reporting what the certificate says."*

This is the strongest single moment in the demo: it shows the app is reading certificate
*facts*, not certifier reputation.

### 5. UNKNOWN, cause 1 — **היימישע בייגל** (missing data)

Badatz Eda Haredit, Pas Yisrael ✓ and Bishul Yisrael ✓ recorded — but **glatt and chalav
yisrael are simply not recorded**.

> *"We don't know. So we say we don't know. We will never guess in the direction of
> permitting something."*

### 6. UNKNOWN, cause 2 — **דנבר סטייק האוס** (expired)

Certificate expired 01/07/2026. Auto-degraded; no human intervened.

> *"The certificate lapsed six weeks ago. The status dropped on its own. Nothing here waits
> for someone to notice."*

### 7. Close — the saved list

Show the degradation banner: a saved place whose status changed after it was saved.

> *"The answer isn't frozen at the moment you saved it. If the evidence changes, what we
> tell you changes."*

---

## Questions you will get, and honest answers

**"How many restaurants do you have?"**
531 across 59 cities, from 6 certifier source documents. 4 certifiers. Jerusalem is the
deepest at 140. Say the real numbers — the corpus is the moat, and it is small on purpose
because every record is traceable.

**"Why is coverage only ~70% on the map?"**
Because we refuse to place a pin we can't verify. 70.7% of Jerusalem is geocoded to rooftop
precision; the rest we won't guess at. Bayit VeGan, the neighbourhood shown, is 100%.

**"Do you have Tel Aviv?"**
No. No source documents exist for Tel Aviv or Beer Sheva yet. That is an acquisition
problem, and it is the honest answer.

**"Is this restaurant kosher?"**
The app never answers that. It answers *"does this certificate meet the standard you set?"*
That distinction is the product.

**"How do you know the data is right?"**
Every kashrut-relevant field carries provenance — source, who verified it, when. Demo-seeded
records are flagged `is_demo_seed` in the database and through the API, so synthetic data can
never be mistaken for verified fact.

---

## If something breaks

| Symptom | Fix |
|---|---|
| App looks broken on first load | Clear site data, re-run onboarding |
| Empty list / no results | Check API: `curl localhost:8000/health`. Check city picker |
| Map is a striped placeholder | Expected without a Maps key. Move on |
| Everything says UNKNOWN | Check the API is reachable — the client fails safe |
| Total failure | Fall back to the recorded walkthrough (task D6) |

**Do not** demo the certifier picker with only Rabbanut Bnei Brak selected — it returns
2 match / 98 no_match in Jerusalem, because that certifier doesn't operate there. The
one-tap preset was removed for exactly this reason, but it is still reachable by hand.
