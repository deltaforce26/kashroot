/**
 * The fixture server answers the filter bar's facets the way the API does, so the
 * app's filter flows exercise the real request shape. Above all: a facet decides
 * which restaurants get asked about, never what the answer is.
 */

import { describe, expect, it } from "vitest";
import { mockSearch } from "../api/mock/server";
import { CERTIFIERS } from "../api/mock/fixtures";
import type { ProfileRequest, SearchFilters } from "../api/types";

const PROFILE: ProfileRequest = {
  whitelist: CERTIFIERS.map((certifier) => ({
    certifier_id: certifier.id,
    min_level: "regular" as const,
  })),
  required_attributes: [],
  preferred_diets: [],
  preferred_price_level: null,
  wanted_amenities: [],
};

const NOW = new Date("2026-08-17T12:00:00Z");

const search = (filters?: SearchFilters) =>
  mockSearch({ profile: PROFILE, page_size: 100, ...(filters ? { filters } : {}) }, NOW);

const ids = (items: Array<{ restaurant_id: string }>) =>
  items.map((item) => item.restaurant_id).sort();

describe("fixture server facets", () => {
  it("narrows to any of several kitchens", async () => {
    const all = await search();
    const picked = await search({ diet_types: ["dairy", "meat"] });

    const expected = all.items.filter(
      (item) => item.diet_type === "dairy" || item.diet_type === "meat",
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(ids(picked.items)).toEqual(ids(expected));
  });

  it("narrows to restaurants holding a certificate from a listed certifier", async () => {
    const all = await search();
    const picked = await search({ certifier_ids: ["cert-rubin"] });

    const expected = all.items.filter((item) =>
      item.certifiers.some((certifier) => certifier.id === "cert-rubin"),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(picked.items.length).toBeLessThan(all.items.length);
    expect(ids(picked.items)).toEqual(ids(expected));
  });

  it("leaves every verdict exactly as the unfiltered search gave it", async () => {
    const all = await search();
    const picked = await search({ certifier_ids: ["cert-rubin", "cert-landa"] });

    expect(picked.items.length).toBeGreaterThan(0);
    for (const item of picked.items) {
      const unfiltered = all.items.find((other) => other.restaurant_id === item.restaurant_id);
      expect(item.kashrut).toEqual(unfiltered?.kashrut);
    }
  });

  it("accepts open-now and a minimum rating, and ignores both until the data exists", async () => {
    const all = await search();
    const picked = await search({ open_now: true, min_rating: 4.5 });
    expect(ids(picked.items)).toEqual(ids(all.items));
  });
});
