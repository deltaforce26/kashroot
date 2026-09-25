# Go-to-market strategy — Kashroot

**Version:** 1.1 · **Date:** 25 Sep 2026 · **Companion to:** `kosher-app-prd.md` (product), `seo-runbook.md`, `deploy-runbook.md`

> **In one line:** launch narrow and trusted, not wide and thin. Beachhead = badatz-eating
> households in Jerusalem, reached through the certifiers and restaurants that are already
> in the corpus, on the web app that is already live. Widen city by city only when the data
> clears the coverage gate. Revenue waits until the trust brand exists.

---

## 1. Where we actually are (the numbers the plan is built on)

| Fact | Value | Source |
|---|---|---|
| Corpus size | 492 records, 435 `LIST_VERIFIED`, 57 pending | `data/README.md` |
| Jerusalem records | 160 | corpus |
| Bnei Brak / Beit Shemesh / Ashdod | 39 / 28 / 57 | corpus |
| Tel Aviv / Beer Sheva | **0 / 0** | corpus |
| Haifa | 10 | corpus |
| Top certifiers | Rubin 152 · Eda Haredit 111 · Beit Yosef 103 · Landa 44 · Machpud 38 | corpus |
| National / local Rabbanut data | effectively none (≈30 rows across ~13 councils) | corpus |
| Certificate-level attributes, expiry dates | none yet | `CLAUDE.md` |
| Client | React PWA live at `kashroot.app` (Vercel + Render + Supabase); no native app | `deploy-runbook.md` |
| Public restaurant pages indexable, sitemap live | yes | `seo-runbook.md` |
| Launch gate (PRD) | ≥80% coverage per city | `CLAUDE.md` |

Three consequences that shape everything below:

1. **The corpus is a badatz corpus, not a "any teuda" corpus.** It can serve the Machmir
   Family and the badatz-eating Hungry Now user today. It cannot serve the secular
   "anything with a teuda" persona until Rabbanut data lands, because the "Local Rabbanut"
   preset returns almost nothing (measured: 2 matches / 98 no-match in Jerusalem, `POC_PLAN.md`).
2. **The launch-city list now follows the data.** PRD v1.0 named Tel Aviv, Jerusalem,
   Bnei Brak, Haifa and Beer Sheva; Tel Aviv and Beer Sheva have zero rows. PRD v1.1
   (25 Sep 2026) revised the order to Jerusalem → Bnei Brak, Beit Shemesh → Ashdod, with
   Tel Aviv, Haifa and Beer Sheva gated on Rabbanut data. This document plans on v1.1.
3. **No app store gate.** The web PWA means the launch channel is a link, and every
   restaurant page is a shareable, indexable landing page. That is a distribution
   advantage; use it before spending on a native app.

---

## 2. Positioning

**Category:** the kosher dining app that matches restaurants to *your* standard, with the
certificate as evidence.

**For** observant households who already know which certifications they accept
**who** currently check certificate photos, ask in WhatsApp groups, or just avoid unfamiliar
places,
**Kashroot** shows every restaurant as Match / No match / Unknown against the profile you
set once, with the certificate, expiry and "verified X days ago" on screen.
**Unlike** Google Maps and existing kosher directories, which answer "is it kosher?" and
leave the real question to you,
**Kashroot** never rules on halacha and never hides a doubt: you choose whom to trust, we
show what we can prove.

**Taglines to test**
- HE: **"לא צריך לתהות אם אפשר לאכול כאן."** / short: **"לפי הסטנדרט שלך."**
- EN: **"Never wonder if you can eat here."** / short: **"Kosher, by your standard."**

**Words we use:** match, evidence, certificate, verified on, expires, unknown, your
standard, you choose.
**Words we never use:** kosher rating, trust score, recommended certifier, "we verify
kashrut", "approved", "Mehadrin" as a judgment, any ranking of agencies. Marketing copy is
bound by the same anti-goals as the product (`PRD §2`): one violation in an ad undoes a
year of trust-building in this segment.

**The trust proof points, in order of persuasive power for the beachhead segment**
1. The certificate itself is on the page, with expiry and last-verified date.
2. Fail-safe rule, said plainly: "if we are not sure, we say Unknown. We never guess Match."
3. Whitelist-only: the app cannot recommend a certifier. Publish this as a policy page.
4. Public firewall policy: paid placement never touches match results or ranking, published
   before the first shekel of restaurant revenue.
5. Rabbinic advisory board for taxonomy and copy (recommend yes, see §11).

---

## 3. Beachhead: segment × city × channel

**Segment:** Machmir Family + badatz-eating Hungry Now (PRD personas 4.2 and 4.1). This is
where the data is, where Google Maps is useless, where a wrong answer costs the most, and
where word of mouth is densest. Win this segment and the product's trust brand is
established with the audience least likely to grant it.

**City:** Jerusalem. Largest record count, hardest audience (the PRD already picked it for
beta for this reason), highest density of badatz-certified restaurants, and the largest
English-speaking observant population in the country (gap-year students, olim, tourists),
which gives the EN interface a real audience from day one.

**Channel:** the certifiers and restaurants already in the corpus, plus the WhatsApp and
shul networks that segment already lives in. Details in §5.

**Explicit non-targets for launch:** secular "any teuda" users (data cannot serve them yet),
Tel Aviv (no data), inbound tourists as a *marketing* target (they arrive anyway through
English SEO and hotels; do not spend on them until presets exist).

---

## 4. Phased rollout

Each phase has an entry gate. Do not move to the next phase on a calendar; move on the gate.

### Phase 0 — Data gate for Jerusalem (now → coverage ≥80%)
The PRD build order stands: pipeline and moderation console before app polish. GTM work in
this phase is *supply-side* and *preparation*, not user acquisition.

- Estimate the Jerusalem denominator (actively certified restaurants). 160 records is
  well under the 80% gate against any reasonable estimate; state the real percentage in
  the weekly report and drive it.
- Certificate-runner gig network live in Jerusalem (PRD §13). Each photographed certificate
  also yields attributes and expiry, which the corpus has none of today.
- Rabbanut Yerushalayim data: pursue the public list. Without it, the "Local Rabbanut" and
  "Any certification" presets stay hidden or labelled "coming soon" in Jerusalem.
- Owner claim + certificate upload flow shipped, because §5.2 depends on it.
- Prepare, do not publish: policy pages (whitelist-only, fail-safe, paid-placement firewall,
  privacy), press kit, HE/EN landing copy, advisory board conversations.

**Exit gate:** Jerusalem ≥80% coverage, ≥50% of Jerusalem records with expiry dates,
wrong-status incident process defined and rehearsed, flag SLA staffed (48h).

### Phase 1 — Closed beta, Jerusalem (≈8 weeks)
- 200–500 households recruited through 3–5 community anchors (a kehilla, a seminary or
  yeshiva with an English-speaking cohort, one neighbourhood WhatsApp group in each of two
  or three neighbourhoods, one large family network). Invite by link, no waitlist theatre.
- Beta is a *data audit with users*: every flag is gold. Reward the flaggers publicly
  (leaderboard, "corrections you helped make") and turn around fixes in under 48h, visibly.
- Measure: W4 retention (target ≥30%), % sessions needing manual filter changes (<10%),
  confident decisions per user per week, flags per 100 page views and their resolution time.
- Do not talk to press. One story about a wrong Match in beta is survivable; in launch week
  it is not.

**Exit gate:** retention target met, zero unresolved wrong-status incidents, coverage held
≥80% for four consecutive weeks (freshness decays; the gate must be a steady state, not a
snapshot).

### Phase 2 — Public launch, Jerusalem (+ Bnei Brak and Beit Shemesh when they clear the gate)
- Launch narrative is the data, not the app: "N certified restaurants in Jerusalem, every
  certificate on file, updated weekly." The number is the product.
- Channels from §5 turned on in order: certifier co-marketing → restaurant QR stickers →
  community networks → religious press → SEO already compounding in the background.
- Bnei Brak and Beit Shemesh are natural second cities: contiguous audiences, the corpus
  already has Landa (Bnei Brak) and Eda Haredit / Rubin coverage, and Beit Shemesh has a
  large Anglo population that overlaps the Jerusalem beta cohort.
- Ashdod has 57 Beit Yosef rows; it becomes a city the moment Rabbanut Ashdod data exists.

### Phase 3 — Israel widening (Tel Aviv, Haifa, Beer Sheva, then all-Israel)
- These cities are Rabbanut-dominated. They are unlaunchable without national or local
  Rabbanut data and without the "Any certification" preset working. That is a data
  partnership problem (§5.1), not a marketing problem. Do not pre-announce them.
- Once Rabbanut data exists, the secular/traditional persona (PRD 4.5) opens up and the
  product becomes a general restaurant app for a large segment. That is the scale phase and
  the point at which modest paid acquisition can be justified.

### Seasonal accelerators (both phases 2 and 3)
- **Pesach (April 2027):** the single largest kosher-dining search moment of the year.
  "Pesach mode" is fast-follow in the PRD; if Phase 2 lands before March 2027, pull it
  forward. Even a minimal version (certificates for Pesach, "open on Chol Hamoed") will
  carry a launch on its own.
- **Chol Hamoed Sukkot and Pesach travel:** the corpus already covers Safed, Tiberias and
  the "vacation cities" poster. Saved lists shared by link are the trip-planning wedge
  (PRD §15). Seed a handful of public lists ("Chol Hamoed in the North, Eda Haredit
  only") before each chag.
- **Bein Hazmanim (yeshiva breaks, Av and Nissan):** the machmir segment travels
  domestically exactly then. Same lists, timed.

---

## 5. Channels, ranked by expected return for the beachhead

Paid acquisition is deliberately last and near zero for MVP. The segment does not convert on
ads; it converts on the recommendation of someone it already trusts.

### 5.1 Certifiers (supply side, highest leverage)
The badatzim publish their restaurant lists as PDFs and posters that go stale the day they
are printed. Offer Rubin, Eda Haredit, Beit Yosef, Landa and Machpud, in that order:
- A free, always-current, searchable public page of *their* certified restaurants, with a
  link they can put on their site and print on their posters.
- A change-push channel (email or form now, the certifier portal in 6–12 months) for
  renewals and, critically, revocations. Revocation speed is the thing they cannot get from
  a PDF and the thing that makes our fail-safe rule real.
- In return: their published list becomes source hierarchy level 1 with their blessing, and
  ideally a line in their next printed list: "the current list is always at kashroot.app".

PRD open question 1 asked whether to negotiate before launch. Recommendation: **launch the
data on public sources, then partner from strength**, but start the *conversations* in
Phase 0 with the two friendliest bodies so the portal pilot (PRD roadmap, 6–12 months) has a
named counterpart on day one. Rabbanut Yerushalayim is the single most valuable partnership
for Phase 2 and should be pursued from Phase 0.

### 5.2 Restaurants (supply side, free distribution)
Every certified restaurant is a physical touchpoint with exactly our audience.
- Owner claim + certificate upload is a *data pipeline component* (PRD 4.6); it is also the
  cheapest channel we have. A claimed listing with a fresh upload never lapses to Unknown,
  which is the owner's incentive.
- **Counter sticker with QR** to the restaurant's own `/r/<id>` page. Copy is factual only:
  "Certificate on file at Kashroot — scan to see it", never "verified kosher by Kashroot".
  The restaurant's page is public and indexable already, so the QR lands on something real.
- Start with the ~160 Jerusalem records: a runner photographing a certificate is already
  standing at the counter; hand the owner the sticker and the claim link in the same visit.
- **Firewall reminder:** nothing offered to owners in this phase is paid, and the public
  firewall policy is published before any paid owner product exists.

### 5.3 Community networks (the real acquisition channel)
- **WhatsApp** is the medium. Neighbourhood groups, kehilla groups, "where to eat" groups,
  seminary and yeshiva parent groups. Distribution is by trusted individuals sharing a
  restaurant page or a saved list, not by the company posting.
- Give people something worth forwarding: a shared list link ("Rubin-certified, open
  Motzei Shabbat, Rehavia") renders as a real page. Every list share is an acquisition.
- **Shul and kollel bulletins**, community-council newsletters, and Anglo community
  organisations in Jerusalem (olim associations, seminary/yeshiva administrations at the
  September intake) reach the EN cohort cheaply.
- **Flag-and-fix loop as marketing:** publish a short weekly "corrections this week"
  post. Nothing signals trustworthiness to this audience like visibly fixing mistakes.

### 5.4 Religious and Israeli press (Phase 2 only)
- Haredi and dati-leumi outlets (print and web) and the English-language Israeli press for
  the Anglo/tourist angle. Pitch the data story ("every certificate in Jerusalem, on file,
  with an expiry date") and the fail-safe principle, not "a new app".
- Prepare the hard question in advance: "who are you to say what is kosher?" Answer: we
  don't. The user whitelists; we show the certificate. Have the advisory board named by then.

### 5.5 SEO (compounding, already running)
- Restaurant pages, sitemap and landing page are live (`seo-runbook.md`). Hebrew long-tail
  queries ("מסעדה בד״ץ עדה החרדית ירושלים", "מסעדה חלבית רובין") are low-competition and
  exactly our intent.
- Next steps that move ranking are already listed in the runbook; the GTM-relevant ones are
  per-city and per-certifier directory pages (public, facts only), which double as the
  certifier co-marketing pages in §5.1.

### 5.6 Paid
- None in Phases 0–1. In Phase 2 at most a small test of Hebrew search ads on certifier
  name + city queries to measure intent, capped and reported. Nothing on social; never
  target by religious profile (PRD §19, §20).

---

## 6. Trust operations as part of GTM

For this product, the incident response plan *is* marketing.
- **Wrong-status incident protocol**, written and rehearsed before Phase 1: degrade to
  Unknown within minutes, notify savers, post-mortem within 72h, publish a summary.
- **Flag SLA** (<48h) is a public promise on the policy page, with the current median shown.
- **Freshness is visible everywhere:** "verified 12 days ago" on every card, not just the
  detail page. Stale data that admits it is stale keeps trust; stale data that looks fresh
  destroys it.
- **Privacy as a selling point:** profile is local-first, no account required (PRD open
  question 4, recommend yes), no third-party sharing of religious profile data. Say this on
  the landing page.
- **Legal disclaimer** drafted with counsel before public launch (PRD §20).

---

## 7. Monetization sequencing (unchanged from PRD, restated as GTM gates)

| Stream | Earliest | Gate |
|---|---|---|
| Consumer core | always free | none |
| Restaurant subscription (analytics, tools, labelled carousel) | after Phase 2 trust brand established, ≥6 months public | firewall policy published, zero open incidents |
| Consumer Premium (trip planning, offline, multi-profile) | v2, first Pesach season with trip lists | retention target met |
| Dataset API / travel partnerships | v3 | all-Israel coverage |

MVP revenue is ≈0 by design. Any pressure to monetise owners before the trust brand exists
should be refused on GTM grounds, not only product grounds: the first paid owner feature will
be scrutinised by exactly the community that decides whether the app is trusted.

---

## 8. Metrics per phase

| Phase | Gate metrics | Growth metrics |
|---|---|---|
| 0 | Jerusalem coverage %, % records with expiry, runner throughput/week | none |
| 1 | W4 retention ≥30%, wrong-status incidents = 0 unresolved, flag median <48h | flags per 100 views, confident decisions per user/week |
| 2 | Coverage ≥80% held 4 weeks per launched city, median freshness ≤30 days | weekly confident decisions (north star), shares of lists and pages, claimed listings %, organic search impressions |
| 3 | Rabbanut coverage per city | same, per city |

Report weekly. Data metrics lead the north star by weeks (PRD §3); if coverage or freshness
slips, growth follows it down with a lag, so the weekly report leads with data.

---

## 9. Team and budget shape for MVP GTM

Keep it small and ops-heavy; this is a data company wearing an app.
- 2 FTE moderators + certificate-runner gig network (already in PRD §13).
- 1 community and partnerships lead (Hebrew + English), owning certifier and restaurant
  relationships, the beta cohort, WhatsApp seeding and press. This is the only new GTM hire.
- Rabbinic advisory board: 2–3 names, light governance, consulted on taxonomy and copy.
- Budget lines: runner payments per verified photo, stickers and print, a small Pesach
  campaign, legal review. No paid media line for Phases 0–1.

---

## 10. Next 90 days (from 25 Sep 2026)

| Weeks | Work |
|---|---|
| 1–2 | Jerusalem denominator estimate; coverage dashboard; runner network recruited; policy pages drafted; first certifier conversations (Rubin, Eda Haredit); advisory board outreach |
| 3–6 | Runners in the field; owner claim + upload live; QR sticker designed; Rabbanut Yerushalayim data pursuit; beta anchor communities identified and briefed |
| 7–10 | Coverage gate check; incident protocol rehearsal; closed beta invites to first 200 households if gate is met, else runners continue and beta slips (the gate is the gate) |
| 11–13 | Beta running; weekly corrections post; Pesach-mode scoping decision based on projected Phase 2 date |

---

## 11. Decisions needed

1. **Launch city list.** ~~Decision needed~~ **Resolved 25 Sep 2026:** PRD v1.1 and
   `CLAUDE.md` now name Jerusalem → Bnei Brak, Beit Shemesh → Ashdod as the launch order,
   with Tel Aviv, Haifa and Beer Sheva in the Rabbanut-data phase.
2. **Rabbinic advisory board** (PRD open question 2). Recommendation: yes, before Phase 2,
   because the press question in §5.4 needs a named answer.
3. **Certifier partnership timing** (PRD open question 1). Recommendation: launch on public
   data, but open conversations with two friendly bodies in Phase 0.
4. **Pesach mode** (PRD open question 3). Recommendation: decide by week 13 against the
   projected Phase 2 date; if Phase 2 lands before March 2027, pull it into MVP.
5. **No-account, local-first profile** (PRD open question 4). Recommendation: yes; it is a
   privacy proof point and removes the largest onboarding drop-off.
6. **Brand and name.** "Kashroot" is the working name and the live domain. Decide whether
   the "Jewish travel" ambition appears in Phase 2 branding (recommendation: no, dining only
   until the data is dense).
