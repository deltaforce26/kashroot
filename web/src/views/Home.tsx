/**
 * Home — location header, search field, filter bar, 2-up tinted result grid.
 *
 * The count of what was *checked* — never of what "matched": with this corpus a
 * large share of results are UNKNOWN, and a "23 restaurants match you" banner over
 * a list of grey pills would be the one dishonest sentence in the app — is no longer
 * drawn as a headline, because the search field takes that band. It stays as the
 * screen's `<h1>`, visually hidden, so the page keeps a real heading and the count
 * is still there for anyone reading with a screen reader.
 *
 * The filter bar (components/filters/FilterBar.tsx) took the place of the kitchen
 * chips, and its sliders button the place of the one that sat in the search field —
 * one control per job. Home is the distance search, so it is the screen that sends
 * the bar's radius; the other facets go out through `toSearchFilters`, and a changed
 * request is what re-runs the search.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAX_QUERY_LENGTH, type SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { FilterBar } from "../components/filters/FilterBar";
import { BellIcon, PinIcon, SearchIcon } from "../components/icons";
import { LocationSheet } from "../components/LocationSheet";
import { RestaurantGridCard } from "../components/RestaurantCard";
import {
  EmptyResults,
  ErrorState,
  LoadingList,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { SaveToListHost } from "../components/SaveToListSheet";
import { TabBar } from "../components/TabBar";
import { InstallPrompt } from "../components/InstallPrompt";
import { PAGE_SIZE } from "../config";
import { toSearchFilters } from "../filters/model";
import { useFilters } from "../filters/useFilters";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

export function Home() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  const { city } = useCity();
  // Where "near me" is measured from: the device, a typed address, or this city's
  // centre. The sheet sets it; the header only reports it.
  const { origin, source, addressLabel } = useOrigin(city);
  // The bar and this request read one store, so a chip tapped there re-runs this.
  const { filters, reset: resetFilters } = useFilters();
  const [pickingPlace, setPickingPlace] = useState(false);
  const [query, setQuery] = useState("");

  // What the header says we are searching near. The device names itself, a typed
  // address is quoted back verbatim, and a city falls back to its area label.
  const placeLabel =
    source === "device"
      ? t.map.youAreHere
      : (addressLabel ?? (lang === "en" ? city.areaEn : city.areaHe));

  const request = useMemo<SearchRequest>(() => {
    const facets = toSearchFilters(filters);
    return {
      profile: toPayload(profile),
      center: origin,
      radius_km: filters.radiusKm,
      page_size: PAGE_SIZE,
      ...(facets ? { filters: facets } : {}),
    };
  }, [profile, filters, origin]);

  const { data, loading, error, reload } = useSearch(request);
  const results = data?.items ?? [];

  return (
    <div className="shell">
      <header className="shell__header">
        <button
          type="button"
          className="circle glass"
          aria-label={t.home.changeLocation}
          aria-expanded={pickingPlace}
          onClick={() => setPickingPlace(true)}
        >
          <PinIcon />
        </button>
        <button
          type="button"
          style={{ flex: 1, textAlign: "start", minWidth: 0 }}
          aria-label={t.home.changeLocation}
          aria-expanded={pickingPlace}
          onClick={() => setPickingPlace(true)}
        >
          <span style={{ display: "block", fontSize: 11.5, color: "var(--sub)" }}>
            {t.home.nearYou}
          </span>
          <span className="header__place">{placeLabel}</span>
        </button>
        <span className="circle glass" aria-hidden="true">
          <BellIcon />
        </span>
      </header>

      {/* Home does not search by name itself — it answers "what is near me". The
          field hands the query to /search, the screen that can filter by name, city
          and diet type together. */}
      <form
        className="searchbar glass"
        style={{ margin: "14px var(--gutter) 0" }}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = query.trim();
          navigate(trimmed ? "/search?q=" + encodeURIComponent(trimmed) : "/search");
        }}
      >
        <span className="searchbar__icon" aria-hidden="true">
          <SearchIcon size={17} />
        </span>
        <input
          type="search"
          className="searchbar__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.home.searchPlaceholder}
          aria-label={t.home.searchPlaceholder}
          maxLength={MAX_QUERY_LENGTH}
        />
        {/* The comp draws no submit control — you press Enter — but a form whose
            only submit path is a keypress is unusable by anyone driving it another
            way, so the button exists and is simply not drawn. */}
        <button type="submit" className="sr-only">
          {t.nav.search}
        </button>
      </form>

      {/*
        The page heading. The comp draws no headline — the search field takes that
        band — but the screen still needs one, and the count of what was *checked* is
        the honest thing to put in it. It is a finding, so it may only be stated when
        there is one: a failed request announcing "0 restaurants checked for you"
        would claim we looked and found nothing, when we never got an answer at all.
      */}
      <h1 className="sr-only">
        {error
          ? t.states.errorTitle
          : loading
            ? t.states.loading
            : t.home.resultsTitle(data?.total ?? 0)}
      </h1>

      <FilterBar />

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : results.length === 0 ? (
          <EmptyResults onWidenProfile={() => navigate("/profile")} onShowAll={resetFilters} />
        ) : (
          <>
            {!hasVerifiedMatch(results) && <NoVerifiedMatchesBanner />}
            <div className="grid">
              {results.map((item) => (
                <RestaurantGridCard
                  key={item.id}
                  item={item}
                  saved={isSaved(item.id)}
                  onToggleSave={toggle}
                />
              ))}
            </div>
            {/* The count above comes from a distance search, which can only see
                geocoded venues. Say so, quietly, rather than letting it read as
                "this is everything here". */}
            <p className="hint" style={{ paddingBottom: 8 }}>
              {t.states.coverageNoteNearby}
            </p>
          </>
        )}
      </div>

      {pickingPlace && <LocationSheet onClose={() => setPickingPlace(false)} />}
      <InstallPrompt />
      <SaveToListHost />
      <TabBar />
    </div>
  );
}
