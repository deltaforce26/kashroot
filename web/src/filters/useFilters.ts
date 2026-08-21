/**
 * The soft filters — Layer 2 only — shared by home, search and the filters screen so
 * changing one in any of them moves all three, and persisted so a demo restart keeps
 * them. Same one-event-one-subscription shape as `useCity`, which holds the city.
 *
 * Nothing here can reach a verdict. `diet_type` and `radius_km` are ordinary facets
 * of the request; the kashrut gate runs over whatever survives them, and a NO_MATCH
 * result is never filtered out by anything on this screen.
 *
 * The set is deliberately small. `SearchFilters` also carries `price_level`,
 * `open_now` and `amenities`, but the seed corpus records none of them (and the API
 * ignores `open_now` outright), so a control for any of the three could only ever
 * empty the list. They are left out until the data exists.
 */

import { useCallback, useEffect, useState } from "react";
import type { DietType } from "../api/types";
import { NEARBY_RADIUS_KM } from "../config";

/** The radii offered on the filters screen, all inside the API's 0.1–50 km bounds. */
export const RADIUS_OPTIONS = [1, 3, NEARBY_RADIUS_KM, 25] as const;

const DIETS: readonly DietType[] = ["meat", "dairy", "pareve", "fish"];

export interface Filters {
  /** null = every kitchen; otherwise the published diet type to narrow to. */
  diet: DietType | null;
  radiusKm: number;
}

export const DEFAULT_FILTERS: Filters = { diet: null, radiusKm: NEARBY_RADIUS_KM };

export function isDefault(filters: Filters): boolean {
  return filters.diet === DEFAULT_FILTERS.diet && filters.radiusKm === DEFAULT_FILTERS.radiusKm;
}

const KEY = "kashroot.filters.v1";
const CHANGED = "kashroot:filters-changed";

/** Anything unrecognised falls back to the default rather than reaching a request. */
function readStored(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      diet: DIETS.includes(parsed.diet as DietType) ? (parsed.diet as DietType) : null,
      radiusKm: RADIUS_OPTIONS.includes(parsed.radiusKm as (typeof RADIUS_OPTIONS)[number])
        ? (parsed.radiusKm as number)
        : DEFAULT_FILTERS.radiusKm,
    };
  } catch {
    // storage blocked or corrupt — the defaults are always a valid request
    return DEFAULT_FILTERS;
  }
}

export function useFilters(): {
  filters: Filters;
  setFilters: (next: Partial<Filters>) => void;
  reset: () => void;
} {
  const [filters, setState] = useState<Filters>(readStored);

  useEffect(() => {
    const listener = () => setState(readStored());
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const write = useCallback((next: Filters) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // non-fatal: the choice just won't survive a reload
    }
    setState(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => write({ ...readStored(), ...patch }),
    [write],
  );

  const reset = useCallback(() => write(DEFAULT_FILTERS), [write]);

  return { filters, setFilters, reset };
}
