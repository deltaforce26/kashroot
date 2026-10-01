/**
 * What a directory page — a city, a city narrowed to one certifier, or a certifier
 * — tells search engines. Built the way `restaurantHead.ts` builds the restaurant
 * page's head, and held to the same rule: facts only.
 *
 * The title is the city's name (with the certifier's after it when the page is
 * narrowed), or the certifier's. The description is a count of what is on record.
 * The JSON-LD is a `schema.org/CollectionPage` carrying a `BreadcrumbList` back to
 * the root and an `ItemList` of the restaurants on the page — each one a
 * `Restaurant` with a name and a URL and nothing else. No `servesCuisine`, no
 * `aggregateRating`, no `review`, no word about any certifier beyond its name: a
 * certifier on a page is a fact on a certificate, and the app never describes one
 * as anything more. The list is declared unordered, because alphabetical is not a
 * ranking and the structured data should not read as one.
 */

import type { Lang, Strings } from "../i18n/strings";
import { pickName } from "../i18n/I18nProvider";
import { SITE_NAME, absoluteUrl } from "./head";
import type { DocumentHeadOptions } from "./useDocumentHead";

/** The restaurant fields the head needs from any directory row. */
export interface DirectoryItemFacts {
  id: string;
  nameHe: string;
  nameEn: string | null;
}

/** What the city page holds that the head needs; `certifier` only when narrowed. */
export interface CityDirectoryFacts {
  citySlug: string;
  cityHe: string;
  cityEn: string | null;
  /** The whole city's count — the description counts the city, not the narrowed list. */
  restaurantCount: number;
  certifier: { slug: string; nameHe: string; nameEn: string | null; restaurantCount: number } | null;
  restaurants: DirectoryItemFacts[];
}

export interface CertifierDirectoryFacts {
  slug: string;
  nameHe: string;
  nameEn: string | null;
  restaurantCount: number;
  cityCount: number;
  restaurants: DirectoryItemFacts[];
}

/**
 * A city's display name: in Hebrew always the records' own `city_he`; in English
 * the records' `city_en`, else the string table's fallback for a launch city, else
 * `city_he` as the records spell it. The same rule the landing page applies.
 */
export function cityDisplayName(cityHe: string, cityEn: string | null, lang: Lang, t: Strings): string {
  if (lang === "he") return cityHe;
  return cityEn ?? t.landing.cityNames[cityHe] ?? cityHe;
}

export function cityPath(citySlug: string, certifierSlug?: string | null): string {
  return certifierSlug
    ? `/city/${encodeURIComponent(citySlug)}/${encodeURIComponent(certifierSlug)}`
    : `/city/${encodeURIComponent(citySlug)}`;
}

export function certifierPath(certifierSlug: string): string {
  return `/certifier/${encodeURIComponent(certifierSlug)}`;
}

interface Crumb {
  name: string;
  path: string;
}

function breadcrumbList(crumbs: Crumb[]): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** Name and URL only — nothing a crawler could read as a judgement of the place. */
function restaurantItemList(restaurants: DirectoryItemFacts[], lang: Lang): Record<string, unknown> {
  return {
    "@type": "ItemList",
    numberOfItems: restaurants.length,
    itemListOrder: "https://schema.org/ItemListUnordered",
    itemListElement: restaurants.map((restaurant, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Restaurant",
        name: pickName(lang, restaurant.nameHe, restaurant.nameEn),
        url: absoluteUrl(`/r/${restaurant.id}`),
      },
    })),
  };
}

function collectionPage(
  name: string,
  path: string,
  crumbs: Crumb[],
  restaurants: DirectoryItemFacts[],
  lang: Lang,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: absoluteUrl(path),
    inLanguage: lang,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
    breadcrumb: breadcrumbList(crumbs),
    mainEntity: restaurantItemList(restaurants, lang),
  };
}

/** The not-in-our-records head every directory page shares: not worth indexing. */
function missingHead(t: Strings): DocumentHeadOptions {
  return { title: t.directory.notFoundTitle, description: t.seo.siteDescription, noindex: true };
}

/**
 * The head for `/city/<slug>` and `/city/<slug>/<certifier>` in each of its three
 * states — loading, loaded, and not in our records — as `restaurantHead` does.
 */
export function cityDirectoryHead(
  facts: CityDirectoryFacts | null,
  citySlug: string,
  certifierSlug: string | undefined,
  lang: Lang,
  t: Strings,
  missing = false,
): DocumentHeadOptions {
  const canonicalPath = cityPath(citySlug, certifierSlug);
  if (missing) return missingHead(t);
  if (!facts) return { description: t.seo.siteDescription, canonicalPath };

  const city = cityDisplayName(facts.cityHe, facts.cityEn, lang, t);
  const home: Crumb = { name: SITE_NAME, path: "/" };
  const cityCrumb: Crumb = { name: city, path: cityPath(facts.citySlug) };

  if (facts.certifier) {
    const certifier = pickName(lang, facts.certifier.nameHe, facts.certifier.nameEn);
    const title = t.directory.cityCertifierTitle(city, certifier);
    return {
      title,
      description: t.seo.cityCertifierDescription(city, certifier, facts.certifier.restaurantCount),
      canonicalPath,
      jsonLd: collectionPage(
        title,
        canonicalPath,
        [home, cityCrumb, { name: certifier, path: canonicalPath }],
        facts.restaurants,
        lang,
      ),
    };
  }

  return {
    title: city,
    description: t.seo.cityDescription(city, facts.restaurantCount),
    canonicalPath,
    jsonLd: collectionPage(city, canonicalPath, [home, cityCrumb], facts.restaurants, lang),
  };
}

/** The head for `/certifier/<slug>`, in the same three states. */
export function certifierDirectoryHead(
  facts: CertifierDirectoryFacts | null,
  slug: string,
  lang: Lang,
  t: Strings,
  missing = false,
): DocumentHeadOptions {
  const canonicalPath = certifierPath(slug);
  if (missing) return missingHead(t);
  if (!facts) return { description: t.seo.siteDescription, canonicalPath };

  const certifier = pickName(lang, facts.nameHe, facts.nameEn);
  return {
    title: certifier,
    description: t.seo.certifierDescription(certifier, facts.restaurantCount, facts.cityCount),
    canonicalPath,
    jsonLd: collectionPage(
      certifier,
      canonicalPath,
      [
        { name: SITE_NAME, path: "/" },
        { name: certifier, path: canonicalPath },
      ],
      facts.restaurants,
      lang,
    ),
  };
}
