/**
 * Entry of the server bundle `vite.ssr.config.ts` builds into `server-dist/` for
 * the Vercel function `api/prerender.js`. Binds `prerender` to the built shell
 * (`dist/index.html`, inlined at build time so the function ships no loose file)
 * and to the live API.
 */

import { parseRoute, prerender, type ApiFetch, type PrerenderResult } from "./prerender";

declare const __SHELL_HTML__: string;

/** Where the API lives — the same host vercel.json's `/v1` rewrite proxies to. */
const DEFAULT_API_ORIGIN = "https://kashroot-api.onrender.com";

/** Under the function's own limit, so a cold API yields a 503 rather than a crash. */
const API_TIMEOUT_MS = 20000;

function apiFetch(origin: string): ApiFetch {
  return async (path) => {
    const response = await fetch(`${origin}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) return { status: response.status };
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

/** `null` for a path this function does not render (the caller serves the shell). */
export async function renderPath(
  pathname: string,
  apiOrigin: string = DEFAULT_API_ORIGIN,
): Promise<PrerenderResult | null> {
  const route = parseRoute(pathname);
  if (!route) return null;
  return prerender(route, __SHELL_HTML__, apiFetch(apiOrigin.replace(/\/+$/, "")));
}

export const shellHtml = (): string => __SHELL_HTML__;
