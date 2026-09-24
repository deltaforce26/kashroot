/**
 * Guard for the fail-safe rule at the service-worker layer.
 *
 * `POST /v1/search` and `POST /v1/restaurants/{id}` are the only endpoints that
 * return a Layer 1 verdict. If the service worker ever serves one of those from a
 * cache, the app renders a full, undecorated MATCH out of evidence that may have
 * been revoked hours earlier — no banner, no doubt, no way for the user to tell.
 * That is the exact inversion of "doubt → UNKNOWN, never doubt → MATCH".
 *
 * These tests fail if anyone gives a verdict-bearing POST a caching handler — which
 * is what adding `method: "POST"` to the NetworkFirst rule would do.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_RUNTIME_CACHING,
  API_URL_PATTERN,
  CACHING_HANDLERS,
  ruleFor,
  type RuntimeCachingRule,
} from "../pwa/runtimeCaching";

/** Every path whose response carries a kashrut verdict, with the method it uses. */
const VERDICT_ENDPOINTS: { path: string; method: RuntimeCachingRule["method"] }[] = [
  { path: "/v1/search", method: "POST" },
  { path: "/v1/restaurants/9d4f3a7c-0000-4000-8000-000000000001", method: "POST" },
  { path: "/api/v1/search", method: "POST" },
];

describe("service worker runtime caching", () => {
  it("matches the endpoints it claims to govern, so the guard is not vacuous", () => {
    for (const endpoint of VERDICT_ENDPOINTS) {
      expect(API_URL_PATTERN.test(endpoint.path)).toBe(true);
    }
  });

  it("never serves a verdict-bearing response from a cache", () => {
    for (const endpoint of VERDICT_ENDPOINTS) {
      const rule = ruleFor(endpoint.path, endpoint.method);
      // No rule at all is acceptable — Workbox then leaves the request alone.
      if (!rule) continue;
      expect(
        CACHING_HANDLERS.includes(rule.handler),
        `${endpoint.method} ${endpoint.path} would be served by "${rule.handler}"; ` +
          "a cached kashrut verdict may be revoked evidence and must never be shown",
      ).toBe(false);
    }
  });

  /**
   * The profile-free facts endpoint is a GET with no verdict in it, but a
   * certificate's stored state and expiry are kashrut facts and a revocation must
   * show the moment it is published — so it is excluded from the GET cache by name.
   */
  it("never caches the public restaurant facts, the one GET that carries certificate state", () => {
    const rule = ruleFor("/v1/restaurants/9d4f3a7c-0000-4000-8000-000000000001", "GET");
    expect(rule?.handler).toBe("NetworkOnly");
    // …while the certifier list, which carries none, is still served from cache.
    expect(ruleFor("/v1/certifiers", "GET")?.handler).toBe("NetworkFirst");
  });

  /**
   * The landing page's directory is the other cacheable GET: restaurant names,
   * addresses and certifier names, with no certificate state in it. It falls under
   * the generic GET rule rather than a rule of its own — asserted so that stays a
   * decision, and so a future path-scoped exclusion cannot catch it by accident.
   */
  it("serves the landing directory from the short-lived GET cache, like the certifier list", () => {
    expect(ruleFor("/v1/directory", "GET")?.handler).toBe("NetworkFirst");
    expect(ruleFor("/v1/directory", "GET")).toBe(ruleFor("/v1/certifiers", "GET"));
  });

  it("declares the POST rule explicitly rather than relying on Workbox's GET default", () => {
    const post = API_RUNTIME_CACHING.find((rule) => rule.method === "POST");
    expect(post, "POST must be routed explicitly, not left to a default").toBeDefined();
    expect(post?.handler).toBe("NetworkOnly");
    expect(post?.options?.cacheName).toBeUndefined();
  });

  it("gives every API rule an explicit method, so no rule silently widens", () => {
    for (const rule of API_RUNTIME_CACHING) {
      expect(rule.method, `rule "${rule.handler}" has no explicit method`).toBeDefined();
    }
  });

  it("caches only GET, and only briefly", () => {
    const cached = API_RUNTIME_CACHING.filter((rule) => CACHING_HANDLERS.includes(rule.handler));
    expect(cached.length).toBeGreaterThan(0);
    for (const rule of cached) {
      expect(rule.method).toBe("GET");
      const maxAge = rule.options?.expiration?.maxAgeSeconds ?? Infinity;
      expect(maxAge).toBeLessThanOrEqual(60 * 60 * 6);
    }
  });

  /**
   * The rules are only testable while they live in the data module. A literal array
   * back inside `vite.config.ts` would be invisible to every assertion above.
   */
  it("keeps the rules in the tested module rather than inline in the build config", () => {
    const config = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../vite.config.ts"),
      "utf8",
    );
    expect(config).toMatch(/runtimeCaching:\s*API_RUNTIME_CACHING/);
    // …and nothing declares a handler or a method inline alongside it.
    expect(config).not.toMatch(/handler:\s*["']/);
    expect(config).not.toMatch(/method:\s*["']/);
  });
});
