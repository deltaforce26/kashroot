/**
 * The one decision behind the map's card popup.
 *
 * Tapping a pin opens its card; tapping the same pin again puts it away. The rest of
 * the popup is Google's marker layer, which never loads in jsdom, so the toggle lives
 * as a pure function rather than as something only a real map could exercise.
 */

import { describe, expect, it } from "vitest";
import { nextOpenId } from "../views/MapView";

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
