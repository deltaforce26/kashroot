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
  return BROWSER_KEY.trim().length > 0;
}

export interface MapsLibs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}

let libsPromise: Promise<MapsLibs> | null = null;
let configured = false;

/**
 * Loader options are global and may only be set once — the map screen and the
 * address lookup both go through here so the second caller cannot re-key the loader
 * out from under the first. `language` follows the UI so labels match its direction,
 * and `region: "IL"` gives Israeli place naming and boundaries.
 */
function configure(language: "he" | "en"): void {
  if (configured) return;
  setOptions({ key: BROWSER_KEY, v: "weekly", language, region: "IL" });
  configured = true;
}

/**
 * One load for the app's lifetime — mounting the map screen twice must not pull the
 * script twice.
 */
function loadLibs(language: "he" | "en"): Promise<MapsLibs> {
  if (!libsPromise) {
    configure(language);
    libsPromise = Promise.all([importLibrary("maps"), importLibrary("marker")]).then(
      ([maps, marker]) => ({ maps, marker }),
    );
  }
  return libsPromise;
}

/** One address candidate: what to show, and the point to measure from. */
export interface GeocodeCandidate {
  label: string;
  point: { lat: number; lon: number };
}

/** The most candidates worth offering; past this the list stops being a choice. */
const MAX_CANDIDATES = 5;

let geocoderPromise: Promise<google.maps.Geocoder> | null = null;

function loadGeocoder(language: "he" | "en"): Promise<google.maps.Geocoder> {
  if (!geocoderPromise) {
    configure(language);
    geocoderPromise = importLibrary("geocoding").then((lib) => new lib.Geocoder());
  }
  return geocoderPromise;
}

/**
 * Address text -> candidate points, restricted to Israel.
 *
 * Rejects rather than returning an empty list when the lookup itself failed (no key,
 * blocked script, offline, quota): "we could not look that up" and "there is no such
 * place" are different answers and the sheet says different things about them. An
 * empty array means the lookup worked and found nothing.
 *
 * The typed address is sent to Google's geocoder, which is the one place in the app
 * where a user's location text leaves our own server. It is never persisted here.
 */
export async function geocodeAddress(
  query: string,
  language: "he" | "en",
): Promise<GeocodeCandidate[]> {
  if (!hasMapsKey()) throw new Error("No maps key configured");
  const geocoder = await loadGeocoder(language);
  let response: google.maps.GeocoderResponse;
  try {
    response = await geocoder.geocode({
      address: query,
      region: "IL",
      componentRestrictions: { country: "IL" },
    });
  } catch (error) {
    // ZERO_RESULTS arrives as a rejection, and it is the one failure that means
    // "no such place" rather than "the lookup broke".
    if (String(error).includes("ZERO_RESULTS")) return [];
    throw error;
  }
  return response.results.slice(0, MAX_CANDIDATES).map((result) => ({
    label: result.formatted_address,
    point: {
      lat: result.geometry.location.lat(),
      lon: result.geometry.location.lng(),
    },
  }));
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
