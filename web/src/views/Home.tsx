/**
 * Home — tinted list cards, verdict pill + certifier evidence (design 3a).
 *
 * The headline counts what was *checked*, not what "matched": with this corpus a
 * large share of results are UNKNOWN, and a "23 restaurants match you" banner over
 * a list of grey pills would be the one dishonest sentence in the app.
 *
 * Two design elements are dropped rather than faked: the "14 open now" subtitle and
 * the "open now" chip. Israel hours logic is out of POC scope, so the API returns no
 * open-now state and a chip that silently did nothing would be worse than no chip.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DietType, SearchRequest } from "../api/types";
import { hasVerifiedMatch } from "../api/viewmodel";
import { BellIcon, PinIcon } from "../components/icons";
import { RestaurantRowCard } from "../components/RestaurantCard";
import {
  EmptyResults,
  ErrorState,
  LoadingList,
  NoVerifiedMatchesBanner,
  OfflineBanner,
} from "../components/states";
import { TabBar } from "../components/TabBar";
import { InstallPrompt } from "../components/InstallPrompt";
import { CITIES, NEARBY_RADIUS_KM, PAGE_SIZE } from "../config";
import { useCity } from "../location/useCity";
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
  const { city, slug, setSlug } = useCity();
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [pickingCity, setPickingCity] = useState(false);

  const request = useMemo<SearchRequest>(
    () => ({
      profile: toPayload(profile),
      center: city.center,
      radius_km: NEARBY_RADIUS_KM,
      page_size: PAGE_SIZE,
      ...(filter === "all" ? {} : { filters: { diet_type: filter } }),
    }),
    [profile, filter, city],
  );

  const { data, loading, error, reload } = useSearch(request);
  const results = data?.items ?? [];

  const chips: Array<[HomeFilter | "map", string]> = [
    ["all", t.home.tabs.all],
    ["meat", t.home.tabs.meat],
    ["dairy", t.home.tabs.dairy],
    ["pareve", t.home.tabs.pareve],
    ["map", t.home.tabs.map],
  ];

  return (
    <div className="shell">
      <header className="shell__header">
        <button
          type="button"
          className="circle glass"
          aria-label={t.home.changeCity}
          aria-expanded={pickingCity}
          onClick={() => setPickingCity((open) => !open)}
        >
          <PinIcon />
        </button>
        <button
          type="button"
          style={{ flex: 1, textAlign: "start" }}
          aria-label={t.home.changeCity}
          aria-expanded={pickingCity}
          onClick={() => setPickingCity((open) => !open)}
        >
          <span style={{ display: "block", fontSize: 11.5, color: "var(--sub)" }}>
            {t.home.yourLocation}
          </span>
          <span style={{ display: "block", fontWeight: 700, fontSize: 15.5 }}>
            {lang === "en" ? city.areaEn : city.areaHe}
          </span>
        </button>
        <span className="circle glass" aria-hidden="true">
          <BellIcon />
        </span>
      </header>

      {pickingCity && (
        <div className="chips" role="group" aria-label={t.home.changeCity}>
          {CITIES.map((option) => (
            <button
              key={option.slug}
              type="button"
              className="chip"
              aria-pressed={option.slug === slug}
              onClick={() => {
                setSlug(option.slug);
                setPickingCity(false);
              }}
            >
              {lang === "en" ? option.en : option.he}
            </button>
          ))}
        </div>
      )}

      {/*
        The count is a finding, so it may only appear when there is one. A failed
        request rendering "0 restaurants checked for you" claims we looked and found
        nothing, when we never got an answer at all — the same class of dishonesty as
        calling an empty city a kashrut result. While loading or after an error, the
        headline is simply absent and the state below speaks instead.
      */}
      <div style={{ padding: "16px 20px 0", flex: "none" }}>
        {error ? (
          <h1 style={{ font: "700 22px/1.25 Assistant, sans-serif", margin: 0 }}>
            {t.states.errorTitle}
          </h1>
        ) : loading ? (
          <h1 style={{ font: "700 22px/1.25 Assistant, sans-serif", margin: 0 }}>
            {t.states.loading}
          </h1>
        ) : (
          <>
            <h1 style={{ font: "700 22px/1.25 Assistant, sans-serif", margin: 0 }}>
              {t.home.resultsTitle(data?.total ?? 0)}
            </h1>
            <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>
              {t.home.resultsSub}
            </div>
          </>
        )}
      </div>

      <div className="chips" role="tablist">
        {chips.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={key === filter}
            onClick={() => (key === "map" ? navigate("/map") : setFilter(key as HomeFilter))}
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
            {!hasVerifiedMatch(results) && (
              <NoVerifiedMatchesBanner />
            )}
            {results.map((item) => (
            <RestaurantRowCard
              key={item.id}
              item={item}
              saved={isSaved(item.id)}
              onToggleSave={toggle}
              />
            ))}
            {/* The count above comes from a distance search, which can only see
                geocoded venues. Say so, quietly, rather than letting it read as
                "this is everything here". */}
            <p className="hint" style={{ paddingBottom: 8 }}>
              {t.states.coverageNoteNearby}
            </p>
          </>
        )}
      </div>

      <InstallPrompt />
      <TabBar />
    </div>
  );
}
