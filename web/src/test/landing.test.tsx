/**
 * `/` without a profile — the landing page, which is what a crawler reads at the
 * site's root and what a first-time visitor sees before onboarding.
 *
 * Two guarantees, in tension, both asserted: the page renders (the hero, a call to
 * action into onboarding, every city with its count, and a real anchor to every
 * restaurant page — the indexable content and the crawl paths), and it renders no
 * verdict of any kind, because there is no profile to produce one. Then the seams:
 * the hero and its call to action survive a failed directory request; the call to
 * action really does lead through onboarding to Home; and a visitor who already
 * has a profile gets Home at the same address and never sees the landing at all.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { ApiError, kashrootApi } from "../api";
import { RESTAURANTS } from "../api/mock/fixtures";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { PROFILE_SCHEMA_VERSION } from "../profile/storage";
import { SavedProvider } from "../saved/SavedProvider";
import { JSON_LD_ATTR } from "../seo/head";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;
const en = STRINGS.en;

// `setup.ts` clears storage after every test, so each render here starts with no
// profile unless `seedProfile` says otherwise.
function renderApp(route = "/") {
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

/**
 * Every way a verdict is written: the wire enum values, and the string table's
 * words for them in both languages, short and long.
 */
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

/** The hero: the tagline as the page heading, and the one call to action. */
async function expectHero() {
  expect(
    await screen.findByRole("heading", { level: 1, name: he.landing.tagline }),
  ).toBeInTheDocument();
  expect(screen.getByText(he.landing.body)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: he.landing.cta })).toHaveAttribute(
    "href",
    "/onboarding/preset",
  );
}

describe("the landing page", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the hero at `/` with no redirect, and no tab bar", async () => {
    renderApp("/");
    await expectHero();

    expect(screen.queryByText(he.onboarding.presetTitle)).toBeNull();
    // Every tab is behind the gate; this is the screen before the app.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText(he.landing.footer)).toBeInTheDocument();
  });

  it("lists every city with its count, in the API's order", async () => {
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "ירושלים" })).toBeInTheDocument();
    expect(screen.getByText(he.landing.restaurantCount(8))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "בני ברק" })).toBeInTheDocument();
    expect(screen.getByText(he.landing.restaurantCount(2))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "טבריה" })).toBeInTheDocument();
    expect(screen.getByText(he.landing.restaurantCount(1))).toBeInTheDocument();

    // Largest city first, as the API orders them — and nothing here reorders.
    const cities = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(cities).toEqual(["ירושלים", "בני ברק", "טבריה"]);
  });

  it("links every restaurant with a real anchor to its page: name, address, certifiers", async () => {
    const { container } = renderApp("/");
    await screen.findByRole("heading", { name: "ירושלים" });

    const row = container.querySelector('a[href="/r/r-nougatine"]');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("נוגטין");
    expect(row).toHaveTextContent("עוזיאל 28, בית וגן");
    expect(row).toHaveTextContent("בד״ץ מהדרין — הרב רובין");
    // The link's accessible name is the restaurant's name alone — not the name,
    // address and certifiers run together.
    expect(screen.getByRole("link", { name: "נוגטין" })).toBe(row);
    expect(screen.queryByRole("link", { name: /עוזיאל 28/ })).toBeNull();

    // Every fixture is reachable from the root — this is how the long tail is found.
    for (const restaurant of RESTAURANTS) {
      expect(
        container.querySelector(`a[href="/r/${restaurant.id}"]`),
        restaurant.id,
      ).not.toBeNull();
    }
    // Rows are links, not buttons: a crawler follows anchors and nothing else.
    expect(container.querySelectorAll(".landing__row")).toHaveLength(RESTAURANTS.length);
    for (const anchor of container.querySelectorAll(".landing__row")) {
      expect(anchor.tagName).toBe("A");
      expect(anchor.querySelector("button")).toBeNull();
    }
    // A place with no certificate says so, rather than inventing one.
    expect(container.querySelector('a[href="/r/r-sushi-bvg"]')).toHaveTextContent(
      he.landing.noCertificate,
    );
  });

  it("separates certifier names visually only: the ' · ' is hidden from assistive tech", async () => {
    vi.spyOn(kashrootApi, "getDirectory").mockResolvedValue({
      totalRestaurants: 1,
      cities: [
        {
          cityHe: "ירושלים",
          cityEn: "Jerusalem",
          restaurantCount: 1,
          restaurants: [
            {
              id: "r-two",
              nameHe: "שתי תעודות",
              nameEn: null,
              addressHe: "רחוב 1",
              certifiers: [
                { nameHe: "בד״ץ א", nameEn: null },
                { nameHe: "בד״ץ ב", nameEn: null },
              ],
            },
          ],
        },
      ],
    });
    const { container } = renderApp("/");
    await screen.findByRole("heading", { name: "ירושלים" });

    // Two certifiers on the record: both names shown, one separator between them,
    // rendered but decorative — and the link is still named by the restaurant alone.
    const row = container.querySelector('a[href="/r/r-two"]');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("בד״ץ א · בד״ץ ב");
    const separators = row?.querySelectorAll('[aria-hidden="true"]') ?? [];
    expect(separators).toHaveLength(1);
    expect(separators[0]).toHaveTextContent("·");
    expect(screen.getByRole("link", { name: "שתי תעודות" })).toBe(row);
  });

  it("names no verdict anywhere — there is no profile to judge by", async () => {
    const { container } = renderApp("/");
    await screen.findByRole("heading", { name: "ירושלים" });

    const text = container.textContent ?? "";
    for (const word of VERDICT_WORDS) {
      expect(text, word).not.toContain(word);
    }
    expect(container.querySelector(".verdict")).toBeNull();
    expect(container.querySelector(".fit")).toBeNull();
    expect(container.querySelector(".fit-row")).toBeNull();
    expect(container.querySelector(".evidence")).toBeNull();
    for (const cls of [".verdict--match", ".verdict--unknown", ".verdict--no_match"]) {
      expect(container.querySelector(cls)).toBeNull();
    }
  });

  it("declares the site in the head: brand title, canonical, one WebSite JSON-LD, no noindex", async () => {
    renderApp("/");
    await expectHero();

    await waitFor(() => expect(document.title).toBe(he.seo.brandTitle));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${window.location.origin}/`,
    );
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      he.seo.siteDescription,
    );
    expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe(
      "website",
    );
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();

    const data = JSON.parse(jsonLd()) as Record<string, unknown>;
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Kashroot",
      url: `${window.location.origin}/`,
      inLanguage: ["he", "en"],
    });
    // One object, and nothing that reads as a judgement or a list of picks.
    expect(jsonLd()).not.toContain("ItemList");
    expect(jsonLd()).not.toContain("SearchAction");
    expect(jsonLd()).not.toMatch(/kosher|verdict|rating|review/i);
  });

  it("still shows the hero and the call to action when the directory request fails", async () => {
    vi.spyOn(kashrootApi, "getDirectory").mockRejectedValue(new ApiError(500, "boom"));
    renderApp("/");

    expect(await screen.findByText(he.states.errorTitle)).toBeInTheDocument();
    await expectHero();
    // The sentence we wrote, never the server's.
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.getByRole("button", { name: he.states.retry })).toBeInTheDocument();
  });

  it("walks the call to action through onboarding and lands on Home", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await user.click(await screen.findByRole("link", { name: he.landing.cta }));
    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // Home: the heading that counts what was checked, and no landing left behind.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/\d/),
    );
    expect(screen.queryByRole("link", { name: he.landing.cta })).toBeNull();
  });

  it("switches language on the spot, naming each city by the records' own `city_en`", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "ירושלים" });
    expect(document.documentElement.dir).toBe("rtl");

    await user.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(screen.getByRole("heading", { level: 1, name: en.landing.tagline })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jerusalem" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bnei Brak" })).toBeInTheDocument();
    // Tiberias is not a launch city and not in the fallback table; the records
    // carry its English name and that is what is shown.
    expect(en.landing.cityNames["טבריה"]).toBeUndefined();
    expect(screen.getByRole("heading", { name: "Tiberias" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "טבריה" })).toBeNull();
    expect(screen.getByRole("link", { name: en.landing.cta })).toHaveAttribute(
      "href",
      "/onboarding/preset",
    );
    // The row's accessible name follows the language: the English name where there is one.
    expect(screen.getByRole("link", { name: "Nougatine" })).toHaveAttribute("href", "/r/r-nougatine");
  });

  it("falls back from `city_en` to the launch-city table, then to `city_he` — in English only", async () => {
    const user = userEvent.setup();
    const row = {
      id: "r-x",
      nameHe: "מסעדה",
      nameEn: null,
      addressHe: null,
      certifiers: [],
    };
    vi.spyOn(kashrootApi, "getDirectory").mockResolvedValue({
      totalRestaurants: 3,
      cities: [
        // The records' own name wins over the table's spelling.
        { cityHe: "ירושלים", cityEn: "Yerushalayim", restaurantCount: 1, restaurants: [{ ...row, id: "r-1" }] },
        // No `city_en`, but a launch city: the table's fallback.
        { cityHe: "חיפה", cityEn: null, restaurantCount: 1, restaurants: [{ ...row, id: "r-2" }] },
        // No `city_en` and not a launch city: as the records spell it.
        { cityHe: "טבריה", cityEn: null, restaurantCount: 1, restaurants: [{ ...row, id: "r-3" }] },
      ],
    });
    renderApp("/");

    // In Hebrew the heading is always `city_he`, whatever `city_en` says.
    await screen.findByRole("heading", { name: "ירושלים" });
    expect(screen.queryByRole("heading", { name: "Yerushalayim" })).toBeNull();
    expect(screen.getByRole("heading", { name: "חיפה" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "טבריה" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByRole("heading", { name: "Yerushalayim" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Jerusalem" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Haifa" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "טבריה" })).toBeInTheDocument();
  });

  it("renders Home, not the landing, once a profile exists", async () => {
    seedProfile();
    renderApp("/");

    expect(await screen.findAllByRole("button", { name: he.home.changeLocation })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: he.landing.cta })).toBeNull();
    expect(screen.queryByText(he.landing.body)).toBeNull();
    // …and declares the same head the landing does.
    await waitFor(() => expect(jsonLd()).toContain('"@type":"WebSite"'));
  });
});
