/**
 * Per-route `<head>`: title, description, canonical, Open Graph, robots, JSON-LD.
 *
 * Why this exists: the app is a client-rendered SPA behind an onboarding gate, so
 * without it every URL Googlebot fetched carried the same `<title>Kashroot</title>`
 * and nothing else — indistinguishable pages, none of them describable. Each screen
 * now declares what it is, and the public restaurant page (the indexable long tail)
 * declares the place, its address and its certificate facts.
 *
 * Written against the DOM directly rather than through a head-management library:
 * the whole job is a dozen `setAttribute` calls, and one more dependency in the
 * bundle every phone downloads is not worth saving them.
 *
 * The hook only ever states facts about the page. Nothing here can name a verdict,
 * a fit score or a certifier ranking — the description and JSON-LD a restaurant
 * page passes in are built in `./restaurantHead.ts`, which is held to that rule.
 */

import { useEffect } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { Lang } from "../i18n/strings";
import { DEFAULT_OG_IMAGE, SITE_NAME, absoluteUrl, setJsonLd, setLink, setMeta } from "./head";

export interface DocumentHeadOptions {
  /** The page's own title. Omitted, the document carries the brand title alone (home). */
  title?: string;
  description: string;
  /** Same-origin path (`/r/abc`). Omitted, no canonical and no `og:url` are declared. */
  canonicalPath?: string;
  /** Thin or profile-dependent screens: ask crawlers to keep them out of the index. */
  noindex?: boolean;
  /** One schema.org object for the page; replaced on change, removed on unmount. */
  jsonLd?: Record<string, unknown> | null;
  /** Same-origin path of a share-card image; falls back to the launcher icon. */
  ogImage?: string;
  ogType?: "website" | "place";
}

const OG_LOCALE: Record<Lang, string> = { he: "he_IL", en: "en_US" };

export function documentTitle(title: string | undefined, brandTitle: string): string {
  return title ? `${title} · ${SITE_NAME}` : brandTitle;
}

export function useDocumentHead(options: DocumentHeadOptions): void {
  const { lang, t } = useI18n();
  const { title, description, canonicalPath, noindex = false, ogImage, ogType = "website" } =
    options;
  // Structured data is compared by value: a caller rebuilding the same object on
  // every render must not rewrite the script tag on every render.
  const jsonLdText = options.jsonLd ? JSON.stringify(options.jsonLd) : "";
  const brandTitle = t.seo.brandTitle;

  useEffect(() => {
    const fullTitle = documentTitle(title, brandTitle);
    const url = canonicalPath ? absoluteUrl(canonicalPath) : null;
    document.title = fullTitle;
    setMeta({ name: "description" }, description);
    setLink("canonical", url);
    setMeta({ property: "og:title" }, fullTitle);
    setMeta({ property: "og:description" }, description);
    setMeta({ property: "og:url" }, url);
    setMeta({ property: "og:type" }, ogType);
    setMeta({ property: "og:locale" }, OG_LOCALE[lang]);
    setMeta({ property: "og:site_name" }, SITE_NAME);
    setMeta({ property: "og:image" }, absoluteUrl(ogImage ?? DEFAULT_OG_IMAGE));
    setMeta({ name: "twitter:card" }, ogImage ? "summary_large_image" : "summary");
    setMeta({ name: "robots" }, noindex ? "noindex,nofollow" : null);
  }, [title, brandTitle, description, canonicalPath, noindex, ogImage, ogType, lang]);

  useEffect(() => {
    setJsonLd(jsonLdText ? (JSON.parse(jsonLdText) as Record<string, unknown>) : null);
    return () => setJsonLd(null);
  }, [jsonLdText]);
}
