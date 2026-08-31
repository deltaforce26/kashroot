# Kashroot moderation console (internal)

- Install: `cd admin && npm install`
- Dev: `npm run dev` — proxies `/api` to the FastAPI server at `http://localhost:8000` (start it first).
- Build: `npm run build` · Tests: `npm test`
- Token: sign in with a moderator token from the backend's `KASHROOT_ADMIN_API_TOKENS`
  (JSON map of token → actor name). Stored in sessionStorage only; a 401 returns you to login.

## Tabs

- **Review queue / Flags / Expiry / Photos** — the moderation work queues. Every action
  is audited and fail-safe: nothing on these paths can raise a kashrut status.
- **Restaurants** — the whole corpus, searchable, with a details editor for the
  non-kashrut half of a record (names, address, city, contact, business type, and the
  Fit Score soft preferences). Certificates show read-only: kashrut facts are edited
  only through the guarded queue actions. Correcting name/city/address re-derives the
  ingestion dedupe key, and a rename onto another record's identity is refused (409).
- **Audit log** — append-only, read-only.

## Language and direction

The console UI is Hebrew and RTL (`<html lang="he" dir="rtl">`). The API contract is
unchanged and stays English: every enum value on the wire (`glatt`, `closed_perm`,
`moderator_verified`, …) is translated for display only, by the maps in
`src/labels.ts`. Raw enum values still drive `className`, request bodies and query
strings, so a label change can never move an API payload.

Two helpers in `src/components/data.tsx` handle mixed-script data:
`<Data>` (`dir="auto"`) for values that may be Hebrew or Latin, and `<Ltr>` for
Latin-only technical values — UUIDs, city slugs, phone numbers, URLs, MIME types,
ISO timestamps — where bidi reordering would otherwise garble the value. The
stylesheet uses logical properties throughout, so it lays out correctly under either
root direction.
