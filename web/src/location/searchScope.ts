/**
 * How the current origin becomes a search request, and what the screens call it.
 *
 * Home, search and the map each build a `SearchRequest` from the one shared origin
 * (`useOrigin`), and each used to spell out the same scope by hand. That is the kind
 * of duplication that drifts: the day one of them learns about cities and another
 * does not, list and map answer different questions. The rule lives here once.
 *
 * A search is scoped by exactly one of three things: a centre with a radius (the
 * device or a typed address — distance is measured and the radius applies), a whole
 * city (`city`, an exact `Restaurant.city_slug` — no centre, no radius, no distance),
 * or nothing (every place in the database). A point and a city are never sent
 * together: the server would apply both, intersecting a radius with a city nobody
 * asked to intersect. `useOrigin` already makes them mutually exclusive in state;
 * this function makes it impossible to send both even if a caller passes both.
 *
 * Pure: no I/O, no storage, nothing read from the DOM.
 */

import type { GeoPoint, SearchRequest } from "../api/types";
import type { CityScope, OriginSource } from "./useOrigin";

/** The scope-bearing fields of a `SearchRequest`, to be spread into one. */
export type ScopeFragment = Pick<SearchRequest, "center" | "radius_km" | "city">;

/**
 * Exactly one of: centre+radius, a city, or nothing. Never both.
 *
 * If a point and a city are somehow both present the point wins: it is the more
 * specific scope, and the tie has to break the same way on every screen.
 */
export function scopeFragment(
  origin: GeoPoint | null,
  city: CityScope | null,
  radiusKm: number,
): ScopeFragment {
  if (origin) return { center: origin, radius_km: radiusKm };
  if (city) return { city: city.slug };
  return {};
}

/**
 * The header's place line, and the place `NothingHere` names. The device names
 * itself, a typed address and a chosen city are quoted back verbatim, and nothing
 * pinned is said as what it is.
 */
export function scopeLabel(
  scope: { source: OriginSource; addressLabel: string | null; city: CityScope | null },
  t: { youAreHere: string; everywhere: string },
): string {
  if (scope.source === "device") return t.youAreHere;
  if (scope.source === "address") return scope.addressLabel ?? t.everywhere;
  if (scope.source === "city") return scope.city?.label ?? t.everywhere;
  return t.everywhere;
}
