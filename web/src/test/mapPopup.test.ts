/**
 * The two decisions behind the map's camera and its card popup.
 *
 * Tapping a pin opens its card; tapping the same pin again puts it away. Moving to a
 * new origin pulls the camera in but never pushes it out. The rest is Google's map and
 * marker layer, which never loads in jsdom, so both decisions live as pure functions
 * rather than as something only a real map could exercise.
 */

import { describe, expect, it } from "vitest";
import { nextOpenId, nextZoom } from "../views/MapView";

describe("map card toggle", () => {
  it("opens the card of the pin that was tapped", () => {
    expect(nextOpenId(null, "r1")).toBe("r1");
  });

  it("closes it when the same pin is tapped again", () => {
    expect(nextOpenId("r1", "r1")).toBeNull();
  });

  it("moves to the other pin rather than closing", () => {
    expect(nextOpenId("r1", "r2")).toBe("r2");
  });
});

describe("map recentre zoom", () => {
  it("pulls in when the camera is wider than the origin is worth", () => {
    expect(nextZoom(10)).toBe(14);
  });

  it("leaves a camera already at the base zoom alone", () => {
    expect(nextZoom(14)).toBeNull();
  });

  it("never zooms out on someone who zoomed in to a street", () => {
    expect(nextZoom(17)).toBeNull();
  });

  it("leaves the zoom alone when the map does not report one", () => {
    expect(nextZoom(undefined)).toBeNull();
  });
});
