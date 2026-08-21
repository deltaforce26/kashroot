/**
 * Loads the Google Maps JavaScript API, or reports honestly that it could not.
 *
 * Key handling: the browser key comes from `VITE_GOOGLE_MAPS_BROWSER_KEY` in
 * `web/.env.local` (gitignored). It is a separate, referrer-restricted browser key.
 * The server-side Geocoding key in the repo root `.env` is deliberately never read
 * here — a server key in a client bundle is a key published to the world.
 *
 * Three outcomes, and the map screen has a real design for all three:
 *   - `absent`  — no key configured. Expected on a fresh clone.
 *   - `error`   — script blocked, offline, bad key, quota exhausted.
 *   - `ready`   — a real map.
 * `absent` and `error` both fall back to the design's striped placeholder with a
 * short line saying why. The demo must never show a grey rectangle or a Google
 * error overlay.
 *
 * The script is fetched from Google at runtime and is deliberately not precached by
 * the service worker: an offline launch resolves to `error` and the fallback, rather
 * than hanging on a request that cannot complete.
 */

import { useEffect, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export type MapsStatus = "absent" | "loading" | "ready" | "error";

/** Empty string when unset, which is how Vite renders a missing env var. */
const BROWSER_KEY: string = import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] ?? "";

export function hasMapsKey(): boolean {
  // Unit tests must never fetch Google scripts merely because a developer has a
  // local browser key; map/Places behavior is exercised through explicit mocks.
  return import.meta.env.MODE !== "test" && BROWSER_KEY.trim().length > 0;
}

export interface MapsLibs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}

export interface PlacesLibs {
  places: google.maps.PlacesLibrary;
}

let libsPromise: Promise<MapsLibs> | null = null;
let placesPromise: Promise<PlacesLibs> | null = null;
let loaderConfigured = false;

function configureLoader(language: "he" | "en"): void {
  if (loaderConfigured) return;
  setOptions({ key: BROWSER_KEY, v: "weekly", language, region: "IL" });
  loaderConfigured = true;
}

/**
 * One load for the app's lifetime — mounting the map screen twice must not pull the
 * script twice. `language` follows the UI so labels match its direction, and
 * `region: "IL"` gives Israeli place naming and boundaries.
 */
function loadLibs(language: "he" | "en"): Promise<MapsLibs> {
  if (!libsPromise) {
    configureLoader(language);
    libsPromise = Promise.all([importLibrary("maps"), importLibrary("marker")]).then(
      ([maps, marker]) => ({ maps, marker }),
    );
  }
  return libsPromise;
}

function loadPlaces(language: "he" | "en"): Promise<PlacesLibs> {
  if (!placesPromise) {
    configureLoader(language);
    placesPromise = importLibrary("places").then((places) => ({ places }));
  }
  return placesPromise;
}

export function useGoogleMaps(language: "he" | "en"): {
  status: MapsStatus;
  libs: MapsLibs | null;
} {
  const [status, setStatus] = useState<MapsStatus>(() => (hasMapsKey() ? "loading" : "absent"));
  const [libs, setLibs] = useState<MapsLibs | null>(null);

  useEffect(() => {
    if (!hasMapsKey()) {
      setStatus("absent");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadLibs(language)
      .then((loaded) => {
        if (cancelled) return;
        setLibs(loaded);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        // Offline, blocked, bad key, quota — all the same to the user: no map.
        // Cleared so a later mount can retry once the network is back.
        libsPromise = null;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return { status, libs };
}

export function useGooglePlaces(language: "he" | "en"): {
  status: MapsStatus;
  libs: PlacesLibs | null;
} {
  const [status, setStatus] = useState<MapsStatus>(() => (hasMapsKey() ? "loading" : "absent"));
  const [libs, setLibs] = useState<PlacesLibs | null>(null);

  useEffect(() => {
    if (!hasMapsKey()) {
      setStatus("absent");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadPlaces(language)
      .then((loaded) => {
        if (cancelled) return;
        setLibs(loaded);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        placesPromise = null;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return { status, libs };
}
