/**
 * The one filter store, shared by every chip, popover and sheet on every screen, so
 * changing a filter in any of them moves all of them — and persisted, so a restart
 * keeps them. Same one-event-one-subscription shape as `useCity`, which holds the
 * city.
 *
 * The shape and its rules live in `./model.ts`; this file only stores it. It holds
 * the UI's state, not a request: screens map it with `toSearchFilters`.
 */

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, normalizeFilters, type FilterState } from "./model";

/** v1 held `{ diet, radiusKm }`; v2 is the filter bar's shape. v1 is simply ignored. */
const KEY = "kashroot.filters.v2";
const CHANGED = "kashroot:filters-changed";

function readStored(): FilterState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeFilters(JSON.parse(raw)) : DEFAULT_FILTERS;
  } catch {
    // storage blocked or corrupt — the defaults are always a valid request
    return DEFAULT_FILTERS;
  }
}

export function useFilters(): {
  filters: FilterState;
  setFilters: (patch: Partial<FilterState>) => void;
  reset: () => void;
} {
  const [filters, setState] = useState<FilterState>(readStored);

  useEffect(() => {
    const listener = () => setState(readStored());
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const write = useCallback((next: FilterState) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // non-fatal: the choice just won't survive a reload
    }
    setState(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);

  const setFilters = useCallback(
    (patch: Partial<FilterState>) => write(normalizeFilters({ ...readStored(), ...patch })),
    [write],
  );

  const reset = useCallback(() => write(DEFAULT_FILTERS), [write]);

  return { filters, setFilters, reset };
}
