/**
 * Google Places enrichment on the restaurant pages: the hero photo, the gallery,
 * opening hours, and the graceful degradation when there is none.
 *
 * Two guarantees this file exists to hold: (1) the verdict renders whether or not
 * the places request ever answers — it is a second, independent fetch and must
 * never block or blank the kashrut gate; and (2) the hours section never carries
 * "from Google" / "unverified" wording, while the gallery and the page foot do
 * carry Google's own required attribution.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import * as api from "../api";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { PROFILE_SCHEMA_VERSION } from "../profile/storage";
import { SavedProvider } from "../saved/SavedProvider";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;

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

/** A profile that whitelists every certifier, so `r-nougatine` reads MATCH. */
function seedProfile() {
  localStorage.setItem(
    `kashroot.profile.v${PROFILE_SCHEMA_VERSION}`,
    JSON.stringify({
      version: PROFILE_SCHEMA_VERSION,
      presetId: "any",
      whitelist: [
        { certifier_id: "cert-eda", min_level: "unknown" },
        { certifier_id: "cert-rubin", min_level: "unknown" },
        { certifier_id: "cert-landa", min_level: "unknown" },
        { certifier_id: "cert-rab-bb", min_level: "unknown" },
        { certifier_id: "cert-rab-jlm", min_level: "unknown" },
      ],
      requiredAttributes: [],
      completedOnboarding: true,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("restaurant hero and Google Places sections", () => {
  it("shows the hero photo and gallery with attribution for a fixture with places", async () => {
    seedProfile();
    renderApp("/r/r-nougatine");

    await screen.findByRole("heading", { level: 1, name: "נוגטין" });

    const hero = document.querySelector(".detail-hero");
    expect(hero).not.toBeNull();
    expect(hero?.querySelector("img.detail-hero__img")).not.toBeNull();

    // The gallery keeps its Google caption and per-photo attribution links.
    expect(await screen.findByText(he.restaurant.gallery.caption)).toBeInTheDocument();
    expect(screen.getByText("Dana K.")).toHaveAttribute("href", "https://maps.google.com/contrib/1");
    expect(screen.getByText("Yossi M.")).toBeInTheDocument();

    // One small attribution line at the page foot, covering photos and hours.
    expect(screen.getByText(he.restaurant.googleAttribution)).toBeInTheDocument();
  });

  it("renders 24/7 hours Sunday-first, highlights today, and names no source in that section", async () => {
    seedProfile();
    renderApp("/r/r-nougatine");
    await screen.findByRole("heading", { level: 1, name: "נוגטין" });

    const hours = await screen.findByRole("region", { name: he.restaurant.hours.title });
    const rows = within(hours).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(within(rows[0] as HTMLElement).getByText(he.weekdays[0])).toBeInTheDocument();
    expect(within(hours).getAllByText(he.restaurant.hours.open24).length).toBe(7);

    const today = rows.find((row) => row.getAttribute("aria-current") === "date");
    expect(today, "no row was marked as today").toBeDefined();

    // The one thing this section must never say.
    expect(hours.textContent).not.toMatch(/Google|מגוגל|unverified|לא מאומת/);

    // The open badge sits in the hero, from the same hours data.
    expect(document.querySelector(".open-badge--open")).not.toBeNull();
  });

  it("keeps the verdict pill in the hero, directly above the evidence panel", async () => {
    seedProfile();
    const { container } = renderApp("/r/r-nougatine");
    await screen.findByLabelText(he.verdict.whyMatch);

    const hero = container.querySelector(".detail-hero");
    expect(hero?.querySelector(".verdict")).not.toBeNull();

    // Structural order: the hero comes before the evidence panel in the DOM.
    const evidence = screen.getByLabelText(he.verdict.whyMatch);
    expect(hero?.compareDocumentPosition(evidence) ?? 0).toBeGreaterThan(0);
  });

  it("shows no verdict wording anywhere on the profile-free page's hero", async () => {
    renderApp("/r/r-nougatine");
    await screen.findByRole("heading", { level: 1, name: "נוגטין" });

    const hero = document.querySelector(".detail-hero");
    expect(hero?.querySelector(".verdict")).toBeNull();
    expect(screen.queryByLabelText(he.verdict.whyMatch)).toBeNull();
    // The public page still gets the hero photo and hours — Google content is not
    // gated on having a kashrut profile.
    expect(hero?.querySelector("img.detail-hero__img")).not.toBeNull();
  });

  it("renders the placeholder hero with no gallery and no hours for a restaurant with no known place id", async () => {
    seedProfile();
    renderApp("/r/r-sushi-bvg");
    await screen.findByRole("heading", { level: 1, name: "סושי בית וגן" });

    const hero = document.querySelector(".detail-hero");
    expect(hero).not.toBeNull();
    expect(hero?.querySelector("img.detail-hero__img")).toBeNull();
    expect(document.querySelector(".gallery")).toBeNull();
    expect(screen.queryByRole("region", { name: he.restaurant.hours.title })).toBeNull();
    expect(document.querySelector(".open-badge--open")).toBeNull();
    expect(document.querySelector(".open-badge--closed")).toBeNull();
  });

  it("still renders the verdict when the places request itself is rejected", async () => {
    seedProfile();
    vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockRejectedValue(new Error("boom"));
    renderApp("/r/r-nougatine");

    // The verdict came from a wholly separate request and must show regardless.
    await screen.findByLabelText(he.verdict.whyMatch);
    expect(screen.getByText(he.verdict.matchLong)).toBeInTheDocument();

    await waitFor(() => expect(document.querySelector(".gallery")).toBeNull());
    expect(document.querySelector(".detail-hero img")).toBeNull();
  });
});
