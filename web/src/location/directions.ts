/**
 * Deep links that hand a destination to a navigation app.
 *
 * Both are universal links: on a phone with the app installed they open it
 * straight into navigation, otherwise they fall back to the app's website.
 * Waze is listed first in the UI because it is the default in Israel.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export function wazeUrl({ lat, lon }: LatLon): string {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
}

export function googleMapsUrl({ lat, lon }: LatLon): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
