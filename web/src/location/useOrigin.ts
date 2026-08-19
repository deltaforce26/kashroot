/**
 * Where "near me" is measured from.
 *
 * Two possible origins: the device's real position, or the centre of the selected
 * city. Whichever is in use is sent to the API as `center`, so distance and the
 * Layer 2 fit score are computed server-side from one source — the client never
 * calculates a distance, which is what keeps list and detail agreeing.
 *
 * Permission is requested at the point of use, never on load, and never twice
 * unprompted. Denied, dismissed, unavailable or timed out all fall back silently to
 * the city centre: refusing to share your location is a legitimate choice, not an
 * error state, and the app says nothing about it beyond labelling what it measured
 * from.
 *
 * Privacy: coordinates go to our own API and nowhere else. They are never persisted,
 * never logged, and never placed in a URL or query string.
 */

import { useCallback, useState } from "react";
import type { GeoPoint } from "../api/types";
import type { CityOption } from "../config";

export type OriginSource = "device" | "city";

export type GeoState = "idle" | "requesting" | "granted" | "unavailable";

const TIMEOUT_MS = 8000;

export function useOrigin(city: CityOption): {
  origin: GeoPoint;
  source: OriginSource;
  state: GeoState;
  /** Ask for the device position. Safe to call when unsupported — resolves to city. */
  requestDeviceLocation: () => void;
  /** Go back to measuring from the city centre. */
  useCityCentre: () => void;
} {
  const [devicePoint, setDevicePoint] = useState<GeoPoint | null>(null);
  const [state, setState] = useState<GeoState>("idle");

  const requestDeviceLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDevicePoint({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setState("granted");
      },
      () => {
        // Denied, dismissed, position unavailable, or timed out. All the same
        // outcome, and none of them is worth a message: we simply measure from the
        // city instead and say so.
        setDevicePoint(null);
        setState("unavailable");
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, []);

  const useCityCentre = useCallback(() => {
    setDevicePoint(null);
    setState("idle");
  }, []);

  return {
    origin: devicePoint ?? city.center,
    source: devicePoint ? "device" : "city",
    state,
    requestDeviceLocation,
    useCityCentre,
  };
}
