# Address verification search task

You are verifying restaurant addresses for Kashroot, a kosher-restaurant data-integrity
product. The seed corpus was transcribed from certifier lists and posters and has never
been checked against reality. Your job is to find what each business's **current public
listings** say its address is.

## Your input
A JSON array of rows at the path given in your prompt. Each row:
`row_number, name_he, address_he, city_he, city_en, business_type_he, phone, needs_review`

## What to do, per row

Run `WebSearch` with a Hebrew query shaped:

    <name_he> <city_he> כתובת

If the first search is inconclusive, run ONE narrowing retry — quote the name
(`"<name_he>" <city_he> כתובת`), or add `business_type_he`, or add the phone number.
Two searches per row maximum. Do not burn more.

Extract the **street name + house number** as published. Prefer Israeli business-listing
sites: d.co.il (דפי זהב), rest.co.il, easy.co.il, kosharot.co.il, 10bis.co.il,
mishloha.co.il, rol.co.il, dunsguide.co.il, or the business's own website.

## Rules — these matter more than coverage

1. **Report what a listing says. Never guess, never infer.** Do not derive an address from
   the restaurant's name, from the neighbourhood, or from a similarly-named business.
2. An address is `FOUND` only if it appears on a real listing/business page AND you record
   that page's URL as `evidence_url`.
3. If sources disagree, or the business is a chain with more than one branch in the same
   city, the status is `AMBIGUOUS`. List every candidate address you saw in
   `candidates`. **Do not pick one.**
4. If you find nothing credible, the status is `NOT_FOUND`. This is a perfectly good
   outcome. An empty result is far better than a wrong one — a bad address sends a user
   to the wrong building.
5. Do **not** decide whether the found address differs from the corpus address. That
   comparison is done later by code. Just report both.
6. Record the found address in Hebrew, as published. Keep it as-is
   (e.g. `דרך חברון 101, ירושלים`); do not normalize or strip anything.

## Output — one JSONL file, one line per input row

Append to the output path given in your prompt. Every input row gets exactly one line,
including NOT_FOUND ones. Schema:

```json
{"row_number": 12, "name_he": "...", "city_he": "...", "address_he": "...",
 "found_address_raw": "דרך חברון 101, ירושלים",
 "evidence_url": "https://www.d.co.il/...",
 "corroborating_urls": ["..."],
 "candidates": [],
 "found_status": "FOUND",
 "agent_note": ""}
```

- `found_status` is one of `FOUND`, `NOT_FOUND`, `AMBIGUOUS`.
- For `NOT_FOUND`: `found_address_raw` and `evidence_url` are `""`.
- For `AMBIGUOUS`: `found_address_raw` is `""`, and `candidates` lists every address seen,
  each as `{"address": "...", "url": "..."}`.
- `agent_note` is a short free-text note (e.g. `"two branches in city"`,
  `"only a delivery aggregator listing"`, `"permanently closed per listing"`).

Write the file with `ensure_ascii=False`, UTF-8.

## When you finish

Verify your JSONL has exactly as many lines as your input batch had rows, and that
`row_number` values are unique and match the input. Then report back ONLY these counts:
total rows, FOUND, NOT_FOUND, AMBIGUOUS, and anything that went wrong.
**Do not paste row data into your reply.**

---

## Provenance

This protocol governed the address verification pass recorded in
`address_search_findings.jsonl`. It is kept in the repo so the method behind every row in
`address_changes.csv` is auditable, and so a later pass can be run the same way.

Selecting a slice of work: rows whose `verdict` is `NOT_CHECKED` in
`address_verification_full.csv` are the ones still needing a search. `NOT_CHECKED` means
nobody looked; `NOT_FOUND` means someone looked and found nothing. Never convert the
former into the latter without actually searching.
