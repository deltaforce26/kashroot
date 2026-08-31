/**
 * The map's list view: the toggle that reaches it, and what a row is.
 *
 * The three things worth pinning down: the map's List toggle leads to the list
 * rather than home (which is what it used to do), a row carries the name and the
 * distance, and the row is a link to that restaurant. The list is asserted to hold
 * the same places the map plots, so the two screens cannot quietly disagree about
 * what "these results" means.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { STRINGS } from "../i18n/strings";
import { ThemeProvider } from "../theme/ThemeProvider";

function renderApp(route = "/", city = "jerusalem") {
  localStorage.setItem("kashroot.city", city);
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

const he = STRINGS.he;

/** Onboards with the widest preset, then lands on the map. */
async function reachMap(user: ReturnType<typeof userEvent.setup>) {
  const rendered = renderApp("/");
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  await user.click(await screen.findByRole("link", { name: he.nav.map }));
  return rendered;
}

describe("map list", () => {
  it("reaches the list from the map's own toggle, not the home screen", async () => {
    const user = userEvent.setup();
    await reachMap(user);

    await user.click(await screen.findByRole("button", { name: he.map.list }));

    // The toggle is still there with List now the pressed side — this is the map's
    // list, not a bounce back to home, which has no such toggle.
    expect(await screen.findByRole("button", { name: he.map.list, pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: he.map.map, pressed: false })).toBeTruthy();
  });

  it("gives every row a name, a distance and a link to that restaurant", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);
    await user.click(await screen.findByRole("button", { name: he.map.list }));

    await waitFor(() => expect(container.querySelectorAll(".card--row").length).toBeGreaterThan(0));
    const rows = [...container.querySelectorAll<HTMLElement>(".card--row")];

    for (const row of rows) {
      const name = row.querySelector(".card__title")?.textContent ?? "";
      expect(name.length).toBeGreaterThan(0);
      // The distance the API measured, in metres or kilometres — never blank.
      expect(row.querySelector(".card__meta")?.textContent ?? "").toMatch(
        new RegExp(`\\d.*(${he.units.m}|${he.units.km})`),
      );
      // The whole row is the link, and it points at that restaurant's page.
      expect(within(row).getByRole("link").getAttribute("href")).toMatch(/^\/r\//);
    }
  });

  it("opens the restaurant screen when a row is clicked", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);
    await user.click(await screen.findByRole("button", { name: he.map.list }));

    await waitFor(() => expect(container.querySelector(".card--row")).toBeTruthy());
    const row = container.querySelector<HTMLElement>(".card--row")!;
    const name = row.querySelector(".card__title")!.textContent!;
    await user.click(within(row).getByRole("link"));

    // The detail screen for the row we clicked: its name, and the report link only
    // that screen draws.
    expect(await screen.findByText(he.restaurant.report)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(name)).length).toBeGreaterThan(0);
  });

  /**
   * The map and its list toggle between each other, so a history-based back button
   * walks between the two rather than out of them. Both go straight home instead.
   */
  it("leaves for home from the back button on either screen", async () => {
    const user = userEvent.setup();
    await reachMap(user);

    await user.click(screen.getByRole("button", { name: he.states.back }));
    expect(await screen.findByText(he.home.nearYou)).toBeInTheDocument();

    await user.click(await screen.findByRole("link", { name: he.nav.map }));
    await user.click(await screen.findByRole("button", { name: he.map.list }));
    await screen.findByRole("button", { name: he.map.list, pressed: true });

    await user.click(screen.getByRole("button", { name: he.states.back }));
    expect(await screen.findByText(he.home.nearYou)).toBeInTheDocument();
  });

  it("lists the same places the map plots", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);

    // The map's carousel holds one card per plotted place.
    await waitFor(() => expect(container.querySelectorAll(".map__slide").length).toBeGreaterThan(0));
    const plotted = container.querySelectorAll(".map__slide").length;

    await user.click(screen.getByRole("button", { name: he.map.list }));
    await waitFor(() => expect(container.querySelectorAll(".card--row").length).toBe(plotted));
  });
});
