/**
 * Search — city chips, the filter bar, result tiles (design 3e).
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
 * This is a city search with no centre, so the bar's radius has nothing to measure
 * from and is left out of its sheet here.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MAX_QUERY_LENGTH, type SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { FilterBar } from "../components/filters/FilterBar";
import { PinIcon, SearchIcon } from "../components/icons";
import { RestaurantTileCard } from "../components/RestaurantCard";
import {
  EmptyCity,
  EmptyQuery,
  EmptyResults,
  OutsideCoverage,
  ErrorState,
  LoadingList,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { SaveToListHost } from "../components/SaveToListSheet";
import { TabBar } from "../components/TabBar";
import { CITIES } from "../config";
import { useOrigin } from "../location/useOrigin";
import { toSearchFilters } from "../filters/model";
import { anyFilterActive, type FilterId } from "../filters/registry";
import { useFilters } from "../filters/useFilters";
import { useCity } from "../location/useCity";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

const NOT_ON_SEARCH: readonly FilterId[] = ["radius"];

export function Search() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  // Home hands its query over in the URL, so arriving from there opens on the term
  // already typed rather than asking for it a second time.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const { slug: city, setSlug: setCity, city: cityOption } = useCity();
  // Shared with home, so a filter picked here is the one picked there.
  const { filters, reset: resetFilters } = useFilters();
  const deferredQuery = useDeferredValue(query);

  const trimmedQuery = deferredQuery.trim();

  const cityLabel = (slug: string) => {
    const found = CITIES.find((entry) => entry.slug === slug);
    return found ? (lang === "en" ? found.en : found.he) : slug;
  };

  // With an address or the device pinned, search measures from it like home does —
  // a city scope would answer for whichever city happens to be stored, which is
  // wrong the moment the pin is in Netanya. Without a pin, the city is the scope.
  const { origin, source, addressLabel } = useOrigin(cityOption);
  const pinned = source !== "city";
  const placeLabel = source === "device" ? t.map.youAreHere : (addressLabel ?? cityLabel(city));

  const request = useMemo<SearchRequest>(() => {
    const facets = toSearchFilters(filters);
    return {
      profile: toPayload(profile),
      ...(pinned ? { center: origin, radius_km: filters.radiusKm } : { city }),
      page_size: 100,
      ...(trimmedQuery ? { query: trimmedQuery.slice(0, MAX_QUERY_LENGTH) } : {}),
      ...(facets ? { filters: facets } : {}),
    };
  }, [profile, city, pinned, origin, filters, trimmedQuery]);

  const { data, loading, error, reload } = useSearch(request);
  const results = data?.items ?? [];

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="circle glass" aria-hidden="true">
          <PinIcon />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t.search.searchingNear}</div>
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

      {/* A city has no centre to measure a radius from; a pinned origin does. */}
      <FilterBar exclude={pinned ? [] : NOT_ON_SEARCH} />

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : results.length === 0 && trimmedQuery ? (
          <EmptyQuery query={trimmedQuery} onClear={() => setQuery("")} />
        ) : (data?.total ?? 0) === 0 && pinned && !anyFilterActive(filters) ? (
          // Nothing at all within range of the pin — a data gap, not a verdict.
          <OutsideCoverage place={placeLabel} onChangePlace={() => navigate("/")} />
        ) : (data?.total ?? 0) === 0 && !anyFilterActive(filters) ? (
          // Nothing in the city at all — a data gap (or a bad city_slug), which is a
          // different statement from "nothing meets your profile".
          <EmptyCity
            city={cityLabel(city)}
            onPickAnother={() => {
              const next = CITIES.find((entry) => entry.slug !== city);
              if (next) setCity(next.slug);
            }}
          />
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
            {!hasVerifiedMatch(results) && (
              <NoVerifiedMatchesBanner />
            )}
            <div className="sr-only" role="status">
              {t.search.resultCount(results.length)}
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
            <p className="hint" style={{ paddingBottom: 8 }}>
              {t.states.coverageNoteCity}
            </p>
          </>
        )}
      </div>

      <SaveToListHost />
      <TabBar />
    </div>
  );
}
