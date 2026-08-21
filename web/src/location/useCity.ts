/**
 * Which city the app is looking at. Shared by home, search and map so switching in
 * one place moves all three, and persisted so a demo restart lands where it left off.
 *
 * Deliberately not a hardcoded lead city: which city the demo opens on is a product
 * decision that is still open, and the corpus covers six.
 */

import { useCallback, useEffect, useState } from "react";
import { CITIES, DEFAULT_CITY_SLUG, cityBySlug, type CityOption } from "../config";
import { resetSessionOrigin } from "./useOrigin";

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
    resetSessionOrigin();
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // non-fatal: the choice just won't survive a reload
    }
    setSlugState(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  return { city: cityBySlug(slug), slug, setSlug };
}
