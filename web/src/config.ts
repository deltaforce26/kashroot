/**
 * Demo-time constants.
 *
 * The app has no "current city" and no default centre: a search is measured from
 * the device, from a pinned address, or from nowhere — in which case the API is
 * asked for every place it holds, paginated. Nothing here names a place the API is
 * ever asked about.
 *
 * Bounds mirror `app/api/consts.py`: radius must stay within 0.1–50 km, page size
 * within 1–100. `POST /v1/search` takes an optional `center`; without one it returns
 * every row.
 */

/** Comfortable walking/driving radius for the home list. */
export const NEARBY_RADIUS_KM = 12;

/**
 * The server's ceiling on `radius_km`, mirrored from the API so this file's header
 * describes the same bounds. No screen sends it: every distance search asks for the
 * filter bar's radius (`RADIUS_OPTIONS`, which tops out well below this), so the
 * reach is the user's choice rather than a sweep of everything.
 */
export const MAX_RADIUS_KM = 50;

export const PAGE_SIZE = 20;

/**
 * Where the map camera opens when there is no origin to open on. A starting
 * viewport only — Jerusalem, at the zoom the map uses for a pinned origin. It is
 * never sent to the API, never used to compute a distance, and never treated as
 * where the user is: with no origin the map plots every place in the database and
 * the user pans to the part of the country they care about.
 */
export const MAP_DEFAULT_VIEW = { center: { lat: 31.7683, lon: 35.2137 }, zoom: 14 } as const;
