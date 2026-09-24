/**
 * Where "near me" is measured from.
 *
 * Three possible origins: the device's real position, an address the user typed, or
 * the centre of the selected city. Whichever is in use is sent to the API as
 * `center`, so distance and the Layer 2 fit score are computed server-side from one
 * source — the client never calculates a distance, which is what keeps list, map and
 * detail agreeing.
 *
 * The override (device or address) is shared process-wide rather than held per
 * component, so setting it on home moves the map too: one origin, one answer. The
 * city itself lives in `useCity` — picking a city clears the override, because a
 * city and a pinned address are two answers to the same question.
 *
 * Permission is requested at the point of use, never on load, and never twice
 * unprompted. Denied, dismissed, unavailable and timed out are one outcome: refusing
 * to share your location is a legitimate choice, not an error state, and the sheet
 * says so once, where the button is, while the header never nags.
 *
 * What that outcome costs depends on what was already chosen. A first request, with
 * nothing behind it, falls back to the city centre. A request made when an origin is
 * already in use leaves that origin standing — a device fix taken a minute ago is
 * still where the user is, and a pinned address is still where they asked to search
 * from, so one attempt that did not come back is no reason to move the whole screen
 * out from under them.
 *
 * Persistence: the chosen origin survives a reload, because a refresh that silently
 * moves the user back to the city centre reports distances from a place they did not
 * pick. What is stored differs by source, and that difference is the privacy line:
 *
 * - An address is stored whole (label and point). The user typed it, it is already
 *   on screen in the header, and it is not where they are — it is where they asked
 *   to search from.
 * - The device position is *never* written to storage. Only the fact that the device
 *   was the chosen origin is, and on load it is re-acquired **only** if the browser
 *   already reports the geolocation permission as granted. No stored coordinates and
 *   no prompt on load: anything short of an already-granted permission drops the
 *   marker and we measure from the city, silently. A refusal note belongs next to the
 *   button that asked, and on load nothing asked.
 *
 * Coordinates go to our own API and nowhere else: never logged, never placed in a URL
 * or query string. An address the user types is the one exception in transit — it
 * goes to Google's geocoder to become a point (see `map/useGoogleMaps.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "../api/types";
import { coveringCity, type CityOption } from "../config";
import { followPoint } from "./useCity";

export type OriginSource = "device" | "city" | "address";

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
  | { source: "address"; label: string; lat: number; lon: number };

const KEY = "kashroot.origin.v1";

/** Cross-component sync without a store: one event, one subscription per hook. */
const CHANGED = "kashroot:origin-changed";

let override: Override | null = null;
let geoState: GeoState = "idle";

function publish(nextOverride: Override | null, nextState: GeoState): void {
  override = nextOverride;
  geoState = nextState;
  // A pinned address or a device fix says where the user is, so the city follows
  // it — otherwise home and map would measure from Beit Shemesh while search kept
  // looking inside Jerusalem. Idempotent, so republishing the same origin is free.
  if (nextOverride) followPoint(nextOverride.point);
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
  if (record["source"] !== "address") return null;
  const { label, lat, lon } = record;
  if (typeof label !== "string" || label.length === 0) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
  return { source: "address", label, lat, lon };
}

/**
 * Re-acquire the device position on load without ever asking for it.
 *
 * `permissions.query` is the whole point: it reports the standing answer without
 * raising a prompt. Anything other than an outright "granted" — prompt, denied, no
 * Permissions API, no geolocation — drops the marker and leaves us on the city.
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
    (position) => {
      publish(
        {
          source: "device",
          point: { lat: position.coords.latitude, lon: position.coords.longitude },
          label: "",
        },
        "granted",
      );
    },
    () => {
      // Nobody asked for this, so nobody is told it failed: no "denied" note for a
      // request the user did not make. We just stay on the city centre.
      persist(null);
    },
    { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
  );
}

let restored = false;

/** Reinstate the last chosen origin. Runs once per page load, before first render. */
export function restoreOrigin(): void {
  if (restored) return;
  restored = true;
  const stored = readStored();
  if (!stored) return;
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

/** Drop any pinned origin. Called by the city picker, so the two cannot both win. */
export function clearOrigin(): void {
  persist(null);
  publish(null, "idle");
}

export function useOrigin(city: CityOption): {
  origin: GeoPoint;
  source: OriginSource;
  /** The typed address, when that is what we are measuring from; otherwise null. */
  addressLabel: string | null;
  /**
   * False when the origin lies outside every city the corpus covers. Home and map
   * would then measure honestly from it and find nothing; search would silently
   * answer for the last city. Each screen says "nothing here yet" instead.
   */
  covered: boolean;
  state: GeoState;
  /** Ask for the device position. Safe to call when unsupported — resolves to city. */
  requestDeviceLocation: () => void;
  /** Measure from a point the user chose by name. */
  setAddressOrigin: (label: string, point: GeoPoint) => void;
  /** Go back to measuring from the city centre. */
  useCityCentre: () => void;
} {
  // Restored in the initialiser, not an effect: the first render must already be
  // measuring from the stored origin, or the list paints once from the city centre
  // and then jumps. Idempotent, so StrictMode's double invoke costs nothing, and at
  // this point no other hook has subscribed yet, so nothing is updated mid-render.
  const [, setTick] = useState(() => {
    restoreOrigin();
    return 0;
  });

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
  }, []);

  const requestDeviceLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      publish(null, "unavailable");
      return;
    }
    publish(override, "requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Only the choice is remembered, never the coordinates.
        persist({ source: "device" });
        publish(
          {
            source: "device",
            point: { lat: position.coords.latitude, lon: position.coords.longitude },
            label: "",
          },
          "granted",
        );
      },
      () => {
        // Denied, dismissed, position unavailable, or timed out — one outcome, and
        // never a reason to discard an origin the user already has. Keeping the last
        // device fix is the difference between a retry that quietly does nothing and
        // a retry that throws the map back to the city centre; keeping a pinned
        // address is the same courtesy for someone who only tried the shortcut.
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
  }, []);

  const setAddressOrigin = useCallback((label: string, point: GeoPoint) => {
    persist({ source: "address", label, lat: point.lat, lon: point.lon });
    publish({ source: "address", point, label }, "idle");
  }, []);

  const useCityCentre = useCallback(() => clearOrigin(), []);

  return {
    origin: override?.point ?? city.center,
    source: override?.source ?? "city",
    addressLabel: override?.source === "address" ? override.label : null,
    covered: override ? coveringCity(override.point) !== null : true,
    state: geoState,
    requestDeviceLocation,
    setAddressOrigin,
    useCityCentre,
  };
}
