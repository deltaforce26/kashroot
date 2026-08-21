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
 * unprompted. Denied, dismissed, unavailable or timed out all fall back to the city
 * centre: refusing to share your location is a legitimate choice, not an error
 * state. The sheet says so once, where the button is, and the header never nags.
 *
 * Privacy: coordinates go to our own API and nowhere else. They are held in memory
 * for the session only — never written to storage, never logged, never placed in a
 * URL or query string. An address the user types is the one exception in transit: it
 * goes to Google's geocoder to become a point (see `map/useGoogleMaps.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { GeoPoint } from "../api/types";
import type { CityOption } from "../config";

export type OriginSource = "device" | "city" | "address";

export type GeoState = "idle" | "requesting" | "granted" | "unavailable";

const TIMEOUT_MS = 8000;

interface Override {
  source: "device" | "address";
  point: GeoPoint;
  /** What to call it in the header. Empty for the device, which names itself. */
  label: string;
}

/** Cross-component sync without a store: one event, one subscription per hook. */
const CHANGED = "kashroot:origin-changed";

let override: Override | null = null;
let geoState: GeoState = "idle";

function publish(nextOverride: Override | null, nextState: GeoState): void {
  override = nextOverride;
  geoState = nextState;
  window.dispatchEvent(new Event(CHANGED));
}

/** Drop any pinned origin. Called by the city picker, so the two cannot both win. */
export function clearOrigin(): void {
  publish(null, "idle");
}

export function useOrigin(city: CityOption): {
  origin: GeoPoint;
  source: OriginSource;
  /** The typed address, when that is what we are measuring from; otherwise null. */
  addressLabel: string | null;
  state: GeoState;
  /** Ask for the device position. Safe to call when unsupported — resolves to city. */
  requestDeviceLocation: () => void;
  /** Measure from a point the user chose by name. */
  setAddressOrigin: (label: string, point: GeoPoint) => void;
  /** Go back to measuring from the city centre. */
  useCityCentre: () => void;
} {
  const [, setTick] = useState(0);

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
        // Denied, dismissed, position unavailable, or timed out. All the same
        // outcome: we measure from the city instead and say so once, in the sheet.
        publish(null, "unavailable");
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, []);

  const setAddressOrigin = useCallback((label: string, point: GeoPoint) => {
    publish({ source: "address", point, label }, "idle");
  }, []);

  const useCityCentre = useCallback(() => clearOrigin(), []);

  return {
    origin: override?.point ?? city.center,
    source: override?.source ?? "city",
    addressLabel: override?.source === "address" ? override.label : null,
    state: geoState,
    requestDeviceLocation,
    setAddressOrigin,
    useCityCentre,
  };
}
