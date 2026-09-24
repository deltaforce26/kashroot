/**
 * The map screen: one set of results, one screen.
 *
 * The map used to ignore the filter bar and sweep a fixed 50 km, so a filter set on
 * home excluded places the map still plotted — two answers to one question, in a
 * product whose claim is that the answer does not change with the screen you are
 * standing on. These pin that shut: the map carries the shared bar and a search field
 * of its own, and its pins are the same set home's cards are.
 *
 * No map is ever drawn here, and none needs to be. `useGoogleMaps` is mocked to the
 * one state jsdom can hold honestly — `ready`, with no libraries — because every
 * effect in MapView that touches Google is already guarded on `libs`. The screen
 * therefore mounts its real map element, runs its real search and draws its real
 * controls with no Google at all. (`vite.config.ts` pins the browser key empty for
 * the suite, so without the mock the screen would sit in its no-key fallback, which
 * is demoFlow's subject rather than this file's.)
 *
 * The seam is the sr-only pin count, which renders either way: it is read off the
 * same `plotted` list the markers are built from, so it stands in for counting the
 * pins jsdom could never draw.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { STRINGS } from "../i18n/strings";
import { ThemeProvider } from "../theme/ThemeProvider";

// A map that is "ready" with nothing behind it: a real mount of the real screen minus
// the canvas, which also leaves the notice slot — errors, an empty result, a query
// that missed — on screen to assert, where the no-key fallback would cover it.
vi.mock("../map/useGoogleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../map/useGoogleMaps")>()),
  useGoogleMaps: () => ({ status: "ready" as const, libs: null }),
}));

const he = STRINGS.he;

type User = ReturnType<typeof userEvent.setup>;

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

/** From the landing's call to action, onboards with the widest preset, which lands on home. */
async function onboard(user: User) {
  const rendered = renderApp("/");
  await user.click(await screen.findByRole("link", { name: he.landing.cta }));
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  return rendered;
}

/** Onboards, then takes the map tab — the only way in now that the list is gone. */
async function reachMap(user: User) {
  const rendered = await onboard(user);
  await user.click(await screen.findByRole("link", { name: he.nav.map }));
  return rendered;
}

// "<n> מקומות על המפה", matched on the words so the number stays free.
const PIN_WORDS = he.map.pinsShown(0).replace(/^\d+\s*/, "");
const PIN_COUNT = new RegExp(`\\d+\\s*${PIN_WORDS}`);

/** The pin count the map announces, or null while it is still saying "loading". */
function readPins(): number | null {
  const announced = screen.queryByText(PIN_COUNT);
  return announced ? Number(announced.textContent!.match(/\d+/)![0]) : null;
}

/** Waits for the map to announce exactly `expected` pins. */
async function expectPins(expected: number) {
  await waitFor(() => expect(readPins()).toBe(expected));
}

/** Picks an option out of one of the bar's chip popovers, leaving it applied. */
async function pickFacet(user: User, chip: string, option: string) {
  await user.click(screen.getByRole("button", { name: chip }));
  const popover = screen.getByRole("dialog", { name: chip });
  await user.click(within(popover).getByRole("button", { name: option }));
  await user.keyboard("{Escape}");
}

/**
 * jsdom has no geolocation and nothing is pinned, so the map asks for everything: all
 * eleven fixtures — Jerusalem, Bnei Brak and Tiberias — five of them meat. Every
 * fixture is geocoded, so "plotted" and "returned" are the same number.
 */
const ALL_PINS = 11;
const ALL_MEAT = 5;

/** Held by exactly one fixture, and that one a pareve bakery. */
const EDA = "בד״ץ העדה החרדית";
const EDA_PINS = 1;

describe("map screen", () => {
  it("offers a search field and the filter bar, and no back button or list toggle", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);
    await expectPins(ALL_PINS);

    // Its own search field, filtering in place — not home's, which navigates away.
    expect(screen.getByRole("searchbox", { name: he.search.placeholder })).toBeInTheDocument();
    expect(container.querySelector(".map__search")).not.toBeNull();

    // The shared bar, whole: the sliders button and all three chips.
    expect(screen.getByRole("button", { name: he.home.openFilters })).toBeInTheDocument();
    for (const chip of [he.filters.kashrut, he.filters.diet, he.filters.openNow]) {
      expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();
    }

    // The tab bar is the way out, so the back button is gone…
    expect(screen.queryByRole("button", { name: he.states.back })).toBeNull();
    // …and with the list deleted there is nothing left to toggle between. `map.map`
    // survives only as the canvas's aria-label, which is not a button.
    expect(screen.queryByRole("button", { name: he.map.map })).toBeNull();
    expect(container.querySelector(".segmented")).toBeNull();
    expect(container.querySelector(".map__overlay")).toBeNull();
    expect(screen.getByRole("link", { name: he.nav.home })).toBeInTheDocument();
  });

  /**
   * The whole point of the change: before it, this filter moved home's list and left
   * the map plotting everything.
   */
  it("honours a filter set on the map itself", async () => {
    const user = userEvent.setup();
    await reachMap(user);
    await expectPins(ALL_PINS);

    await pickFacet(user, he.filters.diet, he.diet.meat);

    await expectPins(ALL_MEAT);
  });

  /**
   * The same filter, set on the other screen. The two requests differ only in
   * `page_size` (100 against home's 20), which cannot separate them here: the whole
   * fixture is eleven places, under either cap, and every one of them is
   * geocoded — so the map's `geo !== null` filter drops nothing and the counts are
   * exactly equal rather than merely related. The cap is asserted too, so a fixture
   * that grew past a page would fail here loudly instead of quietly proving nothing.
   */
  it("plots exactly what home lists, for a filter set on home", async () => {
    const user = userEvent.setup();
    const { container } = await onboard(user);

    await waitFor(() =>
      expect(container.querySelectorAll(".card--grid").length).toBe(ALL_PINS),
    );
    await pickFacet(user, he.filters.diet, he.diet.meat);
    await waitFor(() =>
      expect(container.querySelectorAll(".card--grid").length).toBe(ALL_MEAT),
    );
    const onHome = container.querySelectorAll(".card--grid").length;
    // Home pages at 20; this set is under it, so the agreement below is real.
    expect(onHome).toBeLessThan(20);

    await user.click(await screen.findByRole("link", { name: he.nav.map }));

    await expectPins(onHome);
  });

  it("narrows the pins to a typed query", async () => {
    const user = userEvent.setup();
    await reachMap(user);
    await expectPins(ALL_PINS);

    // Matches one fixture by name — the API does a case-insensitive substring over
    // name and address and nothing cleverer, which is all the UI promises.
    await user.type(screen.getByRole("searchbox", { name: he.search.placeholder }), "בורגר");

    await expectPins(1);
  });

  it("explains an empty map as a spelling difference when a query caused it", async () => {
    const user = userEvent.setup();
    await reachMap(user);
    await expectPins(ALL_PINS);

    await user.type(screen.getByRole("searchbox", { name: he.search.placeholder }), "זזזזזז");

    await expectPins(0);
    // The query's own empty state, not the profile's: nothing here tells the user to
    // widen a profile over what is only a typo.
    expect(await screen.findByText(he.states.emptyQueryTitle("זזזזזז"))).toBeInTheDocument();
    expect(screen.queryByText(he.states.emptyTitle)).toBeNull();

    // And it clears back to a full map from the state's own button.
    await user.click(screen.getByRole("button", { name: he.states.emptyQueryAction }));
    await expectPins(ALL_PINS);
  });

  /**
   * A filter can empty the map legitimately, and an empty map with nothing said over
   * it reads as a broken screen. This is the other branch of that slot: the one
   * fixture holding this certifier is a pareve bakery, so the two facets
   * together leave nothing — while each on its own still finds something, which is
   * what makes the empty map the filters' doing rather than an empty corpus.
   */
  it("explains an empty map as a profile question when a filter caused it", async () => {
    const user = userEvent.setup();
    await reachMap(user);
    await expectPins(ALL_PINS);

    await pickFacet(user, he.filters.kashrut, EDA);
    await expectPins(EDA_PINS);
    await pickFacet(user, he.filters.diet, he.diet.meat);

    await expectPins(0);
    expect(screen.getByText(he.states.emptyTitle)).toBeInTheDocument();
  });

  /** An installed PWA can still hold the old address, so it has to land somewhere. */
  it("redirects the deleted list route back to the map", async () => {
    const user = userEvent.setup();
    await onboard(user);
    await screen.findAllByRole("button", { name: he.home.changeLocation });

    // Remount at the dead address with the profile onboarding just wrote.
    cleanup();
    renderApp("/map/list");

    expect(
      await screen.findByRole("searchbox", { name: he.search.placeholder }),
    ).toBeInTheDocument();
    await expectPins(ALL_PINS);
    expect(screen.queryByRole("button", { name: he.states.back })).toBeNull();
  });

  /**
   * The one thing this layout risks. `.sheet` is `position: absolute; bottom: 0`, so it
   * anchors to its nearest *positioned* ancestor. The controls float over the map with
   * no wrapper precisely so that ancestor stays `.shell` — wrap `<FilterBar />` in an
   * absolutely-positioned overlay and the sheet would anchor to that ~120px strip and
   * render as a stub near the top of the screen instead of rising full-width from the
   * bottom. jsdom lays nothing out, so what is asserted is the structure that decides
   * it: the sheet is a direct child of the shell, with nothing positioned in between.
   */
  it("hangs the filter sheet off the shell, not off a wrapper round the controls", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);
    await expectPins(ALL_PINS);

    await user.click(screen.getByRole("button", { name: he.home.openFilters }));

    const shell = container.querySelector(".shell");
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    expect(sheet).toHaveClass("sheet");
    expect(sheet.parentElement).toBe(shell);
    // The scrim has to cover the whole shell too, or a tap beside the sheet would
    // fall through to the map's "close the card" handler instead of closing it.
    expect(container.querySelector(".sheet__scrim")?.parentElement).toBe(shell);
    // The bar itself is a plain flow child, which is what keeps that true.
    expect(container.querySelector(".fbar")?.parentElement).toBe(shell);
  });

  /**
   * "Only businesses with a mapped location appear here" — home says it in prose, and
   * a map has no room for a paragraph, so it is said to screen readers. Deliberately
   * outside the `role="status"` that carries the count: a standing fact re-announced
   * on every result change is noise.
   */
  it("keeps the coverage caveat, and out of the live region", async () => {
    const user = userEvent.setup();
    const { container } = await reachMap(user);
    await expectPins(ALL_PINS);

    const note = screen.getByText(he.map.note);
    expect(note).toHaveClass("sr-only");
    expect(note.closest('[role="status"]')).toBeNull();

    // And the screen has a real heading, which a picture cannot otherwise give.
    const heading = within(container).getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(he.home.resultsTitle(ALL_PINS));
  });
});
