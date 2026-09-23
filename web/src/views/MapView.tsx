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
 * `Marker`'s symbol path — so a pin is Google's own teardrop, coloured straight from
 * the same custom property and carrying the verdict's glyph, the one the pill already
 * uses, in its head. Advanced markers only render on a map created with a
 * map ID, which is why the map is constructed with one; see `useGoogleMaps`. A
 * browser that cannot build one gets classic pins and a plainer card instead of a
 * crash — every marker on this screen goes through `map/pins.ts`, which never throws.
 *
 * When there is no maps key, or the script fails to load — a blocked CDN, an
 * exhausted quota, or simply being offline — the screen falls back to the design's
 * striped placeholder with one line saying why, and home is one tap away. It
 * never shows a bare grey rectangle or a Google error overlay.
 *
 * The screen carries the shared filter bar and a search field of its own, so its pins
 * answer the same question home's cards answer. A filter tapped here is the filter
 * tapped there — both read the one store in `filters/useFilters.ts` — and the reach is
 * the bar's radius rather than a fixed sweep of the server's ceiling. There is no
 * separate list screen to drift from: home is the list, and the tab bar is on screen,
 * so the map needs no back button of its own.
 */

import { LocateFixed } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { MAX_QUERY_LENGTH, type SearchRequest, type Verdict } from "../api/types";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { FilterBar } from "../components/filters/FilterBar";
import { CloseIcon, PinIcon, SearchIcon } from "../components/icons";
import { tintClass } from "../components/RestaurantCard";
import { EmptyQuery, EmptyResults, ErrorState } from "../components/states";
import { TabBar } from "../components/TabBar";
import { VERDICT_GLYPH, verdictLabel } from "../components/VerdictPill";
import { toSearchFilters } from "../filters/model";
import { useFilters } from "../filters/useFilters";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { useOrigin } from "../location/useOrigin";
import { createPin, createPopupAnchor, SELECTED_PIN_HEIGHT, type Pin } from "../map/pins";
import { MAP_ID, useGoogleMaps } from "../map/useGoogleMaps";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";

/** Above the pins and above "you are here", so a card is never half-hidden by a pin. */
const POPUP_Z = 30;

/** "You are here" sits above every result pin, and the open card's pin above the rest. */
const ME_Z = 20;
const SELECTED_Z = 10;
const PLAIN_Z = 1;

/** Google's own blue for a device position — a location, not a verdict. */
const ME_COLOUR = "#1a73e8";

/**
 * How far the camera moves up when a card opens, in pixels. `panTo` would centre the
 * pin and let the card run into the top controls, so the pin is left sitting below
 * centre with the card in the clear space above it.
 *
 * The card now starts a pin's height further up than it did over a flat dot, so the pin
 * is dropped by exactly that much to leave the air above the card where it was.
 */
const POPUP_PAN_UP = 80 + SELECTED_PIN_HEIGHT;

/** Reads a verdict colour from the live theme so map and pills cannot drift apart. */
function verdictColour(verdict: Verdict): string {
  const token = verdict === "match" ? "--green" : verdict === "no_match" ? "--red" : "--amber";
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || "#6b6b6b";
}

/** What a tap on a pin does: open that card, or close the one already open. */
export function nextOpenId(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

/** Close enough to read a street, which is what a pinned origin is worth looking at. */
const ORIGIN_ZOOM = 14;

/**
 * What the zoom becomes when the camera moves to a new origin, or null to leave it be.
 *
 * Recentring only ever zooms *in*. Someone looking at the whole city gets brought close
 * enough for their position to mean something; someone who deliberately zoomed to a
 * street keeps their street, because pulling them back out would undo a choice they made
 * with their own hands.
 */
export function nextZoom(current: number | undefined): number | null {
  if (current === undefined || current >= ORIGIN_ZOOM) return null;
  return ORIGIN_ZOOM;
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
  // The one filter store, shared with home and search, so a chip tapped here is the
  // chip tapped there and the map cannot become a third, differently-filtered answer.
  const { filters } = useFilters();
  const { origin, source, state: originState, requestDeviceLocation } = useOrigin(city);
  const { status: mapsStatus, libs } = useGoogleMaps(lang);

  // The open card, by restaurant id. Nothing is open on arrival.
  const [openId, setOpenId] = useState<string | null>(null);
  // The marker content node the card is portalled into, once there is one.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<{ id: string; verdict: Verdict; pin: Pin }[]>([]);
  const meMarkerRef = useRef<Pin | null>(null);
  // Read by the marker-building effect, which must not rebuild every pin just because
  // the selection moved — the restyle effect below handles that.
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  // Filters in place, like search's field and unlike home's, which navigates away:
  // on a map the results are the screen, so there is nowhere to navigate to.
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();

  const request = useMemo<SearchRequest>(() => {
    const facets = toSearchFilters(filters);
    return {
      profile: toPayload(profile),
      center: origin,
      // The bar's radius, not the server's ceiling: the map is a distance search with
      // a centre, so it reaches exactly as far as home reaches. `toSearchFilters`
      // leaves the radius out on purpose — it is top-level, not a facet.
      radius_km: filters.radiusKm,
      // Deliberately larger than home's PAGE_SIZE. A map is read at a glance rather
      // than paged, so it plots the whole radius where home shows its first page of
      // it — which makes the map a superset of home's cards by distance, never a
      // different set. Do not "fix" this to PAGE_SIZE and leave the screen 20 pins.
      page_size: 100,
      ...(trimmedQuery ? { query: trimmedQuery.slice(0, MAX_QUERY_LENGTH) } : {}),
      ...(facets ? { filters: facets } : {}),
    };
  }, [profile, origin, filters, trimmedQuery]);
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

    for (const entry of markersRef.current) entry.pin.remove();
    markersRef.current = plotted.flatMap((item) => {
      const selected = item.id === openIdRef.current;
      const pin = createPin(libs.marker, {
        map,
        position: { lat: item.geo!.lat, lng: item.geo!.lon },
        // A pin says its verdict in a colour and a glyph, neither of which reaches a
        // screen reader — so the title, which does, carries the word as well.
        title: `${pickName(lang, item.nameHe, item.nameEn)} · ${verdictLabel(item.kashrut.verdict, t)}`,
        colour: verdictColour(item.kashrut.verdict),
        glyph: VERDICT_GLYPH[item.kashrut.verdict],
        selected,
        zIndex: selected ? SELECTED_Z : PLAIN_Z,
        onClick: () => setOpenId((current) => nextOpenId(current, item.id)),
      });
      return pin ? [{ id: item.id, verdict: item.kashrut.verdict, pin }] : [];
    });

    return () => {
      for (const entry of markersRef.current) entry.pin.remove();
      markersRef.current = [];
    };
  }, [plotted, libs, lang]);

  // Selection only changes how a pin looks, so it restyles the existing nodes rather
  // than tearing the whole layer down and building it again.
  useEffect(() => {
    for (const entry of markersRef.current) {
      const selected = entry.id === openId;
      entry.pin.update({
        colour: verdictColour(entry.verdict),
        glyph: VERDICT_GLYPH[entry.verdict],
        selected,
        zIndex: selected ? SELECTED_Z : PLAIN_Z,
      });
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
    const anchor = createPopupAnchor(libs.maps, libs.marker, {
      map,
      position: { lat: open.geo.lat, lng: open.geo.lon },
      host,
      zIndex: POPUP_Z,
    });
    if (!anchor) return;
    setPopupHost(host);
    return () => {
      anchor.remove();
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
    if (meMarkerRef.current) meMarkerRef.current.remove();
    meMarkerRef.current = null;
    if (source !== "device") return;
    meMarkerRef.current = createPin(libs.marker, {
      map,
      position: { lat: origin.lat, lng: origin.lon },
      title: t.map.youAreHere,
      colour: ME_COLOUR,
      // Deliberately no glyph. This pin marks where the user is standing, not an answer
      // about a place — a ✓ or a ? in its head would read as a verdict on the user's own
      // position. It keeps Google's plain pin head, the way its blue is not a verdict
      // colour either.
      selected: false,
      zIndex: ME_Z,
    });
  }, [source, origin, libs, t.map.youAreHere]);

  // Bring the open card into view: its pin below centre, the card in the space above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !open?.geo) return;
    map.panTo({ lat: open.geo.lat, lng: open.geo.lon });
    map.panBy(0, -POPUP_PAN_UP);
  }, [open]);

  // The camera follows the origin. The map is built once, with its centre fixed at
  // construction, so without this the locate button silently changes what is searched
  // and where "you are here" sits while leaving the viewport on the old city centre —
  // which reads as a button that does nothing. Declared after the card effect on
  // purpose: when both want the camera in one commit, the origin is the explicit ask.
  //
  // `origin` is reference-stable — a point object written once per publish in
  // `useOrigin`, or the city's own `center` from config — so this fires on a real
  // change and never on a re-render, and the user's own panning is left alone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: origin.lat, lng: origin.lon });
    const zoom = nextZoom(map.getZoom());
    if (zoom !== null) map.setZoom(zoom);
  }, [origin, mapsStatus]);

  const mapUnavailable = mapsStatus === "absent" || mapsStatus === "error";
  const locating = originState === "requesting";

  return (
    <div className="shell">
      {/* The screen's heading, as on home: the count of what was *checked*, never of
          what matched, and only once there is an answer to state. A map is a picture,
          so this is the only heading a screen reader can get from it. */}
      <h1 className="sr-only">
        {error
          ? t.states.errorTitle
          : loading
            ? t.states.loading
            : t.home.resultsTitle(plotted.length)}
      </h1>

      {/*
        The controls float over a full-bleed map rather than sitting in a header band
        above it, which is why they are ordinary flow children with no wrapper: `.map`
        is `position: absolute; inset: 0`, so it is out of flow and these lay out at
        the top of the shell with nothing to push against.
        A wrapper would in fact break the filter sheet — `.sheet` positions against its
        nearest positioned ancestor, so an absolutely-positioned box around `FilterBar`
        would anchor the sheet to that ~120px strip instead of the shell.
        They come first so tab order and the accessibility tree read controls-then-map;
        paint order is unaffected, an explicit positive z-index beating the map's `auto`.
      */}
      <label className="searchbar glass map__search">
        <span className="searchbar__icon" aria-hidden="true">
          <SearchIcon size={17} />
        </span>
        <input
          type="search"
          className="searchbar__input"
          dir="auto"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search.placeholder}
          aria-label={t.search.placeholder}
          maxLength={MAX_QUERY_LENGTH}
        />
      </label>

      {/* Bare, like home's: the map is a distance search with a centre, so the radius
          belongs in its sheet. (Search excludes it — a city search has no centre.) */}
      <FilterBar />

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
              {/* Home is the list now, so the copy — "מעבר לרשימה" / "Go to the list",
                  and the "The list works as usual" the banner above it ends on — stays
                  true with the destination changed. */}
              <button type="button" className="cta" onClick={() => navigate("/")}>
                {t.map.toList}
              </button>
            </div>
          )}
        </div>
      )}

      {/* A map is a picture, so how many places are on it is the one thing a screen
          reader cannot get from it. Announced, not drawn: the map itself is the view. */}
      <p className="sr-only" role="status">
        {loading ? t.states.loadingShort : t.map.pinsShown(plotted.length)}
      </p>

      {/* The same coverage caveat home states in prose. A map has no room for a
          paragraph, so it is said to screen readers only — and in a line of its own,
          not inside the `role="status"` above, which would re-announce this standing
          fact every time the result count changed. */}
      <p className="sr-only">{t.map.note}</p>

      {/*
        An empty map, said out loud over it. A failed search reads as "nothing here"
        rather than "we could not ask", and now that filters and a query can empty the
        map on purpose, so does an ordinary miss — the same three states search draws
        under its list, in the one slot a map has room for.
      */}
      {mapsStatus === "ready" && (error || (!loading && plotted.length === 0)) && (
        <div className="map__notice">
          {error ? (
            <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
          ) : trimmedQuery ? (
            <EmptyQuery query={trimmedQuery} onClear={() => setQuery("")} />
          ) : (
            <EmptyResults onWidenProfile={() => navigate("/profile")} />
          )}
        </div>
      )}

      {popupHost && open
        ? createPortal(<MapPopupCard item={open} onClose={() => setOpenId(null)} />, popupHost)
        : null}

      {/* Locate belongs to the map, not to the header: it moves the picture, and it
          sits in the bottom corner where a thumb already is and where every map the
          user has ever used keeps it — just clear of the tab bar. The browser's
          permission prompt can take a beat to paint, and a tap with nothing behind it
          reads as a dead button, so the label says what is happening and a second tap
          cannot stack another request behind the first. */}
      <button
        type="button"
        className="circle glass map__locate"
        aria-label={locating ? t.origin.locating : t.origin.useMyLocation}
        aria-pressed={source === "device"}
        aria-busy={locating}
        disabled={locating}
        onClick={requestDeviceLocation}
      >
        <LocateFixed size={22} strokeWidth={2} aria-hidden />
      </button>

      <TabBar />
    </div>
  );
}
