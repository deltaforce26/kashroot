/**
 * Vercel function: server-rendered HTML for `/r/<id>`, `/city/<city>[/<certifier>]`
 * and `/certifier/<certifier>`. vercel.json rewrites those paths here with the
 * original path in `?path=`; the rendering itself is `src/ssr/prerender.ts`, built
 * into `server-dist/server.js` by `npm run build`.
 *
 * `KASHROOT_API_ORIGIN` overrides the API host (default: the Render service the
 * `/v1` rewrite proxies to).
 */
import { renderPath, shellHtml } from "../server-dist/server.js";

export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.searchParams.get("path") ?? url.pathname;
  const result = await renderPath(pathname, process.env.KASHROOT_API_ORIGIN || undefined);
  if (!result) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(shellHtml());
    return;
  }
  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  res.end(result.html);
}
