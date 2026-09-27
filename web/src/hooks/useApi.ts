/**
 * Thin data hooks over `kashrootApi`. Same job as `admin/src/hooks/usePagedQuery`:
 * request, abort on change, expose loading / error / data. No caching layer — the
 * service worker handles offline replay, and a stale kashrut verdict held in memory
 * is exactly what we do not want.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, kashrootApi } from "../api";
import type { GeoPoint, ProfileRequest, SearchRequest } from "../api/types";
import type {
  DetailView,
  DirectoryView,
  PlacesView,
  PublicRestaurantView,
  ResultView,
  SearchView,
} from "../api/viewmodel";

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
}

/**
 * A result, tagged with the question it answers. Effects run *after* React has
 * committed a frame, so state alone would let one painted frame pair the previous
 * query's verdicts with the new origin or profile — a MATCH from the old profile
 * shown, briefly, as the answer for the new one. One frame is still an assertion
 * about kashrut we cannot back, and the fail-safe rule does not have a grace period.
 */
interface Snapshot<T> {
  key: string;
  data: T | null;
  error: ApiError | Error | null;
}

function useQuery<T>(run: (signal: AbortSignal) => Promise<T>, deps: unknown[]): QueryState<T> {
  const key = JSON.stringify(deps);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key, data: null, error: null });
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    // A retry of the same question clears the previous failure but keeps whatever
    // was already on screen; a *different* question is discarded during render below.
    setSnapshot((previous) => (previous.error ? { ...previous, error: null } : previous));
    run(controller.signal)
      .then((result) => {
        setSnapshot({ key, data: result, error: null });
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const failure = caught instanceof Error ? caught : new Error(String(caught));
        // The only place the technical detail is allowed to surface. Components
        // render the sentence we wrote; a server validation dump stays in the
        // console where an engineer can find it.
        console.error("[kashroot] request failed:", failure);
        setSnapshot({ key, data: null, error: failure });
        setLoading(false);
      });
    return () => controller.abort();
    // `run` is rebuilt from `deps` by the callers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);

  // Derived in render, not in an effect: the moment the key changes, the answer to
  // the old question stops being an answer at all. Callers see `loading`, never a
  // verdict belonging to a profile or an origin the user has already left.
  const answersThisQuestion = snapshot.key === key;
  return {
    data: answersThisQuestion ? snapshot.data : null,
    loading: !answersThisQuestion || loading,
    error: answersThisQuestion ? snapshot.error : null,
    reload,
  };
}

const EMPTY_SEARCH: SearchView = { items: [], total: 0, page: 1, pageSize: 0 };

export function useSearch(request: SearchRequest | null): QueryState<SearchView> {
  // Serialised so a structurally identical request does not refetch on every render.
  const key = useMemo(() => (request ? JSON.stringify(request) : ""), [request]);
  return useQuery<SearchView>(
    (signal) => (request ? kashrootApi.search(request, signal) : Promise.resolve(EMPTY_SEARCH)),
    [key],
  );
}

export function useRestaurant(
  id: string | undefined,
  profile: ProfileRequest | null,
  center?: GeoPoint,
): QueryState<DetailView> {
  const key = useMemo(() => (profile ? JSON.stringify(profile) : ""), [profile]);
  const centerKey = center ? `${center.lat},${center.lon}` : "";
  return useQuery<DetailView>(
    (signal) =>
      id && profile
        ? kashrootApi.getRestaurant(id, profile, center, signal)
        : Promise.reject(new Error("missing restaurant id or profile")),
    [id, key, centerKey],
  );
}

/** The profile-free facts for `/r/:id`. No profile, no centre — the id is the whole question. */
export function useRestaurantPublic(id: string | undefined): QueryState<PublicRestaurantView> {
  return useQuery<PublicRestaurantView>(
    (signal) =>
      id
        ? kashrootApi.getRestaurantPublic(id, signal)
        : Promise.reject(new Error("missing restaurant id")),
    [id],
  );
}

/**
 * Google Places enrichment for a restaurant: photos and hours, fetched
 * independently of `useRestaurant`/`useRestaurantPublic` so a failure or a slow
 * answer here never delays or blanks the kashrut verdict. Callers render the
 * placeholder/no-gallery/no-hours fallback on `error` or `!data`, never a loading
 * state that blocks the rest of the page.
 */
export function useRestaurantPlaces(id: string | undefined): QueryState<PlacesView> {
  return useQuery<PlacesView>(
    (signal) =>
      id
        ? kashrootApi.getRestaurantPlaces(id, signal)
        : Promise.reject(new Error("missing restaurant id")),
    [id],
  );
}

/**
 * The city-grouped directory behind the landing page. No inputs at all: there is no
 * profile and no centre on this path, so the question is always the same one.
 */
export function useDirectory(): QueryState<DirectoryView> {
  return useQuery<DirectoryView>((signal) => kashrootApi.getDirectory(signal), []);
}

export function isNetworkError(error: Error | null): boolean {
  return error instanceof ApiError && error.isNetwork;
}

/** The server answered, and said the id is not in our records. */
export function isNotFoundError(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 404;
}

export interface PagedSearchState {
  /** Every item fetched so far, page 1 first, in the order the server sent them. */
  items: ResultView[];
  /** The server's count for the whole question, not for the pages fetched. */
  total: number;
  /** True until page 1 has answered — and while the request is still null. */
  loading: boolean;
  /** True while a further page is on its way; the earlier pages stay on screen. */
  loadingMore: boolean;
  error: ApiError | Error | null;
  /** Start again from page 1 on the same question. */
  reload: () => void;
  hasMore: boolean;
  /** Fetch the next page. A no-op while one is already in flight or none is left. */
  loadMore: () => void;
}

interface PagedSnapshot {
  key: string;
  items: ResultView[];
  total: number;
  /** The highest page fetched so far; 0 before page 1 has answered. */
  page: number;
  error: ApiError | Error | null;
}

const EMPTY_PAGES: PagedSnapshot = { key: "", items: [], total: 0, page: 0, error: null };

/**
 * `useSearch`, page by page. Page 1 is fetched when the question changes and every
 * further page is appended on `loadMore`, so a long unscoped list — "all of Israel"
 * is the whole database — arrives in `PAGE_SIZE` steps rather than all at once.
 *
 * The question is the request minus its `page`, and the same fail-safe rule applies
 * as in `useQuery`: the moment it changes, the pages already fetched are discarded
 * in the same render, never shown under a profile or origin they do not answer.
 *
 * A null request is a question not yet askable — the device is still being asked
 * where we are — and reads as loading, not as an empty answer.
 */
export function usePagedSearch(request: SearchRequest | null): PagedSearchState {
  const key = useMemo(() => {
    if (!request) return "";
    const { page: _page, ...rest } = request;
    return JSON.stringify(rest);
  }, [request]);
  const [snapshot, setSnapshot] = useState<PagedSnapshot>(EMPTY_PAGES);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [token, setToken] = useState(0);
  // The page fetch in flight, so a late answer to an old question is dropped and a
  // second "load more" tap cannot stack a duplicate page behind the first.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    inFlight.current?.abort();
    setLoadingMore(false);
    if (!request) {
      setLoading(true);
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setSnapshot((previous) => (previous.error ? { ...previous, error: null } : previous));
    kashrootApi
      .search({ ...request, page: 1 }, controller.signal)
      .then((result) => {
        setSnapshot({ key, items: result.items, total: result.total, page: 1, error: null });
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const failure = caught instanceof Error ? caught : new Error(String(caught));
        console.error("[kashroot] request failed:", failure);
        setSnapshot({ key, items: [], total: 0, page: 0, error: failure });
        setLoading(false);
      });
    return () => controller.abort();
    // `request` is fully described by `key`; `token` is the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);

  const answersThisQuestion = snapshot.key === key && key !== "";
  const items = answersThisQuestion ? snapshot.items : [];
  const total = answersThisQuestion ? snapshot.total : 0;
  const hasMore = answersThisQuestion && snapshot.page > 0 && items.length < total;

  const loadMore = useCallback(() => {
    if (!request || !hasMore || loadingMore) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const nextPage = snapshot.page + 1;
    setLoadingMore(true);
    kashrootApi
      .search({ ...request, page: nextPage }, controller.signal)
      .then((result) => {
        setSnapshot((previous) =>
          previous.key === key
            ? {
                ...previous,
                items: [...previous.items, ...result.items],
                total: result.total,
                page: nextPage,
              }
            : previous,
        );
        setLoadingMore(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const failure = caught instanceof Error ? caught : new Error(String(caught));
        console.error("[kashroot] request failed:", failure);
        // The pages already shown are still a true answer; only the next one failed.
        setSnapshot((previous) => (previous.key === key ? { ...previous, error: failure } : previous));
        setLoadingMore(false);
      });
  }, [request, hasMore, loadingMore, snapshot.page, key]);

  return {
    items,
    total,
    loading: !answersThisQuestion || loading,
    loadingMore,
    error: answersThisQuestion ? snapshot.error : null,
    reload,
    hasMore,
    loadMore,
  };
}
