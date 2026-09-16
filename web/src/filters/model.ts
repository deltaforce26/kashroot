/**
 * The filter bar's state — pure data and pure functions, no React, no storage, so
 * every rule here is directly unit-testable.
 *
 * `FilterState` is what the chips and the sheet edit. `toSearchFilters` is the only
 * place it becomes the API's `SearchFilters`: screens build their request from that
 * mapping, never from the state, so the UI and the wire contract can change apart.
 * The radius is the one exception — it is a top-level `radius_km` on the request,
 * and only the distance search on home sends it.
 *
 * Two facets are ahead of the data. The corpus records no opening hours and no
 * restaurant ratings, so `open_now` and `min_rating` go out on the request and the
 * API accepts and ignores both until it does. Shipping the controls first was the
 * product owner's call (Sep 2026); the request shape will not need to change.
 *
 * The certifier facet narrows on certificate *identity* — "holds a certificate from
 * one of these bodies" — and the server answers it. Nothing here reads, sorts or
 * hides by a verdict; a result that survives the facets keeps its own.
 */

import type { DietType, SearchFilters } from "../api/types";

/** Every radius sits inside the API's 0.1–50 km bounds. */
export const RADIUS_OPTIONS = [1, 3, 5, 10, 25] as const;
export const DEFAULT_RADIUS_KM = 10;

/** The kitchens offered, in the order the options list them. */
export const DIET_OPTIONS: readonly DietType[] = ["meat", "dairy", "fish", "pareve"];

export const RATING_OPTIONS = [3, 3.5, 4, 4.5] as const;

export interface FilterState {
  /** Certifiers to narrow to; empty means no certifier facet at all. */
  certifierIds: string[];
  openNow: boolean;
  radiusKm: number;
  /** Any of these kitchens; empty means every kitchen. */
  diets: DietType[];
  /** null = no minimum. */
  minRating: number | null;
}

export const DEFAULT_FILTERS: FilterState = {
  certifierIds: [],
  openNow: false,
  radiusKm: DEFAULT_RADIUS_KM,
  diets: [],
  minRating: null,
};

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

/** Anything unrecognised falls back to its default rather than reaching a request. */
export function normalizeFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== "object") return DEFAULT_FILTERS;
  const value = raw as Record<string, unknown>;
  const radius = RADIUS_OPTIONS.find((km) => km === value.radiusKm);
  const rating = RATING_OPTIONS.find((min) => min === value.minRating);
  return {
    certifierIds: uniqueStrings(value.certifierIds),
    openNow: value.openNow === true,
    radiusKm: radius ?? DEFAULT_RADIUS_KM,
    diets: uniqueStrings(value.diets).filter((diet): diet is DietType =>
      (DIET_OPTIONS as readonly string[]).includes(diet),
    ),
    minRating: rating ?? null,
  };
}

/** Sorted so identical selections produce identical request bodies. */
export function toSearchFilters(state: FilterState): SearchFilters | undefined {
  const facets: SearchFilters = {};
  if (state.diets.length > 0) facets.diet_types = [...state.diets].sort();
  if (state.certifierIds.length > 0) facets.certifier_ids = [...state.certifierIds].sort();
  if (state.openNow) facets.open_now = true;
  if (state.minRating !== null) facets.min_rating = state.minRating;
  return Object.keys(facets).length > 0 ? facets : undefined;
}
