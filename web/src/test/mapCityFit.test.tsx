/**
 * The map's camera under a city scope: fit the city's pins, once, and not past street level.
 *
 * A city has no centre, so the camera-follows-origin effect has nothing to follow and a
 * map opened on a chosen city would sit wherever it was, over pins elsewhere. These pin
 * the other half: the viewport is fitted to the plotted pins when the city's results
 * arrive, a refilter of the same city leaves it alone, and a lone pin — which fits to
 * the deepest zoom the tiles allow — is pulled back to the zoom a pinned origin gets.
 *
 * Google is doubled with a map that only records what it was told. The marker library
 * is left empty on purpose: `map/pins.ts` never throws, so pins that cannot be built
 * are simply absent, and the camera logic under test does not depend on them.
 */

import { render, screen, waitFor } from "@testing-library/react";
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

const fakes = vi.hoisted(() => ({
  fitBounds: [] as unknown[][],
  zooms: [] as number[],
  zoomAfterFit: 18,
}));

vi.mock("../map/useGoogleMaps", async (importOriginal) => {
  class FakeMap {
    addListener(): void {}
    panTo(): void {}
    panBy(): void {}
    fitBounds(...args: unknown[]): void {
      fakes.fitBounds.push(args);
    }
    getZoom(): number {
      return fakes.zoomAfterFit;
    }
    setZoom(zoom: number): void {
      fakes.zooms.push(zoom);
    }
  }
  return {
    ...(await importOriginal<typeof import("../map/useGoogleMaps")>()),
    hasMapsKey: () => false,
    useGoogleMaps: () => ({
      status: "ready" as const,
      libs: { maps: { Map: FakeMap }, marker: {} },
    }),
  };
});

const he = STRINGS.he;

/** The single Tiberias fixture, at 32.7898 N 35.5401 E. */
const TIBERIAS = { lat: 32.7898, lon: 35.5401 };

function mountMap() {
  localStorage.setItem(
    "kashroot.origin.v1",
    JSON.stringify({ source: "city", slug: "tiberias", label: "טבריה" }),
  );
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

async function reachMap(user: ReturnType<typeof userEvent.setup>) {
  mountMap();
  await user.click(await screen.findByRole("link", { name: he.landing.cta }));
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  await user.click(await screen.findByRole("link", { name: he.nav.map }));
}

describe("map camera under a city scope", () => {
  afterEach(() => {
    fakes.fitBounds.length = 0;
    fakes.zooms.length = 0;
    fakes.zoomAfterFit = 18;
    vi.restoreAllMocks();
    clearOrigin();
    resetOriginState();
  });

  it("fits the city's pins once, caps a lone pin at street level, and ignores a refilter", async () => {
    // The empty marker library makes every pin fail, which `createPin` reports and
    // survives; the report is not what this test is about.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await reachMap(user);

    await waitFor(() => expect(fakes.fitBounds.length).toBe(1));
    expect(fakes.fitBounds[0]).toEqual([
      { north: TIBERIAS.lat, south: TIBERIAS.lat, east: TIBERIAS.lon, west: TIBERIAS.lon },
      48,
    ]);
    // One pin fits to the deepest zoom; the camera is pulled back to street level.
    expect(fakes.zooms).toEqual([14]);

    // Narrowing the same city with a query is the user's own doing: no second fit.
    await user.type(screen.getByRole("searchbox", { name: he.search.placeholder }), "האגם");
    await waitFor(() => expect(screen.getByText(he.map.pinsShown(1))).toBeInTheDocument());
    expect(fakes.fitBounds.length).toBe(1);
  });
});
