/**
 * The unified search bar: a field, a "near me" button and a dropdown of what a pick
 * can do, on home (and, shared, on search and the map).
 *
 * What matters is the line between typing and choosing. Typing only ever offers; the
 * origin moves on a pick and on nothing else, and the header — which names the place
 * we are really searching — must agree with the pick. A city is a scope (whole city,
 * no radius), a Google place is a point (a radius applies), and the device is a point
 * the user asked for with one tap. A refusal is said once, next to the button that
 * asked, and never for a refusal this bar did not ask for.
 *
 * Google is doubled exactly as in the location sheet's tests: the completions are
 * Google's network call, not ours. The directory the city list comes from is the
 * mock API's, so the cities and counts are the real fixtures'.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { STRINGS } from "../i18n/strings";
import { ThemeProvider } from "../theme/ThemeProvider";
import { resetCityIndex } from "../location/useCityIndex";
import { DEFAULT_FILTERS } from "../filters/model";
import { clearOrigin, resetOriginState } from "../location/useOrigin";

type Candidate = { label: string; point: { lat: number; lon: number } };
type Suggestions = Array<{ id: string; label: string; resolve: () => Promise<Candidate> }>;

/** A hand-rolled double, for the reason the location sheet's tests give. */
const suggestCalls: string[] = [];
let suggestImpl: (query: string) => Promise<Suggestions> = async () => [];

/** The device's area name; refuses by default, as with no key or a failed lookup. */
const areaCalls: Array<{ lat: number; lon: number }> = [];
let areaImpl: () => Promise<string | null> = () => Promise.reject(new Error("No maps key"));

vi.mock("../map/useGoogleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../map/useGoogleMaps")>()),
  hasMapsKey: () => true,
  suggestAddresses: (query: string) => {
    suggestCalls.push(query);
    return suggestImpl(query);
  },
  reverseGeocodeArea: (point: { lat: number; lon: number }) => {
    areaCalls.push(point);
    return areaImpl();
  },
}));

const he = STRINGS.he;

/** Ramat Gan, far from everything else in the fixtures. */
const PLACE: Candidate = { label: "ביאליק 1, רמת גן", point: { lat: 32.0684, lon: 34.8248 } };

/** The one Tiberias fixture: the whole city, so the whole list. */
const TIBERIAS_NAME = "מסעדת האגם";

type User = ReturnType<typeof userEvent.setup>;

function mount() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ProfileProvider>
          <SavedProvider>
            <MemoryRouter initialEntries={["/"]}>
              <App />
            </MemoryRouter>
          </SavedProvider>
        </ProfileProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

/** A visitor who already chose "all of Israel", so the load asks the device for nothing. */
function seedEverywhere() {
  localStorage.setItem("kashroot.origin.v1", JSON.stringify({ source: "none" }));
}

/** Through the landing's call to action and onboarding to home. */
async function reachHome(user: User) {
  mount();
  await user.click(await screen.findByRole("link", { name: he.landing.cta }));
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  await screen.findAllByRole("button", { name: he.home.changeLocation });
}

const field = () => screen.getByRole("searchbox", { name: he.search.placeholder });
const nearMe = () => screen.getByRole("button", { name: he.origin.nearMe });
const locatingButton = () => screen.getByRole("button", { name: he.origin.locating });
const withinButton = () => screen.getByRole("button", { name: he.origin.withinKm(5) });
const ORIGIN_KEY = "kashroot.origin.v1";
/** The lucide `navigation` arrow, by its path: the idle button's icon. */
const NAVIGATION_PATH = "M3 11l19-9-9 19-2-8-8-2z";
const header = () => within(document.querySelector<HTMLElement>(".shell__header")!);
const menu = () => screen.queryByLabelText(he.search.suggestionsLabel);

/** Whether the filter sheet offers a radius, which it does only with a centre to measure from. */
async function radiusOffered(user: User): Promise<boolean> {
  await user.click(screen.getByRole("button", { name: he.home.openFilters }));
  const sheet = await screen.findByRole("dialog", { name: he.filters.title });
  const offered = within(sheet).queryByText(he.filters.radius) !== null;
  await user.keyboard("{Escape}");
  return offered;
}

let positionRequests = 0;
/** Held open so a test can look at the pending state before answering. */
let answer: (() => void) | null = null;

function stubGeolocation(behaviour: "grant" | "deny" | "timeout" | "hold") {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        positionRequests += 1;
        const grant = () =>
          ok({ coords: { latitude: 31.78, longitude: 35.21 } } as GeolocationPosition);
        if (behaviour === "grant") grant();
        else if (behaviour === "deny") fail({ code: 1, message: "denied" } as GeolocationPositionError);
        else if (behaviour === "timeout") fail({ code: 3, message: "timeout" } as GeolocationPositionError);
        else answer = grant;
      },
    },
  });
}

describe("search bar", () => {
  afterEach(() => {
    suggestCalls.length = 0;
    suggestImpl = async () => [];
    areaCalls.length = 0;
    areaImpl = () => Promise.reject(new Error("No maps key"));
    positionRequests = 0;
    answer = null;
    cleanup();
    clearOrigin();
    resetOriginState();
    resetCityIndex();
    Reflect.deleteProperty(navigator, "geolocation");
    Reflect.deleteProperty(navigator, "permissions");
  });

  it("is idle at first: the near-me label and the navigation arrow, on the gradient pill", async () => {
    seedEverywhere();
    const user = userEvent.setup();
    await reachHome(user);

    const button = nearMe();
    expect(button).toHaveAttribute("data-state", "idle");
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button.querySelector(`svg path[d="${NAVIGATION_PATH}"]`)).not.toBeNull();
    expect(button.querySelector(".searchbar__spinner")).toBeNull();
    expect(field()).toHaveAttribute("placeholder", he.search.placeholder);
    // The divider the handoff does not have.
    expect(document.querySelector(".searchbar__divider")).toBeNull();
  });

  it("asks the device once on a tap, shows the locating state, then goes active", async () => {
    seedEverywhere();
    stubGeolocation("hold");
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    const pending = locatingButton();
    // Enabled on purpose: pressing it again cancels.
    expect(pending).toBeEnabled();
    expect(pending).toHaveAttribute("data-state", "locating");
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending.querySelector(".searchbar__spinner")).not.toBeNull();
    expect(pending.querySelector("svg")).toBeNull();
    expect(positionRequests).toBe(1);

    answer!();
    await waitFor(() => expect(withinButton()).toBeInTheDocument());
    expect(withinButton()).toHaveAttribute("data-state", "active");
    expect(withinButton()).toBeEnabled();
    expect(withinButton()).toHaveAttribute("aria-busy", "false");
    expect(header().getByText(he.map.youAreHere)).toBeInTheDocument();
    expect(positionRequests).toBe(1);
    // No key in the app and no area answer: the generic name stands in for the area.
    expect(field()).toHaveAttribute("placeholder", he.search.nearPlaceholder(he.map.youAreHere));
    // The accessible name of the field does not move with its placeholder.
    expect(field()).toBeInTheDocument();
  });

  it("names the area in the placeholder once the reverse geocode answers, once per fix", async () => {
    seedEverywhere();
    stubGeolocation("grant");
    areaImpl = async () => "פלורנטין";
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    await waitFor(() =>
      expect(field()).toHaveAttribute("placeholder", he.search.nearPlaceholder("פלורנטין")),
    );
    expect(he.search.nearPlaceholder("פלורנטין")).toBe("מסעדות ליד פלורנטין…");
    // The fix goes to the one lookup and is asked about once, however often the bar renders.
    await user.type(field(), "א");
    expect(areaCalls).toEqual([{ lat: 31.78, lon: 35.21 }]);
  });

  it("falls back to the generic name when the area has none, and drops a stale answer", async () => {
    seedEverywhere();
    stubGeolocation("grant");
    let name!: (value: string | null) => void;
    areaImpl = () => new Promise<string | null>((resolve) => (name = resolve));
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    await waitFor(() => expect(withinButton()).toBeInTheDocument());
    // Dropped before Google answered: the late name must not reach the idle field.
    await user.click(withinButton());
    name("פלורנטין");
    await waitFor(() => expect(nearMe()).toBeInTheDocument());
    expect(field()).toHaveAttribute("placeholder", he.search.placeholder);
  });

  it("returns to idle on a tap while active: all of Israel, and the choice is stored", async () => {
    seedEverywhere();
    stubGeolocation("grant");
    const user = userEvent.setup();
    await reachHome(user);
    await user.click(nearMe());
    await waitFor(() => expect(withinButton()).toBeInTheDocument());
    expect(header().getByText(he.map.youAreHere)).toBeInTheDocument();

    await user.click(withinButton());

    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(field()).toHaveAttribute("placeholder", he.search.placeholder);
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null")).toEqual({ source: "none" });
    // Leaving is not a refusal.
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
  });

  it("cancels on a tap while locating, without a hint, and ignores the late answer", async () => {
    seedEverywhere();
    stubGeolocation("hold");
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    expect(locatingButton()).toBeInTheDocument();
    await user.click(locatingButton());
    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();

    // The device answers after all: nobody is waiting for it.
    answer!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();
    expect(field()).toHaveAttribute("placeholder", he.search.placeholder);
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
    expect(JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null")).toEqual({ source: "none" });
  });

  it("keeps a pinned city when a locating tap is cancelled, and ignores the late fix", async () => {
    seedEverywhere();
    stubGeolocation("hold");
    const user = userEvent.setup();
    await reachHome(user);
    await user.type(field(), "טבר");
    await user.click(await screen.findByRole("button", { name: /טבריה/ }));
    expect(header().getByText("טבריה")).toBeInTheDocument();

    await user.click(nearMe());
    await user.click(locatingButton());
    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();

    answer!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(header().getByText("טבריה")).toBeInTheDocument();
    expect(header().getByText(he.origin.searchingInCity)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null")).toMatchObject({
      source: "city",
      slug: "tiberias",
    });
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
  });

  it("labels the active button with the filter bar's radius", async () => {
    seedEverywhere();
    localStorage.setItem(
      "kashroot.filters.v2",
      JSON.stringify({ ...DEFAULT_FILTERS, radiusKm: 2 }),
    );
    stubGeolocation("grant");
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    expect(await screen.findByRole("button", { name: he.origin.withinKm(2) })).toBeInTheDocument();
    expect(he.origin.withinKm(2)).toBe("עד 2 ק״מ");
  });

  it("says a refusal once, keeps searching all of Israel, and not for an earlier refusal", async () => {
    seedEverywhere();
    stubGeolocation("deny");
    const user = userEvent.setup();
    await reachHome(user);
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();

    await user.click(nearMe());
    expect(await screen.findByText(he.origin.refused.denied)).toBeInTheDocument();
    const hint = screen.getByText(he.origin.refused.denied);
    expect(hint).toHaveAttribute("role", "status");
    // Outside the wrapper that anchors the menu, so a menu opening later is not pushed
    // below it.
    expect(hint.closest(".searchbar__wrap")).toBeNull();
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();

    // A fresh mount, the refusal still recorded in the module: nobody asked this time.
    cleanup();
    mount();
    await screen.findAllByRole("button", { name: he.home.changeLocation });
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
  });

  it("names the timeout for a timed-out request, not the blocked-site instruction", async () => {
    seedEverywhere();
    stubGeolocation("timeout");
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    expect(await screen.findByText(he.origin.refused.timeout)).toBeInTheDocument();
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();
  });

  it("says the site is blocked at once, without asking the device, when permission is already denied", async () => {
    seedEverywhere();
    stubGeolocation("grant");
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: () => Promise.resolve({ state: "denied" }) },
    });
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    expect(await screen.findByText(he.origin.refused.denied)).toBeInTheDocument();
    expect(positionRequests).toBe(0);
    expect(nearMe()).toHaveAttribute("data-state", "idle");
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();
  });

  it("asks the device anyway when the permission query itself fails", async () => {
    seedEverywhere();
    stubGeolocation("grant");
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: () => Promise.reject(new TypeError("unsupported")) },
    });
    const user = userEvent.setup();
    await reachHome(user);

    await user.click(nearMe());
    await waitFor(() => expect(withinButton()).toBeInTheDocument());
    expect(positionRequests).toBe(1);
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
  });

  it("offers a matching city, and a pick scopes the whole city and survives a reload", async () => {
    seedEverywhere();
    const user = userEvent.setup();
    await reachHome(user);

    await user.type(field(), "טבר");
    const row = await screen.findByRole("button", {
      name: `טבריה · ${he.search.cityCount(1)}`,
    });
    // Plain input, plain group: not a combobox, so no combobox attributes either.
    expect(field()).not.toHaveAttribute("aria-expanded");
    expect(field()).not.toHaveAttribute("aria-controls");
    // The class that places the menu is on it, and it hangs off the wrapper that owns it.
    const group = screen.getByRole("group", { name: he.search.suggestionsLabel });
    expect(group).toHaveClass("searchbar__menu");
    expect(group.parentElement).toHaveClass("searchbar__wrap");
    // Typing offered; it did not move anything.
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();

    await user.click(row);
    expect(field()).toHaveValue("");
    expect(menu()).toBeNull();
    expect(header().getByText(he.origin.searchingInCity)).toBeInTheDocument();
    expect(header().getByText("טבריה")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".card--grid").length).toBe(1));
    expect(screen.getByText(TIBERIAS_NAME)).toBeInTheDocument();
    // A city is not a centre: there is nothing to measure a radius from.
    expect(await radiusOffered(user)).toBe(false);

    cleanup();
    resetOriginState();
    mount();
    await screen.findAllByRole("button", { name: he.home.changeLocation });
    expect(header().getByText("טבריה")).toBeInTheDocument();
    expect(header().getByText(he.origin.searchingInCity)).toBeInTheDocument();
  });

  it("pins a picked Google place as the origin and names it in the header", async () => {
    seedEverywhere();
    suggestImpl = async () => [{ id: "p1", label: PLACE.label, resolve: async () => PLACE }];
    const user = userEvent.setup();
    await reachHome(user);

    await user.type(field(), "ביאליק");
    await user.click(await screen.findByRole("button", { name: new RegExp(PLACE.label) }));

    expect(field()).toHaveValue("");
    expect(menu()).toBeNull();
    expect(header().getByText(PLACE.label)).toBeInTheDocument();
    // A point has a radius to offer, which the city scope did not.
    expect(await radiusOffered(user)).toBe(true);
    expect(suggestCalls.length).toBeGreaterThan(0);
  });

  it("clears the refusal hint when a city is picked", async () => {
    seedEverywhere();
    stubGeolocation("deny");
    const user = userEvent.setup();
    await reachHome(user);
    await user.click(nearMe());
    await screen.findByText(he.origin.refused.denied);

    await user.type(field(), "טבר");
    await user.click(await screen.findByRole("button", { name: /טבריה/ }));
    expect(screen.queryByText(he.origin.refused.denied)).toBeNull();
  });

  it("lets a later pick win over a place whose lookup is still in flight", async () => {
    seedEverywhere();
    let finish!: () => void;
    const late = new Promise<Candidate>((resolve) => {
      finish = () => resolve(PLACE);
    });
    suggestImpl = async () => [{ id: "p1", label: "ירושלים, ישראל", resolve: () => late }];
    const user = userEvent.setup();
    await reachHome(user);

    await user.type(field(), "ירוש");
    await user.click(await screen.findByRole("button", { name: "ירושלים, ישראל" }));
    // The place is still resolving; the user picks the city instead.
    await user.click(await screen.findByRole("button", { name: /^ירושלים ·/ }));
    expect(header().getByText(he.origin.searchingInCity)).toBeInTheDocument();

    finish();
    await late;
    // The late answer finds it was superseded: the city stands.
    await waitFor(() => expect(header().getByText("ירושלים")).toBeInTheDocument());
    expect(header().queryByText(PLACE.label)).toBeNull();
    expect(header().getByText(he.origin.searchingInCity)).toBeInTheDocument();
  });

  it("closes on Escape and on the scrim, and reopens when typing resumes", async () => {
    seedEverywhere();
    const user = userEvent.setup();
    await reachHome(user);

    await user.type(field(), "טבר");
    await screen.findByRole("button", { name: /טבריה/ });
    await user.keyboard("{Escape}");
    expect(menu()).toBeNull();

    await user.type(field(), "י");
    await screen.findByRole("button", { name: /טבריה/ });
    await user.click(screen.getByRole("button", { name: he.origin.close }));
    expect(menu()).toBeNull();
    // Closing is not choosing: the typed text and the scope are untouched.
    expect(field()).toHaveValue("טברי");
    expect(header().getByText(he.origin.everywhere)).toBeInTheDocument();
  });

  it("offers a name search on home that goes to /search with the text", async () => {
    seedEverywhere();
    const user = userEvent.setup();
    await reachHome(user);

    await user.type(field(), "פיצה");
    await user.click(screen.getByRole("button", { name: he.search.searchNames("פיצה") }));

    // Search is the other screen with this bar: it carries the text over, and has no
    // name row of its own — it filters in place.
    await waitFor(() => expect(field()).toHaveValue("פיצה"));
    expect(screen.queryByRole("button", { name: he.search.searchNames("פיצה") })).toBeNull();
  });
});
