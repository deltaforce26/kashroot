import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchRequest } from "../api/types";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { EMPTY_PROFILE } from "../profile/profile";
import { Home } from "../views/Home";

const mocks = vi.hoisted(() => ({
  requests: [] as SearchRequest[],
  fetchSuggestions: vi.fn(),
  libs: null as unknown as {
    places: {
      AutocompleteSuggestion: { fetchAutocompleteSuggestions: ReturnType<typeof vi.fn> };
      AutocompleteSessionToken: new () => object;
    };
  },
}));

vi.mock("../hooks/useApi", () => ({
  isNetworkError: () => false,
  useSearch: (request: SearchRequest) => {
    mocks.requests.push(request);
    return { data: { items: [], total: 0 }, loading: false, error: null, reload: vi.fn() };
  },
}));

vi.mock("../profile/ProfileProvider", () => ({ useProfile: () => ({ profile: EMPTY_PROFILE }) }));
vi.mock("../saved/useSaveToggle", () => ({
  useSaveToggle: () => ({ toggle: vi.fn(), isSaved: () => false }),
}));
vi.mock("../map/useGoogleMaps", () => ({
  useGooglePlaces: () => ({
    status: "ready",
    libs: mocks.libs,
  }),
}));

function renderHome() {
  return render(
    <I18nProvider>
      <MemoryRouter><Home /></MemoryRouter>
    </I18nProvider>,
  );
}

const he = STRINGS.he;

describe("home location picker", () => {
  beforeEach(() => {
    mocks.requests.length = 0;
    mocks.fetchSuggestions.mockReset();
    mocks.fetchSuggestions.mockResolvedValue({ suggestions: [] });
    mocks.libs = {
      places: {
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: mocks.fetchSuggestions },
        AutocompleteSessionToken: class {},
      },
    };
  });

  it("opens the same accessible picker from both the pin and address controls", async () => {
    const user = userEvent.setup();
    renderHome();
    const triggers = screen.getAllByRole("button", { name: he.locationPicker.open });
    expect(triggers).toHaveLength(2);

    await user.click(triggers[0] as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: he.locationPicker.title });
    expect(dialog).toBeInTheDocument();
    const close = within(dialog).getByRole("button", { name: he.locationPicker.close });
    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(dialog).getByRole("button", { name: "טבריה" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(close);
    await waitFor(() => expect(triggers[0]).toHaveFocus());
    await user.click(triggers[1] as HTMLElement);
    expect(screen.getByRole("dialog", { name: he.locationPicker.title })).toBeInTheDocument();
  });

  it("uses a selected typed address as the Home search center without persisting it", async () => {
    const place = {
      formattedAddress: "1 Jaffa Street, Jerusalem",
      location: { lat: () => 31.781, lng: () => 35.22 },
      fetchFields: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { placeId: "jaffa", text: { text: "Jaffa Street" }, toPlace: () => place } }],
    });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.type(screen.getByLabelText(he.locationPicker.addressLabel), "Jaffa");
    await screen.findByRole("option", { name: "Jaffa Street" });
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      const latest = mocks.requests.at(-1);
      expect(latest?.center).toEqual({ lat: 31.781, lon: 35.22 });
    });
    expect(screen.getByText("1 Jaffa Street, Jerusalem")).toBeInTheDocument();
    expect(localStorage.getItem("kashroot.origin")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("shows Google attribution and replaces stale predictions when the query changes", async () => {
    mocks.fetchSuggestions
      .mockResolvedValueOnce({ suggestions: [{ placePrediction: { placeId: "old", text: { text: "Old address" } } }] })
      .mockResolvedValueOnce({ suggestions: [{ placePrediction: { placeId: "new", text: { text: "New address" } } }] });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    const input = screen.getByRole("combobox", { name: he.locationPicker.addressLabel });
    await user.type(input, "Old");
    expect(await screen.findByRole("option", { name: "Old address" })).toBeInTheDocument();
    expect(screen.getByLabelText("Google Maps")).toHaveTextContent("Google Maps");
    expect(screen.getByRole("option", { name: "Old address" })).toHaveAttribute("tabindex", "-1");
    await user.clear(input);
    expect(screen.queryByRole("option", { name: "Old address" })).toBeNull();
    await user.type(input, "New");
    expect(await screen.findByRole("option", { name: "New address" })).toBeInTheDocument();
    expect(mocks.fetchSuggestions.mock.calls.at(-1)?.[0]).toMatchObject({
      locationBias: { center: expect.any(Object), radius: 50_000 },
      sessionToken: expect.any(Object),
    });
    expect(mocks.fetchSuggestions.mock.calls.at(-1)?.[0]).not.toHaveProperty("origin");
  });

  it("resets a session address when an explicit city shortcut is chosen", async () => {
    const place = {
      formattedAddress: "1 Jaffa Street, Jerusalem",
      location: { lat: () => 31.781, lng: () => 35.22 },
      fetchFields: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { placeId: "jaffa", text: { text: "Jaffa Street" }, toPlace: () => place } }],
    });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.type(screen.getByRole("combobox"), "Jaffa");
    await user.click(await screen.findByRole("option", { name: "Jaffa Street" }));
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "חיפה" }));
    await waitFor(() => expect(mocks.requests.at(-1)?.center).toEqual({ lat: 32.8082, lon: 34.9896 }));
  });

  it("asks for browser location only after the button is pressed and handles success", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    const user = userEvent.setup();
    renderHome();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const success = getCurrentPosition.mock.calls[0]?.[0];
    success({ coords: { latitude: 32.1, longitude: 34.8 } });
    await waitFor(() => expect(mocks.requests.at(-1)?.center).toEqual({ lat: 32.1, lon: 34.8 }));
  });

  it("keeps the city fallback and explains denied location access", async () => {
    const getCurrentPosition = vi.fn((_success, failure) =>
      failure({ code: 1, PERMISSION_DENIED: 1 }),
    );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    expect(await screen.findByRole("alert")).toHaveTextContent(he.locationPicker.locationDenied);
    expect(screen.getByRole("group", { name: he.locationPicker.cityFallback })).toBeInTheDocument();
  });

  it("ignores a pending geolocation callback after the picker is dismissed", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: he.origin.useMyLocation }));
    await user.click(screen.getByRole("button", { name: he.locationPicker.close }));
    getCurrentPosition.mock.calls[0]?.[0]({ coords: { latitude: 1, longitude: 2 } });
    await waitFor(() => expect(mocks.requests.at(-1)?.center).toEqual({ lat: 31.7649, lon: 35.1846 }));
  });

  it("ignores place details that finish after the picker is dismissed", async () => {
    let finishDetails: (() => void) | undefined;
    const place = {
      formattedAddress: "Late address",
      location: { lat: () => 1, lng: () => 2 },
      fetchFields: vi.fn(() => new Promise<void>((resolve) => { finishDetails = resolve; })),
    };
    mocks.fetchSuggestions.mockResolvedValue({
      suggestions: [{ placePrediction: { placeId: "late", text: { text: "Late address" }, toPlace: () => place } }],
    });
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getAllByRole("button", { name: he.locationPicker.open })[0] as HTMLElement);
    await user.type(screen.getByRole("combobox"), "Late");
    await user.click(await screen.findByRole("option", { name: "Late address" }));
    await user.click(screen.getByRole("button", { name: he.locationPicker.close }));
    finishDetails?.();
    await waitFor(() => expect(mocks.requests.at(-1)?.center).toEqual({ lat: 31.7649, lon: 35.1846 }));
  });
});
