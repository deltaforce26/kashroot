// @vitest-environment node
/**
 * The server prerender (src/ssr/prerender.ts): what a crawler reads before any
 * script runs. Node environment on purpose — there is no `window` on the server,
 * so the canonical must come out as the production origin, not a test host.
 */
import { describe, expect, it } from "vitest";
import type { ApiFetch } from "../ssr/prerender";
import { parseRoute, prerender } from "../ssr/prerender";

const SHELL = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="description" content="generic" />
    <meta property="og:title" content="generic" />
    <meta property="og:image" content="/icons/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <title>Kashroot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index-abc.js"></script>
  </body>
</html>`;

const RESTAURANT_ID = "6f1c2b9e-3a4d-4c5e-8f70-112233445566";

const RESTAURANT = {
  restaurant_id: RESTAURANT_ID,
  name_he: "נוגטין",
  name_en: "Nougatine",
  address_he: "רחוב יפו 1",
  city_he: "ירושלים",
  phone: "02-5555555",
  website: "https://example.com",
  diet_type: "dairy",
  price_level: 2,
  amenities: {},
  geo: { lat: 31.78, lon: 35.21 },
  certificates: [
    {
      certifier: { id: "c1", name_he: "בד״ץ <רובין>", name_en: null, type: "badatz" },
      status: "active",
      valid_until: null,
      attributes: { chalav_yisrael: true },
    },
  ],
  updated_at: "2026-09-01T00:00:00Z",
};

const CITY = {
  city_slug: "jerusalem",
  city_he: "ירושלים",
  city_en: "Jerusalem",
  restaurant_count: 1,
  certifiers: [{ slug: "rubin", name_he: "בד״ץ רובין", name_en: null, restaurant_count: 1 }],
  selected_certifier: null,
  restaurants: [
    {
      restaurant_id: RESTAURANT_ID,
      name_he: "נוגטין",
      name_en: "Nougatine",
      address_he: "רחוב יפו 1",
      certifier_names_he: ["בד״ץ רובין"],
      certifier_names_en: [null],
      certifier_slugs: ["rubin"],
    },
  ],
};

function api(routes: Record<string, { status: number; body?: unknown }>): ApiFetch {
  return async (path) => routes[path] ?? { status: 404 };
}

function count(html: string, pattern: RegExp): number {
  return html.match(new RegExp(pattern, "g"))?.length ?? 0;
}

describe("parseRoute", () => {
  it("recognises the indexable routes and nothing else", () => {
    expect(parseRoute("/r/abc")).toEqual({ kind: "restaurant", id: "abc" });
    expect(parseRoute("/city/jerusalem")).toEqual({ kind: "city", citySlug: "jerusalem" });
    expect(parseRoute("/city/jerusalem/rubin")).toEqual({
      kind: "city",
      citySlug: "jerusalem",
      certifierSlug: "rubin",
    });
    expect(parseRoute("/certifier/rubin")).toEqual({ kind: "certifier", certifierSlug: "rubin" });
    expect(parseRoute("/saved")).toBeNull();
    expect(parseRoute("/r/a/b")).toBeNull();
    expect(parseRoute("/r")).toBeNull();
  });
});

describe("prerender", () => {
  it("writes a restaurant's own head and facts into the raw HTML", async () => {
    const result = await prerender(
      { kind: "restaurant", id: RESTAURANT_ID },
      SHELL,
      api({ [`/v1/restaurants/${RESTAURANT_ID}`]: { status: 200, body: RESTAURANT } }),
    );
    expect(result.status).toBe(200);
    const { html } = result;
    expect(count(html, /<link rel="canonical"/)).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="https://kashroot.app/r/${RESTAURANT_ID}" />`);
    expect(count(html, /<title>/)).toBe(1);
    expect(html).toContain("<title>נוגטין · Nougatine · Kashroot</title>");
    expect(count(html, /<meta name="description"/)).toBe(1);
    expect(html).not.toContain('content="generic"');
    expect(html).toContain("<h1>נוגטין</h1>");
    expect(html).toContain("רחוב יפו 1, ירושלים");
    // Escaped, not injected.
    expect(html).toContain("בד״ץ &lt;רובין&gt;");
    expect(html).not.toContain("<רובין>");
    expect(html).toContain('"@type":"Restaurant"');
    expect(html).not.toMatch(/noindex/);
    // The app still boots.
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
  });

  it("answers 404 with noindex and no canonical for a listing that does not exist", async () => {
    const result = await prerender({ kind: "restaurant", id: "gone" }, SHELL, api({}));
    expect(result.status).toBe(404);
    expect(result.html).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(result.html).not.toContain('rel="canonical"');
  });

  it("treats a malformed id (422) as not found", async () => {
    const result = await prerender(
      { kind: "restaurant", id: "x" },
      SHELL,
      api({ "/v1/restaurants/x": { status: 422 } }),
    );
    expect(result.status).toBe(404);
  });

  it("answers 503 with Retry-After when the API is down — never an empty 200", async () => {
    const down: ApiFetch = async () => {
      throw new Error("timeout");
    };
    const result = await prerender({ kind: "restaurant", id: RESTAURANT_ID }, SHELL, down);
    expect(result.status).toBe(503);
    expect(result.headers["Retry-After"]).toBeDefined();
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(count(result.html, /<link rel="canonical"/)).toBe(1);

    const broken = await prerender(
      { kind: "restaurant", id: RESTAURANT_ID },
      SHELL,
      api({ [`/v1/restaurants/${RESTAURANT_ID}`]: { status: 500 } }),
    );
    expect(broken.status).toBe(503);
  });

  it("lists a city's restaurants as links under the city's own canonical", async () => {
    const result = await prerender(
      { kind: "city", citySlug: "jerusalem" },
      SHELL,
      api({ "/v1/directory/cities/jerusalem": { status: 200, body: CITY } }),
    );
    expect(result.status).toBe(200);
    expect(result.html).toContain('<link rel="canonical" href="https://kashroot.app/city/jerusalem" />');
    expect(result.html).toContain("<title>ירושלים · Kashroot</title>");
    expect(result.html).toContain(`<a href="/r/${RESTAURANT_ID}">נוגטין</a>`);
    expect(result.html).toContain('<a href="/city/jerusalem/rubin">');
  });

  it("gives each city-certifier page its own canonical", async () => {
    const result = await prerender(
      { kind: "city", citySlug: "jerusalem", certifierSlug: "rubin" },
      SHELL,
      api({
        "/v1/directory/cities/jerusalem?certifier=rubin": {
          status: 200,
          body: { ...CITY, selected_certifier: CITY.certifiers[0] },
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.html).toContain(
      '<link rel="canonical" href="https://kashroot.app/city/jerusalem/rubin" />',
    );
  });

  it("answers 404 for an unknown city", async () => {
    const result = await prerender({ kind: "city", citySlug: "atlantis" }, SHELL, api({}));
    expect(result.status).toBe(404);
  });
});
