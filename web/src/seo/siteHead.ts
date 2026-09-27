/**
 * The head `/` declares — in both of its states.
 *
 * The root renders two different screens: the landing page for a visitor with no
 * profile (and for every crawler), and Home for a visitor with one. They are one
 * address with one canonical, one description and one piece of structured data, so
 * the head is built here once and both screens call it. Two copies would drift, and
 * a crawler only ever reads the landing's; whatever Home declared would be unseen
 * until the day it disagreed.
 *
 * The structured data is a `WebSite` with its name and languages only — no
 * `SearchAction`, because a sitelinks search box would hand Google a query URL that
 * lands behind the onboarding gate. No `ItemList` of restaurants either: the landing
 * page's rows are ordinary anchors, which is all a crawler needs to find them, and
 * one JSON-LD object per page is simpler to keep honest than two.
 */

import type { Strings } from "../i18n/strings";
import { SITE_NAME, absoluteUrl } from "./head";
import type { DocumentHeadOptions } from "./useDocumentHead";

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    inLanguage: ["he", "en"],
  };
}

/** No `title`: the front page carries the brand title alone. */
export function siteHead(t: Strings): DocumentHeadOptions {
  return {
    description: t.seo.siteDescription,
    canonicalPath: "/",
    ogType: "website",
    jsonLd: websiteJsonLd(),
  };
}
