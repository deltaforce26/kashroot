/**
 * Map — verdict-coloured pins with a popup card over the one you tapped.
 *
 * Marker colour is the API's verdict, drawn from the same CSS custom properties as
 * the pills, so the map introduces no new colour language and follows the light/dark
 * theme without a second palette. The map never re-ranks or filters anything.
 *
 * The card belongs to a pin, so it is anchored to that pin rather than parked at the
 * bottom of the screen: tapping a pin floats its card just above it, tapping the same
 * pin again — or the map, or Escape — puts it away. That frees the bottom of the
 * screen for the tab bar every other full screen has. Nothing is selected on arrival,
 * so the map opens as a map.
 *
 * The popup is a real React card portalled into an `AdvancedMarkerElement`'s content
 * node, which is what buys the anchoring for free: Google keeps the node glued to its
 * coordinate through every pan and zoom, where a hand-positioned overlay would have to
 * re-derive pixels on every `bounds_changed` and still drift mid-gesture.
 *
 * Pins are `AdvancedMarkerElement`, which takes a DOM node rather than the deprecated
 * `Marker`'s symbol path — so the dot is a styled div and the colour comes straight
 * from the same custom property. Advanced markers only render on a map created with a
 * map ID, which is why the map is constructed with one; see `useGoogleMaps`.
 *
 * When there is no maps key, or the script fails to load — a blocked CDN, an
 * exhausted quota, or simply being offline — the screen falls back to the design's
 * striped placeholder with one line saying why, and the list is one tap away. It
 * never shows a bare grey rectangle or a Google error overlay.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import type { SearchRequest, Verdict } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { ChevronIcon, CloseIcon, PinIcon } from "../components/icons";
import { tintClass } from "../components/RestaurantCard";
import { ErrorState } from "../components/states";
import { TabBar } from "../components/TabBar";
import { MAX_RADIUS_KM } from "../config";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { MAP_ID, useGoogleMaps } from "../map/useGoogleMaps";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";

/** Above the pins and above "you are here", so a card is never half-hidden by a dot. */
const POPUP_Z = 30;

/**
 * How far the camera moves up when a card opens, in pixels. `panTo` would centre the
 * pin and let the card run into the top controls, so the pin is left sitting below
 * centre with the card in the clear space above it.
 */
const POPUP_PAN_UP = 80;

/** Reads a verdict colour from the live theme so map and pills cannot drift apart. */
function verdictColour(verdict: Verdict): string {
  const token = verdict === "match" ? "--green" : verdict === "no_match" ? "--red" : "--amber";
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || "#6b6b6b";
}

/** The filled circle in a white ring, grown a little while its card is open. */
function styleDot(dot: HTMLElement, colour: string, selected: boolean): void {
  const diameter = selected ? 22 : 16;
  dot.style.cssText = [
    `width:${diameter}px`,
    `height:${diameter}px`,
    "box-sizing:border-box",
    "border-radius:50%",
    `background:${colour}`,
    `border:${selected ? 3 : 2.5}px solid #fff`,
  ].join(";");
}

/** A pin's visual as a DOM node, which is what an advanced marker takes. */
function markerDot(colour: string, selected: boolean): HTMLElement {
  const dot = document.createElement("div");
  styleDot(dot, colour, selected);
  return dot;
}

/** What a tap on a pin does: open that card, or close the one already open. */
export function nextOpenId(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

/**
 * The card that floats over a pin: the name, who certifies it and how far it is, and
 * the one action worth taking from a map. The verdict is not repeated here — the pin
 * under the card is already coloured by it, and the restaurant screen spells it out.
 */
function MapPopupCard({ item, onClose }: { item: ResultView; onClose: () => void }) {
  const { t, lang } = useI18n();
  const name = pickName(lang, item.nameHe, item.nameEn);
  const tint = tintClass(item.dietType);

  return (
    // The map closes the card on its own click event, which a DOM click inside the
    // marker's content never reaches — this only guards against that changing.
    <div className="map__popup" onClick={(event) => event.stopPropagation()}>
      {/* The tail is a sibling of the card, not a child: `.card` clips to its radius,
          which would swallow anything hanging off the bottom edge. */}
      <article className={`card map__popup__card ${tint}`}>
        {/* The whole card is the link to the restaurant, with the close button and the
            navigate link raised above it — the same shape as the search tile. */}
        <Link to={`/r/${item.id}`} className="card__link" aria-label={name} />
        <button
          type="button"
          className="map__popup__close card__above"
          aria-label={t.map.closeCard}
          onClick={onClose}
        >
          <CloseIcon size={13} />
        </button>
        <span className="card__title">{name}</span>
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
          >
            {t.restaurant.navigate}
          </a>
        </div>
      </article>
      <span className={`map__popup__tail ${tint}`} aria-hidden="true" />
    </div>
  );
}

export function MapView() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { city } = useCity();
  const { origin, source, requestDeviceLocation } = useOrigin(city);
  const { status: mapsStatus, libs } = useGoogleMaps(lang);

  // The open card, by restaurant id. Nothing is open on arrival.
  const [openId, setOpenId] = useState<string | null>(null);
  // The marker content node the card is portalled into, once there is one.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<
    { id: string; verdict: Verdict; marker: google.maps.marker.AdvancedMarkerElement }[]
  >([]);
  const meMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  // Read by the marker-building effect, which must not rebuild every pin just because
  // the selection moved — the restyle effect below handles that.
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

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
  const open = useMemo(
    () => (openId === null ? null : (plotted.find((item) => item.id === openId) ?? null)),
    [plotted, openId],
  );

  useEffect(() => setOpenId(null), [city.slug, source]);

  // A reload can drop the place whose card is open — a different profile, a different
  // origin — and a card for something no longer on the map would be a lie.
  useEffect(() => {
    if (openId !== null && !plotted.some((item) => item.id === openId)) setOpenId(null);
  }, [plotted, openId]);

  // Create the map once the script is ready and the container is mounted.
  useEffect(() => {
    if (mapsStatus !== "ready" || !libs || !containerRef.current || mapRef.current) return;
    const map = new libs.maps.Map(containerRef.current, {
      center: { lat: origin.lat, lng: origin.lon },
      zoom: 14,
      mapId: MAP_ID,
      disableDefaultUI: true,
      gestureHandling: "greedy",
      clickableIcons: false,
    });
    // Tapping the map itself puts the card away. Taps inside the card are DOM events
    // on the marker's content node and never reach this listener.
    map.addListener("click", () => setOpenId(null));
    mapRef.current = map;
  }, [mapsStatus, libs, origin]);

  // Redraw markers whenever results or theme change — not on selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libs) return;

    for (const entry of markersRef.current) entry.marker.map = null;
    markersRef.current = plotted.map((item) => {
      const marker = new libs.marker.AdvancedMarkerElement({
        map,
        position: { lat: item.geo!.lat, lng: item.geo!.lon },
        title: pickName(lang, item.nameHe, item.nameEn),
        zIndex: item.id === openIdRef.current ? 10 : 1,
        // A dot marks a point, so it sits centred on it rather than standing on it
        // the way a teardrop pin would — which is the anchor an advanced marker
        // uses by default.
        anchorTop: "-50%",
        gmpClickable: true,
        content: markerDot(verdictColour(item.kashrut.verdict), item.id === openIdRef.current),
      });
      marker.addListener("gmp-click", () => setOpenId((current) => nextOpenId(current, item.id)));
      return { id: item.id, verdict: item.kashrut.verdict, marker };
    });

    return () => {
      for (const entry of markersRef.current) entry.marker.map = null;
      markersRef.current = [];
    };
  }, [plotted, libs, lang]);

  // Selection only changes how a pin looks, so it restyles the existing nodes rather
  // than tearing the whole layer down and building it again.
  useEffect(() => {
    for (const entry of markersRef.current) {
      const selected = entry.id === openId;
      const dot = entry.marker.content;
      if (dot instanceof HTMLElement) styleDot(dot, verdictColour(entry.verdict), selected);
      entry.marker.zIndex = selected ? 10 : 1;
    }
  }, [openId, plotted, lang]);

  // The open card, as one more marker whose content React owns.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libs || !open?.geo) return;
    const host = document.createElement("div");
    // The API can mark a non-clickable marker's wrapper `pointer-events: none`; a
    // descendant is allowed to turn them back on, and this card is all taps.
    host.style.pointerEvents = "auto";
    const marker = new libs.marker.AdvancedMarkerElement({
      map,
      position: { lat: open.geo.lat, lng: open.geo.lon },
      // The card stands entirely above its point, the way a speech bubble does.
      anchorTop: "-100%",
      zIndex: POPUP_Z,
      content: host,
    });
    setPopupHost(host);
    return () => {
      marker.map = null;
      setPopupHost(null);
    };
  }, [open, libs]);

  // Keyboard users cannot tap the map to dismiss, so Escape does it — same as the sheets.
  useEffect(() => {
    if (openId === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenId(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openId]);

  // "You are here", only when a real device position is in use.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libs) return;
    if (meMarkerRef.current) meMarkerRef.current.map = null;
    meMarkerRef.current = null;
    if (source !== "device") return;
    meMarkerRef.current = new libs.marker.AdvancedMarkerElement({
      map,
      position: { lat: origin.lat, lng: origin.lon },
      title: t.map.youAreHere,
      zIndex: 20,
      anchorTop: "-50%",
      content: markerDot("#1a73e8", false),
    });
  }, [source, origin, libs, t.map.youAreHere]);

  // Bring the open card into view: its pin below centre, the card in the space above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !open?.geo) return;
    map.panTo({ lat: open.geo.lat, lng: open.geo.lon });
    map.panBy(0, -POPUP_PAN_UP);
  }, [open]);

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
          // Home, not history: the map and its list toggle between each other, so
          // "back" through history can bounce between the two instead of leaving.
          onClick={() => navigate("/")}
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
          <PinIcon size={16} />
        </button>
      </div>

      {/* A map is a picture, so how many places are on it is the one thing a screen
          reader cannot get from it. Announced, not drawn: the map itself is the view. */}
      <p className="sr-only" role="status">
        {loading ? t.states.loadingShort : t.map.pinsShown(plotted.length)}
      </p>

      {/* A search that failed leaves an empty map, which reads as "nothing here"
          rather than "we could not ask" — so the failure is said out loud, over the
          map, and the retry is right there. */}
      {error && mapsStatus === "ready" && (
        <div className="map__notice">
          <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
        </div>
      )}

      {popupHost && open
        ? createPortal(<MapPopupCard item={open} onClose={() => setOpenId(null)} />, popupHost)
        : null}

      <TabBar />
    </div>
  );
}
