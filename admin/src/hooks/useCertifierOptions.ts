import { useEffect, useState } from "react";

import { api, ApiError } from "../api/client";
import { MAX_PAGE_LIMIT, type CertifierOption, type Page } from "../api/types";

/**
 * Certifiers for the certificate picker, fetched once per distinct query string.
 *
 * The cache is module-level on purpose: the certifier table is small, slow-moving
 * reference data, and a moderator entering a run of certificates should not refetch
 * the same list for every row. Only `useCertifierOptions` writes to it, and only
 * with what the API returned.
 *
 * Inactive certifiers are always included. A certificate that really was issued by
 * a certifier that has since gone inactive must still be recordable; the picker
 * marks the fact rather than hiding the option. The list carries no levels field —
 * the API does not return one, because levels rendered beside a certifier read as a
 * ranking, and the app never ranks certifiers.
 */

const cache = new Map<string, CertifierOption[]>();

/** Test seam: the cache outlives a component, so a test suite must be able to drop it. */
export function clearCertifierOptionsCache(): void {
  cache.clear();
}

export interface CertifierOptionsState {
  options: CertifierOption[];
  loading: boolean;
  error: string | null;
}

export function useCertifierOptions(query: string): CertifierOptionsState {
  const key = query.trim();
  const [options, setOptions] = useState<CertifierOption[]>(() => cache.get(key) ?? []);
  const [loading, setLoading] = useState(!cache.has(key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setOptions(cached);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<Page<CertifierOption>>("/api/admin/certifiers", {
      query: { q: key || undefined, include_inactive: true, limit: MAX_PAGE_LIMIT },
    })
      .then((page) => {
        if (cancelled) return;
        cache.set(key, page.items);
        setOptions(page.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOptions([]);
        setError(err instanceof ApiError ? err.message : "שגיאה בלתי צפויה בטעינת גופי הכשרות");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { options, loading, error };
}
