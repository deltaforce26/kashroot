# Day-One Data — The Questions It Must Answer

**Version:** 1.0 · **Date:** Sep 2026
**Companion to:** `docs/monetization-strategy.md` §4 (what to capture from day one).

This is the acceptance test for the day-one data capture. Every question below must
be answerable from the schema, or the schema is wrong. Questions are grouped by who
asks them, and each names the fields it depends on.

Two stores, one bright line (see §6):
- **`match_evaluation`** (Postgres, append-only, daily-rotating pseudonym) — carries
  requirement shape and verdicts.
- **PostHog** (stable anonymous `analytics_id`) — carries behaviour only, **never any
  kashrut profile data**.

They are never joined. §5 lists the four schema refinements this exercise surfaced.

---

## 1. Owner-facing — the billable report (Revenue Stream 1)

These are what a restaurant pays ₪249/mo to see. Every one must be per-restaurant,
per-month, and defensible to an owner who disputes it.

| # | Question | Fields required |
|---|---|---|
| 1.1 | How many matched searches did this restaurant appear in this month? | `restaurant_id`, `evaluated_at`, `surface` |
| 1.2 | How many distinct daily users saw it? | + `daily_pseudonym` |
| 1.3 | What was the verdict split — MATCH / NO_MATCH / UNKNOWN? | + `verdict` |
| 1.4 | Of those who saw NO_MATCH, what was the blocking reason code? | + `reason_codes[]` |
| 1.5 | **Which single certificate attribute, if added, converts the most NO_MATCH → MATCH?** | + `reason_codes[].attribute` where code = `ATTRIBUTE_FALSE` |
| 1.6 | Which certifier, if obtained, would unlock the most blocked demand? | + `requirement_shape.whitelisted_certifier_ids`, where code = `CERTIFIER_NOT_IN_WHITELIST` |
| 1.7 | Is it being blocked by a *level* rather than a certifier? | + `reason_codes[]` where code = `LEVEL_BELOW_MINIMUM`, + `requirement_shape.min_levels` |
| 1.8 | How much demand is lost to our own missing data rather than to the restaurant's cert? | + `reason_codes[]` where code ∈ {`ATTRIBUTE_UNKNOWN`, `LEVEL_UNKNOWN`, `NO_CERTIFICATE`} |
| 1.9 | Is the certificate about to expire, and how much demand is at risk when it does? | + `certificate_id` → Certificate.valid_until; + `CERTIFICATE_EXPIRES_SOON` |
| 1.10 | Did users who saw MATCH actually act — call, navigate, save? | + `action_taken` (**see refinement R2**) |
| 1.11 | How does this restaurant compare to the neighbourhood median on 1.1–1.4? | + `geo_cell` |
| 1.12 | Month-over-month trend on all of the above | `evaluated_at` + permanent aggregates |

**Question 1.5 is the product.** It is the one line in the report that converts a
free listing into a paid subscription, and it is answerable only because reason codes
are per-attribute rather than a single opaque verdict.

---

## 2. Licensing-facing — enterprise diligence (Revenue Stream 3)

A delivery platform's data team asks these before signing. Every one needs history
that cannot be reconstructed retroactively.

| # | Question | Fields required |
|---|---|---|
| 2.1 | What % of your corpus carries certificate-level attributes, by city? | Tier 3 daily snapshot |
| 2.2 | What is median data freshness, and what SLA can you contract to? | Tier 3 daily snapshot, 24-month history |
| 2.3 | Show freshness and coverage over the last 24 months, not today's number | Tier 3 — **impossible without daily snapshots from day one** |
| 2.4 | What is your wrong-status incident rate, and can you prove it? | §4.1 below |
| 2.5 | How many of *our* kosher-flagged venues does your data contradict or enrich? | Restaurant corpus + Certificate attributes (not the demand log) |
| 2.6 | What is your provenance chain for a given claim? | `verified_by`, `verified_at`, `source_document`, `source_date`, certificate image + hash |
| 2.7 | How fast do you propagate a revocation? | Event-sourced certificate history: revocation event → next evaluation reflecting it |
| 2.8 | What is the real demand signal — how many kashrut-filtered decisions per month, per metro? | `evaluated_at`, `geo_cell`, `surface` |
| 2.9 | Can you supply this as a delta feed rather than a full dump? | Append-only history with monotonic version/sequence |

Question 2.3 is the one that kills deals. A company with 24 months of freshness
history is a vendor; a company with today's number is a demo.

---

## 3. Internal ops — where to spend verification money

The data pipeline is the largest cost line. These questions make it demand-weighted
rather than alphabetical.

| # | Question | Fields required |
|---|---|---|
| 3.1 | Which restaurants generate the most UNKNOWN verdicts? | `restaurant_id`, `verdict`, volume |
| 3.2 | Which *specific* missing attribute costs the most demand, corpus-wide? | `reason_codes[].attribute` where code = `ATTRIBUTE_UNKNOWN` |
| 3.3 | What is the demand-weighted verification backlog — what should a runner photograph next? | 3.1 + 3.2 ranked by evaluation volume |
| 3.4 | Which certifiers appear most in user whitelists but least in our corpus? | `requirement_shape.whitelisted_certifier_ids` vs Certifier coverage |
| 3.5 | Which cities are below the 80% launch gate, and by how much? | Tier 3 snapshot vs corpus |
| 3.6 | What does one verified record cost us, and is it falling? | Ops cost / records verified, from the moderation trail |
| 3.7 | How much verification load did owner self-serve remove? | Certificate rows by `verified_by` type |
| 3.8 | Which records are about to auto-degrade to UNKNOWN on expiry? | Certificate.valid_until + freshness window |

Question 3.3 is how the certificate-runner budget stops being guesswork. It is also
the same query as 1.5, viewed from the supply side rather than the demand side.

---

## 4. Trust & safety — the commitment that keeps the brand

| # | Question | Fields required |
|---|---|---|
| 4.1 | **How many evaluations returned MATCH against a certificate later found to have been invalid at evaluation time?** | `certificate_id` on the evaluation row (**R4**) + event-sourced certificate history |
| 4.2 | Who saw that wrong MATCH, and in what window? | `evaluated_at`, `restaurant_id` — aggregate only, never identities |
| 4.3 | What was the source and the moderator decision behind the bad record? | Moderation trail, `verified_by`, `source_document` |
| 4.4 | Median time from user-reported error to resolution | Moderation trail timestamps |
| 4.5 | Are community flags ever correlating with real status changes? | Flag events vs subsequent certificate events |

Question 4.1 is the PRD §3 commitment (< 0.1% of records/month, each with a
post-mortem). It is a **retroactive** query — answerable only if the deciding
certificate is recorded on every evaluation and certificate history is append-only.
Neither can be added later for past evaluations.

---

## 5. Product & growth — PostHog only, zero kashrut data

| # | Question | Source |
|---|---|---|
| 5.1 | Time from app open → chosen restaurant (PRD target < 60s median) | PostHog funnel |
| 5.2 | W4 retention of onboarded users (PRD target ≥ 30%) | PostHog, stable `analytics_id` |
| 5.3 | % sessions requiring manual filter changes (PRD target < 10%) | PostHog |
| 5.4 | Weekly confident decisions — page views ending in call / navigate / save | PostHog (volume) + Postgres (verdict-conditioned, per R2) |
| 5.5 | Onboarding completion and drop-off by step | PostHog — **step index only, never the selections** |
| 5.6 | Which surfaces drive decisions — nearby, search, saved lists? | PostHog + `surface` |
| 5.7 | Feature flag / A-B results | PostHog |

Note on 5.5: the *shape* of onboarding drop-off is a legitimate product question. The
*content* of what a user selected is religious belief data and never enters PostHog.

---

## 6. Questions we have deliberately made unanswerable

This section is load-bearing. A privacy boundary that is never stated is a boundary
that erodes. Each of these is commercially useful and permanently off-limits:

- Who is the most machmir user in Jerusalem?
- Show me an individual's dining history.
- Which users relaxed or tightened their standards over time?
- Build a cross-day behavioural profile segmented by stringency level.
- Which named users would accept a restaurant this certifier covers?
- Cohort our paying subscribers by observance level.

These are blocked structurally, not by policy: the demand log has no stable
identifier, and the store that has one carries no kashrut data. **The two are never
joined** — that single sentence is the whole control, and it is auditable in code
review.

A consequence worth accepting explicitly: **monthly distinct-user counts on the
demand log are unavailable by design** (the pseudonym rotates daily). Owner reports
therefore say "appeared in 1,240 matched searches from ~380 distinct daily users",
and monthly actives come from PostHog, unjoined. See R3.

---

## 7. Schema refinements this exercise surfaced

Writing the questions first exposed four things the field list in
`monetization-strategy.md` §4 did not capture. All four are cheap now and expensive
later.

**R1 — Normalise the requirement shape.** Storing the full whitelist array on every
evaluation row is heavy (a user may whitelist ~130 local councils, and the row is
written per restaurant per search). Instead write a `requirement_shape` dimension
table keyed by `requirement_signature`, populated once per distinct shape; the
evaluation row carries only the signature. This collapses row size by orders of
magnitude and turns questions 1.6, 1.7 and 3.4 into cheap joins.

**R2 — `action_taken` belongs on the Postgres evaluation row, not in PostHog.**
Question 1.10 ("did MATCH convert better than UNKNOWN?") needs the action *and* the
verdict. If the action lives only in PostHog, answering it requires joining across
the bright line. Record call / navigate / save on the restaurant-page evaluation row
itself, and the question is answerable without ever crossing it.

**R3 — Accept the loss of monthly distinct counts.** Documented in §6. Do not fix it
by lengthening the salt rotation; the daily rotation is the control.

**R4 — Keep the deciding `certificate_id` on every evaluation row.** Without it,
question 4.1 — the wrong-status audit the PRD commits to — is unanswerable for every
evaluation already written. This is the single most irreversible field on the list.

---

## 8. Acceptance criteria

The day-one capture is done when every question in §1–§5 can be answered by a query
against the schema, §6 remains structurally impossible, and R1–R4 are implemented.
Questions 1.5, 2.3 and 4.1 are the three that justify the whole exercise: the first
sells subscriptions, the second closes licensing deals, and the third protects the
brand that makes either possible.
