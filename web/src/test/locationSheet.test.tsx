/**
 * The home location control: pin or address -> sheet -> device, typed address, city.
 *
 * What matters here is that each of the three origins can actually be chosen and
 * that the header then names the place we are really measuring from — the header
 * and the search `center` must never disagree, because that is how a distance
 * becomes a lie. The refused-permission branch is covered too: refusing is a
 * legitimate answer, so the app states it once and keeps working from the city.
 *
 * The geocoder is mocked. It is Google's network call, not ours; what is tested is
 * what the sheet does with an answer, with no answer, and with a failure.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { STRINGS } from "../i18n/strings";
import { ThemeProvider } from "../theme/ThemeProvider";
import { clearOrigin } from "../location/useOrigin";

type Candidates = Array<{ label: string; point: { lat: number; lon: number } }>;

/**
 * A hand-rolled double rather than `vi.fn`: the spy wrapper re-raises a rejected
 * result on its own promise chain, which the runner then reports as an unhandled
 * error even though the sheet caught it. Calls are recorded here instead.
 */
const geocodeCalls: Array<[string, string]> = [];
let geocodeImpl: (query: string) => Promise<Candidates> = async () => [];

vi.mock("../map/useGoogleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../map/useGoogleMaps")>()),
  // The address field is only drawn when a geocoder is reachable, so the tests that
  // exercise it must say one is.
  hasMapsKey: () => true,
  geocodeAddress: (query: string, lang: "he" | "en") => {
    geocodeCalls.push([query, lang]);
    return geocodeImpl(query);
  },
}));

const he = STRINGS.he;

/** Ramat Gan — far enough from Jerusalem that nothing could mistake the two. */
const CANDIDATE = { label: "ביאליק 1, רמת גן", point: { lat: 32.0684, lon: 34.8248 } };

type User = ReturnType<typeof userEvent.setup>;

function renderApp() {
  localStorage.setItem("kashroot.city", "jerusalem");
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

/** Through onboarding to home, the way the demo gets there. */
async function reachHome(user: User) {
  renderApp();
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  await screen.findByText(he.home.nearYou);
}

async function openSheet(user: User) {
  await user.click(screen.getAllByRole("button", { name: he.home.changeLocation })[0]!);
  return screen.findByRole("dialog", { name: he.origin.title });
}

async function pickAddress(user: User, typed: string) {
  await user.type(screen.getByLabelText(he.origin.addressLabel), typed);
  await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));
  await user.click(await screen.findByRole("button", { name: new RegExp(CANDIDATE.label) }));
}

/** A geolocation that answers however the test wants it to. */
function stubGeolocation(behaviour: "grant" | "deny") {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
        behaviour === "grant"
          ? ok({ coords: { latitude: 31.78, longitude: 35.21 } } as GeolocationPosition)
          : fail({ code: 1, message: "denied" } as GeolocationPositionError),
    },
  });
}

describe("home location sheet", () => {
  afterEach(() => {
    geocodeCalls.length = 0;
    geocodeImpl = async () => [];
    // The origin is process-wide by design, so it has to be put back between tests.
    clearOrigin();
    Reflect.deleteProperty(navigator, "geolocation");
  });

  it("opens from the pin and offers both origins a person names themselves", async () => {
    const user = userEvent.setup();
    await reachHome(user);
    const sheet = await openSheet(user);

    expect(
      within(sheet).getByRole("button", { name: he.origin.useMyLocation }),
    ).toBeInTheDocument();
    expect(within(sheet).getByLabelText(he.origin.addressLabel)).toBeInTheDocument();
    // Cities are a filter, not an origin, and are not repeated here.
    expect(within(sheet).queryByRole("button", { name: "ירושלים" })).toBeNull();
  });

  it("opens from the address in the header too — the two are one control", async () => {
    const user = userEvent.setup();
    await reachHome(user);
    const openers = screen.getAllByRole("button", { name: he.home.changeLocation });
    expect(openers).toHaveLength(2);
    await user.click(openers[1]!);
    expect(await screen.findByRole("dialog", { name: he.origin.title })).toBeInTheDocument();
  });

  it("measures from a typed address once one of its candidates is picked", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");

    // Sheet closed, and the header now names the place the search runs from.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(CANDIDATE.label)).toBeInTheDocument();
    expect(geocodeCalls).toEqual([["ביאליק 1", "he"]]);
  });

  it("says an address was not found without pretending the lookup broke", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [];
    await reachHome(user);
    await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "אין כזו כתובת");
    await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));

    expect(await screen.findByText(he.origin.noResults)).toBeInTheDocument();
    expect(screen.queryByText(he.origin.lookupFailed)).toBeNull();
  });

  it("says the lookup itself failed when it did, and stays open to be retried", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => {
      throw new Error("quota");
    };
    await reachHome(user);
    const sheet = await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "דיזנגוף");
    await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));

    expect(await screen.findByText(he.origin.lookupFailed)).toBeInTheDocument();
    expect(within(sheet).getByLabelText(he.origin.addressLabel)).toBeInTheDocument();
  });

  it("measures from the device when the user allows it", async () => {
    const user = userEvent.setup();
    stubGeolocation("grant");
    await reachHome(user);
    await openSheet(user);

    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(he.map.youAreHere)).toBeInTheDocument();
  });

  it("treats a refusal as an answer, not an error, and stays on the city centre", async () => {
    const user = userEvent.setup();
    stubGeolocation("deny");
    await reachHome(user);
    await openSheet(user);

    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));

    expect(await screen.findByText(he.origin.denied)).toBeInTheDocument();
    // Still the city, and the sheet stayed open so another way can be chosen.
    expect(screen.getByRole("dialog", { name: he.origin.title })).toBeInTheDocument();
    expect(screen.getByText("ירושלים · בית וגן")).toBeInTheDocument();
  });

  /**
   * The city moved off the sheet, but it is still the same question, so picking one
   * anywhere — here, the filters screen — has to drop a pinned address. Two answers
   * cannot both be live: the header would name one place and the results come from
   * another.
   */
  it("drops a pinned address when a city is picked elsewhere", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");
    expect(await screen.findByText(CANDIDATE.label)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: he.home.openFilters }));
    await user.click(await screen.findByRole("button", { name: "חיפה" }));
    await user.click(screen.getByRole("link", { name: he.nav.home }));

    expect(await screen.findByText("חיפה · הדר")).toBeInTheDocument();
    expect(screen.queryByText(CANDIDATE.label)).toBeNull();
  });
});
