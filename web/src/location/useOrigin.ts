/**
 * Where a search is measured from — or the fact that it is not.
 *
 * The app has no notion of a "current city" and no default centre. A search comes
 * from exactly one of three places: the device's real position, an address the user
 * typed, or nowhere at all — in which case the API is asked for every place in the
 * database, paginated, and the header says so ("כל הארץ"). Whichever point is in use
 * is sent to the API as `center`, so distance and the Layer 2 fit score are computed
 * server-side from one source — the client never calculates a distance, which is what
 * keeps list, map and detail agreeing. With no point, no `center` goes out and the
 * server returns `distance_km: null`.
 *
 * "Everywhere" is the last resort, not the opening position. A first load with no
 * stored origin asks the device straight away — a permission prompt is acceptable
 * here — and only a refusal, an unsupported browser or a timeout leaves the app
 * searching without a centre. While that first request is pending the screens keep
 * their loading state (`resolving`), so the unscoped list never flashes before the
 * device has had its chance to answer.
 *
 * The origin is shared process-wide rather than held per component, so setting it
 * on home moves the map too: one origin, one answer.
 *
 * Denied, dismissed, unavailable and timed out are one outcome: refusing to share
 * your location is a legitimate choice, not an error state, and the sheet says so
 * once, where the button is, while the header never nags.
 *
 * What that outcome costs depends on what was already chosen. A request made with
 * nothing behind it leaves the app searching everywhere. A request made when an
 * origin is already in use leaves that origin standing — a device fix taken a minute
 * ago is still where the user is, and a pinned address is still where they asked to
 * search from, so one attempt that did not come back is no reason to move the whole
 * screen out from under them.
 *
 * Persistence: the chosen origin survives a reload, because a refresh that silently
 * changes where the user searches from reports distances from a place they did not
 * pick. What is stored differs by source, and that difference is the privacy line:
 *
 * - An address is stored whole (label and point). The user typed it, it is already
 *   on screen in the header, and it is not where they are — it is where they asked
 *   to search from.
 * - The device position is *never* written to storage. Only the fact that the device
 *   was the chosen origin is, and on load it is re-acquired **only** if the browser
 *   already reports the geolocation permission as granted. No stored coordinates and
 *   no prompt: anything short of an already-granted permission drops the marker and
 *   we search everywhere, silently. A refusal note belongs next to the button that
 *   asked, and on that path nothing asked.
 * - An explicit "all of Israel" is stored as that choice, so a reload honours it
 *   rather than prompting for the device the user just declined to use.
 *
 * Coordinates go to our own API and nowhere else: never logged, never placed in a URL
 * or query string. An address the user types is the one exception in transit — it
 * goes to Google's geocoder to become a point (see `map/useGoogleMaps.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "../api/types";

export type OriginSource = "device" | "address" | "none";

/**
 * How the last device request ended.
 *
 * `stale` is the one worth naming: the request failed, but a fix from an earlier one
 * is still the origin — so the position on screen is real and only the refresh is
 * missing. `unavailable` means there is no device position at all.
 */
export type GeoState = "idle" | "requesting" | "granted" | "stale" | "unavailable";

const TIMEOUT_MS = 8000;

interface Override {
  source: "device" | "address";
  point: GeoPoint;
  /** What to call it in the header. Empty for the device, which names itself. */
  label: string;
}

/**
 * What gets written to storage. The device variant carries no point on purpose —
 * see the privacy note above.
 */
type StoredOrigin =
  | { source: "device" }
  | { source: "none" }
  | { source: "address"; label: string; lat: number; lon: number };

const KEY = "kashroot.origin.v1";

/** Cross-component sync without a store: one event, one subscription per hook. */
const CHANGED = "kashroot:origin-changed";

let override: Override | null = null;
let geoState: GeoState = "idle";

function publish(nextOverride: Override | null, nextState: GeoState): void {
  override = nextOverride;
  geoState = nextState;
  window.dispatchEvent(new Event(CHANGED));
}

function persist(stored: StoredOrigin | null): void {
  try {
    if (stored) localStorage.setItem(KEY, JSON.stringify(stored));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked or full: the origin still holds for this session.
  }
}

/** Defensive read — a foreign or half-written blob is discarded, never patched up. */
function readStored(): StoredOrigin | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record["source"] === "device") return { source: "device" };
  if (record["source"] === "none") return { source: "none" };
  if (record["source"] !== "address") return null;
  const { label, lat, lon } = record;
  if (typeof label !== "string" || label.length === 0) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
  return { source: "address", label, lat, lon };
}

function devicePoint(position: GeolocationPosition): Override {
  return {
    source: "device",
    point: { lat: position.coords.latitude, lon: position.coords.longitude },
    label: "",
  };
}

/**
 * Ask the device for its position. Shared by the sheet's button, the map's locate
 * control and the first load, so every path handles a refusal the same way.
 */
function requestDevice(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    publish(override, override ? geoState : "unavailable");
    return;
  }
  publish(override, "requesting");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Only the choice is remembered, never the coordinates.
      persist({ source: "device" });
      publish(devicePoint(position), "granted");
    },
    () => {
      // Denied, dismissed, position unavailable, or timed out — one outcome, and
      // never a reason to discard an origin the user already has. Keeping the last
      // device fix is the difference between a retry that quietly does nothing and
      // a retry that throws the map somewhere else; keeping a pinned address is the
      // same courtesy for someone who only tried the shortcut.
      //
      // Storage is left alone with it, so the kept origin also survives a reload.
      if (override) {
        publish(override, override.source === "device" ? "stale" : "unavailable");
        return;
      }
      persist(null);
      publish(null, "unavailable");
    },
    { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
  );
}

/**
 * Re-acquire the device position on load without ever asking for it.
 *
 * `permissions.query` is the whole point: it reports the standing answer without
 * raising a prompt. Anything other than an outright "granted" — prompt, denied, no
 * Permissions API, no geolocation — drops the marker and leaves us searching
 * everywhere.
 */
async function reacquireDevice(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) {
    persist(null);
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state !== "granted") {
      persist(null);
      return;
    }
  } catch {
    persist(null);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => publish(devicePoint(position), "granted"),
    () => {
      // Nobody asked for this, so nobody is told it failed: no "denied" note for a
      // request the user did not make. We just search everywhere.
      persist(null);
    },
    { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
  );
}

let restored = false;

/**
 * Reinstate the last chosen origin. Runs once per page load, before first render.
 *
 * Nothing stored means a first visit, and a first visit asks the device — with a
 * prompt if need be — because "everywhere" is what the app falls back to, not what
 * it opens on. A stored choice, including an explicit "all of Israel", is honoured
 * without a prompt.
 */
export function restoreOrigin(): void {
  if (restored) return;
  restored = true;
  const stored = readStored();
  if (!stored) {
    requestDevice();
    return;
  }
  if (stored.source === "none") return;
  if (stored.source === "address") {
    publish(
      { source: "address", point: { lat: stored.lat, lon: stored.lon }, label: stored.label },
      "idle",
    );
    return;
  }
  void reacquireDevice();
}

/**
 * Test seam: drop the in-memory origin and the restore latch, leaving storage
 * alone. That is precisely what a page reload does to this module, and it is the
 * only way to prove the reload path reads storage rather than surviving on module
 * state that a real refresh would have thrown away. Not used by the app.
 */
export function resetOriginState(): void {
  override = null;
  geoState = "idle";
  restored = false;
}

/** Drop any pinned origin, in memory and in storage. Test seam and reset path. */
export function clearOrigin(): void {
  persist(null);
  publish(null, "idle");
}

export function useOrigin(): {
  /** The point searches are measured from, or null to search everywhere. */
  origin: GeoPoint | null;
  source: OriginSource;
  /** The typed address, when that is what we are measuring from; otherwise null. */
  addressLabel: string | null;
  state: GeoState;
  /**
   * True while the device is being asked and nothing else is pinned: the answer is
   * not yet "everywhere", so screens keep loading rather than searching unscoped.
   */
  resolving: boolean;
  /** Ask for the device position. Safe to call when unsupported. */
  requestDeviceLocation: () => void;
  /** Measure from a point the user chose by name. */
  setAddressOrigin: (label: string, point: GeoPoint) => void;
  /** Drop the pin and show every place in the database. Remembered across reloads. */
} {
  // Restored in the initialiser, not an effect: the first render must already be
  // measuring from the stored origin, or the list paints once unscoped and then
  // jumps. Idempotent, so StrictMode's double invoke costs nothing, and at this
  // point no other hook has subscribed yet, so nothing is updated mid-render.
  const [, setTick] = useState(() => {
    restoreOrigin();
    return 0;
  });

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const requestDeviceLocation = useCallback(() => requestDevice(), []);

  const setAddressOrigin = useCallback((label: string, point: GeoPoint) => {
    persist({ source: "address", label, lat: point.lat, lon: point.lon });
    publish({ source: "address", point, label }, "idle");
  }, []);

  return {
    origin: override?.point ?? null,
    source: override?.source ?? "none",
    addressLabel: override?.source === "address" ? override.label : null,
    state: geoState,
    resolving: override === null && geoState === "requesting",
    requestDeviceLocation,
    setAddressOrigin,
  };
}
