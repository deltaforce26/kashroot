/**
 * Map — glass toggle, tinted carousel card (design 3g), now over a real Google map.
 *
 * Marker colour is the API's verdict, drawn from the same CSS custom properties as
 * the pills, so the map introduces no new colour language and follows the light/dark
 * theme without a second palette. Selecting a marker selects its carousel card and
 * the reverse; the map never re-ranks or filters anything.
 *
 * When there is no maps key, or the script fails to load — a blocked CDN, an
 * exhausted quota, or simply being offline — the screen falls back to the design's
 * striped placeholder with one line saying why, and the list is one tap away. It
 * never shows a bare grey rectangle or a Google error overlay.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SearchRequest, Verdict } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { ChevronIcon, PinIcon, SlidersIcon } from "../components/icons";
import { tintClass } from "../components/RestaurantCard";
import { VerdictPill } from "../components/VerdictPill";
import { ErrorState, LoadingList } from "../components/states";
import { MAX_RADIUS_KM } from "../config";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { useGoogleMaps } from "../map/useGoogleMaps";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";

/** Reads a verdict colour from the live theme so map and pills cannot drift apart. */
function verdictColour(verdict: Verdict): string {
  const token = verdict === "match" ? "--green" : verdict === "no_match" ? "--red" : "--amber";
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || "#6b6b6b";
}

export function MapView() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { city } = useCity();
  const { origin, source, requestDeviceLocation } = useOrigin(city);
  const { status: mapsStatus, libs } = useGoogleMaps(lang);

  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // True while the track is being scrolled by us (marker tap), so the scroll
  // handler does not fight the user's finger or echo the selection back.
  const syncingRef = useRef(false);
  const settleRef = useRef<number | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const meMarkerRef = useRef<google.maps.Marker | null>(null);

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

  // Only geocoded records can be plotted; the rest still exist in the list.
  const plotted = useMemo(() => (data?.items ?? []).filter((item) => item.geo !== null), [data]);
  const active: ResultView | undefined = plotted[Math.min(activeIndex, plotted.length - 1)];

  useEffect(() => setActiveIndex(0), [city.slug, source]);

  /**
   * Distance between two consecutive cards, measured rather than assumed so the
   * gap and side padding cannot drift out of sync with the CSS. It is negative
   * under RTL, which is exactly the sign scrollLeft uses there, so the same
   * arithmetic works in both directions.
   */
  function strideOf(track: HTMLDivElement): number {
    const [first, second] = [track.children[0], track.children[1]] as HTMLElement[];
    if (!first || !second) return 0;
    return second.offsetLeft - first.offsetLeft;
  }

  /** Index of the card currently filling the track, from its scroll offset. */
  function indexFromScroll(track: HTMLDivElement): number {
    const stride = strideOf(track);
    return stride === 0 ? 0 : Math.round(track.scrollLeft / stride);
  }

  // Finger swipe -> selection. Debounced so the marker only moves once the
  // swipe settles on a card, not on every intermediate frame.
  function onTrackScroll() {
    const track = trackRef.current;
    if (!track || syncingRef.current) return;
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      const next = Math.min(indexFromScroll(track), Math.max(plotted.length - 1, 0));
      setActiveIndex((current) => (current === next ? current : next));
    }, 90);
  }

  // Selection -> track, for the other direction: tapping a marker brings its
  // card into view. Skipped when the track is already there.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || plotted.length === 0) return;
    if (indexFromScroll(track) === activeIndex) return;
    syncingRef.current = true;
    track.scrollTo({ left: strideOf(track) * activeIndex, behavior: "smooth" });
    const done = window.setTimeout(() => {
      syncingRef.current = false;
    }, 400);
    return () => window.clearTimeout(done);
  }, [activeIndex, plotted.length]);

  useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  // Create the map once the script is ready and the container is mounted.
  useEffect(() => {
    if (mapsStatus !== "ready" || !libs || !containerRef.current || mapRef.current) return;
    mapRef.current = new libs.maps.Map(containerRef.current, {
      center: { lat: origin.lat, lng: origin.lon },
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
  }, [mapsStatus, libs, origin]);

  // Redraw markers whenever results, selection or theme change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libs) return;

    for (const marker of markersRef.current) marker.setMap(null);
    markersRef.current = plotted.map((item, index) => {
      const selected = index === activeIndex;
      const marker = new libs.marker.Marker({
        map,
        position: { lat: item.geo!.lat, lng: item.geo!.lon },
        title: pickName(lang, item.nameHe, item.nameEn),
        zIndex: selected ? 10 : 1,
        icon: {
          path: 0 as unknown as google.maps.SymbolPath, // SymbolPath.CIRCLE
          fillColor: verdictColour(item.kashrut.verdict),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: selected ? 3 : 2.5,
          scale: selected ? 11 : 8,
        },
      });
      marker.addListener("click", () => setActiveIndex(index));
      return marker;
    });

    return () => {
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
    };
  }, [plotted, activeIndex, libs, lang]);

  // "You are here", only when a real device position is in use.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libs) return;
    meMarkerRef.current?.setMap(null);
    meMarkerRef.current = null;
    if (source !== "device") return;
    meMarkerRef.current = new libs.marker.Marker({
      map,
      position: { lat: origin.lat, lng: origin.lon },
      title: t.map.youAreHere,
      zIndex: 20,
      icon: {
        path: 0 as unknown as google.maps.SymbolPath,
        fillColor: "#1a73e8",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
        scale: 7,
      },
    });
  }, [source, origin, libs, t.map.youAreHere]);

  // Keep the selected card centred.
  useEffect(() => {
    if (!mapRef.current || !active?.geo) return;
    mapRef.current.panTo({ lat: active.geo.lat, lng: active.geo.lon });
  }, [active]);

  const mapUnavailable = mapsStatus === "absent" || mapsStatus === "error";

  return (
    <div className="shell">
      {mapsStatus === "ready" ? (
        <div className="map" ref={containerRef} aria-label={t.map.map} role="application" />
      ) : (
        <div className="map">
          <div className="map__grid" aria-hidden="true">
            {t.map.placeholder(lang === "en" ? city.areaEn : city.areaHe)}
          </div>
          {mapUnavailable && (
            <div className="map__fallback">
              <div className="banner glass" role="status">
                <span style={{ color: "var(--amber)", flex: "none" }} aria-hidden="true">
                  <PinIcon size={16} />
                </span>
                <div>
                  <div className="banner__title">{t.map.unavailableTitle}</div>
                  <div className="banner__body">
                    {mapsStatus === "absent" ? t.map.unavailableNoKey : t.map.unavailableError}
                  </div>
                </div>
              </div>
              <button type="button" className="cta" onClick={() => navigate("/map/list")}>
                {t.map.toList}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="map__overlay">
        <button
          type="button"
          className="circle glass"
          aria-label={t.states.back}
          onClick={() => navigate(-1)}
        >
          <ChevronIcon />
        </button>
        <span className="segmented glass" style={{ padding: "5px 4px" }}>
          <button type="button" aria-pressed={true}>
            {t.map.map}
          </button>
          <button type="button" aria-pressed={false} onClick={() => navigate("/map/list")}>
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
      </div>

      <div className="map__carousel">
        {loading ? (
          <LoadingList rows={1} />
        ) : error ? (
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        ) : active ? (
          <>
            <div
              className="map__track"
              ref={trackRef}
              onScroll={onTrackScroll}
              aria-label={t.map.list}
            >
              {plotted.map((item, index) => (
                <article
                  key={item.id}
                  className={`card card--row map__slide ${tintClass(item.dietType)}`}
                  style={{ boxShadow: "0 6px 24px rgba(0,0,0,.14)" }}
                >
                  {/* The carousel card is itself the link to the restaurant. One
                      stretched anchor over the card, with the navigate button raised
                      above it — same shape as the search tile. */}
                  <Link
                    to={`/r/${item.id}`}
                    className="card__link"
                    aria-label={pickName(lang, item.nameHe, item.nameEn)}
                    tabIndex={index === activeIndex ? undefined : -1}
                  />
                  <span className="card__photo stripe" aria-hidden="true">
                    {t.photoPlaceholder}
                  </span>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span className="card__title">{pickName(lang, item.nameHe, item.nameEn)}</span>
                    <VerdictPill verdict={item.kashrut.verdict} />
                  </div>
                  <div className="card__meta on-tint">
                    {[certifierLabel(item, lang), formatDistance(item.distanceKm, t)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="card__foot">
                    <a
                      className="cta card__above"
                      style={{ flex: 1, padding: 9, fontSize: 13 }}
                      href={
                        item.geo
                          ? `https://www.google.com/maps/dir/?api=1&destination=${item.geo.lat},${item.geo.lon}`
                          : "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                      tabIndex={index === activeIndex ? undefined : -1}
                    >
                      {t.restaurant.navigate}
                    </a>
                  </div>
                </article>
              ))}
            </div>
            <div className="dots" aria-hidden="true">
              {plotted.slice(0, 6).map((item, index) => (
                <span key={item.id} data-on={index === activeIndex} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
