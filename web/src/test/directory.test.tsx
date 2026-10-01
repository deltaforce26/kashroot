/**
 * The directory pages — `/city/:citySlug`, `/city/:citySlug/:certifierSlug` and
 * `/certifier/:certifierSlug` — which a crawler reads, and which anyone reads
 * without a profile.
 *
 * Two guarantees, in tension, both asserted: each page renders its list and its
 * links (the indexable content and the crawl paths: every restaurant a real anchor
 * to `/r/<id>`, every facet a link to the narrowed page), and none of them renders
 * a verdict, because there is no profile on these pages to produce one. Then the
 * head: a title, a canonical, and one `CollectionPage` with its breadcrumbs and an
 * `ItemList` of restaurants carrying names and URLs only. And the seams: an
 * unknown city or certifier is a not-in-our-records page that says `noindex`.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { CERTIFIERS, CERTIFIER_SLUGS, RESTAURANTS } from "../api/mock/fixtures";
import { directoryCertifiers } from "../api/mock/server";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { PROFILE_SCHEMA_VERSION } from "../profile/storage";
import { SavedProvider } from "../saved/SavedProvider";
import { JSON_LD_ATTR } from "../seo/head";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;
const en = STRINGS.en;

function renderApp(route: string) {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ProfileProvider>
          <SavedProvider>
            <MemoryRouter initialEntries={[route]}>
              <App />
            </MemoryRouter>
          </SavedProvider>
        </ProfileProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

/** A profile with one whitelisted certifier — enough to clear the onboarding gate. */
function seedProfile() {
  localStorage.setItem(
    `kashroot.profile.v${PROFILE_SCHEMA_VERSION}`,
    JSON.stringify({
      version: PROFILE_SCHEMA_VERSION,
      presetId: "any",
      whitelist: [{ certifier_id: "cert-rubin", min_level: "unknown" }],
      requiredAttributes: [],
      completedOnboarding: true,
    }),
  );
}

const VERDICT_WORDS = [
  "MATCH",
  "NO_MATCH",
  "UNKNOWN",
  ...[he.verdict, en.verdict].flatMap((verdict) => [
    verdict.match,
    verdict.noMatch,
    verdict.unknown,
    verdict.matchLong,
    verdict.noMatchLong,
    verdict.unknownLong,
  ]),
];

const jsonLd = () => document.head.querySelector(`script[${JSON_LD_ATTR}]`)?.textContent ?? "";
const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute("content");
const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
const description = () =>
  document.head.querySelector('meta[name="description"]')?.getAttribute("content");

/* The fixtures, read the way the mock server reads them, so nothing is hardcoded
   that the fixture file could silently change. */
const RUBIN = CERTIFIERS.find((certifier) => certifier.id === "cert-rubin")!;
const RUBIN_SLUG = CERTIFIER_SLUGS["cert-rubin"]!;
/** Membership as the directory counts it: an `active` certificate from the certifier. */
const holdsCertifier = (restaurant: (typeof RESTAURANTS)[number], certifierId: string) =>
  restaurant.certificates.some(
    (certificate) => certificate.certifier_id === certifierId && certificate.state === "active",
  );
const JERUSALEM = RESTAURANTS.filter((restaurant) => restaurant.city_slug === "jerusalem");
const JERUSALEM_RUBIN = JERUSALEM.filter((restaurant) => holdsCertifier(restaurant, RUBIN.id));
const JERUSALEM_NOT_RUBIN = JERUSALEM.filter((restaurant) => !holdsCertifier(restaurant, RUBIN.id));
const ALL_RUBIN = RESTAURANTS.filter((restaurant) => holdsCertifier(restaurant, RUBIN.id));

function expectNoVerdict(container: HTMLElement) {
  const text = container.textContent ?? "";
  for (const word of VERDICT_WORDS) {
    expect(text, word).not.toContain(word);
  }
  expect(container.querySelector(".verdict")).toBeNull();
  expect(container.querySelector(".fit")).toBeNull();
  expect(container.querySelector(".evidence")).toBeNull();
}

describe("the city directory page", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("renders the city, its count, its certifier facets and every restaurant as an anchor", async () => {
    const { container } = renderApp("/city/jerusalem");

    expect(await screen.findByRole("heading", { level: 1, name: "ירושלים" })).toBeInTheDocument();
    expect(screen.getByText(he.directory.cityIntro("ירושלים", JERUSALEM.length))).toBeInTheDocument();
    // Sanity: the fixtures really do hold more than one Jerusalem row.
    expect(JERUSALEM.length).toBeGreaterThan(1);

    // The facets: one link per certifier in the city, to the narrowed page, with
    // its own count. The "all" link only appears once a facet is selected.
    const rubinFacet = container.querySelector(`a[href="/city/jerusalem/${RUBIN_SLUG}"]`);
    expect(rubinFacet).not.toBeNull();
    expect(rubinFacet).toHaveTextContent(RUBIN.name_he);
    expect(rubinFacet).toHaveTextContent(he.landing.restaurantCount(JERUSALEM_RUBIN.length));
    expect(rubinFacet).not.toHaveAttribute("aria-current");
    expect(container.querySelector('a[href="/city/jerusalem"]')).toBeNull();
    expect(screen.queryByText(he.directory.allInCity("ירושלים"))).toBeNull();
    // A certifier with no Jerusalem row gets no facet at all.
    const bneiBrakOnly = CERTIFIER_SLUGS["cert-rab-bb"]!;
    expect(container.querySelector(`a[href="/city/jerusalem/${bneiBrakOnly}"]`)).toBeNull();

    // Every Jerusalem fixture, as a real anchor: name, address, certifier names.
    for (const restaurant of JERUSALEM) {
      const row = container.querySelector(`a[href="/r/${restaurant.id}"]`);
      expect(row, restaurant.id).not.toBeNull();
      expect(row).toHaveTextContent(restaurant.name_he);
      expect(row).toHaveTextContent(restaurant.address_he);
      expect(row).toHaveClass("landing__row");
    }
    expect(container.querySelectorAll(".landing__row")).toHaveLength(JERUSALEM.length);
    expect(container.querySelector('a[href="/r/r-nougatine"]')).toHaveTextContent(RUBIN.name_he);
    expect(screen.getByRole("link", { name: "נוגטין" })).toHaveAttribute("href", "/r/r-nougatine");
    // No row from another city.
    expect(container.querySelector('a[href="/r/r-sushi-bvg"]')).not.toBeNull();
    for (const restaurant of RESTAURANTS.filter((candidate) => candidate.city_slug !== "jerusalem")) {
      expect(container.querySelector(`a[href="/r/${restaurant.id}"]`), restaurant.id).toBeNull();
    }

    // Breadcrumb back to the root; the page itself is not a link.
    const crumbs = screen.getByRole("navigation", { name: he.directory.breadcrumbs });
    expect(within(crumbs).getByRole("link", { name: he.directory.home })).toHaveAttribute("href", "/");
    expect(within(crumbs).getByText("ירושלים")).toHaveAttribute("aria-current", "page");

    expectNoVerdict(container);
  });

  it("narrows to one certifier: title, selected facet, the 'all' link, and only its rows", async () => {
    const { container } = renderApp(`/city/jerusalem/${RUBIN_SLUG}`);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: he.directory.cityCertifierTitle("ירושלים", RUBIN.name_he),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(he.directory.cityCertifierIntro("ירושלים", RUBIN.name_he, JERUSALEM_RUBIN.length)),
    ).toBeInTheDocument();

    // The selected facet is marked, every other facet is still there, and the
    // "all" link leads back to the whole city with the whole city's count.
    const selected = container.querySelector(`a[href="/city/jerusalem/${RUBIN_SLUG}"]`);
    expect(selected).toHaveAttribute("aria-current", "page");
    const edaSlug = CERTIFIER_SLUGS["cert-eda"]!;
    expect(container.querySelector(`a[href="/city/jerusalem/${edaSlug}"]`)).not.toBeNull();
    const all = screen.getByRole("link", { name: new RegExp(he.directory.allInCity("ירושלים")) });
    expect(all).toHaveAttribute("href", "/city/jerusalem");
    expect(all).toHaveTextContent(he.landing.restaurantCount(JERUSALEM.length));

    // The list holds the narrowed rows and nothing else.
    expect(JERUSALEM_RUBIN.length).toBeGreaterThan(0);
    expect(JERUSALEM_NOT_RUBIN.length).toBeGreaterThan(0);
    for (const restaurant of JERUSALEM_RUBIN) {
      expect(container.querySelector(`a[href="/r/${restaurant.id}"]`), restaurant.id).not.toBeNull();
    }
    for (const restaurant of JERUSALEM_NOT_RUBIN) {
      expect(container.querySelector(`a[href="/r/${restaurant.id}"]`), restaurant.id).toBeNull();
    }
    expect(container.querySelectorAll(".landing__row")).toHaveLength(JERUSALEM_RUBIN.length);

    // Breadcrumbs: root, the city (a link now), the certifier (the page).
    const crumbs = screen.getByRole("navigation", { name: he.directory.breadcrumbs });
    expect(within(crumbs).getByRole("link", { name: "ירושלים" })).toHaveAttribute("href", "/city/jerusalem");
    expect(within(crumbs).getByText(RUBIN.name_he)).toHaveAttribute("aria-current", "page");

    expectNoVerdict(container);
  });

  it("declares the city page in the head: title, canonical, description, CollectionPage with breadcrumbs and an ItemList", async () => {
    renderApp("/city/jerusalem");
    await screen.findByRole("heading", { level: 1, name: "ירושלים" });

    await waitFor(() => expect(document.title).toBe("ירושלים · Kashroot"));
    expect(canonical()).toBe(`${window.location.origin}/city/jerusalem`);
    expect(description()).toBe(he.seo.cityDescription("ירושלים", JERUSALEM.length));
    expect(robots()).toBeUndefined();

    const data = JSON.parse(jsonLd()) as {
      "@type": string;
      name: string;
      url: string;
      breadcrumb: { "@type": string; itemListElement: { position: number; name: string; item: string }[] };
      mainEntity: {
        "@type": string;
        numberOfItems: number;
        itemListElement: { item: Record<string, unknown> }[];
      };
    };
    expect(data["@type"]).toBe("CollectionPage");
    expect(data.name).toBe("ירושלים");
    expect(data.url).toBe(`${window.location.origin}/city/jerusalem`);
    expect(data.breadcrumb["@type"]).toBe("BreadcrumbList");
    expect(data.breadcrumb.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Kashroot", item: `${window.location.origin}/` },
      { "@type": "ListItem", position: 2, name: "ירושלים", item: `${window.location.origin}/city/jerusalem` },
    ]);
    expect(data.mainEntity["@type"]).toBe("ItemList");
    expect(data.mainEntity.numberOfItems).toBe(JERUSALEM.length);
    expect(data.mainEntity.itemListElement).toHaveLength(JERUSALEM.length);
    // Each item is a Restaurant with a name and a URL — and nothing else.
    for (const { item } of data.mainEntity.itemListElement) {
      expect(Object.keys(item).sort()).toEqual(["@type", "name", "url"]);
      expect(item["@type"]).toBe("Restaurant");
      expect(String(item["url"])).toMatch(new RegExp(`^${window.location.origin}/r/`));
    }
    expect(jsonLd()).toContain(`${window.location.origin}/r/r-nougatine`);
    // Nothing evaluative anywhere in the structured data.
    expect(jsonLd()).not.toMatch(/servesCuisine|aggregateRating|review|rating|kosher|verdict|mehadrin/i);
  });

  it("declares the narrowed page with its own canonical and a three-step breadcrumb", async () => {
    renderApp(`/city/jerusalem/${RUBIN_SLUG}`);
    const title = he.directory.cityCertifierTitle("ירושלים", RUBIN.name_he);
    await screen.findByRole("heading", { level: 1, name: title });

    await waitFor(() => expect(document.title).toBe(`${title} · Kashroot`));
    expect(canonical()).toBe(`${window.location.origin}/city/jerusalem/${RUBIN_SLUG}`);
    expect(description()).toBe(
      he.seo.cityCertifierDescription("ירושלים", RUBIN.name_he, JERUSALEM_RUBIN.length),
    );
    const data = JSON.parse(jsonLd()) as {
      breadcrumb: { itemListElement: { position: number; name: string; item: string }[] };
      mainEntity: { numberOfItems: number };
    };
    expect(data.breadcrumb.itemListElement.map((crumb) => crumb.name)).toEqual([
      "Kashroot",
      "ירושלים",
      RUBIN.name_he,
    ]);
    expect(data.breadcrumb.itemListElement[2]?.item).toBe(
      `${window.location.origin}/city/jerusalem/${RUBIN_SLUG}`,
    );
    expect(data.mainEntity.numberOfItems).toBe(JERUSALEM_RUBIN.length);
  });

  it("names the city in English, from the records' own `city_en`, when the language is English", async () => {
    localStorage.setItem("kashroot.lang", "en");
    renderApp("/city/jerusalem");

    expect(await screen.findByRole("heading", { level: 1, name: "Jerusalem" })).toBeInTheDocument();
    expect(screen.getByText(en.directory.cityIntro("Jerusalem", JERUSALEM.length))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nougatine" })).toHaveAttribute("href", "/r/r-nougatine");
    await waitFor(() => expect(document.title).toBe("Jerusalem · Kashroot"));
    expect(description()).toBe(en.seo.cityDescription("Jerusalem", JERUSALEM.length));
    expect(jsonLd()).toContain('"name":"Jerusalem"');
  });

  it("is the same facts page with a profile — never the verdict screen", async () => {
    seedProfile();
    const { container } = renderApp("/city/jerusalem");

    expect(await screen.findByRole("heading", { level: 1, name: "ירושלים" })).toBeInTheDocument();
    expect(container.querySelectorAll(".landing__row")).toHaveLength(JERUSALEM.length);
    expectNoVerdict(container);
  });

  it("answers an unknown city as not in our records, and keeps it out of the index", async () => {
    renderApp("/city/nowhere");

    expect(await screen.findByRole("heading", { level: 1, name: he.directory.notFoundTitle })).toBeInTheDocument();
    expect(screen.getByText(he.directory.notFoundBody)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: he.directory.notFoundHome })).toHaveAttribute("href", "/");
    await waitFor(() => expect(robots()).toBe("noindex,nofollow"));
    expect(canonical()).toBeUndefined();
    expect(jsonLd()).toBe("");
  });

  it("answers a certifier with no restaurant in the city the same way", async () => {
    const bneiBrakOnly = CERTIFIER_SLUGS["cert-rab-bb"]!;
    renderApp(`/city/jerusalem/${bneiBrakOnly}`);

    expect(await screen.findByRole("heading", { level: 1, name: he.directory.notFoundTitle })).toBeInTheDocument();
    await waitFor(() => expect(robots()).toBe("noindex,nofollow"));
  });
});

describe("the directory's wording", () => {
  it("counts one restaurant and one city in the singular, in both languages", () => {
    for (const t of [he, en]) {
      for (const text of [
        t.seo.cityDescription("X", 1),
        t.seo.cityCertifierDescription("X", "Y", 1),
        t.seo.certifierDescription("Y", 1, 1),
        t.directory.cityIntro("X", 1),
        t.directory.cityCertifierIntro("X", "Y", 1),
        t.directory.certifierIntro("Y", 1, 1),
      ]) {
        expect(text).not.toMatch(/1 restaurants|1 cities|1 מסעדות|1 ערים/);
      }
    }
    expect(en.seo.certifierDescription("Y", 1, 1)).toContain("1 restaurant in 1 city ");
    expect(en.seo.certifierDescription("Y", 2, 2)).toContain("2 restaurants in 2 cities ");
    expect(he.seo.certifierDescription("Y", 1, 1)).toContain("מסעדה אחת בעיר אחת");
    expect(he.directory.cityIntro("X", 1)).toContain("רשומה מסעדה אחת");
    expect(he.directory.cityIntro("X", 2)).toContain("רשומות 2 מסעדות");
  });

  it("names a certifier as what the records list, never as a certificate the place holds", () => {
    for (const text of [
      en.seo.cityCertifierDescription("X", "Y", 3),
      en.seo.certifierDescription("Y", 3, 2),
      en.directory.cityCertifierIntro("X", "Y", 3),
      en.directory.certifierIntro("Y", 3, 2),
    ]) {
      expect(text).toContain("on record");
      expect(text).not.toMatch(/certificate from|certified by|holds? a certificate/i);
    }
    for (const text of [
      he.seo.cityCertifierDescription("X", "Y", 3),
      he.seo.certifierDescription("Y", 3, 2),
      he.directory.cityCertifierIntro("X", "Y", 3),
      he.directory.certifierIntro("Y", 3, 2),
    ]) {
      expect(text).toMatch(/רשום/);
      expect(text).not.toContain("תעודת כשרות של");
    }
  });
});

describe("the mock directory's certifier membership", () => {
  it("counts only active certificates, as the API does", async () => {
    // The one fixture whose certificate is revoked: its certifier is not on record
    // for it, so it is on no certifier page and in no facet count — but it is still
    // in its city's list, with no certifier named.
    const revoked = RESTAURANTS.find((restaurant) =>
      restaurant.certificates.some((certificate) => certificate.state === "revoked"),
    )!;
    expect(revoked).toBeDefined();
    const revokedCertifierId = revoked.certificates.find((c) => c.state === "revoked")!.certifier_id;
    const revokedSlug = CERTIFIER_SLUGS[revokedCertifierId]!;
    expect(directoryCertifiers(revoked).map((chip) => chip.id)).not.toContain(revokedCertifierId);

    const { container } = renderApp(`/city/${revoked.city_slug}`);
    await screen.findByRole("heading", { level: 1 });
    const row = container.querySelector(`a[href="/r/${revoked.id}"]`);
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(he.landing.noCertificate);
    const facet = container.querySelector(`a[href="/city/${revoked.city_slug}/${revokedSlug}"]`);
    if (facet) {
      const others = RESTAURANTS.filter(
        (restaurant) =>
          restaurant.city_slug === revoked.city_slug && holdsCertifier(restaurant, revokedCertifierId),
      );
      expect(facet).toHaveTextContent(he.landing.restaurantCount(others.length));
    }
  });
});

describe("the certifier directory page", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("renders the certifier, its cities as links to the narrowed city page, and every restaurant", async () => {
    const { container } = renderApp(`/certifier/${RUBIN_SLUG}`);

    expect(await screen.findByRole("heading", { level: 1, name: RUBIN.name_he })).toBeInTheDocument();
    const cities = [...new Set(ALL_RUBIN.map((restaurant) => restaurant.city_slug))];
    expect(
      screen.getByText(he.directory.certifierIntro(RUBIN.name_he, ALL_RUBIN.length, cities.length)),
    ).toBeInTheDocument();

    // One link per city, to the city page narrowed to this certifier, with a count.
    for (const citySlug of cities) {
      const link = container.querySelector(`a[href="/city/${citySlug}/${RUBIN_SLUG}"]`);
      expect(link, citySlug).not.toBeNull();
      const count = ALL_RUBIN.filter((restaurant) => restaurant.city_slug === citySlug).length;
      expect(link).toHaveTextContent(he.landing.restaurantCount(count));
    }
    expect(container.querySelector(`a[href="/city/jerusalem/${RUBIN_SLUG}"]`)).toHaveTextContent("ירושלים");

    // Every restaurant holding this certifier, each a real anchor naming its city;
    // no restaurant without it.
    for (const restaurant of ALL_RUBIN) {
      const row = container.querySelector(`a[href="/r/${restaurant.id}"]`);
      expect(row, restaurant.id).not.toBeNull();
      expect(row).toHaveTextContent(restaurant.city_he);
    }
    for (const restaurant of RESTAURANTS.filter((candidate) => !holdsCertifier(candidate, RUBIN.id))) {
      expect(container.querySelector(`a[href="/r/${restaurant.id}"]`), restaurant.id).toBeNull();
    }
    expect(container.querySelectorAll(".landing__row")).toHaveLength(ALL_RUBIN.length);

    const crumbs = screen.getByRole("navigation", { name: he.directory.breadcrumbs });
    expect(within(crumbs).getByRole("link", { name: he.directory.home })).toHaveAttribute("href", "/");
    expect(within(crumbs).getByText(RUBIN.name_he)).toHaveAttribute("aria-current", "page");

    expectNoVerdict(container);
  });

  it("declares the certifier page in the head, with a CollectionPage naming the certifier and nothing about it", async () => {
    renderApp(`/certifier/${RUBIN_SLUG}`);
    await screen.findByRole("heading", { level: 1, name: RUBIN.name_he });

    await waitFor(() => expect(document.title).toBe(`${RUBIN.name_he} · Kashroot`));
    expect(canonical()).toBe(`${window.location.origin}/certifier/${RUBIN_SLUG}`);
    const cities = new Set(ALL_RUBIN.map((restaurant) => restaurant.city_slug)).size;
    expect(description()).toBe(he.seo.certifierDescription(RUBIN.name_he, ALL_RUBIN.length, cities));
    expect(robots()).toBeUndefined();

    const data = JSON.parse(jsonLd()) as {
      "@type": string;
      breadcrumb: { itemListElement: { name: string; item: string }[] };
      mainEntity: { "@type": string; numberOfItems: number; itemListElement: { item: Record<string, unknown> }[] };
    };
    expect(data["@type"]).toBe("CollectionPage");
    expect(data.breadcrumb.itemListElement.map((crumb) => crumb.name)).toEqual(["Kashroot", RUBIN.name_he]);
    expect(data.mainEntity["@type"]).toBe("ItemList");
    expect(data.mainEntity.numberOfItems).toBe(ALL_RUBIN.length);
    for (const { item } of data.mainEntity.itemListElement) {
      expect(Object.keys(item).sort()).toEqual(["@type", "name", "url"]);
    }
    expect(jsonLd()).not.toMatch(/servesCuisine|aggregateRating|review|rating|kosher|verdict|certificationLevel|certifierType/i);
  });

  it("answers an unknown certifier as not in our records, and keeps it out of the index", async () => {
    renderApp("/certifier/nobody");

    expect(await screen.findByRole("heading", { level: 1, name: he.directory.notFoundTitle })).toBeInTheDocument();
    await waitFor(() => expect(robots()).toBe("noindex,nofollow"));
    expect(jsonLd()).toBe("");
  });
});

describe("the landing page's links into the directory", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("links each city heading and a 'show all' line to the city page", async () => {
    const { container } = renderApp("/");
    await screen.findByRole("heading", { name: "ירושלים" });

    const heading = screen.getByRole("heading", { level: 3, name: "ירושלים" });
    expect(within(heading).getByRole("link", { name: "ירושלים" })).toHaveAttribute("href", "/city/jerusalem");
    // No count in the link: the landing counts by `city_he`, the city page by
    // `city_slug`, and a number that could disagree with its target is not printed.
    const showAll = screen.getAllByRole("link", { name: he.landing.showAll });
    expect(showAll.length).toBeGreaterThan(0);
    expect(showAll.map((link) => link.getAttribute("href"))).toContain("/city/jerusalem");
    for (const link of showAll) expect(link.textContent).not.toMatch(/\d/);
    // Rows are unchanged: still one real anchor per restaurant, to its own page.
    expect(container.querySelectorAll(".landing__row")).toHaveLength(RESTAURANTS.length);
    expect(container.querySelectorAll('a[href="/city/bnei-brak"]').length).toBeGreaterThan(0);
  });
});
