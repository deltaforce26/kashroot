/**
 * Server prerender for the indexable routes: `/r/<id>`, `/city/<city>[/<certifier>]`
 * and `/certifier/<certifier>`.
 *
 * Why this exists: the app is a client-rendered SPA, so every one of those URLs used
 * to answer with the same empty `index.html` — one title, no canonical, an empty
 * `#root` — and only became a distinct page once JavaScript ran. Google judged the
 * raw responses duplicates of one another and picked canonicals of its own, and a
 * listing that no longer exists answered 200 with a "not found" drawn by script.
 *
 * Here the shell is filled in before it leaves the server: the route's own title,
 * description, canonical, Open Graph and JSON-LD — built by the very functions the
 * client's `useDocumentHead` uses, so hydration rewrites each tag to the value it
 * already has and never changes the canonical — and the page's facts as plain HTML
 * inside `#root`, which React replaces on its first render. A record the API does
 * not have is a real 404 (`noindex`, no canonical); an API that does not answer is a
 * 503, so a crawler retries later instead of indexing an empty page, while a person
 * still gets the full app, which loads its own data.
 *
 * Facts only, the same rule as the rest of `src/seo/`: no verdict, no fit score, no
 * ranking. There is no profile on the server — a crawler has none — so there is
 * nothing to evaluate against.
 *
 * Pure: the shell and the API fetch are passed in, so the tests drive it with
 * fixtures and the Vercel function (`api/prerender.js`) with the real thing.
 */

import {
  toCertifierDirectoryView,
  toCityDirectoryView,
  toPublicView,
  type CertifierDirectoryView,
  type CityDirectoryView,
  type DirectoryRestaurantView,
  type PublicRestaurantView,
} from "../api/viewmodel";
import type { CertifierDirectoryOut, CityDirectoryOut, RestaurantPublicOut } from "../api/types";
import { formatDate, pickName } from "../i18n/I18nProvider";
import { STRINGS, type Strings } from "../i18n/strings";
import {
  certifierDirectoryHead,
  certifierPath,
  cityDisplayName,
  cityPath,
  cityDirectoryHead,
} from "../seo/directoryHead";
import { DEFAULT_OG_IMAGE, JSON_LD_ATTR, absoluteUrl } from "../seo/head";
import { restaurantHead, uniqueCertifierNames } from "../seo/restaurantHead";
import { documentTitle, type DocumentHeadOptions } from "../seo/useDocumentHead";

/** The language the raw HTML is written in — the `<html lang>` default of `index.html`. */
const LANG = "he" as const;

export type PrerenderRoute =
  | { kind: "restaurant"; id: string }
  | { kind: "city"; citySlug: string; certifierSlug?: string }
  | { kind: "certifier"; certifierSlug: string };

/** What the API answered: a parsed body on 2xx, or just the status. */
export type ApiResult = { status: number; body?: unknown };

/** Resolves an API path (`/v1/...`); throws or resolves `status >= 500` when it is down. */
export type ApiFetch = (path: string) => Promise<ApiResult>;

export interface PrerenderResult {
  status: number;
  headers: Record<string, string>;
  html: string;
}

/** Cached at the edge for an hour, served stale for a day while the API wakes up. */
export const CACHE_FOUND = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
/** Short, so a record restored by mistake is back in minutes. */
export const CACHE_MISSING = "public, max-age=0, s-maxage=300";
export const CACHE_UNAVAILABLE = "no-store";
/** Seconds a crawler is asked to wait before retrying a 503. */
export const RETRY_AFTER_SECONDS = "120";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** `/r/<id>` etc. → the route, or `null` for anything this module does not render. */
export function parseRoute(pathname: string): PrerenderRoute | null {
  const segments = pathname.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const [head, first, second, ...rest] = segments;
  if (rest.length > 0 || !first) return null;
  if (head === "r" && !second) return { kind: "restaurant", id: first };
  if (head === "certifier" && !second) return { kind: "certifier", certifierSlug: first };
  if (head === "city") {
    return second
      ? { kind: "city", citySlug: first, certifierSlug: second }
      : { kind: "city", citySlug: first };
  }
  return null;
}

function apiPath(route: PrerenderRoute): string {
  switch (route.kind) {
    case "restaurant":
      return `/v1/restaurants/${encodeURIComponent(route.id)}`;
    case "city":
      return `/v1/directory/cities/${encodeURIComponent(route.citySlug)}${
        route.certifierSlug ? `?certifier=${encodeURIComponent(route.certifierSlug)}` : ""
      }`;
    case "certifier":
      return `/v1/directory/certifiers/${encodeURIComponent(route.certifierSlug)}`;
  }
}

/* ── <head> ─────────────────────────────────────────────────────────────── */

/** Drops every tag the head writes, so each is written exactly once below. */
function stripManagedHead(shell: string): string {
  return shell
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="(?:description|robots|twitter:card)"[^>]*>\s*/gi, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "")
    .replace(new RegExp(`<script[^>]*${JSON_LD_ATTR}[^>]*>[\\s\\S]*?<\\/script>\\s*`, "gi"), "");
}

/** The same tags, with the same values, `useDocumentHead` writes for these options. */
export function headTags(options: DocumentHeadOptions, t: Strings): string {
  const title = documentTitle(options.title, t.seo.brandTitle);
  const url = options.canonicalPath ? absoluteUrl(options.canonicalPath) : null;
  const meta = (attr: "name" | "property", key: string, content: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    meta("name", "description", options.description),
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : "",
    meta("property", "og:title", title),
    meta("property", "og:description", options.description),
    url ? meta("property", "og:url", url) : "",
    meta("property", "og:type", options.ogType ?? "website"),
    meta("property", "og:locale", "he_IL"),
    meta("property", "og:site_name", "Kashroot"),
    meta("property", "og:image", absoluteUrl(options.ogImage ?? DEFAULT_OG_IMAGE)),
    meta("name", "twitter:card", options.ogImage ? "summary_large_image" : "summary"),
    options.noindex ? meta("name", "robots", "noindex,nofollow") : "",
    options.jsonLd
      ? `<script type="application/ld+json" ${JSON_LD_ATTR}="">${JSON.stringify(
          options.jsonLd,
        ).replace(/</g, "\\u003c")}</script>`
      : "",
  ];
  return tags.filter(Boolean).join("\n    ");
}

export function fillShell(shell: string, options: DocumentHeadOptions, t: Strings, body: string): string {
  const stripped = stripManagedHead(shell);
  const withHead = stripped.replace(/<\/head>/i, `  ${headTags(options, t)}\n  </head>`);
  return withHead.replace(/<div id="root">\s*<\/div>/i, `<div id="root">${body}</div>`);
}

/* ── <body> ─────────────────────────────────────────────────────────────── */

function link(path: string, text: string): string {
  return `<a href="${escapeHtml(path)}">${escapeHtml(text)}</a>`;
}

function restaurantRows(restaurants: DirectoryRestaurantView[]): string {
  const rows = restaurants.map((restaurant) => {
    const certifiers = restaurant.certifiers
      .map((certifier) => pickName(LANG, certifier.nameHe, certifier.nameEn))
      .join(" · ");
    const details = [restaurant.addressHe, certifiers].filter(Boolean).map((part) => escapeHtml(part!));
    return `<li>${link(`/r/${encodeURIComponent(restaurant.id)}`, pickName(LANG, restaurant.nameHe, restaurant.nameEn))}${
      details.length > 0 ? ` — ${details.join(" · ")}` : ""
    }</li>`;
  });
  return `<ul>${rows.join("")}</ul>`;
}

function restaurantBody(view: PublicRestaurantView, t: Strings): string {
  const labels = t.attributes as Record<string, string | undefined>;
  const name = pickName(LANG, view.nameHe, view.nameEn);
  const other = name === view.nameHe ? view.nameEn : view.nameHe;
  const address = [view.addressHe, view.cityHe].filter(Boolean).join(", ");
  const certificates = view.certificates.map((certificate) => {
    const validUntil = formatDate(certificate.validUntil);
    const facts =
      certificate.facts.length > 0
        ? `<p>${escapeHtml(t.publicRestaurant.listed)}:</p><ul>${certificate.facts
            .map(
              (fact) =>
                `<li>${escapeHtml(labels[fact.key] ?? fact.key)}: ${escapeHtml(
                  fact.published ? t.publicRestaurant.yes : t.publicRestaurant.no,
                )}</li>`,
            )
            .join("")}</ul>`
        : `<p>${escapeHtml(t.publicRestaurant.nothingListed)}</p>`;
    return `<section><h2>${escapeHtml(t.restaurant.certificate)}</h2><p><strong>${escapeHtml(
      pickName(LANG, certificate.certifier.name_he, certificate.certifier.name_en),
    )}</strong></p><p>${escapeHtml(t.publicRestaurant.status)}: ${escapeHtml(
      t.publicRestaurant.states[certificate.status],
    )}</p><p>${escapeHtml(validUntil ? t.restaurant.validUntil(validUntil) : t.restaurant.noExpiry)}</p>${facts}</section>`;
  });
  return [
    `<main>`,
    `<h1>${escapeHtml(name)}</h1>`,
    other && other !== name ? `<p>${escapeHtml(other)}</p>` : "",
    address ? `<p>${escapeHtml(address)}</p>` : "",
    view.phone ? `<p><a href="tel:${escapeHtml(view.phone)}">${escapeHtml(view.phone)}</a></p>` : "",
    view.website
      ? `<p><a href="${escapeHtml(view.website)}" rel="nofollow noopener">${escapeHtml(t.publicRestaurant.website)}</a></p>`
      : "",
    `<p>${escapeHtml(t.publicRestaurant.factsLead)}</p>`,
    ...certificates,
    `<p>${link("/", t.directory.home)}</p>`,
    `</main>`,
  ].join("");
}

function cityBody(view: CityDirectoryView, t: Strings): string {
  const city = cityDisplayName(view.cityHe, view.cityEn, LANG, t);
  const selected = view.selectedCertifier;
  const certifier = selected ? pickName(LANG, selected.nameHe, selected.nameEn) : null;
  const facets = view.certifiers.map(
    (facet) =>
      `<li>${link(cityPath(view.citySlug, facet.slug), pickName(LANG, facet.nameHe, facet.nameEn))} (${facet.restaurantCount})</li>`,
  );
  return [
    `<main>`,
    `<p>${link("/", t.directory.home)}${selected ? ` › ${link(cityPath(view.citySlug), city)}` : ""}</p>`,
    `<h1>${escapeHtml(certifier ? t.directory.cityCertifierTitle(city, certifier) : city)}</h1>`,
    `<p>${escapeHtml(
      selected && certifier
        ? t.directory.cityCertifierIntro(city, certifier, selected.restaurantCount)
        : t.directory.cityIntro(city, view.restaurantCount),
    )}</p>`,
    `<h2>${escapeHtml(t.directory.restaurantsTitle)}</h2>`,
    restaurantRows(view.restaurants),
    facets.length > 0 ? `<h2>${escapeHtml(t.directory.facetsTitle)}</h2><ul>${facets.join("")}</ul>` : "",
    `</main>`,
  ].join("");
}

function certifierBody(view: CertifierDirectoryView, t: Strings): string {
  const certifier = pickName(LANG, view.nameHe, view.nameEn);
  const cities = view.cities.map(
    (city) =>
      `<li>${link(cityPath(city.citySlug, view.slug), cityDisplayName(city.cityHe, city.cityEn, LANG, t))} (${city.restaurantCount})</li>`,
  );
  return [
    `<main>`,
    `<p>${link("/", t.directory.home)}</p>`,
    `<h1>${escapeHtml(certifier)}</h1>`,
    `<p>${escapeHtml(t.directory.certifierIntro(certifier, view.restaurantCount, view.cities.length))}</p>`,
    cities.length > 0 ? `<h2>${escapeHtml(t.directory.citiesTitle)}</h2><ul>${cities.join("")}</ul>` : "",
    `<h2>${escapeHtml(t.directory.restaurantsTitle)}</h2>`,
    restaurantRows(view.restaurants),
    `</main>`,
  ].join("");
}

function missingBody(title: string, t: Strings): string {
  return `<main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
    t.directory.notFoundBody,
  )}</p><p>${link("/", t.directory.notFoundHome)}</p></main>`;
}

/* ── the route ──────────────────────────────────────────────────────────── */

/** Head and body for a route the API answered 200 for. */
function foundPage(route: PrerenderRoute, body: unknown, t: Strings): { head: DocumentHeadOptions; html: string } {
  switch (route.kind) {
    case "restaurant": {
      const view = toPublicView(body as RestaurantPublicOut);
      const head = restaurantHead(
        {
          id: view.id,
          nameHe: view.nameHe,
          nameEn: view.nameEn,
          cityHe: view.cityHe,
          addressHe: view.addressHe,
          phone: view.phone,
          website: view.website,
          geo: view.geo,
          certifierNames: uniqueCertifierNames(
            view.certificates.map((certificate) => certificate.certifier),
            LANG,
          ),
        },
        route.id,
        LANG,
        t,
      );
      return { head, html: restaurantBody(view, t) };
    }
    case "city": {
      const view = toCityDirectoryView(body as CityDirectoryOut);
      const head = cityDirectoryHead(
        {
          citySlug: view.citySlug,
          cityHe: view.cityHe,
          cityEn: view.cityEn,
          restaurantCount: view.restaurantCount,
          certifier: view.selectedCertifier,
          restaurants: view.restaurants,
        },
        route.citySlug,
        route.certifierSlug,
        LANG,
        t,
      );
      return { head, html: cityBody(view, t) };
    }
    case "certifier": {
      const view = toCertifierDirectoryView(body as CertifierDirectoryOut);
      const head = certifierDirectoryHead(
        {
          slug: view.slug,
          nameHe: view.nameHe,
          nameEn: view.nameEn,
          restaurantCount: view.restaurantCount,
          cityCount: view.cities.length,
          restaurants: view.restaurants,
        },
        route.certifierSlug,
        LANG,
        t,
      );
      return { head, html: certifierBody(view, t) };
    }
  }
}

function missingHead(route: PrerenderRoute, t: Strings): DocumentHeadOptions {
  switch (route.kind) {
    case "restaurant":
      return restaurantHead(null, route.id, LANG, t, true);
    case "city":
      return cityDirectoryHead(null, route.citySlug, route.certifierSlug, LANG, t, true);
    case "certifier":
      return certifierDirectoryHead(null, route.certifierSlug, LANG, t, true);
  }
}

/** The canonical path of a route — what the client head declares while loading. */
function routePath(route: PrerenderRoute): string {
  switch (route.kind) {
    case "restaurant":
      return `/r/${route.id}`;
    case "city":
      return cityPath(route.citySlug, route.certifierSlug);
    case "certifier":
      return certifierPath(route.certifierSlug);
  }
}

/**
 * Renders one route into the shell. 200 with the page, 404 when the API has no such
 * record (or the address is malformed: 404/410/422), 503 when it did not answer.
 */
export async function prerender(
  route: PrerenderRoute,
  shell: string,
  fetchApi: ApiFetch,
): Promise<PrerenderResult> {
  const t = STRINGS[LANG];
  const html = { "Content-Type": "text/html; charset=utf-8" };

  let result: ApiResult;
  try {
    result = await fetchApi(apiPath(route));
  } catch {
    result = { status: 503 };
  }

  if (result.status >= 200 && result.status < 300 && result.body !== undefined) {
    try {
      const page = foundPage(route, result.body, t);
      return {
        status: 200,
        headers: { ...html, "Cache-Control": CACHE_FOUND },
        html: fillShell(shell, page.head, t, page.html),
      };
    } catch {
      // A body the view models cannot read is the API misbehaving, not a missing page.
      result = { status: 502 };
    }
  }

  if (result.status === 404 || result.status === 410 || result.status === 422) {
    const head = missingHead(route, t);
    return {
      status: 404,
      headers: { ...html, "Cache-Control": CACHE_MISSING },
      html: fillShell(shell, head, t, missingBody(head.title ?? t.directory.notFoundTitle, t)),
    };
  }

  // Unavailable: the shell with this route's canonical and nothing else claimed.
  // The app still boots and fetches for itself; a crawler is told to come back.
  return {
    status: 503,
    headers: { ...html, "Cache-Control": CACHE_UNAVAILABLE, "Retry-After": RETRY_AFTER_SECONDS },
    html: fillShell(
      shell,
      { description: t.seo.siteDescription, canonicalPath: routePath(route) },
      t,
      "",
    ),
  };
}
