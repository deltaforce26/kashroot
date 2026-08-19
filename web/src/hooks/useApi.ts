/**
 * Two thin data hooks over `kashrootApi`. Same job as `admin/src/hooks/usePagedQuery`:
 * request, abort on change, expose loading / error / data. No caching layer — the
 * service worker handles offline replay, and a stale kashrut verdict held in memory
 * is exactly what we do not want.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, kashrootApi } from "../api";
import type { GeoPoint, ProfileRequest, SearchRequest } from "../api/types";
import type { DetailView, SearchView } from "../api/viewmodel";

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
}

/**
 * A result, tagged with the question it answers. Effects run *after* React has
 * committed a frame, so state alone would let one painted frame pair the previous
 * query's verdicts with the new city or profile — a MATCH from the old profile
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
  // verdict belonging to a profile or a city the user has already left.
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

export function isNetworkError(error: Error | null): boolean {
  return error instanceof ApiError && error.isNetwork;
}
