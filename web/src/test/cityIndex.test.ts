/**
 * The city scope's client core: the suggestion matcher, the directory-backed index,
 * the origin hook's third kind ("city"), and the request fragment it produces.
 *
 * What matters: a city is a scope and never a centre — setting one leaves `origin`
 * null and stores slug and label only; it survives a reload the way an address does;
 * a refused device request leaves it standing; and a search never carries a point and
 * a city together. The matcher is plain trim/lowercase/prefix/substring — no fuzzy
 * matching, no Hebrew normalisation — because the server's own `query` is no better
 * and the UI must not imply otherwise.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kashrootApi } from "../api";
import type { DirectoryView } from "../api/viewmodel";
import { scopeFragment, scopeLabel } from "../location/searchScope";
import {
  type CityOption,
  matchCities,
  resetCityIndex,
  useCityIndex,
} from "../location/useCityIndex";
import { clearOrigin, resetOriginState, restoreOrigin, useOrigin } from "../location/useOrigin";

const ORIGIN_KEY = "kashroot.origin.v1";

const CITIES: CityOption[] = [
  { slug: "jerusalem", labelHe: "ירושלים", labelEn: "Jerusalem", count: 8 },
  { slug: "bnei-brak", labelHe: "בני ברק", labelEn: "Bnei Brak", count: 2 },
  { slug: "beer-sheva", labelHe: "באר שבע", labelEn: "Beer Sheva", count: 1 },
  { slug: "new-jerusalem", labelHe: "ירושלים החדשה", labelEn: null, count: 1 },
  { slug: "tiberias", labelHe: "טבריה", labelEn: "Tiberias", count: 1 },
];

describe("matchCities", () => {
  it("returns prefix matches before substring matches", () => {
    // "Jerusalem" starts with "jer"; "New Jerusalem" only contains it.
    const cities: CityOption[] = [
      { slug: "new-jerusalem", labelHe: "ירושלים החדשה", labelEn: "New Jerusalem", count: 9 },
      ...CITIES.slice(0, 1),
    ];
    expect(matchCities(cities, "jer").map((c) => c.slug)).toEqual(["jerusalem", "new-jerusalem"]);
  });

  it("matches the Hebrew name, the English name, and either spelling's substring", () => {
    expect(matchCities(CITIES, "בני").map((c) => c.slug)).toEqual(["bnei-brak"]);
    expect(matchCities(CITIES, "BRAK").map((c) => c.slug)).toEqual(["bnei-brak"]);
    expect(matchCities(CITIES, "  tiber  ").map((c) => c.slug)).toEqual(["tiberias"]);
    // Prefix in Hebrew ranks above a Hebrew substring hit.
    expect(matchCities(CITIES, "ירושלים").map((c) => c.slug)).toEqual([
      "jerusalem",
      "new-jerusalem",
    ]);
    // A city without an English name is still found by Hebrew.
    expect(matchCities(CITIES, "החדשה").map((c) => c.slug)).toEqual(["new-jerusalem"]);
  });

  it("caps at the limit (default 5) and keeps the order it was given", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      slug: `c${i}`,
      labelHe: `עיר ${i}`,
      labelEn: `City ${i}`,
      count: 1,
    }));
    expect(matchCities(many, "city")).toHaveLength(5);
    expect(matchCities(many, "city", 2).map((c) => c.slug)).toEqual(["c0", "c1"]);
    expect(matchCities(many, "city", 0)).toEqual([]);
  });

  it("matches nothing for an empty or blank query, and for no hit", () => {
    expect(matchCities(CITIES, "")).toEqual([]);
    expect(matchCities(CITIES, "   ")).toEqual([]);
    expect(matchCities(CITIES, "zzz")).toEqual([]);
    expect(matchCities([], "jer")).toEqual([]);
  });
});

describe("the city index", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetCityIndex();
  });

  const directory = (): DirectoryView => ({
    totalRestaurants: 4,
    cities: [
      { cityHe: "ירושלים", cityEn: "Jerusalem", citySlug: "jerusalem", restaurantCount: 2, restaurants: [] },
      { cityHe: "ירושלים (כתיב)", cityEn: null, citySlug: "jerusalem", restaurantCount: 1, restaurants: [] },
      { cityHe: "טבריה", cityEn: "Tiberias", citySlug: null, restaurantCount: 1, restaurants: [] },
    ],
  });

  it("asks for nothing until enabled, then loads once and keeps only cities with a slug", async () => {
    const spy = vi.spyOn(kashrootApi, "getDirectory").mockResolvedValue(directory());
    const { result, rerender } = renderHook(({ on }) => useCityIndex(on), {
      initialProps: { on: false },
    });
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(result.current).not.toBeNull());
    // Tiberias has no slug, so it cannot be offered; the two Jerusalem groups are one scope.
    expect(result.current).toEqual([
      { slug: "jerusalem", labelHe: "ירושלים", labelEn: "Jerusalem", count: 3 },
    ]);

    // A second consumer in the same page load is served from the cache.
    const second = renderHook(() => useCityIndex(true));
    expect(second.result.current).toEqual(result.current);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("yields null on failure and retries on the next call", async () => {
    const spy = vi
      .spyOn(kashrootApi, "getDirectory")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(directory());
    const first = renderHook(() => useCityIndex(true));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Let the rejection settle; there is still nothing to suggest.
    await act(async () => {});
    expect(first.result.current).toBeNull();
    first.unmount();

    const second = renderHook(() => useCityIndex(true));
    await waitFor(() => expect(second.result.current).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("a city as the search origin", () => {
  beforeEach(() => {
    clearOrigin();
    resetOriginState();
  });
  afterEach(() => {
    clearOrigin();
    resetOriginState();
    Reflect.deleteProperty(navigator, "geolocation");
  });

  /** A geolocation that always refuses, or always answers with one fixed point. */
  function stubGeolocation(answer: "refuse" | { lat: number; lon: number }) {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          ok: (position: GeolocationPosition) => void,
          fail: (error: GeolocationPositionError) => void,
        ) => {
          if (answer === "refuse") fail({ code: 1 } as GeolocationPositionError);
          else ok({ coords: { latitude: answer.lat, longitude: answer.lon } } as GeolocationPosition);
        },
      },
    });
  }

  it("is a scope, not a centre: no origin point, the city set, slug and label stored", () => {
    const { result } = renderHook(() => useOrigin());
    act(() => result.current.setCityOrigin("jerusalem", "ירושלים"));

    expect(result.current.origin).toBeNull();
    expect(result.current.source).toBe("city");
    expect(result.current.city).toEqual({ slug: "jerusalem", label: "ירושלים" });
    expect(result.current.addressLabel).toBeNull();
    expect(result.current.state).toBe("idle");
    expect(result.current.resolving).toBe(false);
    expect(JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null")).toEqual({
      source: "city",
      slug: "jerusalem",
      label: "ירושלים",
    });
  });

  it("hands out the same city object until the next choice", () => {
    const { result, rerender } = renderHook(() => useOrigin());
    act(() => result.current.setCityOrigin("jerusalem", "ירושלים"));
    const first = result.current.city;
    rerender();
    expect(result.current.city).toBe(first);
    act(() => result.current.setCityOrigin("jerusalem", "ירושלים"));
    expect(result.current.city).not.toBe(first);
  });

  it("survives a reload without asking the device", () => {
    const { result, unmount } = renderHook(() => useOrigin());
    act(() => result.current.setCityOrigin("bnei-brak", "בני ברק"));
    unmount();

    // A reload forgets module state and keeps storage.
    resetOriginState();
    restoreOrigin();
    const after = renderHook(() => useOrigin());
    expect(after.result.current.source).toBe("city");
    expect(after.result.current.city).toEqual({ slug: "bnei-brak", label: "בני ברק" });
    expect(after.result.current.origin).toBeNull();
    expect(after.result.current.state).toBe("idle");
  });

  it("is kept when the device request is refused, and survives a reload after it", () => {
    const { result } = renderHook(() => useOrigin());
    act(() => result.current.setCityOrigin("jerusalem", "ירושלים"));
    stubGeolocation("refuse");
    act(() => result.current.requestDeviceLocation());

    expect(result.current.city).toEqual({ slug: "jerusalem", label: "ירושלים" });
    expect(result.current.source).toBe("city");
    expect(result.current.state).toBe("unavailable");
    expect(JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null")).toMatchObject({ source: "city" });
  });

  it("is replaced by the device point when the device answers, and vice versa", () => {
    const { result } = renderHook(() => useOrigin());
    act(() => result.current.setCityOrigin("jerusalem", "ירושלים"));
    stubGeolocation({ lat: 32.08, lon: 34.78 });
    act(() => result.current.requestDeviceLocation());
    expect(result.current.city).toBeNull();
    expect(result.current.origin).toEqual({ lat: 32.08, lon: 34.78 });
    expect(result.current.source).toBe("device");
    // The coordinates are never stored; only the choice is.
    expect(localStorage.getItem(ORIGIN_KEY)).toBe('{"source":"device"}');

    act(() => result.current.setCityOrigin("haifa", "חיפה"));
    expect(result.current.origin).toBeNull();
    expect(result.current.city?.slug).toBe("haifa");
  });

  it("discards a half-written city blob and falls back to asking the device", () => {
    for (const blob of [
      { source: "city", slug: "", label: "ירושלים" },
      { source: "city", slug: "jerusalem", label: "" },
      { source: "city", slug: 7, label: "x" },
      { source: "city" },
    ]) {
      resetOriginState();
      localStorage.setItem(ORIGIN_KEY, JSON.stringify(blob));
      const { result, unmount } = renderHook(() => useOrigin());
      expect(result.current.city).toBeNull();
      expect(result.current.source).toBe("none");
      unmount();
    }
  });
});

describe("scope fragment and label", () => {
  const POINT = { lat: 31.77, lon: 35.21 };
  const CITY = { slug: "jerusalem", label: "ירושלים" };

  it("sends exactly one scope: centre and radius, a city, or nothing", () => {
    expect(scopeFragment(POINT, null, 7)).toEqual({ center: POINT, radius_km: 7 });
    expect(scopeFragment(null, CITY, 7)).toEqual({ city: "jerusalem" });
    expect(scopeFragment(null, null, 7)).toEqual({});
    // Even handed both, it never sends both.
    const both = scopeFragment(POINT, CITY, 7);
    expect("city" in both && "center" in both).toBe(false);
  });

  it("names the place: device, address, city, else everywhere", () => {
    const t = { youAreHere: "אתם כאן", everywhere: "כל הארץ" };
    expect(scopeLabel({ source: "device", addressLabel: null, city: null }, t)).toBe("אתם כאן");
    expect(scopeLabel({ source: "address", addressLabel: "הרצל 1", city: null }, t)).toBe("הרצל 1");
    expect(scopeLabel({ source: "city", addressLabel: null, city: CITY }, t)).toBe("ירושלים");
    expect(scopeLabel({ source: "none", addressLabel: null, city: null }, t)).toBe("כל הארץ");
  });
});
