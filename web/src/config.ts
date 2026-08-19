/**
 * Demo-time constants.
 *
 * The POC has no geolocation permission flow, so the app opens on a chosen city
 * centre rather than the device's position. No single city is hardcoded as *the*
 * demo city: the lead city is still a product decision, and the app lets you switch
 * between every city the corpus actually covers.
 *
 * Bounds mirror `app/api/consts.py`: radius must stay within 0.1–50 km, page size
 * within 1–100. `POST /v1/search` requires `center` or `city`.
 */

export interface CityOption {
  /** Must match `Restaurant.city_slug`. Verified against Track A's geocoding pass. */
  slug: string;
  he: string;
  en: string;
  /** Neighbourhood-level label for the home header, where the design shows one. */
  areaHe: string;
  areaEn: string;
  center: { lat: number; lon: number };
}

/**
 * Every city with geocoded rows in the corpus. Slugs confirmed verbatim against the
 * database. Coverage is partial in all of them, which is why `states.coverageNote`
 * exists — the list a user sees is never the whole city.
 *
 * Jerusalem leads because the product owner chose it as the demo city, not because
 * of its coverage number. The order is presentational only; nothing depends on it
 * except which chip appears first.
 */
export const CITIES: readonly CityOption[] = [
  {
    slug: "jerusalem",
    he: "ירושלים",
    en: "Jerusalem",
    areaHe: "ירושלים · בית וגן",
    areaEn: "Jerusalem · Bayit VeGan",
    center: { lat: 31.7649, lon: 35.1846 },
  },
  {
    slug: "bnei-brak",
    he: "בני ברק",
    en: "Bnei Brak",
    areaHe: "בני ברק · רבי עקיבא",
    areaEn: "Bnei Brak · Rabbi Akiva",
    center: { lat: 32.0853, lon: 34.8338 },
  },
  {
    slug: "haifa",
    he: "חיפה",
    en: "Haifa",
    areaHe: "חיפה · הדר",
    areaEn: "Haifa · Hadar",
    center: { lat: 32.8082, lon: 34.9896 },
  },
  {
    slug: "beit-shemesh",
    he: "בית שמש",
    en: "Beit Shemesh",
    areaHe: "בית שמש · רמת בית שמש",
    areaEn: "Beit Shemesh · Ramat Beit Shemesh",
    center: { lat: 31.7497, lon: 34.9887 },
  },
  {
    slug: "safed",
    he: "צפת",
    en: "Safed",
    areaHe: "צפת · העיר העתיקה",
    areaEn: "Safed · Old City",
    center: { lat: 32.9646, lon: 35.4961 },
  },
  {
    slug: "tiberias",
    he: "טבריה",
    en: "Tiberias",
    areaHe: "טבריה · הטיילת",
    areaEn: "Tiberias · Promenade",
    center: { lat: 32.7922, lon: 35.5312 },
  },
];

/**
 * The city the app opens on. A product decision (Jerusalem), stated explicitly here
 * rather than falling out of array order, so changing it is one obvious edit and
 * cannot be moved by accident when the city list is reordered.
 */
export const DEFAULT_CITY_SLUG = "jerusalem";

export function cityBySlug(slug: string): CityOption {
  return CITIES.find((city) => city.slug === slug) ?? (CITIES[0] as CityOption);
}

/** Comfortable walking/driving radius for the home list. */
export const NEARBY_RADIUS_KM = 12;

/** The server's ceiling; used when the map wants everything around a centre. */
export const MAX_RADIUS_KM = 50;

export const PAGE_SIZE = 20;
