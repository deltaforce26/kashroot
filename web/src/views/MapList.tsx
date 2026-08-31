/**
 * The map's results as a list.
 *
 * Same query, same origin and the same set of places the map plots — this is the
 * map screen with the pins unrolled into rows, not a second search. It shows what
 * the map's carousel shows (name, distance, verdict) in a form you can scan, and
 * each row is the link to that restaurant.
 *
 * It lists only geocoded records, exactly as the map does: an item with no point
 * has no pin and no distance, so putting it here would make the two screens
 * disagree about what "these results" means. The note at the foot says so.
 *
 * The header is the map's overlay controls in a static bar — same back button,
 * same Map/List toggle, same origin button — so switching between the two screens
 * moves nothing but the content underneath.
 */

import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SearchRequest } from "../api/types";
import { ChevronIcon, PinIcon, SlidersIcon } from "../components/icons";
import { tintClass } from "../components/RestaurantCard";
import { VerdictPill } from "../components/VerdictPill";
import { EmptyResults, ErrorState, LoadingList } from "../components/states";
import { TabBar } from "../components/TabBar";
import { MAX_RADIUS_KM } from "../config";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";

export function MapList() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { city } = useCity();
  const { origin, source, requestDeviceLocation } = useOrigin(city);

  // Byte-for-byte the map's request, so both screens hit the same answer and can
  // never show two different sets of places.
  const request = useMemo<SearchRequest>(
    () => ({
      profile: toPayload(profile),
      center: origin,
      radius_km: MAX_RADIUS_KM,
      page_size: 100,
    }),
    [profile, origin],
  );
  const { data, loading, error, reload } = useSearch(request);

  const plotted = useMemo(() => (data?.items ?? []).filter((item) => item.geo !== null), [data]);

  // A distance is only meaningful once you know what it was measured from, so the
  // screen says which origin produced these numbers rather than showing a bare
  // "400 m" that could mean either.
  const measuredFrom =
    source === "device"
      ? t.origin.fromDevice
      : t.origin.fromCity(lang === "en" ? city.areaEn : city.areaHe);

  return (
    <div className="shell">
      <header className="shell__header" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="circle glass"
          aria-label={t.states.back}
          onClick={() => navigate(-1)}
        >
          <ChevronIcon />
        </button>
        <span className="segmented glass" style={{ padding: "5px 4px" }}>
          <button type="button" aria-pressed={false} onClick={() => navigate("/map")}>
            {t.map.map}
          </button>
          <button type="button" aria-pressed={true}>
            {t.map.list}
          </button>
        </span>
        <button
          type="button"
          className="circle glass"
          aria-label={t.origin.useMyLocation}
          aria-pressed={source === "device"}
          onClick={requestDeviceLocation}
        >
          {source === "device" ? <PinIcon size={16} /> : <SlidersIcon size={16} />}
        </button>
      </header>

      {/* The screen's heading. Like home's, it is the count of what was *checked* —
          never of what matched — and it may only be stated once there is an answer. */}
      <h1 className="sr-only">
        {error
          ? t.states.errorTitle
          : loading
            ? t.states.loading
            : t.home.resultsTitle(plotted.length)}
      </h1>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        {loading ? (
          <LoadingList />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : plotted.length === 0 ? (
          <EmptyResults onWidenProfile={() => navigate("/profile")} />
        ) : (
          <>
            <p className="hint">{measuredFrom}</p>
            {plotted.map((item) => {
              const name = pickName(lang, item.nameHe, item.nameEn);
              return (
                <article key={item.id} className={`card card--row ${tintClass(item.dietType)}`}>
                  {/* The whole row is one stretched anchor, the same shape as the
                      map's carousel card and the search tile — so it keeps real
                      link semantics rather than being a clickable <article>. */}
                  <Link to={`/r/${item.id}`} className="card__link" aria-label={name} />
                  <span className="card__photo stripe" aria-hidden="true">
                    {t.photoPlaceholder}
                  </span>
                  <span className="card__title">{name}</span>
                  <div className="card__meta on-tint">{formatDistance(item.distanceKm, t)}</div>
                  <div className="card__foot">
                    <VerdictPill verdict={item.kashrut.verdict} />
                  </div>
                </article>
              );
            })}
            {/* Same caveat the map carries: these are the mapped records, not every
                business in the area. */}
            <p className="hint" style={{ paddingBottom: 8 }}>
              {t.map.note}
            </p>
          </>
        )}
      </div>

      <TabBar />
    </div>
  );
}
