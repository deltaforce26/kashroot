/**
 * `/r/:id` without a profile — the page a crawler and a first-time visitor see.
 *
 * Two guarantees, in tension, both asserted: the page renders (name, address,
 * certifier, facts, structured data — the indexable content), and it renders no
 * verdict of any kind (no pill, no fit score, no reason list). Then the seam: the
 * call to action walks through onboarding and comes back to the same address, now
 * as the verdict screen; and a visitor who already has a profile never sees the
 * facts page at all.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { PROFILE_SCHEMA_VERSION } from "../profile/storage";
import { SavedProvider } from "../saved/SavedProvider";
import { JSON_LD_ATTR } from "../seo/head";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;

// `setup.ts` clears storage after every test, so each render here starts with no
// profile unless `seedProfile` says otherwise — the opposite of the demo tests.
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
  he.verdict.match,
  he.verdict.noMatch,
  he.verdict.unknown,
  he.verdict.matchLong,
  he.verdict.noMatchLong,
  he.verdict.unknownLong,
];

const jsonLd = () => document.head.querySelector(`script[${JSON_LD_ATTR}]`)?.textContent ?? "";

describe("the public restaurant page", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("renders the place and its certificate facts without a profile", async () => {
    renderApp("/r/r-nougatine");

    expect(await screen.findByRole("heading", { level: 1, name: "נוגטין" })).toBeInTheDocument();
    expect(screen.getByText(/עוזיאל 28, בית וגן, ירושלים/)).toBeInTheDocument();
    expect(screen.queryByText(he.onboarding.presetTitle)).toBeNull();

    const card = screen.getByRole("region", { name: he.restaurant.certificate });
    expect(within(card).getByText("בד״ץ מהדרין — הרב רובין")).toBeInTheDocument();
    expect(
      within(card).getByText(`${he.publicRestaurant.status}: ${he.publicRestaurant.states.active}`),
    ).toBeInTheDocument();
    expect(within(card).getByText(he.restaurant.validUntil("30/09/26"))).toBeInTheDocument();
    // The attributes the certificate lists, as listed — labelled, not evaluated.
    expect(within(card).getByText(new RegExp(he.attributes.chalav_yisrael))).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(he.attributes.pas_yisrael))).toBeInTheDocument();
    expect(screen.getByText(he.publicRestaurant.factsLead)).toBeInTheDocument();
  });

  it("shows no verdict, no fit score and no reasons — there is no profile to judge by", async () => {
    const { container } = renderApp("/r/r-nougatine");
    await screen.findByRole("heading", { level: 1, name: "נוגטין" });

    expect(container.querySelector(".verdict")).toBeNull();
    expect(container.querySelector(".fit")).toBeNull();
    expect(container.querySelector(".fit-row")).toBeNull();
    expect(container.querySelector(".evidence")).toBeNull();
    for (const word of VERDICT_WORDS) {
      expect(screen.queryByText(new RegExp(word)), word).toBeNull();
    }
    // The classic pill classes, by name, so a restyled pill cannot slip through.
    for (const cls of [".verdict--match", ".verdict--unknown", ".verdict--no_match"]) {
      expect(container.querySelector(cls)).toBeNull();
    }
    expect(screen.queryByLabelText(he.verdict.whyMatch)).toBeNull();
    expect(screen.queryByLabelText(he.verdict.whyUnknown)).toBeNull();
    expect(screen.queryByLabelText(he.verdict.whyNoMatch)).toBeNull();
  });

  it("offers one call to action that leads to onboarding and remembers this address", async () => {
    renderApp("/r/r-nougatine");
    const cta = await screen.findByRole("link", { name: he.publicRestaurant.cta });
    expect(cta).toHaveAttribute("href", "/onboarding/preset");
  });

  it("declares the page in the head: title, canonical, Restaurant JSON-LD, no noindex", async () => {
    renderApp("/r/r-nougatine");
    await screen.findByRole("heading", { level: 1, name: "נוגטין" });

    await waitFor(() => expect(document.title).toBe("נוגטין · Nougatine · Kashroot"));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${window.location.origin}/r/r-nougatine`,
    );
    const description =
      document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    expect(description).toContain("נוגטין");
    expect(description).toContain("ירושלים");
    expect(description).toContain("בד״ץ מהדרין — הרב רובין");
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();

    const data = JSON.parse(jsonLd()) as Record<string, unknown>;
    expect(jsonLd()).toContain('"@type":"Restaurant"');
    expect(data).toMatchObject({
      name: "נוגטין",
      alternateName: "Nougatine",
      servesCuisine: "Kosher",
      address: { "@type": "PostalAddress", addressLocality: "ירושלים", addressCountry: "IL" },
      geo: { "@type": "GeoCoordinates", latitude: 31.7651, longitude: 35.1838 },
    });
    // Nothing that would put an app judgement into a search result.
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
    expect(jsonLd()).not.toMatch(/kashrut|verdict|"match"|no_match/);
  });

  it("walks the call to action through onboarding and back to this restaurant, now with a verdict", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/r/r-nougatine");

    await user.click(await screen.findByRole("link", { name: he.publicRestaurant.cta }));
    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // Back on the same address, as the verdict screen: the pill, and the argument.
    expect(await screen.findByLabelText(he.verdict.whyMatch)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "נוגטין" })).toBeInTheDocument();
    expect(container.querySelector(".verdict--match")).not.toBeNull();
    expect(screen.queryByRole("link", { name: he.publicRestaurant.cta })).toBeNull();
  });

  it("renders the verdict screen as before when a profile already exists", async () => {
    seedProfile();
    const { container } = renderApp("/r/r-hapisga");

    expect(await screen.findByLabelText(he.verdict.whyMatch)).toBeInTheDocument();
    expect(container.querySelector(".verdict")).not.toBeNull();
    expect(container.querySelector(".fit")).not.toBeNull();
    expect(screen.queryByRole("link", { name: he.publicRestaurant.cta })).toBeNull();
    // …and it declares the same head the public page would.
    await waitFor(() => expect(document.title).toBe("מזנון הפסגה · Hapisga Deli · Kashroot"));
    expect(jsonLd()).toContain('"@type":"Restaurant"');
  });

  it("says a place with no certificate has none, rather than inventing one", async () => {
    renderApp("/r/r-sushi-bvg");
    await screen.findByRole("heading", { level: 1, name: "סושי בית וגן" });
    expect(screen.getByText(he.restaurant.noCertificate)).toBeInTheDocument();
  });

  it("answers an unknown id as not in our records, and keeps it out of the index", async () => {
    renderApp("/r/no-such-place");
    expect(await screen.findByText(he.states.notFound)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
        "noindex,nofollow",
      ),
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("marks the onboarding screen a first-time crawler of `/` lands on as noindex", async () => {
    renderApp("/");
    await screen.findByText(he.onboarding.presetTitle);
    await waitFor(() => expect(document.title).toBe(`${he.seo.onboardingTitle} · Kashroot`));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex,nofollow",
    );
  });
});
