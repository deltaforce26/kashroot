/**
 * Search — filter chips, result tiles (design 3e).
 *
 * Filtering is Layer 2 territory only: city, diet type, and a name filter. Nothing
 * here filters or reorders by verdict. A NO_MATCH result stays in the list with its
 * own pill; hiding it would answer a question the user did not ask.
 *
 * The search box sends `query` to the server, which does an exact case-insensitive
 * substring match over name and address — no fuzzy matching, no Hebrew
 * normalization. The UI is careful not to imply otherwise: there is no "did you
 * mean", and a miss is explained as a spelling difference rather than an absence.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MAX_QUERY_LENGTH, type DietType, type SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { PinIcon, SearchIcon, SlidersIcon } from "../components/icons";
import { RestaurantTileCard } from "../components/RestaurantCard";
import {
  EmptyCity,
  EmptyQuery,
  EmptyResults,
  ErrorState,
  LoadingList,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { TabBar } from "../components/TabBar";
import { CITIES } from "../config";
import { useFilters } from "../filters/useFilters";
import { useCity } from "../location/useCity";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

const DIET_FILTERS: DietType[] = ["meat", "dairy", "pareve", "fish"];

export function Search() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  // Home hands its query over in the URL, so arriving from there opens on the term
  // already typed rather than asking for it a second time.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const { slug: city, setSlug: setCity } = useCity();
  // Shared with home and /filters, so the kitchen picked here is the one picked there.
  const { filters, setFilters } = useFilters();
  const diet = filters.diet;
  const setDiet = (next: DietType | null) => setFilters({ diet: next });
  const deferredQuery = useDeferredValue(query);

  const trimmedQuery = deferredQuery.trim();

  const request = useMemo<SearchRequest>(
    () => ({
      profile: toPayload(profile),
      city,
      page_size: 100,
      ...(trimmedQuery ? { query: trimmedQuery.slice(0, MAX_QUERY_LENGTH) } : {}),
      ...(diet ? { filters: { diet_type: diet } } : {}),
    }),
    [profile, city, diet, trimmedQuery],
  );

  const { data, loading, error, reload } = useSearch(request);
  const results = data?.items ?? [];

  const cityLabel = (slug: string) => {
    const found = CITIES.find((entry) => entry.slug === slug);
    return found ? (lang === "en" ? found.en : found.he) : slug;
  };

  return (
    <div className="shell">
      <header className="shell__header">
        <span className="circle glass" aria-hidden="true">
          <PinIcon />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t.search.searchingNear}</div>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{cityLabel(city)}</div>
        </div>
        <button
          type="button"
          className="circle glass"
          aria-label={t.home.openFilters}
          onClick={() => navigate("/filters")}
        >
          <SlidersIcon />
        </button>
      </header>

      <label className="searchbar glass" style={{ margin: "14px 20px 0" }}>
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

      <div className="chips" role="tablist" aria-label={t.search.searchingNear}>
        {CITIES.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            className="chip"
            aria-pressed={city === entry.slug}
            onClick={() => setCity(entry.slug)}
          >
            {lang === "en" ? entry.en : entry.he}
          </button>
        ))}
      </div>

      <div className="chips" role="tablist" style={{ paddingTop: 0 }}>
        <button
          type="button"
          className="chip"
          aria-pressed={diet === null}
          onClick={() => setDiet(null)}
        >
          {t.search.allFilter}
        </button>
        {DIET_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={diet === value}
            onClick={() => setDiet(value)}
          >
            {t.diet[value]}
          </button>
        ))}
      </div>

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : results.length === 0 && trimmedQuery ? (
          <EmptyQuery query={trimmedQuery} onClear={() => setQuery("")} />
        ) : (data?.total ?? 0) === 0 ? (
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
              setDiet(null);
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

      <TabBar />
    </div>
  );
}
