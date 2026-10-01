/**
 * The cities a search can be scoped to, for the search bar's city suggestions.
 *
 * The list comes from the directory (`GET /v1/directory`), the one endpoint that
 * already groups every public restaurant by city and now says which slug scopes each
 * group. `useQuery` deliberately has no cache — verdict data must never be served
 * stale — so using it here would refetch the whole directory every time the search
 * bar mounted. The directory is facts only (names, counts, slugs; no verdict, no
 * certificate state), so a module-level cache is safe for it, and it is held here
 * rather than in `useQuery` so that exception stays visibly local to this file.
 *
 * Loaded once per page load, and only once the caller says it is needed (`enabled`):
 * a visitor who never focuses the search field never pays for the request. A failure
 * is not remembered — the cached promise is dropped on rejection, so the next call
 * retries — and until it succeeds the hook yields `null`, which the bar reads as "no
 * city suggestions", not as an error: the field still works as a place or text search.
 *
 * A city without a slug is left out. Without a slug there is no exact `city_slug` to
 * send, so offering the name would promise a scope the server cannot apply. Cities
 * that share a slug are one scope and appear once, under the larger group's name,
 * with their counts added.
 *
 * Matching is `matchCities`: a plain trim, lowercase and prefix-then-substring over
 * the Hebrew and English names. Exact substrings only, like the server's own `query`
 * — no fuzzy matching and no Hebrew normalisation, and nothing here implies either.
 */

import { useEffect, useState } from "react";
import { kashrootApi } from "../api";
import type { DirectoryView } from "../api/viewmodel";

export interface CityOption {
  /** What a search sends as `city` (`Restaurant.city_slug`). */
  slug: string;
  labelHe: string;
  /** The records' own English name; null when none has one. */
  labelEn: string | null;
  /** Every restaurant in the city, not just the directory's sample of it. */
  count: number;
}

/** Default number of suggestions `matchCities` returns. */
const DEFAULT_LIMIT = 5;

/** The directory view, reduced to the cities a search can actually be scoped to. */
function toCityOptions(directory: DirectoryView): CityOption[] {
  const bySlug = new Map<string, CityOption>();
  for (const city of directory.cities) {
    if (!city.citySlug) continue;
    const existing = bySlug.get(city.citySlug);
    if (existing) {
      // Cities arrive largest first, so the first spelling seen is the main one.
      existing.count += city.restaurantCount;
      existing.labelEn ??= city.cityEn;
    } else {
      bySlug.set(city.citySlug, {
        slug: city.citySlug,
        labelHe: city.cityHe,
        labelEn: city.cityEn,
        count: city.restaurantCount,
      });
    }
  }
  return [...bySlug.values()];
}

let loaded: CityOption[] | null = null;
let pending: Promise<CityOption[]> | null = null;

/** One request per page load; a rejection clears the promise so the next call retries. */
function loadCityIndex(): Promise<CityOption[]> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = kashrootApi.getDirectory().then(
      (directory) => {
        loaded = toCityOptions(directory);
        return loaded;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}

/** Test seam: forget the cache, as a page reload would. Not used by the app. */
export function resetCityIndex(): void {
  loaded = null;
  pending = null;
}

/**
 * The cities a search can be scoped to, or null until they have loaded (or if they
 * could not be). Nothing is requested while `enabled` is false.
 */
export function useCityIndex(enabled: boolean): CityOption[] | null {
  const [cities, setCities] = useState<CityOption[] | null>(loaded);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadCityIndex().then(
      (options) => {
        if (!cancelled) setCities(options);
      },
      () => {
        // Not an error state: no suggestions, and the next enabled mount retries.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return cities;
}

/**
 * Cities whose Hebrew or English name matches `query`: prefix matches first, then
 * substring matches, each group in the order given (the directory's, largest first).
 * Case-insensitive and trimmed; an empty query matches nothing rather than
 * everything, so a closed or blank field suggests no city.
 */
export function matchCities(
  cities: CityOption[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): CityOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const prefix: CityOption[] = [];
  const inside: CityOption[] = [];
  for (const city of cities) {
    const names = [city.labelHe, city.labelEn ?? ""].map((name) => name.toLowerCase());
    if (names.some((name) => name.startsWith(needle))) prefix.push(city);
    else if (names.some((name) => name.includes(needle))) inside.push(city);
  }
  return [...prefix, ...inside].slice(0, Math.max(0, limit));
}
