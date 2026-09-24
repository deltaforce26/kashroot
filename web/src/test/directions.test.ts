import { describe, expect, it } from "vitest";
import { googleMapsUrl, wazeUrl } from "../location/directions";

describe("navigation deep links", () => {
  const geo = { lat: 31.7784, lon: 35.2066 };

  it("opens Waze straight into navigation", () => {
    expect(wazeUrl(geo)).toBe("https://waze.com/ul?ll=31.7784,35.2066&navigate=yes");
  });

  it("opens Google Maps directions", () => {
    expect(googleMapsUrl(geo)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=31.7784,35.2066",
    );
  });
});
