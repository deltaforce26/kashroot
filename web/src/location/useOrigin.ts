/**
 * Where "near me" is measured from.
 *
 * Two possible origins: the device's real position, or the centre of the selected
 * city. Whichever is in use is sent to the API as `center`, so distance and the
 * Layer 2 fit score are computed server-side from one source — the client never
 * calculates a distance, which is what keeps list and detail agreeing.
 *
 * Permission is requested at the point of use, never on load or unprompted. A failed
 * request falls back to the city centre, while the picker retains an honest state so
 * it can distinguish permission denial from an unavailable position.
 *
 * Privacy: coordinates go to our own API and nowhere else. They are never persisted,
 * never logged, and never placed in a URL or query string.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { GeoPoint } from "../api/types";
import type { CityOption } from "../config";

export type OriginSource = "device" | "city" | "address";

export type GeoState = "idle" | "requesting" | "granted" | "denied" | "unavailable";

interface SelectedOrigin {
  point: GeoPoint;
  source: Exclude<OriginSource, "city">;
  label: string | null;
}

const TIMEOUT_MS = 8000;
let selected: SelectedOrigin | null = null;
let geoState: GeoState = "idle";
let requestNumber = 0;
let revision = 0;
const listeners = new Set<() => void>();

function emit(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return revision;
}

export function useOrigin(city: CityOption): {
  origin: GeoPoint;
  source: OriginSource;
  label: string | null;
  state: GeoState;
  /** Ask for the device position. Safe to call when unsupported — resolves to city. */
  requestDeviceLocation: () => void;
  /** Invalidate a pending browser callback without changing the selected origin. */
  cancelPendingRequest: () => void;
  /** Use an address selected from Places for this browser session. */
  useAddress: (point: GeoPoint, label: string) => void;
  /** Go back to measuring from the city centre. */
  useCityCentre: () => void;
} {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const requestDeviceLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      selected = null;
      geoState = "unavailable";
      emit();
      return;
    }
    const currentRequest = ++requestNumber;
    geoState = "requesting";
    emit();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (currentRequest !== requestNumber) return;
        selected = {
          point: { lat: position.coords.latitude, lon: position.coords.longitude },
          source: "device",
          label: null,
        };
        geoState = "granted";
        emit();
      },
      (error) => {
        if (currentRequest !== requestNumber) return;
        selected = null;
        geoState = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
        emit();
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, []);

  const useAddress = useCallback((point: GeoPoint, label: string) => {
    requestNumber += 1;
    selected = { point, source: "address", label };
    geoState = "idle";
    emit();
  }, []);

  const cancelPendingRequest = useCallback(() => {
    if (geoState !== "requesting") return;
    requestNumber += 1;
    geoState = "idle";
    emit();
  }, []);

  const useCityCentre = useCallback(() => {
    requestNumber += 1;
    selected = null;
    geoState = "idle";
    emit();
  }, []);

  return {
    origin: selected?.point ?? city.center,
    source: selected?.source ?? "city",
    label: selected?.label ?? null,
    state: geoState,
    requestDeviceLocation,
    cancelPendingRequest,
    useAddress,
    useCityCentre,
  };
}

/** Clears the non-persistent selection when starting a fresh app/test session. */
export function resetSessionOrigin(): void {
  requestNumber += 1;
  selected = null;
  geoState = "idle";
  emit();
}
