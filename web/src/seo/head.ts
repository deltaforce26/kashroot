/**
 * The `<head>` primitives `useDocumentHead` is built on — no dependency, on purpose.
 *
 * Every writer here is idempotent: a tag is looked up by its identity (`name`,
 * `property`, `rel`, or the JSON-LD marker), created once if missing, and updated in
 * place after that. `index.html` ships static defaults for the same tags so a
 * crawler that reads the raw document still sees a description and an Open Graph
 * card; the hook then overwrites those very elements rather than adding a second
 * copy beside them — two `<meta name="description">` tags is how a page ends up
 * described by whichever one the crawler happened to read first.
 *
 * `null` content removes the tag. That is how `noindex` and the canonical link are
 * withdrawn when a route that set them is left.
 */

export const SITE_NAME = "Kashroot";

/** The 512px launcher icon doubles as the share-card image until a real one exists. */
export const DEFAULT_OG_IMAGE = "/icons/icon-512.png";

/** Marks the one JSON-LD script this app owns, so it can be replaced and removed. */
export const JSON_LD_ATTR = "data-kashroot-jsonld";

/**
 * The origin every absolute URL in the head is built on.
 *
 * `VITE_SITE_ORIGIN` is the deploy's public address, set at build time so a preview
 * deployment on a Vercel branch URL still declares the production canonical — a
 * canonical pointing at the preview host would split the site's ranking across
 * every preview ever built. Without it the running page's own origin is used, which
 * is right for local development and for the tests.
 */
export function siteOrigin(): string {
  const configured = (import.meta.env["VITE_SITE_ORIGIN"] as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
}

export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** `<meta name=…>` for the HTML vocabulary, `<meta property=…>` for Open Graph. */
export type MetaKey = { name: string } | { property: string };

function metaSelector(key: MetaKey): string {
  return "name" in key ? `meta[name="${key.name}"]` : `meta[property="${key.property}"]`;
}

export function setMeta(key: MetaKey, content: string | null): void {
  const existing = document.head.querySelector<HTMLMetaElement>(metaSelector(key));
  if (content === null) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("meta");
  if (!existing) {
    if ("name" in key) element.setAttribute("name", key.name);
    else element.setAttribute("property", key.property);
    document.head.appendChild(element);
  }
  if (element.getAttribute("content") !== content) element.setAttribute("content", content);
}

export function setLink(rel: string, href: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (href === null) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("link");
  if (!existing) {
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  if (element.getAttribute("href") !== href) element.setAttribute("href", href);
}

/**
 * The page's structured data, as one script. Serialised with `<` escaped so a name
 * containing `</script>` cannot close the tag early — JSON-LD is JSON, but it sits
 * inside HTML.
 */
export function setJsonLd(data: Record<string, unknown> | null): void {
  const existing = document.head.querySelector<HTMLScriptElement>(`script[${JSON_LD_ATTR}]`);
  if (data === null) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("script");
  if (!existing) {
    element.type = "application/ld+json";
    element.setAttribute(JSON_LD_ATTR, "");
    document.head.appendChild(element);
  }
  const text = JSON.stringify(data).replace(/</g, "\\u003c");
  if (element.textContent !== text) element.textContent = text;
}
