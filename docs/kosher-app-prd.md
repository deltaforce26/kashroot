# PRD — "Kashroot" (working name)
### The kosher dining app that answers: *"Can I eat here according to MY standards?"*

**Version:** 1.0 draft · **Date:** Aug 2026 · **Decisions locked:** Israel-first · Hybrid match (binary kashrut gate + soft-preference score) · MVP = Discovery + Saved Lists

---

## 1. Executive Summary

Every existing kosher app answers "is this restaurant kosher?" and forces the user to manually verify whether the certification meets *their* standard. We flip the model: the user defines their kashrut profile once; every restaurant is then shown as **Matches / Doesn't match / Unknown** — with proof.

The signature insight from product analysis: **the product is a data company wearing an app.** The UX is table stakes; the moat is a per-certificate, per-restaurant, continuously-verified kashrut database with provenance and freshness. No competitor has this. Building it is hard, which is exactly why it's defensible.

MVP: Israel only. Discovery (nearby + city search), personalized kashrut matching, restaurant pages with certificate evidence, saved lists. Trip planning, AI search, US expansion are explicitly post-MVP.

---

## 2. Product Vision

**"Never wonder if you can eat here."**

- One-time kashrut profile → zero-filter daily experience.
- Kashrut compliance is **binary and evidence-backed** — never a percentage.
- Soft preferences (distance, price, open-now, family-friendly) get a **Fit Score**.
- Trust is earned via provenance: every claim shows its source, evidence, and last-verified date.
- Long-term: the definitive global layer for kosher dining and Jewish travel (bakeries, supermarkets, hotels, synagogues, mikvahs) — but only after the restaurant layer is bulletproof in each geography.

**Anti-goals (important):**
- The app never rules on halacha. It never says "Badatz X is Mehadrin." Users whitelist certifiers; the app reports facts.
- Community input never determines certification status — only freshness/flag signals.
- Paid placement never influences match results or ranking.

---

## 3. Success Metrics

| Category | Metric | MVP target (Israel, 6 mo post-launch) |
|---|---|---|
| **Data (north-star inputs)** | Certified restaurants covered | ≥ 85% of actively certified restaurants in Tel Aviv, Jerusalem, Bnei Brak, Haifa, Beer Sheva |
| | % records with certificate-level attributes | ≥ 70% |
| | Median data freshness (last verified) | ≤ 30 days |
| | Wrong-status incidents (restaurant shown as Match while cert lapsed) | < 0.1% of records / month, each with post-mortem |
| **Product (north star)** | Weekly "confident decisions" = restaurant page views ending in call/navigate/save | growth metric |
| | % sessions requiring manual filter changes | < 10% (profile does the work) |
| | Time from open → chosen restaurant | < 60s median |
| **Retention** | W4 retention of onboarded users | ≥ 30% |
| **Trust** | User-reported data errors resolved | median < 48h |

North-star: **weekly confident dining decisions**. Data metrics are leading indicators — if they slip, the north star dies with a lag.

---

## 4. User Personas

### 4.1 Local Daily User — "Hungry Now" (primary MVP)
Yossi, 34, Tel Aviv, eats Rabbanut Mehadrin + specific badatzim. Opens app at lunch. Needs: open-now, walking distance, matches profile, decide in 30s. Success = never reads a certificate photo himself.

### 4.2 Machmir Family — "High-trust household" (primary MVP)
The Katz family, Jerusalem, eat only Eda Haredit / Beit Yosef / Rubin, require Pas Yisrael + Chalav Yisrael + Glatt. Needs: absolute trust, evidence photos, family seating, parking, large groups. One wrong match = uninstall + community backlash. This persona sets the trust bar.

### 4.3 Domestic Traveler (secondary MVP)
Family from Modi'in spending Chol Hamoed in the north. Needs: city search ("Tiberias"), saved lists per outing, hours around holidays (critical in Israel: erev chag closures, Chol Hamoed hours).

### 4.4 Inbound Tourist (post-MVP priority)
US visitor in Israel; doesn't know Israeli certifier landscape. Needs: profile presets mapped from US-familiar terms ("I eat OU at home → here's what typically corresponds — you choose"), English UI, hotel-proximity search. **Note:** the mapping suggestion is informational only, user confirms — the app doesn't equate agencies.

### 4.5 Secular/Traditional user (growth persona)
Eats "anything with a teuda." Needs the simplest preset ("Any valid certification") — this persona makes the app a general restaurant app for a large Israeli segment and drives scale.

### 4.6 Restaurant Owner (supply-side persona — often forgotten)
Wants: correct listing, upload renewed certificate, respond to flags, see analytics. Owner self-serve is a *data pipeline component*, not just a business feature.

### 4.7 (Post-MVP) Outbound Israeli traveler & US local user — activated at US expansion.

---

## 5. User Stories (selected, MVP)

- As a user, I set my kashrut profile once (preset or custom certifier whitelist + required attributes) so I never configure filters again.
- As a user, I see nearby restaurants split into **Matches you (N)** / Unknown / Doesn't match — matches first, sorted by Fit Score.
- As a machmir user, I tap "Why does this match?" and see: certifier, level, attributes, certificate photo, expiry, last verified date.
- As a user, I search "Tiberias" and get the same matched experience for a future outing.
- As a user, I save restaurants into named lists ("North trip", "Date nights") and share a list via link.
- As a user, I flag "certificate looks expired / restaurant closed" in two taps.
- As a saved-list user, I'm notified if a saved restaurant's certification changes or lapses (the *only* MVP notification).
- As an owner, I claim my listing and upload a renewed certificate for moderator review.
- As a moderator (internal), I process a queue of: new certificates, flags, expiring-soon records.

---

## 6. Information Architecture

```
App
├── Home (nearby matches, open now)
├── Search (places: city/neighborhood/address/landmark + text)
├── Map (same result set, toggle with list)
├── Saved (lists)
├── Profile (kashrut profile, prefs, language)
└── Restaurant Page
    ├── Match verdict + explanation
    ├── Certificate evidence
    ├── Practical info (hours incl. Shabbat/chag logic, phone, nav, menu, price)
    ├── Amenities (family, parking, accessibility, delivery)
    └── Flags / report
Internal
└── Moderation console (queues, sources, audit log)
Owner
└── Claim + certificate upload (web, minimal)
```

---

## 7. Navigation

Bottom tabs (mobile-first, RTL-first): **Home · Search · Saved · Profile**. Map is a toggle inside result views, not a tab (reduces choice; matches "decide fast" goal). Notifications live as a bell on Home (MVP has one notification type — no tab justified).

---

## 8. User Flows (key)

**Onboarding (target < 90s):**
1. Language (HE/EN) → location permission (with clear value copy).
2. "How do you eat?" → 4–6 presets: *Any certification* / *Rabbanut (regular)* / *Rabbanut Mehadrin+* / *Specific Badatzim only* / *Custom*.
3. Preset → optional refinement: certifier checklist (logos, grouped: Rabbanut levels, badatzim, private/Tzohar), required attributes (Glatt, Chalav Yisrael, Pas Yisrael, Bishul Yisrael, kitniyot policy for Pesach mode).
4. Diet quick-pick: meat/dairy/both.
5. Land on Home with matches. Skippable at every step → defaults to "Any certification" with a persistent gentle prompt.

**Grandparent test:** preset path is 3 taps. Custom path exists for the machmir persona. Complexity is progressive, never mandatory.

**Daily flow:** open → Home shows "23 restaurants match you nearby · 14 open now" → tap card → verdict + hours + navigate. Zero filters.

**Flag flow:** restaurant page → "Report" → chips (Closed / Certificate changed / Wrong info / Not kosher anymore) → optional photo → thanks + status tracking. Feeds moderation queue; repeated flags auto-degrade record to "Unknown" pending review (fail-safe direction: doubt → Unknown, never doubt → Match).

**Empty states:** no matches nearby → show nearest matches + distance, plus "Unknown" section with explanation ("we haven't verified these yet — want to help? / owner? claim it"). Never a dead end.

---

## 9. Functional Requirements (MVP)

**FR1 Kashrut Profile:** presets + custom whitelist of certifiers (by certifier *and* level, e.g. "Rabbanut Mehadrin" ≠ "Rabbanut regular") + required attributes + diet. Multiple profiles per account (post-MVP: family profiles; MVP: single).
**FR2 Match Engine:** see §17. Output per restaurant: `MATCH | NO_MATCH | UNKNOWN` + reason codes + confidence + freshness.
**FR3 Discovery:** geo query (radius, open-now, diet), place search (Google Places for geocoding), map/list, sorted by gate → Fit Score.
**FR4 Restaurant Page:** verdict explanation, certificate evidence (photo, certifier, expiry, source, last-verified), hours with Israel-specific logic (Shabbat, chagim, erev chag early close, Chol Hamoed), practical info, amenities, flag/report.
**FR5 Saved Lists:** create/rename/share (public read-only link), offline cache of saved items' core data.
**FR6 Cert-change notification** for saved restaurants only.
**FR7 Owner claim + certificate upload** (minimal web form → moderation queue).
**FR8 Moderation console:** source ingestion review, flag queue, expiry queue (auto-surface certs expiring < 14 days), audit log of every status change (who/what/evidence).
**FR9 Localization:** Hebrew (RTL) + English at launch. Dates: Gregorian + Hebrew calendar awareness for hours logic.

**Explicitly NOT in MVP:** trip planning, AI/NLP search, reviews & ratings, delivery integration, reservations, community reviewers/following, US data, Pesach mode (fast-follow — seasonal), menus beyond a photo/link.

---

## 10. Non-Functional Requirements

- **Correctness over completeness:** a record without verified data shows Unknown. No silent guessing. Ever.
- **Performance:** Home results < 1.5s p90 on 4G; map pan re-query < 700ms.
- **Availability:** 99.5% MVP; degrade gracefully to cached data.
- **Offline:** saved lists readable offline (Shabbat-adjacent travel, poor reception up north).
- **Privacy:** location used transiently, not stored as history (MVP); religious profile is sensitive personal data — encrypt at rest, never sold, never used for ads. State this loudly; it's a trust feature.
- **Accessibility:** WCAG AA, large-text friendly (grandparents), full RTL.
- **Auditability:** every kashrut status change is logged with source + evidence + actor.

---

## 11. Feature Prioritization

| Phase | Features |
|---|---|
| **MVP (0–6 mo)** | Profile, match engine, discovery, restaurant pages w/ evidence, saved lists, flagging, owner claim, moderation console, HE/EN, 5 major cities' data |
| **Fast-follow (6–9 mo)** | Pesach mode, coverage → all Israel, photos/menus enrichment, simple AI search, home-screen widgets |
| **v2 (9–15 mo)** | Trip planning, community layer (photos, "still open" confirmations, trusted local lists), tourist presets, notifications expansion |
| **v3 (15–24 mo)** | US launch (city-by-city), categories expansion (bakeries, supermarkets, hotels), API/enterprise |

---

## 12. AI Opportunities (honest assessment)

**High value, MVP-adjacent:**
- **Certificate OCR + extraction** (Hebrew): parse certifier, level, expiry, attributes from certificate photos → pre-fill moderator review. This is the single highest-ROI AI use — it scales the ops team. Human always confirms; AI never publishes directly.
- **Source-diff monitoring:** detect changes in certifier lists/PDFs, generate structured diffs for moderators.

**v2:** natural-language search ("basari in Jerusalem under Badatz Rubin, open now") → structured query. Constrained NL→filter translation; the *match* still comes from the engine, AI never answers kashrut questions from its own knowledge.
**v2:** certificate explanation in plain language ("This is a Rabbanut Mehadrin certificate from the Jerusalem religious council, valid until…").
**Avoid:** AI-generated kashrut judgments, AI-ranked "trustworthiness" of certifiers. Liability + trust destroyers.

---

## 13. Trust & Verification System (core of the product)

### Source hierarchy (descending authority)
0. **Certifier portal push** (target state) — certifier uploads/updates their own restaurants via a dedicated portal; real-time renewals *and revocations*. Manual collection (below) is the bootstrap that proves value and creates the incentive for certifiers to adopt the portal.
1. **Certifier official data** (Rabbanut national kashrut database, badatz published lists) — authoritative for *status*, often weak on attributes.
2. **Certificate photo verified by moderator** — authoritative for attributes + expiry.
3. **Owner-submitted certificate** (pending moderation) — provisional.
4. **Field verification** (ops team / trusted volunteers photographing certificates) — bootstraps coverage.
5. **Community flags** — *never* set status upward; can only trigger review or degrade to Unknown.

### Record states & rules
- `MATCH` requires: valid certificate from a whitelisted certifier, not expired, attributes satisfy user requirements, freshness within threshold.
- Expiry passed with no renewal evidence → auto-degrade to `UNKNOWN` ("certificate expired — pending re-verification"), notify savers. **Fail safe, always.**
- Every record displays: source badge, evidence photo, expiry date, "verified X days ago."
- Confidence score (internal, surfaced as freshness UI): source authority × recency × corroboration count.

### Moderation ops (this is a team, budget it)
- MVP ops: ~2 FTE moderators + certificate-runner network (paid gig per verified photo) for the 5 launch cities. Estimated initial corpus: ~3,000–4,000 certified restaurants in launch cities; steady-state re-verification load driven by ~annual cert renewals + expiry queue.
- SLA: flags < 48h, expiring certs surfaced 14 days early, owner uploads < 72h.

### Restaurant owners
Claimed listings get a "responsive owner" badge; uploading renewals keeps them at `MATCH` without gaps → aligned incentive that feeds the pipeline for free.

---

## 14. Search System

- **Geo discovery:** PostGIS radius/viewport queries over the restaurant index; filters compiled from profile (certifier whitelist, attributes, diet) + session filters (open now, distance, price).
- **Place search:** geocoding provider (Google Places) for cities/neighborhoods/hotels/landmarks/addresses → coordinates → same geo pipeline. Landmark aliases curated for Jewish POIs ("הכותל", "קבר רחל", Ben Gurion) — cheap, high-delight.
- **Text search:** restaurant-name search with Hebrew normalization (nikud-insensitive, final letters, HE/EN transliteration: "שגב" / "Segev").
- **Ranking within Matches:** FitScore = weighted(open-now hard-boost, distance decay, price fit, amenity fit, [v2: ratings]) — weights per context (lunch hours boost open-now + walking distance). Distance is deliberately *not* dominant when a slightly farther restaurant fits much better.
- **v2:** NL search layer (see §12).

---

## 15. Trip Planning System (v2 — design sketch, not MVP)

Trip = destination(s) + dates + lodging anchor(s) + transport mode + profile. System produces: matched restaurants clustered by anchor (hotel / attractions / airport / route corridors via routing-engine isochrones), day-assignable lists, offline bundle, holiday-hours warnings for the date range ("this Friday everything near your hotel closes by 14:30"). Differentiation is real but worthless without dense trusted data — hence v2. MVP's shareable saved lists are the wedge (users already plan trips with lists today).

---

## 16. Restaurant Data Model (core entities)

```
Restaurant(id, names{he,en}, geo point, address, city, phone, website,
           diet_type[meat|dairy|pareve|fish|mixed], price_level,
           amenities{family, parking, accessibility, delivery, groups},
           hours[] (with erev_shabbat/chag rules), photos[], menu_url,
           status[open|closed_temp|closed_perm], owner_claim_id?)

Certifier(id, name, type[rabbanut_local|badatz|private], parent?, logo)
  // Rabbanut modeled per local religious council + level

Certificate(id, restaurant_id, certifier_id, level[regular|mehadrin|...],
            attributes{glatt, chalav_yisrael, pas_yisrael, bishul_yisrael,
                       yashan, kitniyot_pesach?, sheruya?...},   // per-certificate!
            valid_from, valid_until, evidence_photo, 
            source[official_list|moderator_verified|owner|field],
            verified_by, verified_at, state[active|expired|revoked|pending])

UserProfile(id, whitelist[(certifier_id, min_level)...],
            required_attributes{...}, diet_prefs, language)

Flag(id, restaurant_id, type, photo?, user_id, state, resolution)
AuditLog(entity, change, actor, evidence, ts)
SavedList(id, user_id, name, restaurant_ids[], share_token?)
```

Key modeling decisions: **attributes live on Certificate, not Certifier** (same badatz differs per restaurant); Rabbanut is ~130 local councils × levels, not one certifier; every kashrut-relevant field carries provenance.

---

## 17. Personalization Model & 18. Recommendation Engine

### Two-layer hybrid (as decided)

**Layer 1 — Kashrut Gate (binary, deterministic, explainable):**
```
MATCH      iff ∃ active, unexpired, fresh certificate C where
           C.certifier ∈ profile.whitelist (at ≥ required level)
           ∧ ∀ a ∈ profile.required_attributes: C.attributes[a] = true
NO_MATCH   iff data sufficient and condition fails
UNKNOWN    otherwise (missing/expired/stale data)
```
Reason codes power the "Why?" UI: *"✓ Badatz Rubin (in your list) · ✓ Glatt · ✓ Pas Yisrael · Certificate valid until 30/09/26 · Verified 6 days ago."* NO_MATCH is equally explicit: *"✗ Certified Rabbanut regular — not in your list."*

**Layer 2 — Fit Score (0–100, soft preferences only):** distance, open-now, price fit, amenities, diet preference, (v2) ratings + learned personal taste from saves/visits. Shown as ranking + optional badge; **visually distinct from the kashrut verdict** so users never confuse "92 fit" with "92% kosher."

Recommendation engine MVP = ranking function; v2 adds collaborative signals ("families like yours save…") — cold-start handled by content-based fit until interaction data accrues.

---

## 19. Business Model

| Model | Verdict | Notes |
|---|---|---|
| **Free consumer core** | ✅ Always | Trust product; kashrut info paywalled = mission failure + PR disaster |
| **Consumer Premium** | ✅ v2 | Trip planning, offline packs, multi-profiles, widgets. Pays for tourists/travelers |
| **Restaurant subscription** | ✅ v2, firewalled | Analytics, menu/photo tools, "responsive owner" tools, promoted placement **only in a clearly labeled, separate carousel — never in match results or organic ranking**. Publish the firewall policy publicly |
| **Travel partnerships** | ✅ v3 | Hotels/airlines/tour operators embedding matched dining (Booking-style affiliate) |
| **API / Enterprise** | ✅ v3 | The certified-kosher dataset licensed to mapping/travel platforms — potentially the biggest asset |
| **Advertising** | ⚠️ Only non-endemic, never targeting by religious profile | Realistically: avoid until scale forces the question |

Honest tradeoff: MVP revenue ≈ 0. This phase is funded to build the data moat; monetization follows density. Restaurant-side revenue is the earliest realistic stream but must launch *after* the trust brand is established, never before.

---

## 20. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Wrong MATCH on lapsed cert** (someone eats treif trusting us) | Existential | Fail-safe degradation to Unknown, expiry auto-queues, audit log, incident post-mortems, insurance/legal disclaimer drafted with counsel |
| Data acquisition slower/costlier than planned | High | Start 5 cities not all Israel; certificate-runner gig network; owner self-serve; OCR leverage |
| Certifier relations (agencies object to inclusion/scraping) | High | Proactive partnerships — offer free digital presence + change-push channel; Rabbanut data is public |
| Perceived halachic positioning ("app decides what's Mehadrin") | High | Whitelist-only model, no agency rankings, rabbinic advisory board for taxonomy naming, careful copy |
| Cold start (thin data → Unknown everywhere → churn) | High | Don't launch a city below 80% coverage; "Any certification" preset works from day one |
| Google Maps "good enough" for secular segment | Med | Our wedge is the machmir + traveler segments where Google is useless; expand from trust core |
| Community flags weaponized (competitor false-flags) | Med | Flags trigger review, never direct status change; flagger reputation; owner notification |
| Sensitive-data breach (religious profiles) | Med | Minimize collection, encrypt, no third-party sharing, privacy as marketing |
| Ops cost scaling with geography | Med | OCR + owner pipeline + community freshness signals reduce per-record cost over time |

---

## 21. Open Questions (need your input)

1. **Certifier partnerships:** do we attempt formal Rabbanut/badatz data partnerships pre-launch, or launch on public data + field verification and partner from strength? (My lean: launch first, partner from strength — pre-launch negotiations with 10 bodies will stall you.)
2. **Rabbinic advisory board:** for taxonomy/copy credibility with the machmir segment — worth the governance overhead at MVP?
3. **Pesach mode scope:** fast-follow or MVP if launch lands near Pesach? (Seasonal spike is a huge acquisition moment.)
4. Anonymous browsing vs. account-required for profiles? (Lean: no account needed; profile local-first, account only for saved-list sync.)
5. Funding model for the ops team — bootstrap size?
6. Brand/name direction, and whether "Jewish travel" ambition appears in branding from day one or stays hidden until v2.

---

## 22. Architecture — **LOCKED: Option A (FastAPI + PostgreSQL/PostGIS modular monolith)**

**Common needs:** geo queries, mobile HE-RTL app, moderation console, image pipeline (certificates), OCR service, audit logging, offline-capable saved lists. Scale is modest (Israel: tens of thousands of records, likely < 100k MAU year one) — this is a *data-integrity* problem, not a scale problem.

**Option A — Modular monolith (my recommendation):**
FastAPI + PostgreSQL/PostGIS (+ pgvector later for NL search embeddings), Redis cache, S3-compatible storage for evidence photos, React Native (Expo) app, small React admin console, Anthropic/OCR service for certificate extraction. CI/CD you already know (GitLab → ArgoCD-style GitOps if self-hosted, or plain managed cloud).
*Pros:* fastest to correctness, one schema with real FKs and audit integrity (your comfort zone), trivial ops, easy to evolve. *Cons:* none that matter at this scale.

**Option B — BaaS (Supabase/Firebase):**
*Pros:* fastest CRUD start, auth/storage free. *Cons:* PostGIS is fine on Supabase but moderation workflows, audit guarantees, and the ingestion pipeline outgrow BaaS ergonomics quickly; migration tax later. Reasonable for a throwaway prototype, not for the system of record.

**Option C — Microservices (ingestion / match / search / media / users):**
*Pros:* clean seams on paper. *Cons:* premature — 5 services for a 3-person team kills velocity. The monolith's modules become services later *if ever needed*.

**Cross-cutting recommendations regardless of option:** match engine as a pure, unit-tested function over Certificate×Profile (your eval/production-runner pattern applies); ingestion as versioned pipelines with diff review; event-sourced audit for kashrut status changes.

**→ Decision: A, confirmed.** Server: FastAPI + PostgreSQL/PostGIS, SQLAlchemy 2.0 + Alembic, Redis, S3-compatible media storage. Client: **React Native (Expo)** — one codebase, OTA updates, solid RTL; maps via react-native-maps / MapLibre. Admin/moderation + certifier portal as web (React).

---

## 23. Roadmap

**0–6 mo (MVP):** data pipeline + moderation console first (weeks 1–8, before app polish), 5-city corpus to ≥80% coverage, app beta in one city (Jerusalem — hardest audience = best test), public launch Israel, HE/EN.
**6–12 mo:** **certifier portal v1** (pilot with 1–2 friendly badatzim / local councils — B2B pitch: free digital management of your certified businesses, push renewals/revocations), all-Israel coverage, Pesach mode, AI search, community freshness layer, restaurant self-serve v2, consumer Premium beta, tourist presets (English marketing to inbound tourism).
**12–24 mo:** Trip planning, US launch (NYC → NJ → LA/Miami; new certifier taxonomy: OU/OK/Star-K/CRC/Kof-K + local vaads — the per-certificate model transfers cleanly), categories expansion (bakeries, supermarkets, hotels), dataset API/enterprise, "Jewish travel layer" (synagogues, mikvahs) as a distinct tab so the dining core stays uncluttered.

---

*Standing challenge encoded in this PRD: every feature decision was tested against "does this help the machmir family trust a match in under 10 seconds?" If a proposed addition doesn't, it waits.*
