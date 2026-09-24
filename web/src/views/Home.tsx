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
 * one control per job. With an origin pinned home is a distance search and sends the
 * bar's radius; with none it asks for every place in the database, page by page,
 * and the radius — which would have nothing to measure from — leaves the bar. The
 * other facets go out through `toSearchFilters`, and a changed request is what
 * re-runs the search.
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
  NothingHere,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { SaveToListHost } from "../components/SaveToListSheet";
import { TabBar } from "../components/TabBar";
import { InstallPrompt } from "../components/InstallPrompt";
import { PAGE_SIZE } from "../config";
import { toSearchFilters } from "../filters/model";
import { anyFilterActive, type FilterId } from "../filters/registry";
import { useFilters } from "../filters/useFilters";
import { useOrigin } from "../location/useOrigin";
import { isNetworkError, usePagedSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";
import { absoluteUrl } from "../seo/head";
import { useDocumentHead } from "../seo/useDocumentHead";

/** A radius needs a centre; with nothing pinned the chip would measure from nowhere. */
const WITHOUT_ORIGIN: readonly FilterId[] = ["radius"];

/**
 * The site's own structured data, declared on its front page. Name and languages
 * only — no `SearchAction`, because a sitelinks search box would hand Google a
 * query URL that lands behind the onboarding gate.
 */
const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Kashroot",
  url: absoluteUrl("/"),
  inLanguage: ["he", "en"],
};

export function Home() {
  const { t } = useI18n();
  useDocumentHead({ description: t.seo.siteDescription, canonicalPath: "/", jsonLd: WEBSITE_JSON_LD });
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  // Where "near me" is measured from: the device, a typed address, or nowhere —
  // then the list is the whole database. The sheet sets it; the header only reports it.
  const { origin, source, addressLabel, resolving } = useOrigin();
  // The bar and this request read one store, so a chip tapped there re-runs this.
  const { filters, reset: resetFilters } = useFilters();
  const [pickingPlace, setPickingPlace] = useState(false);
  const [query, setQuery] = useState("");

  // What the header says we are searching near. The device names itself, a typed
  // address is quoted back verbatim, and nothing pinned is said as what it is.
  const placeLabel =
    source === "device" ? t.map.youAreHere : (addressLabel ?? t.origin.everywhere);

  // Null while the device is still being asked on first load: "everywhere" is the
  // last resort, so the unscoped list is not fetched until the device has answered.
  const request = useMemo<SearchRequest | null>(() => {
    if (resolving) return null;
    const facets = toSearchFilters(filters);
    return {
      profile: toPayload(profile),
      // A centre and a radius only when there is a point to measure from. Never a
      // city: the app has no such concept, and the server needs neither.
      ...(origin ? { center: origin, radius_km: filters.radiusKm } : {}),
      page_size: PAGE_SIZE,
      ...(facets ? { filters: facets } : {}),
    };
  }, [profile, filters, origin, resolving]);

  const { items: results, total, loading, loadingMore, error, reload, hasMore, loadMore } =
    usePagedSearch(request);

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
            {origin ? t.home.nearYou : t.origin.searchingEverywhere}
          </span>
          <span className="header__place">{placeLabel}</span>
        </button>
        <span className="circle glass" aria-hidden="true">
          <BellIcon />
        </span>
      </header>

      {/* Home does not search by name itself — it answers "what is near me". The
          field hands the query to /search, the screen that can filter by name, address
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
            : t.home.resultsTitle(total)}
      </h1>

      <FilterBar exclude={origin ? [] : WITHOUT_ORIGIN} />

      <div className="shell__scroll" style={{ paddingTop: 10 }}>
        {error && isNetworkError(error) && <OfflineBanner />}
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : total === 0 && !anyFilterActive(filters) ? (
          // No rows at all, before the profile was applied: a data gap, not a
          // verdict. Saying "nothing matches your profile" here would blame the
          // product's core promise for a hole in the corpus.
          <NothingHere
            place={origin ? placeLabel : null}
            onChangePlace={() => setPickingPlace(true)}
          />
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
            {/* Said for screen readers on every page fetched: the grid grows in
                place, and the heading above already carries the count once. */}
            <p className="sr-only" role="status">
              {t.home.resultsTitle(total)}
            </p>
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
            {/* A distance search can only see geocoded venues; an unscoped one sees
                everything we hold, which is still not everything there is. Say so,
                quietly, rather than letting the count read as "this is everything". */}
            <p className="hint" style={{ paddingBottom: 8 }}>
              {origin ? t.states.coverageNoteNearby : t.states.coverageNoteEverywhere}
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
