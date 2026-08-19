/**
 * Service-worker runtime caching rules, kept here as plain data so they can be unit
 * tested (`src/test/serviceWorker.test.ts`) instead of living as an untested literal
 * inside `vite.config.ts`.
 *
 * The rule that matters is a negative one. `POST /v1/search` and
 * `POST /v1/restaurants/{id}` are the only endpoints that carry a kashrut verdict,
 * and **their responses must never be cached**. A certificate can be revoked at any
 * moment; a cached response would let the app render a full, undecorated MATCH from
 * evidence that no longer exists, with nothing on screen saying the answer is old.
 * "Doubt → UNKNOWN, never doubt → MATCH" is a locked decision, and a stale cache is
 * doubt the UI cannot see. No verdict is strictly better than a wrong one, so the
 * POST rule is `NetworkOnly` and is written out explicitly rather than left to
 * Workbox's GET-only default — a default is not a decision, and the next person to
 * touch this file should have to delete a paragraph to break it.
 */

/** Structural shape of a Workbox runtime-caching entry — only what we use. */
export interface RuntimeCachingRule {
  urlPattern: RegExp;
  handler: "NetworkFirst" | "NetworkOnly" | "CacheFirst" | "CacheOnly" | "StaleWhileRevalidate";
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  options?: {
    cacheName?: string;
    networkTimeoutSeconds?: number;
    expiration?: { maxEntries?: number; maxAgeSeconds?: number };
  };
}

/** Both prefixes the app talks to: `/v1` (consumer router) and `/api` (admin router). */
export const API_URL_PATTERN = /^\/(v1|api)\//;

/** Handlers that can serve a response the network did not just produce. */
export const CACHING_HANDLERS: readonly RuntimeCachingRule["handler"][] = [
  "NetworkFirst",
  "CacheFirst",
  "CacheOnly",
  "StaleWhileRevalidate",
];

export const API_RUNTIME_CACHING: RuntimeCachingRule[] = [
  {
    // Verdict-bearing traffic. Every endpoint that returns a Layer 1 verdict is a
    // POST, and none of it is ever stored. Do not "improve" this to NetworkFirst to
    // get an offline search: an offline MATCH from a six-hour-old cache is the worst
    // failure this product has.
    urlPattern: API_URL_PATTERN,
    handler: "NetworkOnly",
    method: "POST",
  },
  {
    // GET traffic only, which today is `GET /v1/certifiers` — a list of certifier
    // names and ids used to build the whitelist picker. It carries no verdict and
    // no kashrut status, so a short-lived copy is safe and keeps the profile screen
    // usable offline. Nothing else on the API is a GET.
    urlPattern: API_URL_PATTERN,
    handler: "NetworkFirst",
    method: "GET",
    options: {
      cacheName: "kashroot-api",
      networkTimeoutSeconds: 6,
      expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 6 },
    },
  },
];

/**
 * The rule Workbox would apply to a request, i.e. the first one that matches both
 * the path and the method. Mirrors Workbox's first-registered-route-wins order so a
 * test can ask "what happens to POST /v1/search?" rather than eyeballing the array.
 */
export function ruleFor(
  path: string,
  method: RuntimeCachingRule["method"],
  rules: RuntimeCachingRule[] = API_RUNTIME_CACHING,
): RuntimeCachingRule | null {
  return (
    rules.find(
      (rule) => rule.urlPattern.test(path) && (rule.method ?? "GET") === method,
    ) ?? null
  );
}
