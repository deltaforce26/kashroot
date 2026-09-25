/**
 * The fixture server's fail-safe behaviour. These assertions belong to Track B's
 * engine in the end; while the fixtures stand in for it they are what keeps the
 * demo from showing a verdict the real engine would never produce.
 */

import { describe, expect, it } from "vitest";
import {
  DIRECTORY_SAMPLE_PER_CITY,
  directoryCityEn,
  mockDirectory,
  mockRestaurant,
  mockSearch,
} from "../api/mock/server";
import { CERTIFIERS, RESTAURANTS } from "../api/mock/fixtures";
import type { ProfileRequest } from "../api/types";

const ALL_CERTIFIERS: ProfileRequest = {
  whitelist: CERTIFIERS.map((certifier) => ({
    certifier_id: certifier.id,
    min_level: "regular" as const,
  })),
  required_attributes: [],
  preferred_diets: [],
  preferred_price_level: null,
  wanted_amenities: [],
};

const RUBIN_WITH_ATTRS: ProfileRequest = {
  whitelist: [{ certifier_id: "cert-rubin", min_level: "regular" }],
  required_attributes: ["chalav_yisrael", "pas_yisrael"],
  preferred_diets: [],
  preferred_price_level: null,
  wanted_amenities: [],
};

const NOW = new Date("2026-08-17T12:00:00Z");

describe("fail-safe verdicts", () => {
  it("returns MATCH only when every required attribute is explicitly present", async () => {
    const detail = await mockRestaurant("r-hapisga", RUBIN_WITH_ATTRS, NOW);
    expect(detail.kashrut.verdict).toBe("match");
  });

  it("matches Rubin's 328-day-old published list (inside the 365-day window)", async () => {
    // The design's flagship restaurant, and the live database's dominant case:
    // Rubin's list is dated 2025-09-23, which is inside the window, so it matches.
    // Verification-age is off (ENFORCE_FRESHNESS = false) for the current app stage,
    // so this reads MATCH with no freshness reason either way.
    const detail = await mockRestaurant("r-nougatine", ALL_CERTIFIERS, NOW);
    expect(detail.kashrut.verdict).toBe("match");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).not.toContain("evidence_fresh");
  });

  it("matches despite evidence that is genuinely past the freshness window", async () => {
    // Product decision override (current app stage): verification-age staleness no
    // longer affects the verdict, so this restaurant — UNKNOWN only because its
    // evidence was stale — now reads MATCH with no freshness reason.
    const detail = await mockRestaurant("r-cafe-alit", ALL_CERTIFIERS, NOW);
    expect(detail.kashrut.verdict).toBe("match");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).not.toContain("evidence_stale");
  });

  it("needs a moderator-reviewed certificate before an attribute requirement can pass", async () => {
    // The bare published list carries no attributes, so on its own it can only ever
    // reach UNKNOWN against a profile that requires one. The moderator row is what
    // makes MATCH reachable — exactly how the seeded demo slice behaves.
    const detail = await mockRestaurant("r-hapisga", RUBIN_WITH_ATTRS, NOW);
    expect(detail.kashrut.verdict).toBe("match");
    expect(detail.certificates).toHaveLength(2);
    const bareList = detail.certificates.find(
      (cert) => cert.provenance.source === "official_list",
    );
    expect(bareList?.outcome).toBe("unknown");
    expect(bareList?.reasons.map((reason) => reason.code)).toContain("attribute_unknown");
  });

  it("degrades to UNKNOWN when a required attribute is simply absent", async () => {
    // Katzefet publishes chalav_yisrael but says nothing about pas_yisrael.
    const detail = await mockRestaurant("r-katzefet", RUBIN_WITH_ATTRS, NOW);
    expect(detail.kashrut.verdict).toBe("unknown");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).toContain("attribute_unknown");
  });

  it("returns UNKNOWN, not NO_MATCH, when there is no certificate at all", async () => {
    const detail = await mockRestaurant("r-sushi-bvg", ALL_CERTIFIERS, NOW);
    expect(detail.kashrut.verdict).toBe("unknown");
    expect(detail.kashrut.reasons[0]?.code).toBe("no_certificate");
  });

  it("auto-degrades a past-expiry certificate however healthy its stored state is", async () => {
    const detail = await mockRestaurant("r-haagam", ALL_CERTIFIERS, NOW);
    expect(detail.certificates[0]?.state).toBe("active");
    expect(detail.kashrut.verdict).toBe("unknown");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).toContain("certificate_expired");
  });

  it("does not degrade evidence past the freshness window (enforce_freshness off)", async () => {
    const detail = await mockRestaurant("r-cafe-alit", ALL_CERTIFIERS, NOW);
    expect(detail.kashrut.verdict).toBe("match");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).not.toContain("evidence_stale");
  });

  it("reserves NO_MATCH for definitive published facts", async () => {
    const revoked = await mockRestaurant("r-grill-habira", ALL_CERTIFIERS, NOW);
    expect(revoked.kashrut.verdict).toBe("no_match");
    expect(revoked.kashrut.reasons[0]?.code).toBe("certificate_revoked");

    const glattRequired: ProfileRequest = {
      ...ALL_CERTIFIERS,
      required_attributes: ["glatt"],
    };
    const explicitlyFalse = await mockRestaurant("r-burger-bite", glattRequired, NOW);
    expect(explicitlyFalse.kashrut.verdict).toBe("no_match");
    expect(explicitlyFalse.kashrut.reasons.map((reason) => reason.code)).toContain("attribute_false");
  });

  it("returns NO_MATCH when the certifier is simply not on the user's list", async () => {
    const onlyEda: ProfileRequest = {
      ...ALL_CERTIFIERS,
      whitelist: [{ certifier_id: "cert-eda", min_level: "regular" }],
    };
    const detail = await mockRestaurant("r-shawarma", onlyEda, NOW);
    expect(detail.kashrut.verdict).toBe("no_match");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).toContain(
      "certifier_not_in_whitelist",
    );
  });

  it("never satisfies a raised minimum with an unpublished level", async () => {
    const mehadrinRequired: ProfileRequest = {
      ...ALL_CERTIFIERS,
      whitelist: [{ certifier_id: "cert-rab-jlm", min_level: "mehadrin" }],
    };
    const detail = await mockRestaurant("r-cafe-alit", mehadrinRequired, NOW);
    expect(detail.kashrut.verdict).toBe("unknown");
    expect(detail.kashrut.reasons.map((reason) => reason.code)).toContain("level_unknown");
  });
});

describe("search response", () => {
  it("keeps the two layers separate: a categorical verdict and a numeric fit", async () => {
    const response = await mockSearch({ profile: ALL_CERTIFIERS, radius_km: 50 }, NOW);
    expect(response.items.length).toBeGreaterThan(0);
    for (const item of response.items) {
      expect(["match", "no_match", "unknown"]).toContain(item.kashrut.verdict);
      expect(typeof item.fit.score).toBe("number");
      // No numeric field anywhere inside the Layer 1 block.
      expect(JSON.stringify(item.kashrut)).not.toMatch(/"score"/);
    }
  });

  it("orders gate first, then fit within each verdict class", async () => {
    const response = await mockSearch(
      { profile: RUBIN_WITH_ATTRS, center: { lat: 31.7649, lon: 35.1846 }, radius_km: 50 },
      NOW,
    );
    const rank = { match: 0, unknown: 1, no_match: 2 } as const;
    const classes = response.items.map((item) => rank[item.kashrut.verdict]);
    expect(classes).toEqual([...classes].sort((a, b) => a - b));

    // …and within one class, fit descends.
    for (const verdict of ["match", "unknown", "no_match"] as const) {
      const scores = response.items
        .filter((item) => item.kashrut.verdict === verdict)
        .map((item) => item.fit.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("never lets a fit score lift a NO_MATCH above an UNKNOWN", async () => {
    const response = await mockSearch(
      { profile: RUBIN_WITH_ATTRS, center: { lat: 31.7649, lon: 35.1846 }, radius_km: 50 },
      NOW,
    );
    const lastUnknown = response.items.map((item) => item.kashrut.verdict).lastIndexOf("unknown");
    const firstNoMatch = response.items.map((item) => item.kashrut.verdict).indexOf("no_match");
    if (lastUnknown !== -1 && firstNoMatch !== -1) expect(lastUnknown).toBeLessThan(firstNoMatch);
  });

  it("does not hide NO_MATCH or UNKNOWN results from the list", async () => {
    const response = await mockSearch({ profile: RUBIN_WITH_ATTRS, radius_km: 50 }, NOW);
    const verdicts = new Set(response.items.map((item) => item.kashrut.verdict));
    expect(verdicts.has("unknown")).toBe(true);
    expect(verdicts.has("no_match")).toBe(true);
  });
});

/**
 * The landing page's directory, replayed to the contract of `GET /v1/directory`:
 * grouped by city, ordered by size, sampled alphabetically, and with no verdict or
 * certificate state anywhere in it — there is no profile on this path.
 */
describe("directory response", () => {
  it("groups every fixture by city, largest city first, and counts the whole city", async () => {
    const response = await mockDirectory();
    expect(response.total_restaurants).toBe(RESTAURANTS.length);
    expect(response.cities.map((city) => city.city_he)).toEqual(["ירושלים", "בני ברק", "טבריה"]);
    expect(response.cities.map((city) => city.restaurant_count)).toEqual([8, 2, 1]);
    for (const city of response.cities) {
      expect(city.restaurants.length).toBeLessThanOrEqual(DIRECTORY_SAMPLE_PER_CITY);
      expect(city.restaurants.length).toBe(Math.min(city.restaurant_count, DIRECTORY_SAMPLE_PER_CITY));
    }
  });

  it("labels each city with its records' `city_en`, grouped by `city_he` alone", async () => {
    const response = await mockDirectory();
    expect(response.cities.map((city) => city.city_en)).toEqual(["Jerusalem", "Bnei Brak", "Tiberias"]);
    for (const city of response.cities) {
      const group = RESTAURANTS.filter((restaurant) => restaurant.city_he === city.city_he);
      expect(city.city_en).toBe(directoryCityEn(group));
    }
  });

  it("picks a city's `city_en` as the API does: majority, ties alphabetical, null if none", () => {
    const named = (...names: (string | null)[]) => names.map((city_en) => ({ city_en }));
    // The majority wins, wherever the nulls fall.
    expect(directoryCityEn(named("Jerusalem", null, "Yerushalayim", "Jerusalem"))).toBe("Jerusalem");
    expect(directoryCityEn(named("Yerushalayim", "Yerushalayim", "Jerusalem"))).toBe("Yerushalayim");
    // A tie is broken alphabetically, not by first appearance.
    expect(directoryCityEn(named("Yerushalayim", "Jerusalem"))).toBe("Jerusalem");
    expect(directoryCityEn(named("Jerusalem", "Yerushalayim"))).toBe("Jerusalem");
    // Nulls are not values: they never win a tie and never become the label.
    expect(directoryCityEn(named(null, null, "Haifa"))).toBe("Haifa");
    expect(directoryCityEn(named(null, null))).toBeNull();
    expect(directoryCityEn([])).toBeNull();
  });

  it("orders a city's rows and each row's certifiers alphabetically — never by anything else", async () => {
    const response = await mockDirectory();
    for (const city of response.cities) {
      const names = city.restaurants.map((row) => row.name_he);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "he")));
      for (const row of city.restaurants) {
        expect(row.certifier_names_he).toEqual(
          [...row.certifier_names_he].sort((a, b) => a.localeCompare(b, "he")),
        );
        expect(row.certifier_names_en).toHaveLength(row.certifier_names_he.length);
      }
    }
  });

  it("deduplicates a restaurant's certifiers, and carries no verdict or certificate state", async () => {
    const response = await mockDirectory();
    const rows = response.cities.flatMap((city) => city.restaurants);
    // Two certificates from the same certifier on the record: one name on the row.
    const hapisga = rows.find((row) => row.restaurant_id === "r-hapisga");
    expect(hapisga?.certifier_names_he).toEqual(["בד״ץ מהדרין — הרב רובין"]);
    // No certificate at all: an empty list, not an invented certifier.
    expect(rows.find((row) => row.restaurant_id === "r-sushi-bvg")?.certifier_names_he).toEqual([]);

    const text = JSON.stringify(response);
    expect(text).not.toMatch(/kashrut|verdict|"match"|no_match|unknown|status|state|attributes|valid_until/);
  });
});
