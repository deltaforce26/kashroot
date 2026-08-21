/**
 * The PWA's real client code, run against the live backend.
 *
 * This is the seam that had never been exercised: every other test runs on fixtures.
 * It imports the *actual* `liveApi` — same fetch wrapper, same view-model mappers the
 * app uses — points it at a running FastAPI on :8000, and asserts that what comes off
 * the socket survives the mapping intact.
 *
 * It skips itself when the API is not reachable, so the suite stays green on a
 * machine without the stack up. Run it deliberately:
 *
 *     KASHROOT_LIVE_API=http://127.0.0.1:8000 npx vitest run live.integration
 *
 * It asserts *shape and invariants*, never specific counts — the corpus is being
 * regeocoded and those numbers move.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { KashrootApi } from "../api";
import type { ProfileRequest } from "../api/types";
import { PICKER_PRESETS, PRESET_ORDER, expandPreset } from "../profile/profile";

const BASE = process.env["KASHROOT_LIVE_API"] ?? "http://127.0.0.1:8000";

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const LIVE = await reachable();

/** Jerusalem · Bayit VeGan — the design's own neighbourhood. */
const CENTER = { lat: 31.7649, lon: 35.1846 };

describe.skipIf(!LIVE)("live API", () => {
  let api: KashrootApi;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    // The client uses same-origin `/v1/...` paths that the Vite dev proxy forwards.
    // There is no origin in Node, so stand in for the proxy.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return realFetch(url.startsWith("/") ? `${BASE}${url}` : url, init);
    }) as typeof fetch;

    vi.stubEnv("VITE_API_MODE", "live");
    const module = await import("../api");
    api = module.kashrootApi;
    expect(module.API_MODE).toBe("live");
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  async function anyProfile(): Promise<ProfileRequest> {
    const certifiers = await api.getCertifiers();
    return {
      whitelist: certifiers.map((certifier) => ({
        certifier_id: certifier.id,
        min_level: "regular" as const,
      })),
      required_attributes: [],
      preferred_diets: [],
      preferred_price_level: null,
      wanted_amenities: [],
    };
  }

  it("maps GET /v1/certifiers into the picker's view model", async () => {
    const certifiers = await api.getCertifiers();
    expect(certifiers.length).toBeGreaterThan(0);
    for (const certifier of certifiers) {
      expect(certifier.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(certifier.nameHe.length).toBeGreaterThan(0);
      expect(["rabbanut_local", "rabbanut_national", "badatz", "private"]).toContain(
        certifier.type,
      );
      expect(Array.isArray(certifier.levels)).toBe(true);
    }
  });

  it("returns results whose two layers stay structurally separate", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 50 });

    expect(search.items.length).toBeGreaterThan(0);
    for (const item of search.items) {
      expect(["match", "no_match", "unknown"]).toContain(item.kashrut.verdict);
      // Layer 1 carries no number anywhere.
      expect(JSON.stringify(item.kashrut)).not.toMatch(/"score"/);
      // Layer 2 is a number and only a number.
      expect(Number.isInteger(item.fit.score)).toBe(true);
      expect(item.fit.score).toBeGreaterThanOrEqual(0);
      expect(item.fit.score).toBeLessThanOrEqual(100);
      // Every row can be rendered: a Hebrew name is always present.
      expect(item.nameHe.length).toBeGreaterThan(0);
      expect(item.kashrut.reasons.length).toBeGreaterThan(0);
    }
  });

  it("orders gate first, then fit inside each verdict class", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 100 });
    const rank = { match: 0, unknown: 1, no_match: 2 } as const;

    const classes = search.items.map((item) => rank[item.kashrut.verdict]);
    expect(classes).toEqual([...classes].sort((a, b) => a - b));

    for (const verdict of ["match", "unknown", "no_match"] as const) {
      const scores = search.items
        .filter((item) => item.kashrut.verdict === verdict)
        .map((item) => item.fit.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("supplies the two fields the design's cards depend on", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 50 });

    // Not every restaurant has a published diet type, so the tint falls back — but
    // the field must be present and usable where it exists.
    const tinted = search.items.filter((item) => item.dietType !== null);
    expect(tinted.length).toBeGreaterThan(0);

    // The card's evidence line attributes the verdict to one certifier.
    const attributed = search.items.filter((item) => item.decidingCertifier !== null);
    expect(attributed.length).toBeGreaterThan(0);
    expect(attributed[0]?.decidingCertifier?.name_he.length).toBeGreaterThan(0);
  });

  it("agrees with the detail endpoint about distance, to the metre", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 5 });
    const first = search.items[0];
    expect(first).toBeDefined();
    if (!first) return;

    const detail = await api.getRestaurant(first.id, profile, CENTER);
    expect(detail.id).toBe(first.id);
    expect(detail.nameHe).toBe(first.nameHe);
    // One PostGIS source: list and detail must not drift.
    expect(detail.distanceKm).toBeCloseTo(first.distanceKm as number, 6);
  });

  it("omits distance entirely for a city-only search rather than inventing one", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, city: "jerusalem", page_size: 20 });
    expect(search.items.length).toBeGreaterThan(0);
    for (const item of search.items) expect(item.distanceKm).toBeNull();
  });

  it("returns full provenance on the deciding certificate", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 20 });
    const withCertificate = search.items.find(
      (item) => item.kashrut.deciding_certificate_id !== null,
    );
    expect(withCertificate).toBeDefined();
    if (!withCertificate) return;

    const detail = await api.getRestaurant(withCertificate.id, profile, CENTER);
    const deciding = detail.certificates.find(
      (certificate) => certificate.certificate_id === detail.kashrut.deciding_certificate_id,
    );
    expect(deciding).toBeDefined();
    if (!deciding) return;

    // Everything the evidence panel and certificate card render.
    expect(deciding.certifier.name_he.length).toBeGreaterThan(0);
    expect(["certifier_portal", "official_list", "moderator_verified", "owner_submitted", "field_verification"]).toContain(
      deciding.provenance.source,
    );
    expect(deciding.freshness).not.toBeNull();
    expect(typeof deciding.freshness.is_stale).toBe("boolean");
    expect(["active", "expired", "revoked", "pending"]).toContain(deciding.state);
    expect(["unknown", "regular", "mehadrin"]).toContain(deciding.level);
    if (deciding.valid_until !== null) expect(deciding.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (deciding.provenance.verified_at !== null)
      expect(Number.isNaN(Date.parse(deciding.provenance.verified_at))).toBe(false);
  });

  it("reaches all three verdicts on real records", async () => {
    const profile = await anyProfile();
    const broad = await api.search({ profile, center: CENTER, radius_km: 12, page_size: 100 });
    const seen = new Set(broad.items.map((item) => item.kashrut.verdict));

    // A profile requiring an attribute drives the UNKNOWN path, which is where most
    // of this corpus lands once anything is required of a certificate.
    const strict = await api.search({
      profile: { ...profile, required_attributes: ["glatt"] },
      center: CENTER,
      radius_km: 12,
      page_size: 100,
    });
    for (const item of strict.items) seen.add(item.kashrut.verdict);

    expect(seen.has("match")).toBe(true);
    expect(seen.has("unknown")).toBe(true);
    expect(seen.has("no_match")).toBe(true);
  });

  it("finds Hebrew text by exact substring, and misses a different spelling", async () => {
    const profile = await anyProfile();
    const hit = await api.search({ profile, city: "jerusalem", query: "פיצה", page_size: 10 });
    expect(hit.items.length).toBeGreaterThan(0);
    for (const item of hit.items) {
      expect(`${item.nameHe} ${item.addressHe ?? ""}`).toContain("פיצה");
    }

    // The limitation the search copy is written around: no normalization, so a
    // spelling the corpus does not use returns nothing rather than a near match.
    const miss = await api.search({
      profile,
      city: "jerusalem",
      query: "זזזזזזאיןכזה",
      page_size: 10,
    });
    expect(miss.items).toHaveLength(0);
  });

  /**
   * Presets select certifiers by `type`, which the API returns — never by an id or a
   * name baked into the client. That is what makes them survive a reseeded database.
   * Names are explicitly not used: the corpus spells the same body both `בד"ץ` and
   * `בד״ץ`, so name matching would be quietly unreliable.
   */
  it("resolves every preset against ids the server actually returned", async () => {
    const certifiers = await api.getCertifiers();
    const known = new Set(certifiers.map((certifier) => certifier.id));

    for (const preset of PRESET_ORDER) {
      const whitelist = expandPreset(preset, certifiers);
      for (const entry of whitelist) {
        // An unresolved id is a guaranteed 422 — it must be impossible to send one.
        expect(known.has(entry.certifier_id)).toBe(true);
      }
      // Only the picker presets are allowed to select nothing.
      if (!PICKER_PRESETS.includes(preset) && preset !== "custom") {
        expect(whitelist.length).toBeGreaterThan(0);
      }
    }
  });

  it("accepts every preset without a validation error", async () => {
    const certifiers = await api.getCertifiers();
    for (const preset of PRESET_ORDER) {
      const whitelist = expandPreset(preset, certifiers);
      if (whitelist.length === 0) continue;
      const search = await api.search({
        profile: {
          whitelist,
          required_attributes: [],
          preferred_diets: [],
          preferred_price_level: null,
          wanted_amenities: [],
        },
        center: CENTER,
        radius_km: 12,
        page_size: 10,
      });
      expect(search.total).toBeGreaterThanOrEqual(0);
    }
  });

  it("degrades a nonexistent city to an empty result, not an error", async () => {
    const profile = await anyProfile();
    const search = await api.search({ profile, city: "no-such-city", page_size: 10 });
    expect(search.total).toBe(0);
    expect(search.items).toHaveLength(0);
  });

  it("surfaces a missing restaurant as a clean 404 through ApiError", async () => {
    const profile = await anyProfile();
    const { ApiError } = await import("../api");
    await expect(
      api.getRestaurant("00000000-0000-0000-0000-000000000000", profile),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
