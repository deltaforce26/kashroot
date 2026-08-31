/**
 * Home — location header, search field, category chips, 2-up tinted result grid.
 *
 * The count of what was *checked* — never of what "matched": with this corpus a
 * large share of results are UNKNOWN, and a "23 restaurants match you" banner over
 * a list of grey pills would be the one dishonest sentence in the app — is no longer
 * drawn as a headline, because the search field takes that band. It stays as the
 * screen's `<h1>`, visually hidden, so the page keeps a real heading and the count
 * is still there for anyone reading with a screen reader.
 *
 * Two design elements are dropped rather than faked: the "14 open now" subtitle and
 * the "open now" chip. Israel hours logic is out of POC scope, so the API returns no
 * open-now state and a chip that silently did nothing would be worse than no chip.
 *
 * The chips filter by published diet type. The comp draws category chips (bakeries,
 * ice cream, cafés) and the corpus has no category field, so those would be chips
 * that cannot filter anything — see the note on `search.allFilter` in strings.ts.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAX_QUERY_LENGTH, type DietType, type SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { BellIcon, PinIcon, SearchIcon, SlidersIcon } from "../components/icons";
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
import { isDefault, useFilters } from "../filters/useFilters";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

type HomeFilter = "all" | DietType;

export function Home() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  const { city } = useCity();
  // Where "near me" is measured from: the device, a typed address, or this city's
  // centre. The sheet sets it; the header only reports it.
  const { origin, source, addressLabel } = useOrigin(city);
  // The chips and the filters screen are two views of one state, so a kitchen picked
  // in either shows as picked in the other.
  const { filters, setFilters } = useFilters();
  const filter: HomeFilter = filters.diet ?? "all";
  const [pickingPlace, setPickingPlace] = useState(false);
  const [query, setQuery] = useState("");

  const setFilter = (next: HomeFilter) => setFilters({ diet: next === "all" ? null : next });

  // What the header says we are searching near. The device names itself, a typed
  // address is quoted back verbatim, and a city falls back to its area label.
  const placeLabel =
    source === "device"
      ? t.map.youAreHere
      : (addressLabel ?? (lang === "en" ? city.areaEn : city.areaHe));

  const request = useMemo<SearchRequest>(
    () => ({
      profile: toPayload(profile),
      center: origin,
      radius_km: filters.radiusKm,
      page_size: PAGE_SIZE,
      ...(filters.diet ? { filters: { diet_type: filters.diet } } : {}),
    }),
    [profile, filters, origin],
  );

  const { data, loading, error, reload } = useSearch(request);
  const results = data?.items ?? [];

  // The four kitchens, as a shortcut for the same control on /filters. The map used
  // to sit here as a sixth chip; it is a tab now, so a chip that navigated away
  // would be the odd one out in a row of filters.
  const chips: Array<[HomeFilter, string]> = [
    ["all", t.home.tabs.all],
    ["meat", t.home.tabs.meat],
    ["dairy", t.home.tabs.dairy],
    ["pareve", t.home.tabs.pareve],
  ];

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
        style={{ margin: "14px 20px 0" }}
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
        <button
          type="button"
          className={`searchbar__icon${isDefault(filters) ? "" : " searchbar__flag"}`}
          aria-label={isDefault(filters) ? t.home.openFilters : t.home.filtersActive}
          onClick={() => navigate("/filters")}
        >
          <SlidersIcon size={17} />
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

      <div className="chips" role="tablist">
        {chips.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={key === filter}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : results.length === 0 ? (
          <EmptyResults
            onWidenProfile={() => navigate("/profile")}
            onShowAll={() => setFilter("all")}
          />
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
