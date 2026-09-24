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
| `/` | via redirect | An anonymous visit redirects to `/onboarding/preset`, so its title/description are what Google shows for the home page. The `WebSite` JSON-LD lives on Home for signed-in users. |
| `/r/<id>` | **yes** | Profile-free facts page. `Restaurant` JSON-LD (name, address, geo, `servesCuisine: Kosher`). No verdict, no rating markup — the app reports facts, it never rules. |
| `/onboarding/*`, `/search`, `/saved*`, `/map`, `/profile` | `noindex` | Thin or profile-dependent. Also disallowed in `robots.txt`. |
| `/robots.txt` | static | Served by Vercel from `web/public/`. **Never** proxied to the API: if the API is asleep and `robots.txt` times out, Google pauses crawling the whole site. |
| `/sitemap.xml` | proxied | `web/vercel.json` rewrites it to `GET /v1/sitemap.xml` on the API, which lists `/` and every `/r/<id>` with `lastmod`. |

The language toggle is client-side state, not a URL, so there are no `hreflang`
alternates — one URL serves both languages, Hebrew first.

---

## Settings that name the public origin

Absolute URLs (sitemap entries, canonical, `og:url`) need to know the site's origin.

| Where | Key | Effect |
|---|---|---|
| Render (API) | `KASHROOT_PUBLIC_WEB_ORIGIN` | Origin used in sitemap URLs, e.g. `https://kashroot.app`. Optional: without it the API uses Vercel's `X-Forwarded-Host`/`X-Forwarded-Proto`, which is correct for the proxied `/sitemap.xml` request. Set it anyway once you have a custom domain, so the sitemap never names a preview deployment. |
| Vercel (web) | `VITE_SITE_ORIGIN` | Build-time. Adds the `Sitemap:` line to `robots.txt` and pins canonical/`og:url` to this origin. Without it canonicals use `window.location.origin` and `robots.txt` has no `Sitemap:` line (submit it in Search Console instead). Redeploy after changing it. |

Set both to the **same** canonical origin, without a trailing slash. If you attach a
custom domain later, change both and redeploy — a `*.vercel.app` canonical that is
already indexed will otherwise keep competing with the real domain.

---

## One-time setup

1. **Custom domain (recommended).** Vercel → Project → Domains. Add the domain, then
   put it in both settings above and redeploy. Add the domain to the Google Maps
   browser key's referrer allowlist as well (`deploy-runbook.md` §3).
2. **Search Console.** https://search.google.com/search-console → Add property.
   Use the **Domain** property with the DNS TXT record if you own the domain;
   otherwise the URL-prefix property and the HTML-tag method — paste the
   `<meta name="google-site-verification" …>` tag into `web/index.html` `<head>` and
   redeploy.
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
- **The home page has no content of its own** — it redirects to onboarding. A public
  landing page (what the app does, the five cities, links into restaurants) is the
  single biggest ranking lever left, and a product decision about the first-run flow.
- **City pages.** `/city/jerusalem` style listing pages would target the queries
  people actually type ("kosher restaurants Jerusalem", "מסעדות כשרות ירושלים").
  They need a profile-free listing endpoint (facts only) to stay honest.
- **URLs are UUIDs.** `/r/<uuid>` works but `/r/<slug>` reads better in results.
  Needs a stored, unique slug per restaurant and a redirect from the UUID form.
- **Coverage is the moat, for search too.** Every restaurant added to the corpus is
  another indexable page.
