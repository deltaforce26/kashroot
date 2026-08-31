import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, type QueryParams } from "../api/client";
import { DEFAULT_PAGE_LIMIT, type Page } from "../api/types";

interface PagedQueryState<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: string | null;
  /** Server offset of the first row currently shown. */
  offset: number;
  reload: () => void;
  /** Optimistically drop rows after a successful action (actions are audited, not undoable). */
  removeItem: (predicate: (item: T) => boolean) => void;
  /**
   * Replace a row in place with the server's response. Unlike `removeItem` this is
   * not optimistic: callers pass what the API returned, so the row on screen and the
   * row in the database cannot drift.
   */
  replaceItem: (predicate: (item: T) => boolean, next: T) => void;
  next: () => void;
  prev: () => void;
}

/**
 * Fetch a limit/offset page; refetches whenever path, filters, or page change.
 *
 * Pagination stays consistent with optimistic removals: after k rows are removed
 * from the current page, the rows still on screen occupy server offsets
 * [offset, offset + items.length), so `next()` starts exactly after what is shown
 * instead of blindly adding `limit` (which would skip k rows). A page that drains
 * to zero refetches itself (later rows have shifted into this offset), or steps
 * back a page when the offset has run past the new total. Changing any filter
 * resets to the first page.
 */
export function usePagedQuery<T>(
  path: string,
  baseParams: QueryParams,
  limit: number = DEFAULT_PAGE_LIMIT,
): PagedQueryState<T> {
  const paramsKey = JSON.stringify(baseParams);
  // Offset is keyed to the filter set so a filter change lands on page one
  // immediately, without an intermediate render at the stale offset.
  const [page, setPage] = useState({ key: paramsKey, offset: 0 });
  const offset = page.key === paramsKey ? page.offset : 0;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: QueryParams = {
      ...(JSON.parse(paramsKey) as QueryParams),
      limit,
      offset,
    };
    api<Page<T>>(path, { query })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof ApiError ? err.message : "שגיאה בלתי צפויה בטעינת הנתונים");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, paramsKey, limit, offset, reloadCounter]);

  const reload = useCallback(() => setReloadCounter((n) => n + 1), []);

  // Live snapshot so the stable callbacks below read current values.
  const snapshot = useRef({ items, total, offset });
  snapshot.current = { items, total, offset };

  const removeItem = useCallback(
    (predicate: (item: T) => boolean) => {
      const current = snapshot.current;
      const remaining = current.items.filter((item) => !predicate(item));
      const removed = current.items.length - remaining.length;
      if (removed === 0) return;
      const newTotal = Math.max(0, current.total - removed);
      setItems(remaining);
      setTotal(newTotal);
      if (remaining.length === 0 && newTotal > 0) {
        if (current.offset >= newTotal) {
          // Last page drained — step back one page.
          setPage({ key: paramsKey, offset: Math.max(0, current.offset - limit) });
        } else {
          // Later rows have shifted into this offset — refetch the same page.
          setReloadCounter((n) => n + 1);
        }
      }
    },
    [paramsKey, limit],
  );

  const replaceItem = useCallback((predicate: (item: T) => boolean, updated: T) => {
    setItems((prev) => prev.map((item) => (predicate(item) ? updated : item)));
  }, []);

  const next = useCallback(() => {
    setPage({
      key: paramsKey,
      offset: snapshot.current.offset + snapshot.current.items.length,
    });
  }, [paramsKey]);

  const prev = useCallback(() => {
    setPage({ key: paramsKey, offset: Math.max(0, snapshot.current.offset - limit) });
  }, [paramsKey, limit]);

  return {
    items,
    total,
    loading,
    error,
    offset,
    reload,
    removeItem,
    replaceItem,
    next,
    prev,
  };
}
