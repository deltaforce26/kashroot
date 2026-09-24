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

import { ApiError, api, postForm } from "./client";
import {
  mockCertifiers,
  mockReportRestaurant,
  mockRestaurant,
  mockSearch,
  mockUploadCertificatePhoto,
} from "./mock/server";
import type {
  CertifierListItem,
  FlagCreatedOut,
  FlagRequest,
  GeoPoint,
  PhotoUploadOut,
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
  /**
   * Anonymous certificate photo upload for the specific certificate card the user is
   * looking at (chosen by their own profile on the client — the server only checks
   * it belongs to `restaurantId`). It lands as `pending` in the moderation queue and
   * changes nothing until a moderator accepts it. Rejects with `ApiError` — 409
   * carries `photo_exists` or `photo_pending` as its message.
   */
  uploadCertificatePhoto(
    restaurantId: string,
    certificateId: string,
    file: File,
  ): Promise<PhotoUploadOut>;
  /** A public report. It opens a moderation flag and never moves a verdict. */
  reportRestaurant(restaurantId: string, body: FlagRequest): Promise<FlagCreatedOut>;
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
  uploadCertificatePhoto: (restaurantId, certificateId, file) => {
    const form = new FormData();
    form.append("certificate_id", certificateId);
    form.append("file", file);
    return postForm<PhotoUploadOut>(
      `/v1/restaurants/${encodeURIComponent(restaurantId)}/certificate-photo`,
      form,
    );
  },
  reportRestaurant: (restaurantId, body) =>
    api<FlagCreatedOut>(`/v1/restaurants/${encodeURIComponent(restaurantId)}/flags`, {
      method: "POST",
      body,
    }),
};

const mockApi: KashrootApi = {
  getCertifiers: () => mockCertifiers().then((items) => items.map(toCertifierView)),
  search: (request) => mockSearch(request).then(toSearchView),
  getRestaurant: (id, profile, center) =>
    mockRestaurant(id, profile, undefined, center).then(toDetailView),
  uploadCertificatePhoto: (restaurantId, certificateId, file) =>
    mockUploadCertificatePhoto(restaurantId, certificateId, file),
  reportRestaurant: (restaurantId, body) => mockReportRestaurant(restaurantId, body),
};

export const kashrootApi: KashrootApi = API_MODE === "live" ? liveApi : mockApi;

/**
 * Which refusal a 409 from the photo upload was. The server's `detail` is a machine
 * code here, read only to pick a string from our own table — the UI never prints it.
 */
export function photoConflict(error: unknown): "photo_exists" | "photo_pending" | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  return error.message === "photo_exists" || error.message === "photo_pending"
    ? error.message
    : null;
}

export { ApiError } from "./client";
export { FLAG_MESSAGE_MAX, FLAG_TYPES, PHOTO_MAX_BYTES, PHOTO_MIME_TYPES } from "./types";
export type * from "./types";
export type { CertifierView, DetailView, ResultView, SearchView } from "./viewmodel";
