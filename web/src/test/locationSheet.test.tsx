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
import { clearOrigin, resetOriginState } from "../location/useOrigin";
import { useCity } from "../location/useCity";

type Candidates = Array<{ label: string; point: { lat: number; lon: number } }>;

/**
 * A hand-rolled double rather than `vi.fn`: the spy wrapper re-raises a rejected
 * result on its own promise chain, which the runner then reports as an unhandled
 * error even though the sheet caught it. Calls are recorded here instead.
 */
const geocodeCalls: Array<[string, string]> = [];
let geocodeImpl: (query: string) => Promise<Candidates> = async () => [];

/** The as-you-type completions, doubled the same way and for the same reason. */
type Suggestions = Array<{
  id: string;
  label: string;
  resolve: () => Promise<Candidates[number]>;
}>;
const suggestCalls: string[] = [];
let suggestImpl: (query: string) => Promise<Suggestions> = async () => [];

vi.mock("../map/useGoogleMaps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../map/useGoogleMaps")>()),
  // The address field is only drawn when a geocoder is reachable, so the tests that
  // exercise it must say one is.
  hasMapsKey: () => true,
  geocodeAddress: (query: string, lang: "he" | "en") => {
    geocodeCalls.push([query, lang]);
    return geocodeImpl(query);
  },
  suggestAddresses: (query: string) => {
    suggestCalls.push(query);
    return suggestImpl(query);
  },
}));

const he = STRINGS.he;

/** Ramat Gan — far enough from Jerusalem that nothing could mistake the two. */
const CANDIDATE = { label: "ביאליק 1, רמת גן", point: { lat: 32.0684, lon: 34.8248 } };

type User = ReturnType<typeof userEvent.setup>;

function renderApp() {
  localStorage.setItem("kashroot.city", "jerusalem");
  return mount();
}

/**
 * The app no longer draws a city switcher (the chips row came off search), but a
 * city can still change under a pinned address — via a deep link, a future picker,
 * or the empty-city recovery button. This stands in for that: a bare button that
 * takes the same `setSlug` path any of them would.
 */
function CitySwitch({ slug, label }: { slug: string; label: string }) {
  const { setSlug } = useCity();
  return (
    <button type="button" onClick={() => setSlug(slug)}>
      {label}
    </button>
  );
}

/** A render that seeds nothing, so a reload sees exactly what the last one left. */
function mount() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ProfileProvider>
          <SavedProvider>
            <MemoryRouter initialEntries={["/"]}>
              <App />
              <CitySwitch slug="haifa" label="חיפה" />
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

/** How many times the device position was actually asked for. */
let positionRequests = 0;

/**
 * A geolocation that answers however the test wants it to. `grant-once` answers the
 * first request and fails every one after it — a device that gave a fix and then went
 * quiet, which is the shape of a timeout on a retry.
 */
function stubGeolocation(behaviour: "grant" | "deny" | "grant-once") {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => {
        positionRequests += 1;
        const grants = behaviour === "grant" || (behaviour === "grant-once" && positionRequests === 1);
        return grants
          ? ok({ coords: { latitude: 31.78, longitude: 35.21 } } as GeolocationPosition)
          : fail({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    },
  });
}

/** The standing permission answer, which the reload path reads instead of asking. */
function stubPermissions(state: PermissionState) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => ({ state }) as PermissionStatus },
  });
}

/**
 * A refresh. Unmounts, then forgets the module-level origin the way a real reload
 * would — storage is left alone, since that is the thing under test.
 */
async function reload() {
  cleanup();
  resetOriginState();
  mount();
  await screen.findByText(he.home.nearYou);
}

describe("home location sheet", () => {
  afterEach(() => {
    geocodeCalls.length = 0;
    geocodeImpl = async () => [];
    suggestCalls.length = 0;
    suggestImpl = async () => [];
    positionRequests = 0;
    // The origin is process-wide by design, so it has to be put back between tests,
    // in storage as well as in memory.
    clearOrigin();
    resetOriginState();
    Reflect.deleteProperty(navigator, "geolocation");
    Reflect.deleteProperty(navigator, "permissions");
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
    // It drops from the top rather than rising from the bottom, so it lands on the
    // header control that asked. jsdom lays nothing out; the modifier is the guarantee.
    expect(sheet).toHaveClass("sheet--top");
  });

  /**
   * React cannot animate a node it has already removed, so the sheet has to outlive
   * the click that dismissed it: `close` only marks it as leaving, and the unmount
   * waits out the exit. The failure this guards is the obvious refactor — wiring the
   * X straight back to `onClose` — which looks right and silently drops the exit.
   */
  it("plays its exit out before it leaves, rather than vanishing on the click", async () => {
    const user = userEvent.setup();
    await reachHome(user);
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("button", { name: he.origin.close }));
    expect(sheet).toHaveClass("sheet--leaving");
    expect(sheet).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("offers completions while the address is still being typed", async () => {
    const user = userEvent.setup();
    suggestImpl = async () => [{ id: "p1", label: CANDIDATE.label, resolve: async () => CANDIDATE }];
    await reachHome(user);
    await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "ביאל");

    const list = await screen.findByRole("list", { name: he.origin.suggestions });
    expect(within(list).getByRole("button", { name: new RegExp(CANDIDATE.label) })).toBeInTheDocument();
    // Nothing was submitted: the geocoder was not asked, and the pause was one request.
    expect(geocodeCalls).toEqual([]);
    expect(suggestCalls).toEqual(["ביאל"]);
  });

  it("measures from a completion once it is picked", async () => {
    const user = userEvent.setup();
    suggestImpl = async () => [{ id: "p1", label: CANDIDATE.label, resolve: async () => CANDIDATE }];
    await reachHome(user);
    await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "ביאל");
    await user.click(await screen.findByRole("button", { name: new RegExp(CANDIDATE.label) }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(CANDIDATE.label)).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.origin.v1")).toContain(CANDIDATE.label);
  });

  /**
   * Answers come back in whatever order the network likes. A slow answer to "די" that
   * lands after the answer to "דיזנ" would put completions on screen for text the
   * field no longer holds.
   */
  it("does not let a slow earlier answer replace a later one", async () => {
    const user = userEvent.setup();
    let releaseFirst: (items: Suggestions) => void = () => {};
    suggestImpl = (query) =>
      query === "די"
        ? new Promise<Suggestions>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve([{ id: "late", label: "דיזנגוף, תל אביב", resolve: async () => CANDIDATE }]);
    await reachHome(user);
    await openSheet(user);
    const field = screen.getByLabelText(he.origin.addressLabel);

    await user.type(field, "די");
    await waitFor(() => expect(suggestCalls).toEqual(["די"]));
    await user.type(field, "זנ");
    await screen.findByRole("button", { name: /דיזנגוף, תל אביב/ });

    releaseFirst([{ id: "early", label: "דימונה", resolve: async () => CANDIDATE }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("button", { name: /דימונה/ })).toBeNull();
    expect(screen.getByRole("button", { name: /דיזנגוף, תל אביב/ })).toBeInTheDocument();
  });

  /**
   * Completions are a courtesy. With Places unreachable the field must behave as it
   * did before it had any — quiet while typing, and still answering on submit.
   */
  it("stays quiet when completions fail, and still answers a submitted address", async () => {
    const user = userEvent.setup();
    suggestImpl = async () => {
      throw new Error("places not enabled");
    };
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "ביאליק 1");
    await waitFor(() => expect(suggestCalls.length).toBeGreaterThan(0));
    expect(screen.queryByText(he.origin.lookupFailed)).toBeNull();
    expect(screen.queryByText(he.origin.noResults)).toBeNull();

    await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));
    await user.click(await screen.findByRole("button", { name: new RegExp(CANDIDATE.label) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(CANDIDATE.label)).toBeInTheDocument();
  });

  it("says so when a picked completion cannot be turned into a place", async () => {
    const user = userEvent.setup();
    suggestImpl = async () => [
      {
        id: "p1",
        label: CANDIDATE.label,
        resolve: async () => {
          throw new Error("offline");
        },
      },
    ];
    await reachHome(user);
    const sheet = await openSheet(user);

    await user.type(screen.getByLabelText(he.origin.addressLabel), "ביאל");
    await user.click(await screen.findByRole("button", { name: new RegExp(CANDIDATE.label) }));

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
   * A request that fails says nothing about where the user is: the fix from a minute
   * ago is still good. Falling back to the city on a timeout would move every screen —
   * the map camera with them — because one attempt did not come back.
   */
  it("keeps the last device position when a later attempt fails", async () => {
    const user = userEvent.setup();
    stubGeolocation("grant-once");
    await reachHome(user);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    await screen.findByText(he.map.youAreHere);

    await openSheet(user);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));

    // Said out loud — a refresh that did not happen is not the same as no position.
    expect(await screen.findByText(he.origin.notRefreshed)).toBeInTheDocument();
    expect(screen.queryByText(he.origin.denied)).toBeNull();
    // Still measuring from the device, in memory and in storage.
    expect(screen.getByText(he.map.youAreHere)).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.origin.v1")).toContain("device");
  });

  /** Same courtesy for someone who only tried the shortcut: their address stands. */
  it("keeps a pinned address when the device cannot be reached", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    stubGeolocation("deny");
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");
    await screen.findByText(CANDIDATE.label);

    await openSheet(user);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));

    expect(await screen.findByText(he.origin.denied)).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.label)).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.origin.v1")).toContain(CANDIDATE.label);
  });

  /**
   * The city moved off the sheet, but it is still the same question, so picking one
   * anywhere — here, the search screen's city chips — has to drop a pinned address.
   * Two answers cannot both be live: the header would name one place and the results
   * come from another.
   */
  it("drops a pinned address when a city is picked elsewhere", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");
    expect(await screen.findByText(CANDIDATE.label)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "חיפה" }));

    expect(await screen.findByText("חיפה · הדר")).toBeInTheDocument();
    expect(screen.queryByText(CANDIDATE.label)).toBeNull();
  });

  /**
   * Home and map measure from the origin, but search is scoped by city. Pinning an
   * address in another city has to move the city too, or search keeps looking in
   * the city the app opened on while the header over it names the new address.
   */
  it("moves the search city to the pinned address", async () => {
    const user = userEvent.setup();
    const beitShemesh = { label: "נחל שורק 1, בית שמש", point: { lat: 31.7497, lon: 34.9887 } };
    geocodeImpl = async () => [beitShemesh];
    await reachHome(user);
    await openSheet(user);
    await user.type(screen.getByLabelText(he.origin.addressLabel), "נחל שורק 1");
    await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));
    await user.click(await screen.findByRole("button", { name: new RegExp(beitShemesh.label) }));
    expect(await screen.findByText(beitShemesh.label)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: he.nav.search }));
    expect(await screen.findByText("בית שמש")).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.city")).toBe("beit-shemesh");
  });

  /**
   * An address outside every covered city must not be answered for the nearest city
   * we do know. Home and search both say the corpus has nothing there yet, the
   * header names the place the user actually typed, and the stored city is left as
   * it was rather than snapped to a neighbour.
   */
  it("says there is nothing yet near an address outside every covered city", async () => {
    const user = userEvent.setup();
    const ashdod = { label: "רוגוזין 1, אשדוד", point: { lat: 31.8014, lon: 34.6435 } };
    geocodeImpl = async () => [ashdod];
    await reachHome(user);
    await openSheet(user);
    await user.type(screen.getByLabelText(he.origin.addressLabel), "רוגוזין 1");
    await user.click(screen.getByRole("button", { name: he.origin.addressSubmit }));
    await user.click(await screen.findByRole("button", { name: new RegExp(ashdod.label) }));

    expect(await screen.findByText(he.states.outsideTitle(ashdod.label))).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.city")).toBe("jerusalem");

    await user.click(screen.getByRole("button", { name: he.nav.search }));
    expect(await screen.findByText(he.states.outsideTitle(ashdod.label))).toBeInTheDocument();
    expect(screen.getByText(ashdod.label)).toBeInTheDocument();
    expect(screen.queryByText("ירושלים")).toBeNull();
  });

  /**
   * A refresh that silently returns to the city centre reports distances from a
   * place the user did not pick, which is the same lie as a wrong distance.
   */
  it("still measures from the pinned address after a reload", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");
    expect(await screen.findByText(CANDIDATE.label)).toBeInTheDocument();

    await reload();

    expect(screen.getByText(CANDIDATE.label)).toBeInTheDocument();
    expect(screen.queryByText("ירושלים · בית וגן")).toBeNull();
  });

  it("drops the pinned address for good once the city takes over", async () => {
    const user = userEvent.setup();
    geocodeImpl = async () => [CANDIDATE];
    await reachHome(user);
    await openSheet(user);
    await pickAddress(user, "ביאליק 1");
    expect(await screen.findByText(CANDIDATE.label)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "חיפה" }));
    await reload();

    expect(screen.getByText("חיפה · הדר")).toBeInTheDocument();
    expect(screen.queryByText(CANDIDATE.label)).toBeNull();
  });

  /**
   * The device is remembered as a *choice*, never as a position: coordinates are
   * not written to storage, and the reload re-acquires them from a permission that
   * is already standing — so the header comes back right without a prompt.
   */
  it("restores the device origin without storing coordinates", async () => {
    const user = userEvent.setup();
    stubGeolocation("grant");
    stubPermissions("granted");
    await reachHome(user);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    await screen.findByText(he.map.youAreHere);

    const stored = localStorage.getItem("kashroot.origin.v1") ?? "";
    expect(stored).toContain("device");
    expect(stored).not.toContain("31.78");
    expect(stored).not.toContain("35.21");

    await reload();

    expect(await screen.findByText(he.map.youAreHere)).toBeInTheDocument();
  });

  /**
   * Permission withdrawn between visits: the marker is worthless, and asking again
   * unprompted is exactly the nagging the sheet exists to avoid.
   */
  it("falls back to the city, silently, when the permission no longer stands", async () => {
    const user = userEvent.setup();
    stubGeolocation("grant");
    stubPermissions("granted");
    await reachHome(user);
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    await screen.findByText(he.map.youAreHere);

    stubPermissions("prompt");
    positionRequests = 0;
    await reload();

    expect(await screen.findByText("ירושלים · בית וגן")).toBeInTheDocument();
    expect(positionRequests).toBe(0);
    // Nobody asked, so nobody is told it failed.
    expect(screen.queryByText(he.origin.denied)).toBeNull();
    // The marker is dropped rather than left to fail the same way every load.
    await waitFor(() => expect(localStorage.getItem("kashroot.origin.v1")).toBeNull());
  });
});
