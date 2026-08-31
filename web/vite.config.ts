/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { API_RUNTIME_CACHING } from "./src/pwa/runtimeCaching";

// Dev proxy: the app always talks to a local FastAPI on :8000, so every request can
// use a same-origin /api/... path. Deliberately no CORS anywhere — same-origin only.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/icon.svg", "fonts/*.woff2", "fonts/fonts.css"],
      manifest: {
        name: "Kashroot — כשרות לפי הסטנדרט שלך",
        short_name: "Kashroot",
        description:
          "Every restaurant checked against your own kashrut profile, with the evidence behind every answer.",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f4f4ef",
        theme_color: "#f4f4ef",
        categories: ["food", "travel", "lifestyle"],
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        navigateFallback: "index.html",
        // The API is never precached, and the verdict-bearing endpoints are never
        // cached at all. What *is* cached: `GET /v1/certifiers` — names and ids for
        // the whitelist picker, no kashrut status in it.
        //
        // What is NOT cached, ever: `POST /v1/search` and `POST /v1/restaurants/{id}`.
        // Those are the only responses carrying a Layer 1 verdict, and a cached
        // verdict is a claim about kashrut made from evidence that may have been
        // revoked since. Offline the app shows no answer rather than an old one.
        //
        // The rules live in `src/pwa/runtimeCaching.ts` as data, unit-tested by
        // `src/test/serviceWorker.test.ts`. Add rules there, not here.
        runtimeCaching: API_RUNTIME_CACHING,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      // The consumer router is mounted at `/v1` (app/api/public.py), not `/api/v1`
      // like the admin router — so both prefixes are proxied through to :8000.
      "/v1": { target: "http://localhost:8000", changeOrigin: true },
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Unit tests always run against the fixture server, whatever the app's shipped
    // default is — otherwise `.env` switching the demo to the live API would quietly
    // turn the fixture suite into a suite that needs a database. The two live
    // integration files opt back in with `vi.stubEnv` and skip when :8000 is down.
    //
    // The maps key is pinned empty for the same reason: `.env.local` on a machine
    // that has a real browser key would otherwise silently take the map screen out
    // of its no-key fallback, and the two tests asserting that fallback would fail
    // on that machine only. A test that wants a key opts in with `vi.stubEnv`.
    env: { VITE_API_MODE: "mock", VITE_GOOGLE_MAPS_BROWSER_KEY: "" },
    // The full-app flow tests each mount the router, walk onboarding and wait on the
    // fixture server's simulated latency. Individually they take ~1s; run alongside
    // the other files on a loaded machine they can pass 5s, and a timeout here reads
    // as a product failure when it is only contention.
    testTimeout: 15000,
  },
});
