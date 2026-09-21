/**
 * Pins must degrade, never throw. The map screen builds them inside a render
 * effect, so a constructor that throws — as `AdvancedMarkerElement` does in a
 * browser where its custom element was never registered — used to take the whole
 * screen down to the crash page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../api/types";
import { VERDICT_GLYPH } from "../components/VerdictPill";
import {
  advancedMarkersUnavailable,
  createPin,
  createPopupAnchor,
  resetPinSupport,
  SELECTED_PIN_HEIGHT,
} from "../map/pins";

/** Enough of `google.maps.Map` for a stub marker to be handed one. */
const MAP = {} as google.maps.Map;

const SPEC = {
  map: MAP,
  position: { lat: 32.08, lng: 34.78 },
  title: "מסעדה",
  colour: "#0a7",
  glyph: "✓",
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
  /** Every visual assigned to an advanced marker, so a restyle can be told from a rebuild. */
  contents: unknown[];
}

/**
 * A stand-in for the marker library. The flags reproduce the failures worth having
 * an answer for: the API hands back a marker class that cannot be constructed, the
 * teardrop inside it failing on its own, and the fallback failing as well.
 */
function stubLibrary(
  options: { advancedThrows?: boolean; legacyThrows?: boolean; pinThrows?: boolean } = {},
) {
  const built: Built[] = [];

  function record(kind: Built["kind"], opts: Record<string, unknown>): Built {
    const entry: Built = {
      kind,
      options: opts,
      listeners: [],
      detached: false,
      icons: [],
      zIndexes: [],
      contents: [],
    };
    built.push(entry);
    return entry;
  }

  class AdvancedMarkerElement {
    map: unknown;
    zIndex: number | null = null;
    entry: Built;
    private visual: unknown;
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
    get content(): unknown {
      return this.visual;
    }
    set content(value: unknown) {
      this.visual = value;
      this.entry.contents.push(value);
    }
    addListener(event: string) {
      this.entry.listeners.push(event);
    }
  }

  /**
   * Google's teardrop, reduced to a node carrying back the options it was built from.
   * What the pin decides is which options it passes; how they are drawn is the API's.
   */
  class PinElement {
    element: HTMLElement;
    constructor(opts: Record<string, unknown>) {
      if (options.pinThrows) throw new TypeError("no pin element in this browser");
      const node = document.createElement("div");
      node.dataset["background"] = String(opts["background"] ?? "");
      node.dataset["glyph"] = String(opts["glyph"] ?? "");
      node.dataset["scale"] = String(opts["scale"] ?? "");
      this.element = node;
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
    marker: { AdvancedMarkerElement, Marker, PinElement } as unknown as google.maps.MarkerLibrary,
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

  it("draws the teardrop in the colour and glyph it was handed, standing on its point", () => {
    const { marker, built } = stubLibrary();
    createPin(marker, SPEC);

    const options = built[0]?.options ?? {};
    const drawn = (options["content"] as HTMLElement).dataset;
    expect(drawn["background"]).toBe("#0a7");
    expect(drawn["glyph"]).toBe("✓");
    expect(drawn["scale"]).toBe("1");
    // A teardrop stands on its point, which is the advanced marker's own default. The
    // dot's old "-50%" override would sink half a pin below the place it marks.
    expect(options["anchorTop"]).toBeUndefined();
  });

  it("leaves the pin head plain when it is given no glyph", () => {
    const { marker, built } = stubLibrary();
    // The shape of the "you are here" pin: a place, not a verdict, so no glyph is
    // passed at all and Google's own plain head is what gets drawn.
    createPin(marker, {
      map: MAP,
      position: SPEC.position,
      title: "אני כאן",
      colour: "#1a73e8",
      selected: false,
      zIndex: 20,
    });

    const drawn = (built[0]?.options["content"] as HTMLElement).dataset;
    expect(drawn["glyph"]).toBe("");
  });

  it("rebuilds an advanced pin's visual on a restyle, without rebuilding the marker", () => {
    const { marker, built } = stubLibrary();
    const pin = createPin(marker, SPEC);
    pin?.update({ colour: "#c00", glyph: "✕", selected: true, zIndex: 10 });

    // One marker for the place, restyled — a `PinElement` cannot be edited in place
    // the way the old dot's `cssText` could, so the visual is what gets replaced.
    expect(built).toHaveLength(1);
    const restyled = (built[0]?.contents.at(-1) as HTMLElement).dataset;
    expect(restyled["background"]).toBe("#c00");
    expect(restyled["glyph"]).toBe("✕");
    expect(restyled["scale"]).toBe("1.35");
  });

  it("falls back to the flat dot when the teardrop itself cannot be built", () => {
    const { marker, built } = stubLibrary({ pinThrows: true });
    const pin = createPin(marker, SPEC);

    // A pin element that throws costs the user no more than a marker that throws:
    // both land on the classic dot rather than on the crash page.
    expect(pin).not.toBeNull();
    expect(built).toHaveLength(1);
    expect(built[0]?.kind).toBe("legacy");
    expect(advancedMarkersUnavailable()).toBe(true);
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

/**
 * The `Record<Verdict, string>` already makes a missing glyph a compile error. What a
 * compiler cannot catch is the other direction — a glyph quietly emptied, or a key left
 * behind after a verdict is renamed — and either one reaches the map as a pin with
 * nothing in its head, which reads as an answer rather than as a bug.
 */
describe("the verdict glyph a pin is handed", () => {
  const VERDICTS: Verdict[] = ["match", "no_match", "unknown"];

  it("covers every verdict and nothing else", () => {
    expect(Object.keys(VERDICT_GLYPH).sort()).toEqual([...VERDICTS].sort());
  });

  it("gives each verdict a glyph that is actually there to see", () => {
    for (const verdict of VERDICTS) expect(VERDICT_GLYPH[verdict].trim()).not.toBe("");
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
    // The React card is unchanged; it rides inside a spacer as tall as the pin, which
    // is what keeps the card off the pin they both hang from.
    const content = built[0]?.options["content"] as HTMLElement;
    expect(content.contains(node)).toBe(true);
    expect(content.style.paddingBottom).toBe(`${SELECTED_PIN_HEIGHT}px`);
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
