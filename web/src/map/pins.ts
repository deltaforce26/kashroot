/**
 * Map pins, and the fallback that stops one unbuildable pin from taking the whole
 * screen down with it.
 *
 * The pin the design asks for is `AdvancedMarkerElement`: it takes a DOM node, so a
 * verdict dot is a styled div coloured straight from the theme's custom properties,
 * and the open card is a React card portalled into a second marker's content node —
 * anchored to its coordinate by Google through every pan and zoom.
 *
 * That marker is a custom element the Maps API registers for us, and in a browser
 * where that registration has not happened — a second copy of the API on the page, a
 * half-loaded module, a blocked `customElements.define` — its constructor throws
 * from deep inside the API: `Cannot read properties of undefined (reading 'keys')`,
 * thrown while Lit reads a property table the unregistered class never got. Pins are
 * built inside a render effect, so that throw reached the error boundary and
 * replaced the map, the cards and the way back with the crash page, for a missing
 * dot.
 *
 * So the map degrades instead of throwing:
 *   - a pin is an advanced marker, or the deprecated `Marker` with a circle symbol
 *     of the same size and colour, or nothing at all;
 *   - the open card's anchor is an advanced marker, or an `InfoWindow` holding the
 *     same React card — plainer, still anchored to the right point — or nothing, in
 *     which case the map still pans and the list is one tap away.
 *
 * The first failure is remembered for the rest of the session, so a hundred results
 * cost one thrown constructor rather than a hundred.
 */

/** How a pin is drawn right now. The open card's pin is the larger one. */
export interface PinStyle {
  /** Already resolved from the theme — pins never decide a verdict colour. */
  colour: string;
  selected: boolean;
  zIndex: number;
}

/** Everything a pin needs at birth. */
export interface PinSpec extends PinStyle {
  map: google.maps.Map;
  position: google.maps.LatLngLiteral;
  title: string;
  onClick?: () => void;
}

/**
 * A placed pin, reduced to what the map screen does with it. Both marker kinds are
 * restyled and detached the same way from here; they spell it differently inside.
 */
export interface Pin {
  /** Selection only changes how a pin looks, so it is never rebuilt for that. */
  update(style: PinStyle): void;
  remove(): void;
}

/** The anchor holding the open card at its restaurant's point. */
export interface PopupAnchor {
  remove(): void;
}

/** Diameter of the dot in pixels, and the width of its white ring. */
const SIZE = { plain: 16, selected: 22 } as const;
const RING = { plain: 2.5, selected: 3 } as const;

/** Set once an advanced marker has thrown; see the note about a hundred results. */
let advancedMarkersBroken = false;

/** Test seam: forget what this session learned about advanced markers. */
export function resetPinSupport(): void {
  advancedMarkersBroken = false;
}

/** True once advanced markers have been found unusable in this browser. */
export function advancedMarkersUnavailable(): boolean {
  return advancedMarkersBroken;
}

/**
 * The user gets pins that still work; an engineer gets the reason they are the old
 * kind. Same split as `useApi` and the error boundary: one console line, never a
 * screen.
 */
function reportBroken(what: string, error: unknown): void {
  advancedMarkersBroken = true;
  console.error(`[kashroot] advanced markers unusable, ${what}:`, error);
}

/** The filled circle in a white ring, grown a little while its card is open. */
export function styleDot(dot: HTMLElement, style: PinStyle): void {
  const diameter = style.selected ? SIZE.selected : SIZE.plain;
  dot.style.cssText = [
    `width:${diameter}px`,
    `height:${diameter}px`,
    "box-sizing:border-box",
    "border-radius:50%",
    `background:${style.colour}`,
    `border:${style.selected ? RING.selected : RING.plain}px solid #fff`,
  ].join(";");
}

/** A pin's visual as a DOM node, which is what an advanced marker takes. */
function markerDot(style: PinStyle): HTMLElement {
  const dot = document.createElement("div");
  styleDot(dot, style);
  return dot;
}

/**
 * The same dot as a classic marker's symbol. `scale` is a radius, so it is half the
 * diameter the advanced pin gets: the two kinds must be the same size on screen.
 */
function dotSymbol(style: PinStyle): google.maps.Symbol {
  return {
    path: circlePath(),
    scale: (style.selected ? SIZE.selected : SIZE.plain) / 2,
    fillColor: style.colour,
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: style.selected ? RING.selected : RING.plain,
  };
}

/**
 * `SymbolPath.CIRCLE`, read defensively: this module is unit tested against a stub
 * marker library, where there is no global `google` to read an enum from.
 */
function circlePath(): google.maps.SymbolPath {
  const fromApi = typeof google !== "undefined" ? google?.maps?.SymbolPath?.CIRCLE : undefined;
  return fromApi ?? (0 as google.maps.SymbolPath);
}

function advancedPin(lib: google.maps.MarkerLibrary, spec: PinSpec): Pin {
  const marker = new lib.AdvancedMarkerElement({
    map: spec.map,
    position: spec.position,
    title: spec.title,
    zIndex: spec.zIndex,
    // A dot marks a point, so it sits centred on it rather than standing on it the
    // way a teardrop pin would — which is the anchor an advanced marker uses by
    // default.
    anchorTop: "-50%",
    gmpClickable: true,
    content: markerDot(spec),
  });
  if (spec.onClick) marker.addListener("gmp-click", spec.onClick);
  return {
    update(style) {
      if (marker.content instanceof HTMLElement) styleDot(marker.content, style);
      marker.zIndex = style.zIndex;
    },
    remove() {
      marker.map = null;
    },
  };
}

function legacyPin(lib: google.maps.MarkerLibrary, spec: PinSpec): Pin {
  const marker = new lib.Marker({
    map: spec.map,
    position: spec.position,
    title: spec.title,
    zIndex: spec.zIndex,
    icon: dotSymbol(spec),
  });
  if (spec.onClick) marker.addListener("click", spec.onClick);
  return {
    update(style) {
      marker.setIcon(dotSymbol(style));
      marker.setZIndex(style.zIndex);
    },
    remove() {
      marker.setMap(null);
    },
  };
}

/**
 * Places one pin, or returns `null` when this browser can draw neither kind.
 *
 * Never throws: the map screen builds pins inside a render effect, and a throw there
 * costs the user the whole screen.
 */
export function createPin(lib: google.maps.MarkerLibrary, spec: PinSpec): Pin | null {
  if (!advancedMarkersBroken) {
    try {
      return advancedPin(lib, spec);
    } catch (error) {
      reportBroken("falling back to classic pins", error);
    }
  }
  try {
    return legacyPin(lib, spec);
  } catch (error) {
    console.error("[kashroot] could not place a map pin:", error);
    return null;
  }
}

/** What the open card's anchor needs: where to sit, and the node React draws into. */
export interface PopupSpec {
  map: google.maps.Map;
  position: google.maps.LatLngLiteral;
  /** The card's host node, portalled into by the map screen. */
  host: HTMLElement;
  zIndex: number;
}

/**
 * Anchors the open card to its point, or returns `null` when neither anchor can be
 * built — the map keeps working, a tapped pin simply opens nothing.
 *
 * Never throws, for the same reason `createPin` does not.
 */
export function createPopupAnchor(
  maps: google.maps.MapsLibrary,
  markerLib: google.maps.MarkerLibrary,
  spec: PopupSpec,
): PopupAnchor | null {
  if (!advancedMarkersBroken) {
    try {
      const marker = new markerLib.AdvancedMarkerElement({
        map: spec.map,
        position: spec.position,
        // The card stands entirely above its point, the way a speech bubble does.
        anchorTop: "-100%",
        zIndex: spec.zIndex,
        content: spec.host,
      });
      return {
        remove() {
          marker.map = null;
        },
      };
    } catch (error) {
      reportBroken("the open card falls back to an info window", error);
    }
  }
  try {
    // Google's own bubble, holding our card: plainer chrome than the design draws,
    // but anchored to the same point and carrying the same React node. Only ever
    // seen in a browser that cannot build an advanced marker at all.
    const info = new maps.InfoWindow({ content: spec.host, position: spec.position });
    info.open({ map: spec.map });
    return {
      remove() {
        info.close();
      },
    };
  } catch (error) {
    console.error("[kashroot] could not anchor the map card:", error);
    return null;
  }
}
