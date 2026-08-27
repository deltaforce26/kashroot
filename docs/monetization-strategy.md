# Kashroot — Monetization Strategy

**Version:** 1.0 draft · **Date:** Aug 2026
**Status:** Expands PRD §19 (Business Model). Does not change any locked decision.

This document answers "how does Kashroot make money" in operational terms: which
streams, in what order, at what price, and — most importantly — what has to be
built *now* so the money is available *later*.

---

## 0. The one-paragraph answer

Kashroot is a **B2B data business with a consumer app as its acquisition and
verification engine**. The consumer app will never be the main revenue line and
should never try to be — paywalling a kashrut verdict is mission failure. The app
earns trust, distribution, and (critically) *demand data*: who requires what, and
which restaurants fail which requirement. That demand data is the product that
restaurants, certifiers, delivery platforms and travel companies will pay for.
Revenue order: restaurants first, tourists second, licensing biggest and last.

---

## 1. Constraints that bound every option

These are locked and are not commercial trade-offs. They are the asset:

| Constraint | Consequence for monetization |
|---|---|
| Free consumer core, forever | No verdict, reason code, certificate, or expiry date is ever behind a paywall |
| Paid placement never influences match or organic ranking | Promotion sells *a labeled slot*, never a position in results |
| The app never rules on halacha | We cannot sell "certified Mehadrin" badges or agency rankings — not at any price |
| Doubt → UNKNOWN | We cannot sell an owner a MATCH. An owner's payment buys visibility of facts, never a change of verdict |
| No ad targeting by religious profile | Rules out the entire endemic ad-network model. Also a privacy/legal landmine — treat as permanently closed |

A machmir family that suspects the list is bought uninstalls and tells the
neighbourhood. Every stream below is designed so that suspicion is structurally
impossible, not merely discouraged.

---

## 2. The revenue streams, in sequencing order

### Stream 1 — Restaurant / owner subscription (first real money)

**When:** after Israel launch and a visible trust brand, not before. Target 9–15
months out.

**Market size:** ~3,000–4,000 certified restaurants in the five launch cities;
roughly 15,000–20,000 nationally.

**What an owner actually pays for**, in descending order of willingness:

1. **Lost-demand report.** *"1,240 users matched your area this month. 38% of them
   require Chalav Yisrael and saw NO_MATCH on you. Upgrading your certificate
   would convert them."* No one else on earth can compute this — it needs the
   per-certificate attribute model plus real profile distributions. This is the
   single most sellable artifact the company will own, and it is a *byproduct* of
   the match engine.
2. **Claim + keep-current.** Self-serve certificate upload, renewal reminders,
   expiry warnings before the record auto-degrades to UNKNOWN. Owners care about
   this the moment they see themselves greyed out.
3. **Presence tools.** Menu, photos, hours (including chag hours), responsiveness
   badge.
4. **Promoted carousel.** Clearly labelled, physically separate from results,
   firewall policy published publicly. Lowest priority — sell it last, price it
   high, and cap inventory.

**Pricing:** ₪99/mo self-serve tier (claim, keep-current, basic stats),
₪249/mo pro tier (lost-demand report, promotion credits, multi-location). Annual
prepay at 2 months free.

**Realistic ramp:** 5% of the 4,000-restaurant launch corpus in year 1 =
200 × ~₪150 blended = **~₪30k/mo**. 1,000 paying nationally at maturity =
**~₪1.8M/yr**.

**Second-order win:** owner self-serve renewal is simultaneously a *cost*
reduction. Every certificate an owner uploads is one the certificate-runner
network does not have to be paid to photograph. Owner revenue and ops cost move
in the same direction, which is rare and worth exploiting.

---

### Stream 2 — Consumer Premium (tourists pay; locals don't)

**When:** v2, alongside or just after Stream 1.

Israeli daily users will not pay for a lunch decision. **Inbound kosher-keeping
tourists will** — they are spending thousands on a trip and are acutely anxious
about food. English-language marketing to inbound tourism is the whole play here.

**What's saleable (never the verdict):**

- Trip planning and itineraries across cities
- Offline packs (works with no data roaming — genuinely valuable to a tourist)
- Multi-profile households (a family where the grandparents' standard differs)
- **Pesach mode** — seasonal, high-anxiety, high willingness to pay
- Widgets, saved-list sharing, hotel/neighbourhood presets

**Pricing:** $9.99 one-time trip pack (14 days) / $29.99 annual. The trip pack is
the volume product; the annual serves frequent travellers and diaspora families.

**Realistic ceiling:** at 200k MAU with 2% conversion at ~₪150/yr →
**~₪600k/yr**. Real, but never the main line. Its strategic value is proving
consumer willingness-to-pay to investors, not the cash itself.

---

### Stream 3 — Data licensing / API (the biggest asset, longest fuse)

**When:** v3, 18–30 months. Requires national coverage and a freshness SLA.

The per-certificate verified database, with provenance and last-verified dates, is
the only one of its kind. Buyers:

| Buyer | Why they need it | Notes |
|---|---|---|
| **Delivery platforms (Wolt, 10bis, Cibus)** | Their "kosher" flag is a single meaningless boolean. A machmir user cannot order from them safely today | The sleeper deal. Highest value, non-competitive with us, and they have budget |
| **Hotels, travel platforms, tour operators** | Embedded matched dining near a property | Booking-style embed or affiliate |
| **Airline / institutional catering, event venues** | Supplier verification | Small but sticky |
| **Mapping / local-data platforms** | Kashrut metadata they cannot source | Beware: also a channel-conflict risk — price accordingly |
| **Certification agencies themselves** | Cross-agency visibility, renewal analytics | Only after the free portal has built the relationship |

**Pricing model:** annual license, priced per-market and per-call volume, roughly
₪100k–500k/yr per enterprise partner. **Three to five partners ≈ ₪1M–1.5M/yr with
almost no incremental ops cost** — comparable to the entire restaurant book, at a
fraction of the effort. This is why the data moat, not the app, is the company.

**Precondition:** the terms of service and owner/community content licenses must
grant redistribution rights **from day one**. Retrofitting those rights across
thousands of records and contributors later is effectively impossible. See §4.

---

### Stream 4 — Certifier / vaad portal (strategic now, revenue much later)

Keep it **free**, as the PRD says. The certifier portal is a data-acquisition
instrument: free digital management of a council's certified businesses, with
push renewals and revocations, in exchange for authoritative first-party data.
That trade is worth far more than a subscription fee.

Monetize only at maturity, and only as genuine SaaS (QR-verifiable certificates,
cross-council analytics, fraud detection on forged certificates). Charging the
~130 local councils early would cost the data pipeline and the institutional
goodwill that makes the pipeline cheap.

---

### Stream 5 — Affiliate and commissions (v3, structurally constrained)

Reservations, delivery deep links, hotel bookings. Viable, but must be built as a
**flat per-referral fee, disclosed**, never a revenue share that varies by
partner — a variable rate creates an incentive to rank, and the firewall must
hold in the incentive structure, not just in the code.

---

### Stream 6 — Non-dilutive funding (available *now*, unlike everything above)

This is the only money accessible during the pre-revenue data-building phase:

- **Israel Ministry of Tourism** actively funds inbound-tourism infrastructure;
  a kosher-dining data layer for tourists is squarely in scope
- **Jewish community foundations** fund data-integrity public goods
- **Municipality partnerships** in the five launch cities — coverage in exchange
  for co-marketing or data-collection support
- Accessibility/consumer-protection angles for public grant programs

Worth pursuing in parallel with the data build, because it funds exactly the
phase that has no revenue.

---

## 3. What Israel is worth, honestly

| Stream | Mature Israel-only annual |
|---|---|
| Restaurant subscriptions | ~₪1.8M |
| Consumer Premium | ~₪0.6M |
| Licensing / API | ~₪1.0–1.5M |
| Affiliate | ~₪0.3M |
| **Total** | **~₪3.7–4.2M/yr (~$1M)** |

Israel alone is a good, defensible small business — not a venture outcome. **The
venture case is the US** (NYC → NJ → LA/Miami): a far more commercial kosher
market, higher willingness to pay on both consumer and restaurant sides, and the
per-certificate model transfers cleanly to OU / OK / Star-K / CRC / Kof-K plus
local vaads. Israel is where the model is proven and the data engine is tuned;
the US is where it is monetized at scale.

---

## 4. What to do NOW — the only monetization work that belongs in this phase

MVP revenue is ≈ 0 and that is correct. But three things are cheap today and
impossible to retrofit later. All three are engineering/legal decisions, not
commercial ones:

1. **Log every match evaluation.** Persist `(profile requirements × restaurant ×
   verdict × reason codes × timestamp × coarse geo)` for every evaluation the
   engine performs, from the first day of launch. Anonymous and aggregate — no
   user-level identity needed. This log *is* the owner lost-demand report and *is*
   the licensing dataset. If it is not written from launch, the entire Stream 1
   and Stream 3 value proposition is 12 months behind whenever someone remembers.
2. **Get the data rights right in the ToS.** Owner-submitted content, community
   contributions, and certificate photographs all need explicit redistribution and
   sublicense grants, worded now. Stream 3 is legally impossible without them.
3. **Publish the firewall policy before there is anything to firewall.** Writing
   "paid placement never affects match results or ranking" publicly while there is
   no paid placement costs nothing and buys the credibility that makes Stream 1
   sellable later. Publishing it *after* launching promotions reads as damage
   control.

Nothing else. No pricing pages, no premium gates, no owner outreach until the
five-city corpus clears the 80% coverage launch gate. Monetization follows
density; density follows the data pipeline.

---

## 5. Permanently closed

- Paywalling any kashrut verdict, reason code, certificate image, or expiry date
- Selling rank, match status, or badge placement in results
- Advertising targeted by religious profile or observance level
- Selling or brokering user-level data
- Any "certified by Kashroot" designation — the app reports facts, it does not
  certify

Each of these would convert a trust asset into a one-time payment. The asset is
worth more.
