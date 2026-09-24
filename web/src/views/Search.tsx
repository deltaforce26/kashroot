/**
 * Search — the filter bar, a text field, result tiles (design 3e).
 *
 * Nothing here filters or reorders by verdict. The bar's facets decide which
 * restaurants get asked about, and the server answers each one that survives with
 * its own verdict: a NO_MATCH result stays in the list with its own pill. The
 * certifier facet is the nearest thing to a kashrut control on this screen, and it
 * narrows on who issued a certificate, never on what the certificate concludes.
 *
 * The search box sends `query` to the server, which does an exact case-insensitive
 * substring match over name and address — no fuzzy matching, no Hebrew
 * normalization. The UI is careful not to imply otherwise: there is no "did you
 * mean", and a miss is explained as a spelling difference rather than an absence.
 *
 * Where it searches is the same origin home uses: the device, a pinned address, or
 * — with neither — every place in the database, paged. There is no city scope. The
 * bar's radius is offered only when there is a centre to measure it from.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MAX_QUERY_LENGTH, type SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { FilterBar } from "../components/filters/FilterBar";
import { PinIcon, SearchIcon } from "../components/icons";
import { RestaurantTileCard } from "../components/RestaurantCard";
import {
  EmptyQuery,
  EmptyResults,
  ErrorState,
  LoadingList,
  NothingHere,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { SaveToListHost } from "../components/SaveToListSheet";
import { TabBar } from "../components/TabBar";
import { PAGE_SIZE } from "../config";
import { useOrigin } from "../location/useOrigin";
import { toSearchFilters } from "../filters/model";
import { anyFilterActive, type FilterId } from "../filters/registry";
import { useFilters } from "../filters/useFilters";
import { isNetworkError, usePagedSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

/** A radius needs a centre; with nothing pinned the chip would measure from nowhere. */
const WITHOUT_ORIGIN: readonly FilterId[] = ["radius"];

export function Search() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  // Home hands its query over in the URL, so arriving from there opens on the term
  // already typed rather than asking for it a second time.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  // Shared with home, so a filter picked here is the one picked there.
  const { filters, reset: resetFilters } = useFilters();
  const deferredQuery = useDeferredValue(query);

  const trimmedQuery = deferredQuery.trim();

  // The one origin, shared with home and the map: measured from the pin when there
  // is one, and from nowhere — the whole database — when there is not.
  const { origin, source, addressLabel, resolving } = useOrigin();
  const placeLabel =
    source === "device" ? t.map.youAreHere : (addressLabel ?? t.origin.everywhere);

  const request = useMemo<SearchRequest | null>(() => {
    if (resolving) return null;
    const facets = toSearchFilters(filters);
    return {
      profile: toPayload(profile),
      ...(origin ? { center: origin, radius_km: filters.radiusKm } : {}),
      page_size: PAGE_SIZE,
      ...(trimmedQuery ? { query: trimmedQuery.slice(0, MAX_QUERY_LENGTH) } : {}),
      ...(facets ? { filters: facets } : {}),
    };
  }, [profile, origin, resolving, filters, trimmedQuery]);

  const { items: results, total, loading, loadingMore, error, reload, hasMore, loadMore } =
    usePagedSearch(request);

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="circle glass" aria-hidden="true">
          <PinIcon />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
            {origin ? t.search.searchingNear : t.origin.searchingEverywhere}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{placeLabel}</div>
        </div>
      </header>

      <label className="searchbar glass" style={{ margin: "14px var(--gutter) 0" }}>
        <span className="searchbar__icon" aria-hidden="true">
          <SearchIcon size={17} />
        </span>
        <input
          type="search"
          className="searchbar__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search.placeholder}
          aria-label={t.search.placeholder}
          maxLength={MAX_QUERY_LENGTH}
        />
      </label>

      {/* A radius is only a question when there is a centre to measure it from. */}
      <FilterBar exclude={origin ? [] : WITHOUT_ORIGIN} />

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : results.length === 0 && trimmedQuery ? (
          <EmptyQuery query={trimmedQuery} onClear={() => setQuery("")} />
        ) : total === 0 && !anyFilterActive(filters) ? (
          // No rows at all, before the profile was applied — a data gap, not a
          // verdict, and a different statement from "nothing meets your profile".
          <NothingHere place={origin ? placeLabel : null} onChangePlace={() => navigate("/")} />
        ) : results.length === 0 ? (
          <EmptyResults
            onWidenProfile={() => navigate("/profile")}
            onShowAll={() => {
              setQuery("");
              resetFilters();
            }}
          />
        ) : (
          <>
            {!hasVerifiedMatch(results) && <NoVerifiedMatchesBanner />}
            <div className="sr-only" role="status">
              {t.search.resultCount(total)}
            </div>
            <div className="grid">
              {results.map((item) => (
                <RestaurantTileCard
                  key={item.id}
                  item={item}
                  saved={isSaved(item.id)}
                  onToggleSave={toggle}
                />
              ))}
            </div>
            {hasMore && (
              <div className="load-more">
                <button
                  type="button"
                  className="cta cta--ghost"
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore ? t.states.loadingShort : t.states.loadMore}
                </button>
              </div>
            )}
            <p className="hint" style={{ paddingBottom: 8 }}>
              {origin ? t.states.coverageNoteNearby : t.states.coverageNoteEverywhere}
            </p>
          </>
        )}
      </div>

      <SaveToListHost />
      <TabBar />
    </div>
  );
}
