/**
 * The server bundle behind `api/prerender.js` — see `src/ssr/prerender.ts`.
 *
 * Runs after the client build (`npm run build`), because it inlines the client's
 * built `dist/index.html` (hashed asset URLs and all) as the shell every prerendered
 * page is filled into. Everything is bundled (`noExternal`), so the function needs
 * nothing from `node_modules` at runtime.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const shell = readFileSync(path.resolve(__dirname, "dist/index.html"), "utf8");

export default defineConfig({
  plugins: [react()],
  define: { __SHELL_HTML__: JSON.stringify(shell) },
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "src/ssr/server.ts",
    outDir: "server-dist",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "server.js", format: "es" } },
  },
});
