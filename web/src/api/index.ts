/**
 * The single swap point between fixtures and Track B's real endpoints.
 *
 * `VITE_API_MODE=live` routes every call at `/v1/...` (Track B's router prefix,
 * forwarded to FastAPI by the Vite dev proxy); anything else uses the fixture server
 * in `./mock`. Both branches speak the identical wire types from `./types` and both
 * are normalised through `./viewmodel`, so switching modes changes where the bytes
 * come from and nothing else. When the endpoints are running: delete `./mock`, drop
 * the branch below, done.
 */

import { api } from "./client";
import { mockCertifiers, mockRestaurant, mockSearch } from "./mock/server";
import type {
  CertifierListItem,
  GeoPoint,
  ProfileRequest,
  RestaurantDetailResponseOut,
  SearchRequest,
  SearchResponseOut,
} from "./types";
import {
  toCertifierView,
  toDetailView,
  toSearchView,
  type CertifierView,
  type DetailView,
  type SearchView,
} from "./viewmodel";

export interface KashrootApi {
  getCertifiers(signal?: AbortSignal): Promise<CertifierView[]>;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchView>;
  /**
   * `center` is passed through so the detail screen's distance comes from the same
   * PostGIS computation as the list's — omit it and the API returns no distance at
   * all rather than a second, differently-derived number.
   */
  getRestaurant(
    id: string,
    profile: ProfileRequest,
    center?: GeoPoint,
    signal?: AbortSignal,
  ): Promise<DetailView>;
}

export const API_MODE: "live" | "mock" =
  import.meta.env.VITE_API_MODE === "live" ? "live" : "mock";

const liveApi: KashrootApi = {
  getCertifiers: (signal) =>
    api<CertifierListItem[]>("/v1/certifiers", { ...(signal ? { signal } : {}) }).then((items) =>
      items.map(toCertifierView),
    ),
  search: (request, signal) =>
    api<SearchResponseOut>("/v1/search", {
      method: "POST",
      body: request,
      ...(signal ? { signal } : {}),
    }).then(toSearchView),
  getRestaurant: (id, profile, center, signal) =>
    api<RestaurantDetailResponseOut>(`/v1/restaurants/${encodeURIComponent(id)}`, {
      method: "POST",
      body: { profile, ...(center ? { center } : {}) },
      ...(signal ? { signal } : {}),
    }).then(toDetailView),
};

const mockApi: KashrootApi = {
  getCertifiers: () => mockCertifiers().then((items) => items.map(toCertifierView)),
  search: (request) => mockSearch(request).then(toSearchView),
  getRestaurant: (id, profile, center) =>
    mockRestaurant(id, profile, undefined, center).then(toDetailView),
};

export const kashrootApi: KashrootApi = API_MODE === "live" ? liveApi : mockApi;

export { ApiError } from "./client";
export type * from "./types";
export type { CertifierView, DetailView, ResultView, SearchView } from "./viewmodel";
