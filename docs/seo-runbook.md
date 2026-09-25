# SEO runbook — getting Kashroot into Google

What the web app exposes to crawlers, the two settings that name the public origin,
and the one-time Search Console steps. Companion to `deploy-runbook.md`.

> **What ranks, in one line:** the restaurant pages. `/r/<id>` renders without a
> profile (facts only — name, address, certifier, certificate validity — plus a
> "set your profile" call-to-action), so every listed restaurant is a real, indexable
> page. Everything else in the app is either a redirect (`/`) or `noindex` (the
> profile-dependent screens).

---

## What a crawler sees

| URL | Indexable? | Notes |
|---|---|---|
| `/` | **yes** | Anonymous visitors get the landing page: what the app does, a call-to-action into onboarding, and every city with a sample of restaurant links (from `GET /v1/directory`, facts only). Those links are how the `/r/<id>` pages get discovered. Visitors with a profile get the Home list at the same URL. `WebSite` JSON-LD on both. |
| `/r/<id>` | **yes** | Profile-free facts page. `Restaurant` JSON-LD (name, address, geo, phone). No verdict, no cuisine claim, no rating markup — a certificate says "certified by X", never "is kosher"; the app reports facts, it never rules. |
| `/onboarding/*`, `/search`, `/saved*`, `/map`, `/profile`, `/filters` | `noindex` | Thin, profile-dependent, or legacy redirects. Also disallowed in `robots.txt`. |
| `/robots.txt` | static | Served by Vercel from `web/public/`. **Never** proxied to the API: if the API is asleep and `robots.txt` times out, Google pauses crawling the whole site. |
| `/sitemap.xml` | proxied | `web/vercel.json` rewrites it to `GET /v1/sitemap.xml` on the API, which lists `/` and every `/r/<id>` with `lastmod`. |

The language toggle is client-side state, not a URL, so there are no `hreflang`
alternates — one URL serves both languages, Hebrew first.

---

## Settings that name the public origin

Absolute URLs (sitemap entries, canonical, `og:url`) need to know the site's origin.
The public address is **`https://kashroot.app`**, and both settings are committed:

| Where | Key | Effect |
|---|---|---|
| Render (API) | `KASHROOT_PUBLIC_WEB_ORIGIN` | In `render.yaml`. Origin used in sitemap URLs. Without it the API falls back to `X-Forwarded-Host`, and only when that host ends in `.vercel.app` (anything else is client input and is ignored in favour of the API's own host, which would put `onrender.com` URLs in the sitemap). If the Render service was created before this line existed, add it in the dashboard by hand. |
| Vercel (web) | `VITE_SITE_ORIGIN` | In `web/.env.production`, so every `vite build` gets it, previews included. Adds the `Sitemap:` line to `robots.txt` and pins canonical/`og:url`. A preview pointing its canonical at the real site is intended; Vercel already `noindex`es preview URLs. |

Both name the **same** origin, without a trailing slash. If the domain ever changes,
change both files together — a canonical that is already indexed keeps competing with
the new domain until it is updated.

---

## One-time setup

1. **Domain.** Vercel → Project → Domains → add `kashroot.app` (and `www.kashroot.app`
   redirecting to it, so there is one canonical host). Add
   `https://kashroot.app/*` to the Google Maps browser key's referrer allowlist
   (`deploy-runbook.md` §3).
2. **Search Console.** https://search.google.com/search-console → Add property →
   **Domain** `kashroot.app`, verified with the DNS TXT record Google shows, added at
   the registrar. This covers http/https and www in one property. (Fallback: the
   URL-prefix property and the HTML-tag method — paste the
   `<meta name="google-site-verification" …>` tag into `web/index.html` `<head>` and
   redeploy.)
3. **Submit the sitemap.** Search Console → Sitemaps → `https://<origin>/sitemap.xml`.
   Before submitting, open it in a browser and confirm it lists restaurants; the
   first hit after idle pays the Render cold start (~50 s), which Google tolerates
   but the keep-warm pinger from `deploy-runbook.md` §5 makes unnecessary.
4. **Request indexing** for `/` and a handful of restaurant URLs via URL Inspection.
   This starts the first crawl days earlier than waiting for discovery.
5. **Bing** (optional, ~10 min): https://www.bing.com/webmasters can import the
   Search Console property in one click.

---

## Checks

```bash
curl -s https://<origin>/robots.txt
curl -s https://<origin>/sitemap.xml | head -20
curl -s https://<origin>/r/<id> | grep -o '<title>[^<]*'   # static default; the real title is set by JS
```

The last line shows only the `index.html` default — the per-page title, description,
canonical and JSON-LD are set at runtime. Google renders JavaScript, so URL Inspection
→ "View crawled page" → "More info" is where to confirm the rendered `<head>`. Then
watch Search Console → Pages for the `/r/…` URLs to move from "Discovered" to
"Indexed"; expect days to a few weeks on a new domain.

---

## Known limits and the next steps that would move ranking

- **No server rendering.** Everything is a client-rendered SPA. Google copes, but
  indexing is slower and other engines/link previews (WhatsApp, Telegram) show only
  the `index.html` defaults. Pre-rendering `/r/<id>` at build or edge time is the
  next step if link previews matter for sharing.
- **City pages.** `/city/jerusalem` style listing pages would target the queries
  people actually type ("kosher restaurants Jerusalem", "מסעדות כשרות ירושלים").
  They need a profile-free listing endpoint (facts only) to stay honest.
- **URLs are UUIDs.** `/r/<uuid>` works but `/r/<slug>` reads better in results.
  Needs a stored, unique slug per restaurant and a redirect from the UUID form.
- **Coverage is the moat, for search too.** Every restaurant added to the corpus is
  another indexable page.
