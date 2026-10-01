import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
let failing = false;
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => {
    if (failing) throw new Error("blocked");
    calls.push(args);
  },
}));

import { trackCtaClick, trackOnboardingComplete, trackRestaurantSaved } from "../analytics";

describe("product analytics events", () => {
  beforeEach(() => {
    calls.length = 0;
    failing = false;
  });

  it("sends each event with its name and props", () => {
    trackCtaClick("landing");
    trackOnboardingComplete({ path: "skip", preset: "any", certifiers: 3, first: true });
    trackRestaurantSaved();
    expect(calls).toEqual([
      ["cta_click", { source: "landing" }],
      ["onboarding_complete", { path: "skip", preset: "any", certifiers: 3, first: true }],
      ["restaurant_saved", {}],
    ]);
  });

  it("never lets an analytics failure break the user action", () => {
    failing = true;
    expect(() => trackRestaurantSaved()).not.toThrow();
  });
});
