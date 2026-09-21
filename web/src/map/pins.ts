/**
 * Map pins, and the fallback that stops one unbuildable pin from taking the whole
 * screen down with it.
 *
 * The pin the design asks for is `AdvancedMarkerElement`: it takes a DOM node, so a
 * pin is Google's own `PinElement` teardrop, coloured straight from the theme's custom
 * properties and carrying the verdict's glyph in its head, and the open card is a React
 * card portalled into a second marker's content node — anchored to its coordinate by
 * Google through every pan and zoom.
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
 *   - a pin is an advanced marker, or the deprecated `Marker` with a circle symbol in
 *     the same verdict colour, or nothing at all;
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
  /**
   * Already resolved from the verdict, for the same reason the colour is: a pin draws
   * what it is handed and knows nothing about kashrut. Absent on a pin that marks a
   * place rather than an answer, which gets Google's own plain pin head instead.
   */
  glyph?: string;
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

/**
 * How much bigger a pin gets while its card is open. `1` is `PinElement` at its
 * natural size, and the selected one grows by about the ratio the old dot did.
 */
const SCALE = { plain: 1, selected: 1.35 } as const;

/**
 * How tall the largest pin on the map stands above its point, in pixels — which is
 * how far the open card has to clear the coordinate the two of them share. Google
 * draws a `PinElement` 37px tall at scale 1, so the selected pin is that scaled up,
 * rounded up: a pixel of extra air costs nothing, a pixel short puts a card over a pin.
 */
export const SELECTED_PIN_HEIGHT = Math.ceil(37 * SCALE.selected);

/** Diameter of the fallback dot in pixels, and the width of its white ring. */
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

/**
 * A pin's visual as a DOM node, which is what an advanced marker takes.
 *
 * Built again from scratch on every restyle rather than edited: a `PinElement` renders
 * its teardrop from the options it was constructed with, so there is no in-place tweak
 * to make the way the old dot's `cssText` could simply be rewritten.
 */
function markerPin(lib: google.maps.MarkerLibrary, style: PinStyle): HTMLElement {
  return new lib.PinElement({
    background: style.colour,
    borderColor: "#fff",
    glyphColor: "#fff",
    // `glyph` rather than the newer `glyphText` that deprecates it: an older release
    // of the API ignores the new field outright, and the failure that buys is a pin
    // with a silently empty head — exactly the kind of quiet wrong this file avoids.
    glyph: style.glyph ?? null,
    scale: style.selected ? SCALE.selected : SCALE.plain,
  }).element;
}

/**
 * The fallback dot as a classic marker's symbol. `scale` is a radius, so it is half
 * the diameter — the last place `SIZE` and `RING` are still read.
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
    // No `anchorTop` here on purpose. A teardrop stands on its point, which is where
    // an advanced marker puts its content by default; the dot that used to live here
    // was the exception, pulled back by half its height to sit centred on the point
    // instead.
    gmpClickable: true,
    content: markerPin(lib, spec),
  });
  if (spec.onClick) marker.addListener("gmp-click", spec.onClick);
  return {
    update(style) {
      // A restyle that cannot be built leaves the pin looking exactly as it did,
      // which is a stale size — not the lost screen a throw would cost, and `update`
      // runs inside a render effect too.
      try {
        marker.content = markerPin(lib, style);
      } catch (error) {
        reportBroken("a pin keeps the size it was drawn at", error);
      }
      marker.zIndex = style.zIndex;
    },
    remove() {
      marker.map = null;
    },
  };
}

/**
 * Deliberately still a flat dot rather than a teardrop: the only browsers that ever
 * reach here are the ones that cannot construct an advanced marker at all, and a
 * hand-rolled SVG pin path is a lot of surface to own for them.
 */
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
 * The card and its pin are two markers on one coordinate, and a teardrop's coordinate
 * is its tip — so a card hung straight off that point would land on top of the pin it
 * belongs to. The host is wrapped in a spacer as tall as the pin instead: the wrapper's
 * bottom edge sits on the point, the card floats clear above the pin, and Google goes on
 * gluing the whole thing to its coordinate. The alternative, re-deriving pixels on every
 * `bounds_changed`, drifts mid-gesture and is the reason the card is a marker at all.
 */
function popupWrapper(host: HTMLElement): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.paddingBottom = `${SELECTED_PIN_HEIGHT}px`;
  // The spacer is empty air over the pin, so taps have to fall through it to the map
  // underneath. The card inside turns them back on for itself.
  wrapper.style.pointerEvents = "none";
  wrapper.appendChild(host);
  return wrapper;
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
        content: popupWrapper(spec.host),
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
