/**
 * Which city the app is looking at. Shared by home, search and map so switching in
 * one place moves all three, and persisted so a demo restart lands where it left off.
 *
 * Deliberately not a hardcoded lead city: which city the demo opens on is a product
 * decision that is still open, and the corpus covers six.
 */

import { useCallback, useEffect, useState } from "react";
import { CITIES, DEFAULT_CITY_SLUG, cityBySlug, coveringCity, type CityOption } from "../config";
import { clearOrigin } from "./useOrigin";

const KEY = "kashroot.city";

function readStored(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && CITIES.some((city) => city.slug === stored)) return stored;
  } catch {
    // storage blocked — fall through to the default
  }
  return DEFAULT_CITY_SLUG;
}

/** Cross-component sync without a store: one event, one subscription per hook. */
const CHANGED = "kashroot:city-changed";

function writeSlug(next: string): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // non-fatal: the choice just won't survive a reload
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Move the city to wherever a point lands. Called by the origin hook whenever an
 * address is pinned or the device answers, so that the one screen scoped by city
 * (search) agrees with the two measured from the origin (home, map). Unlike
 * `setSlug` this does *not* clear the origin: the origin is what is being followed.
 *
 * A point outside every covered city leaves the slug alone: the screens then say
 * the corpus has nothing there (see `useOrigin().covered`) instead of answering
 * for the nearest city we happen to know.
 */
export function followPoint(point: { lat: number; lon: number }): void {
  const next = coveringCity(point)?.slug;
  if (!next || next === readStored()) return;
  writeSlug(next);
}

export function useCity(): {
  city: CityOption;
  slug: string;
  setSlug: (slug: string) => void;
} {
  const [slug, setSlugState] = useState<string>(readStored);

  useEffect(() => {
    const listener = () => setSlugState(readStored());
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const setSlug = useCallback((next: string) => {
    // Picking a city answers the same question as a pinned address or the device
    // position, so it replaces them rather than sitting behind them — otherwise the
    // header would name one place and the results would come from another.
    clearOrigin();
    setSlugState(next);
    writeSlug(next);
  }, []);

  return { city: cityBySlug(slug), slug, setSlug };
}
