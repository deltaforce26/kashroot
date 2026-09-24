/**
 * What a restaurant page tells search engines — the same head whether the visitor
 * has a profile (the verdict screen) or not (the public facts page), because both
 * live at `/r/<id>` and a crawler only ever sees the second.
 *
 * Facts only, by construction. The title is the name; the description is name,
 * city and the certifiers on record; the JSON-LD is a `schema.org/Restaurant` with
 * its address and coordinates. There is no `aggregateRating`, no review markup, no
 * `kashrut` field and no word about whether the place matches anyone — a verdict is
 * the answer to (Certificate × Profile), and a crawler has no profile. Structured
 * data that implied an app judgement would also be the one place that judgement
 * escaped the app into a search result, where the fail-safe rule cannot follow it.
 *
 * `servesCuisine: "Kosher"` is the one kashrut-adjacent word, and it is a category
 * label for what the certificate on record is about, not a claim by us that the
 * food is kosher by any standard.
 */

import type { GeoPointOut } from "../api/types";
import { pickName } from "../i18n/I18nProvider";
import type { Lang, Strings } from "../i18n/strings";
import { absoluteUrl } from "./head";
import type { DocumentHeadOptions } from "./useDocumentHead";

/** The subset of a restaurant either screen holds that the head needs. */
export interface RestaurantFacts {
  id: string;
  nameHe: string;
  nameEn: string | null;
  cityHe: string | null;
  addressHe: string | null;
  phone: string | null;
  website: string | null;
  geo: GeoPointOut | null;
  /** Display names of every certifier on the record, in the API's order, deduplicated. */
  certifierNames: string[];
}

/** A certifier's name in the UI language, Hebrew when no English one was published. */
interface NamedCertifier {
  id: string;
  name_he: string;
  name_en: string | null;
}

export function uniqueCertifierNames(certifiers: NamedCertifier[], lang: Lang): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const certifier of certifiers) {
    if (seen.has(certifier.id)) continue;
    seen.add(certifier.id);
    names.push(pickName(lang, certifier.name_he, certifier.name_en));
  }
  return names;
}

/** "אייס סטורי · Ice Story" — both names when two exist, the UI language's first. */
export function restaurantTitle(facts: RestaurantFacts, lang: Lang): string {
  const primary = pickName(lang, facts.nameHe, facts.nameEn);
  const other = primary === facts.nameHe ? facts.nameEn : facts.nameHe;
  return other && other !== primary ? `${primary} · ${other}` : primary;
}

export function restaurantJsonLd(facts: RestaurantFacts, lang: Lang): Record<string, unknown> {
  const name = pickName(lang, facts.nameHe, facts.nameEn);
  const alternate = name === facts.nameHe ? facts.nameEn : facts.nameHe;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name,
    ...(alternate && alternate !== name ? { alternateName: alternate } : {}),
    url: absoluteUrl(`/r/${facts.id}`),
    address: {
      "@type": "PostalAddress",
      ...(facts.addressHe ? { streetAddress: facts.addressHe } : {}),
      ...(facts.cityHe ? { addressLocality: facts.cityHe } : {}),
      addressCountry: "IL",
    },
    ...(facts.geo
      ? { geo: { "@type": "GeoCoordinates", latitude: facts.geo.lat, longitude: facts.geo.lon } }
      : {}),
    ...(facts.phone ? { telephone: facts.phone } : {}),
    ...(facts.website ? { sameAs: facts.website } : {}),
    servesCuisine: "Kosher",
  };
}

/**
 * The head for `/r/<id>` in each of its three states: still loading (the brand
 * title, so the previous route's title does not linger over a page that is not it),
 * loaded, and not in our records — which is a page not worth indexing.
 */
export function restaurantHead(
  facts: RestaurantFacts | null,
  id: string,
  lang: Lang,
  t: Strings,
  missing = false,
): DocumentHeadOptions {
  const canonicalPath = `/r/${id}`;
  if (missing) {
    return { title: t.states.notFound, description: t.seo.siteDescription, noindex: true };
  }
  if (!facts) return { description: t.seo.siteDescription, canonicalPath };
  return {
    title: restaurantTitle(facts, lang),
    description: t.seo.restaurantDescription(
      pickName(lang, facts.nameHe, facts.nameEn),
      facts.cityHe,
      facts.certifierNames.length > 0 ? facts.certifierNames.join(" · ") : null,
    ),
    canonicalPath,
    ogType: "place",
    jsonLd: restaurantJsonLd(facts, lang),
  };
}
