/**
 * The browse grid tile (handoff 1c): branch disambiguation, the lazily fetched
 * Google photo with its credit, and the heart save toggle.
 *
 * Two branches of one chain must not read as a duplicate on the home grid.
 *
 * The seed corpus holds chains as one Restaurant per address (dedupe key is
 * name + city + address), so a Bnei Brak search legitimately returns "טייסטי מיט"
 * twice. The grid tile is the only card shape that used to omit the address; these
 * tests pin the street (or city) onto it so the two tiles stay distinguishable.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { PlacesView, ResultView } from "../api/viewmodel";
import { RestaurantGridCard } from "../components/RestaurantCard";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";

const he = STRINGS.he;

function renderHe(node: ReactNode) {
  return render(
    <I18nProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );
}

function view(overrides: Partial<ResultView>): ResultView {
  return {
    id: "r1",
    nameHe: "טייסטי מיט",
    nameEn: "Tasty Meat",
    cityHe: "בני ברק",
    addressHe: "הרב קוק 4",
    geo: null,
    distanceKm: 2.6,
    kashrut: {
      verdict: "match",
      reasons: [],
      confidence: "high",
      freshness: null,
      deciding_certificate_id: null,
    },
    fit: { score: 0, components: [] },
    certifiers: [],
    decidingCertifier: null,
    dietType: "meat",
    priceLevel: null,
    isOpenNow: null,
    closesAt: null,
    ...overrides,
  };
}

const noop = () => {};

describe("RestaurantGridCard branches", () => {
  it("shows each branch's street so same-name tiles are distinguishable", () => {
    renderHe(
      <>
        <RestaurantGridCard item={view({ id: "a" })} saved={false} onToggleSave={noop} />
        <RestaurantGridCard
          item={view({ id: "b", cityHe: "רמת גן", addressHe: "חיבת ציון 45", distanceKm: 3.5 })}
          saved={false}
          onToggleSave={noop}
        />
      </>,
    );
    expect(screen.getAllByText("טייסטי מיט")).toHaveLength(2);
    expect(screen.getByText("הרב קוק 4")).toBeInTheDocument();
    expect(screen.getByText("חיבת ציון 45")).toBeInTheDocument();
  });

  it("falls back to the city when the record has no street", () => {
    renderHe(
      <RestaurantGridCard
        item={view({ addressHe: null, cityHe: "רמת גן" })}
        saved={false}
        onToggleSave={noop}
      />,
    );
    expect(screen.getByText("רמת גן")).toBeInTheDocument();
  });

  it("renders no empty line when neither street nor city is known", () => {
    const { container } = renderHe(
      <RestaurantGridCard
        item={view({ addressHe: null, cityHe: null })}
        saved={false}
        onToggleSave={noop}
      />,
    );
    expect(container.querySelector(".card__where")).toBeNull();
  });

  it("keeps the diet and distance on their own line, ahead of the address", () => {
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    const metas = Array.from(container.querySelectorAll(".card__meta")).map(
      (el) => el.textContent ?? "",
    );
    expect(metas).toHaveLength(2);
    expect(metas[0]).toContain("2.6");
    expect(metas[0]).not.toContain("הרב קוק");
    expect(metas[1]).toBe("הרב קוק 4");
  });
});

/**
 * An IntersectionObserver that reports every observed tile as on screen at once —
 * jsdom has none, and without one the tile deliberately never fetches.
 */
class OnScreenObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function places(photos: PlacesView["photos"]): PlacesView {
  return { placeIdKnown: true, photos, hours: null };
}

const ONE_PHOTO = places([
  {
    index: 0,
    url: "/v1/restaurants/r1/photos/0?w=800",
    attributions: [{ display_name: "Dana K.", uri: null }],
  },
]);

describe("RestaurantGridCard photo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not fetch, and draws no photo area, without an IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const spy = vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockResolvedValue(ONE_PHOTO);
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector(".tile__photo")).toBeNull();
    expect(container.querySelector(".verdict")).not.toBeNull();
  });

  it("hides the photo area entirely when Places has no photo", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    const spy = vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockResolvedValue(places([]));
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    await waitFor(() => expect(spy).toHaveBeenCalledWith("r1", expect.anything()));
    expect(container.querySelector(".tile__photo")).toBeNull();
    expect(container.querySelector(".card--bare")).not.toBeNull();
    expect(container.querySelector(".verdict")).not.toBeNull();
  });

  it("shows the first photo at tile width with the photographer's credit", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockResolvedValue(ONE_PHOTO);
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    expect(await screen.findByText("Dana K. · Google")).toBeInTheDocument();
    const img = container.querySelector<HTMLImageElement>(".tile__photo img");
    expect(img?.getAttribute("src")).toBe("/v1/restaurants/r1/photos/0?w=680");
    // Transparent until it loads, so the tinted ground shows instead of a spinner.
    expect(img?.classList.contains("tile__img--in")).toBe(false);
    fireEvent.load(img as HTMLImageElement);
    expect(img?.classList.contains("tile__img--in")).toBe(true);
  });

  it("takes the photo area away again when the image fails to load", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockResolvedValue(ONE_PHOTO);
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    await screen.findByText("Dana K. · Google");
    fireEvent.error(container.querySelector(".tile__photo img") as HTMLImageElement);
    expect(container.querySelector(".tile__photo")).toBeNull();
    expect(screen.queryByText("Dana K. · Google")).toBeNull();
  });

  it("keeps the verdict when the Places request fails", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockRejectedValue(new Error("boom"));
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(container.querySelector(".tile__photo")).toBeNull();
    expect(container.querySelector(".verdict--match")).not.toBeNull();
  });

  it("renders no rating or star — the verdict is never shown as one", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    vi.spyOn(api.kashrootApi, "getRestaurantPlaces").mockResolvedValue(ONE_PHOTO);
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    await screen.findByText("Dana K. · Google");
    expect(container.textContent).not.toMatch(/[★☆⭐]/);
    expect(container.querySelector(".tile__meta")?.textContent).toMatch(/^[^·]+ · [^·]+$/);
  });
});

describe("RestaurantGridCard heart", () => {
  function renderRouted(node: ReactNode) {
    return render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={node} />
            <Route path="/r/:id" element={<p>detail page</p>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
  }

  it("toggles the save without following the tile's link", async () => {
    const user = userEvent.setup();
    const onToggleSave = vi.fn();
    const item = view({});
    renderRouted(<RestaurantGridCard item={item} saved={false} onToggleSave={onToggleSave} />);

    const heart = screen.getByRole("button", { name: he.restaurant.save });
    // A real sibling of the stretched link, never a descendant of it.
    expect(heart.closest("a")).toBeNull();
    await user.click(heart);
    expect(onToggleSave).toHaveBeenCalledWith(item);
    expect(screen.queryByText("detail page")).toBeNull();
  });

  it("reports the saved state through aria-pressed and a filled heart", () => {
    const { rerender } = renderRouted(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    const heart = screen.getByRole("button", { name: he.restaurant.save });
    expect(heart).toHaveAttribute("aria-pressed", "false");
    expect(heart.querySelector("svg")?.getAttribute("fill")).toBe("none");

    rerender(
      <I18nProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={<RestaurantGridCard item={view({})} saved onToggleSave={noop} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const pressed = screen.getByRole("button", { name: he.restaurant.saved });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("still links the whole tile to the restaurant", async () => {
    const user = userEvent.setup();
    renderRouted(<RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />);
    await user.click(screen.getByRole("link", { name: "טייסטי מיט" }));
    expect(screen.getByText("detail page")).toBeInTheDocument();
  });
});
