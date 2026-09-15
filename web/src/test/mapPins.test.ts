/**
 * Pins must degrade, never throw. The map screen builds them inside a render
 * effect, so a constructor that throws — as `AdvancedMarkerElement` does in a
 * browser where its custom element was never registered — used to take the whole
 * screen down to the crash page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advancedMarkersUnavailable,
  createPin,
  createPopupAnchor,
  resetPinSupport,
} from "../map/pins";

/** Enough of `google.maps.Map` for a stub marker to be handed one. */
const MAP = {} as google.maps.Map;

const SPEC = {
  map: MAP,
  position: { lat: 32.08, lng: 34.78 },
  title: "מסעדה",
  colour: "#0a7",
  selected: false,
  zIndex: 1,
};

interface Built {
  kind: "advanced" | "legacy" | "info";
  options: Record<string, unknown>;
  listeners: string[];
  detached: boolean;
  icons: Record<string, unknown>[];
  zIndexes: number[];
}

/**
 * A stand-in for the marker library. The flags reproduce the failures worth having
 * an answer for: the API hands back a marker class that cannot be constructed, and
 * the fallback failing as well.
 */
function stubLibrary(options: { advancedThrows?: boolean; legacyThrows?: boolean } = {}) {
  const built: Built[] = [];

  function record(kind: Built["kind"], opts: Record<string, unknown>): Built {
    const entry: Built = { kind, options: opts, listeners: [], detached: false, icons: [], zIndexes: [] };
    built.push(entry);
    return entry;
  }

  class AdvancedMarkerElement {
    map: unknown;
    zIndex: number | null = null;
    content: unknown;
    entry: Built;
    constructor(opts: Record<string, unknown>) {
      if (options.advancedThrows) {
        // The shape of the real failure: thrown from inside the API, reading a
        // property table the unregistered custom element never got.
        throw new TypeError("Cannot read properties of undefined (reading 'keys')");
      }
      this.entry = record("advanced", opts);
      this.map = opts["map"];
      this.content = opts["content"];
    }
    addListener(event: string) {
      this.entry.listeners.push(event);
    }
  }

  class Marker {
    entry: Built;
    constructor(opts: Record<string, unknown>) {
      if (options.legacyThrows) throw new TypeError("no markers here either");
      this.entry = record("legacy", opts);
    }
    addListener(event: string) {
      this.entry.listeners.push(event);
    }
    setIcon(icon: Record<string, unknown>) {
      this.entry.icons.push(icon);
    }
    setZIndex(zIndex: number) {
      this.entry.zIndexes.push(zIndex);
    }
    setMap(map: unknown) {
      if (map === null) this.entry.detached = true;
    }
  }

  class InfoWindow {
    entry: Built;
    constructor(opts: Record<string, unknown>) {
      this.entry = record("info", opts);
    }
    open() {}
    close() {
      this.entry.detached = true;
    }
  }

  return {
    marker: { AdvancedMarkerElement, Marker } as unknown as google.maps.MarkerLibrary,
    maps: { InfoWindow } as unknown as google.maps.MapsLibrary,
    built,
  };
}

describe("map pins", () => {
  beforeEach(() => {
    resetPinSupport();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses an advanced marker when the API can build one", () => {
    const { marker, built } = stubLibrary();
    const pin = createPin(marker, { ...SPEC, onClick: () => {} });

    expect(pin).not.toBeNull();
    expect(built).toHaveLength(1);
    expect(built[0]?.kind).toBe("advanced");
    expect(built[0]?.listeners).toEqual(["gmp-click"]);
    expect(advancedMarkersUnavailable()).toBe(false);
  });

  it("falls back to a classic marker instead of throwing", () => {
    const { marker, built } = stubLibrary({ advancedThrows: true });
    const pin = createPin(marker, { ...SPEC, onClick: () => {} });

    expect(pin).not.toBeNull();
    expect(built).toHaveLength(1);
    expect(built[0]?.kind).toBe("legacy");
    expect(built[0]?.listeners).toEqual(["click"]);
    // The dot keeps its size and colour: scale is a radius, so half the diameter.
    const icon = built[0]?.options["icon"] as Record<string, unknown>;
    expect(icon["scale"]).toBe(8);
    expect(icon["fillColor"]).toBe("#0a7");
  });

  it("restyles a classic pin in place when the selection moves", () => {
    const { marker, built } = stubLibrary({ advancedThrows: true });
    const pin = createPin(marker, SPEC);
    pin?.update({ colour: "#0a7", selected: true, zIndex: 10 });

    expect(built).toHaveLength(1);
    expect(built[0]?.icons.at(-1)?.["scale"]).toBe(11);
    expect(built[0]?.zIndexes).toEqual([10]);
  });

  it("restyles an advanced pin's own dot without rebuilding it", () => {
    const { marker, built } = stubLibrary();
    const pin = createPin(marker, SPEC);
    pin?.update({ colour: "#c00", selected: true, zIndex: 10 });

    expect(built).toHaveLength(1);
    const dot = built[0]?.options["content"] as HTMLElement;
    expect(dot.style.width).toBe("22px");
    expect(dot.style.background).toBe("rgb(204, 0, 0)");
  });

  it("stops retrying the advanced marker once it has thrown once", () => {
    const { marker, built } = stubLibrary({ advancedThrows: true });
    createPin(marker, SPEC);
    createPin(marker, SPEC);
    createPin(marker, SPEC);

    expect(advancedMarkersUnavailable()).toBe(true);
    expect(built.every((entry) => entry.kind === "legacy")).toBe(true);
    // One report, not one per result.
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("returns no pin, rather than throwing, when neither marker can be built", () => {
    const { marker, built } = stubLibrary({ advancedThrows: true, legacyThrows: true });

    expect(createPin(marker, SPEC)).toBeNull();
    expect(built).toHaveLength(0);
  });

  it("detaches a pin from the map when it is removed", () => {
    const { marker, built } = stubLibrary({ advancedThrows: true });
    createPin(marker, SPEC)?.remove();
    expect(built[0]?.detached).toBe(true);
  });
});

describe("the open card's anchor", () => {
  beforeEach(() => {
    resetPinSupport();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const host = () => document.createElement("div");

  it("hangs the card on an advanced marker when it can", () => {
    const { maps, marker, built } = stubLibrary();
    const node = host();
    const anchor = createPopupAnchor(maps, marker, {
      map: MAP,
      position: SPEC.position,
      host: node,
      zIndex: 30,
    });

    expect(anchor).not.toBeNull();
    expect(built[0]?.kind).toBe("advanced");
    expect(built[0]?.options["content"]).toBe(node);
  });

  it("puts the same card in an info window when the marker cannot be built", () => {
    const { maps, marker, built } = stubLibrary({ advancedThrows: true });
    const node = host();
    const anchor = createPopupAnchor(maps, marker, {
      map: MAP,
      position: SPEC.position,
      host: node,
      zIndex: 30,
    });

    expect(anchor).not.toBeNull();
    expect(built[0]?.kind).toBe("info");
    // The React card itself is unchanged — only what holds it.
    expect(built[0]?.options["content"]).toBe(node);

    anchor?.remove();
    expect(built[0]?.detached).toBe(true);
  });
});
