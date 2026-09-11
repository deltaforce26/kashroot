# Kashroot — app flow

One question, answered the same way every time: **can I eat here, according to my
standards?** The user defines a kashrut profile once; every restaurant then returns
one of three verdicts with the evidence attached. The app never rules on halacha.

| Verdict | Meaning |
| --- | --- |
| `MATCH` | A certificate satisfies the profile: whitelisted certifier, level met, every required attribute true, in force, evidence fresh. |
| `NO_MATCH` | The data was sufficient and it failed — a definitive published fact. |
| `UNKNOWN` | Anything else. Doubt is never resolved in the restaurant's favour. |

A rendered version of these diagrams:
<https://claude.ai/code/artifact/4d263ca7-69bb-4f85-a382-24c3db032cae>

---

## 1. End to end

Three parties. The person sets a profile and asks about a place; the backend gates and
ranks; the certificate database — built and maintained by hand — is the only thing
that can produce a `MATCH`.

```mermaid
flowchart TD
    subgraph APP["1 — In the app"]
        A1["Open the app<br/>no sign-up wall"]
        A2["Pick a starting preset<br/>or build a standard from scratch"]
        A3["Whitelist certifiers, require attributes<br/>glatt · chalav yisrael · pas yisrael"]
        A4["Home · Search · Map<br/>a place, a radius, soft filters"]
        A5["Results list<br/>verdict pill and fit bar, side by side"]
        A6["Restaurant page<br/>the evidence panel answers Why?"]
        A7["Save to a list · report a problem"]
        A1 --> A2 --> A3 --> A4
        A5 --> A6 --> A7
    end

    subgraph API["2 — API and match engine"]
        B1["POST /search<br/>the profile travels with every query"]
        B2["Candidate set<br/>PostGIS radius · text · open-now · filters"]
        B3["Layer 1 — the kashrut gate<br/>pure function, run per certificate"]
        B4["Layer 2 — fit score 0-100<br/>distance · open now · price · amenities"]
        B5["Response<br/>verdict · reason codes · fit · deciding certificate"]
        B1 --> B2 --> B3 --> B4 --> B5
    end

    subgraph DATA["3 — Data and moderation"]
        C1["Certifier lists and source documents<br/>375 seed records from 7 sources"]
        C2["Ingestion run<br/>versioned, dry-run diff by default"]
        C3["Moderation console<br/>approve · correct · reject the diff"]
        C4["Certificate records<br/>attributes · level · dates · provenance"]
        C5["Expiry and freshness watch<br/>past due or stale, degraded on read"]
        C6["Audit log<br/>every kashrut status change, kept"]
        C1 --> C2 --> C3 -- "approved rows only" --> C4
        C4 -- "valid_until · verified_at" --> C5
        C5 -.-> C6
    end

    A4 -- "profile + place" --> B1
    C4 -- "reads" --> B3
    B5 -- "verdict + evidence" --> A5
    A7 -. "a report opens a review — it can degrade a status, never raise one" .-> C3
```

**The profile is the query.** Nothing is pre-computed per user: the same restaurant
returns `MATCH` to one person and `NO_MATCH` to the next, because the gate runs
against that person's whitelist at request time.

---

## 2. Layer 1 — the kashrut gate, one certificate at a time

Five questions in a fixed order. Falling out to the left is a *definitive fact* — the
data was sufficient and it failed. Falling out to the right is *doubt*. Only a clean
run down the middle reaches `MATCH`.

```mermaid
flowchart TD
    S["A restaurant × your profile"] --> Q1{"Any certificate<br/>on file at all?"}
    Q1 -- no --> U1["UNKNOWN<br/>no_certificate"]
    Q1 -- yes --> Q2{"Is its certifier<br/>on your whitelist?"}
    Q2 -- no --> N1["NO_MATCH<br/>certifier_not_in_whitelist"]
    Q2 -- yes --> Q3{"Is the certificate in force?<br/>not revoked, inside its dates"}
    Q3 -- revoked --> N2["NO_MATCH<br/>certificate_revoked"]
    Q3 -- "expired · pending · not yet valid" --> U2["UNKNOWN<br/>certificate_expired"]
    Q3 -- yes --> Q4{"Does the level meet<br/>your minimum?"}
    Q4 -- below --> N3["NO_MATCH<br/>level_below_minimum"]
    Q4 -- "not published" --> U3["UNKNOWN<br/>level_unknown"]
    Q4 -- yes --> Q5{"Is every required<br/>attribute true?"}
    Q5 -- "one is false" --> N4["NO_MATCH<br/>attribute_false"]
    Q5 -- "one is not mentioned" --> U4["UNKNOWN<br/>attribute_unknown"]
    Q5 -- yes --> Q6{"Is the evidence fresh?<br/>clock runs from verified_at"}
    Q6 -- "stale or missing" --> U5["UNKNOWN<br/>evidence_stale"]
    Q6 -- yes --> M["MATCH"]
```

**A restaurant may hold several certificates.** Each runs this gate on its own, then
the engine ranks the results — `MATCH` before `UNKNOWN` before `NO_MATCH`, then by
source authority, then by most recent verification. The winner is the *deciding
certificate* shown in the evidence panel, so the answer and its proof are always the
same document.

**Fail-safe.** Doubt goes to `UNKNOWN`; it never goes to `MATCH`. An expired
certificate with no renewal evidence degrades on read, even if the stored record still
says active. An attribute the certificate does not mention is *unknown*, not false:
absence of evidence blocks a `MATCH` but does not prove a `NO_MATCH`.

---

## 3. Two layers that never touch

Kashrut is a gate with three states. Everything else — how far, whether it's open,
price, amenities — is a soft score out of 100. Disjoint inputs; combined only in the
layout, never in arithmetic.

```mermaid
flowchart LR
    I1["Certificate × profile<br/>whitelist · levels · attributes"] --> L1
    I2["Distance, hours, price<br/>amenities · diet preference"] --> L2
    L1["Layer 1 — the kashrut gate<br/>deterministic · explainable<br/>no distance, no hours, no price"] --> V["MATCH / NO_MATCH / UNKNOWN"]
    L2["Layer 2 — fit score<br/>soft preferences only<br/>no certifier, no certificate, no verdict"] --> F["84 fit"]
    V --> UI["On the card:<br/>verdict pill and fit bar,<br/>visually distinct, never blended"]
    F --> UI
```

**The same restaurant scores 84 whether its verdict is `MATCH` or `UNKNOWN`.** Layer 2
cannot see the verdict, so a high fit score can never be misread as "mostly kosher" —
and a restaurant is never nudged past the gate by being close and open.

---

## Where each step lives

| Step | Code | Notes |
| --- | --- | --- |
| Onboarding and profile | `web/src/views/Onboarding*.tsx`, `web/src/profile/` | Profile is held client-side and sent with each query |
| Search and detail API | `app/api/public.py` | PostGIS candidate set, then per-restaurant evaluation |
| Layer 1 — the gate | `app/match/engine.py` | Pure; `now` is a parameter, not a clock |
| Layer 2 — fit score | `app/match/fit.py` | Missing soft data scores a neutral 0.5, never zero |
| Certificates and provenance | `app/models/certificate.py` | Attributes sit here, not on the certifier |
| Ingestion | `app/ingestion/seed_import.py` | Dry-run by default; writes an ingestion run plus audit rows |
| Moderation queues | `app/api/admin/`, `admin/src/views/` | Review, expiry, flags, photo evidence, audit log |

Launch gate: no city ships below 80% coverage — Tel Aviv, Jerusalem, Bnei Brak,
Haifa, Beer Sheva.
