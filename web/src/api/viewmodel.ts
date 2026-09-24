/**
 * The shapes the app actually renders, and the mappers from the wire types.
 *
 * This layer exists so a contract change on Track B's side lands in one file rather
 * than in fifteen components, and so the UI can hold fields the search endpoint does
 * not currently return (see the three `null` notes below) without every card growing
 * a conditional.
 *
 * Nothing here derives, softens or recomputes a verdict: `kashrut` and `fit` are
 * carried through byte-for-byte from the response.
 */

import type {
  AmenityKey,
  CertificateEvidenceOut,
  CertificateState,
  CertifierChip,
  CertifierListItem,
  DietType,
  DirectoryCityOut,
  DirectoryOut,
  DirectoryRestaurantOut,
  FitScoreOut,
  GeoPointOut,
  KashrutVerdictOut,
  ProfileRequest,
  PublicCertificateOut,
  PublicCertifierOut,
  RestaurantDetailResponseOut,
  RestaurantPublicOut,
  SearchResponseOut,
  SearchResultItemOut,
} from "./types";

export interface ResultView {
  id: string;
  nameHe: string;
  nameEn: string | null;
  cityHe: string | null;
  addressHe: string | null;
  geo: GeoPointOut | null;
  distanceKm: number | null;
  kashrut: KashrutVerdictOut;
  fit: FitScoreOut;
  /** Every certifier on the record. */
  certifiers: CertifierChip[];
  /** The certifier whose certificate produced the verdict. Null only when none did. */
  decidingCertifier: CertifierChip | null;
  /** Drives the design's food tint. */
  dietType: DietType | null;
  priceLevel: number | null;
  /**
   * Israel hours logic is out of POC scope, so the API returns no open-now state and
   * the UI simply omits the design's "open until 23:00" line rather than inventing it.
   */
  isOpenNow: boolean | null;
  closesAt: string | null;
}

export interface DetailView extends ResultView {
  phone: string | null;
  website: string | null;
  amenities: Record<string, boolean>;
  certificates: CertificateEvidenceOut[];
}

export interface SearchView {
  items: ResultView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CertifierView {
  id: string;
  nameHe: string;
  nameEn: string | null;
  type: CertifierChip["type"];
  levels: CertifierListItem["levels"];
}

export function toResultView(item: SearchResultItemOut): ResultView {
  return {
    id: item.restaurant_id,
    nameHe: item.name_he,
    nameEn: item.name_en,
    cityHe: item.city_he,
    addressHe: item.address_he,
    geo: item.geo,
    distanceKm: item.distance_km,
    kashrut: item.kashrut,
    fit: item.fit,
    certifiers: item.certifiers,
    decidingCertifier: item.deciding_certificate?.certifier ?? null,
    dietType: item.diet_type,
    priceLevel: null,
    isOpenNow: null,
    closesAt: null,
  };
}

export function toSearchView(response: SearchResponseOut): SearchView {
  return {
    items: response.items.map(toResultView),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
  };
}

export function toDetailView(response: RestaurantDetailResponseOut): DetailView {
  const deciding = response.certificates.find(
    (certificate) => certificate.certificate_id === response.kashrut.deciding_certificate_id,
  );
  return {
    id: response.restaurant_id,
    nameHe: response.name_he,
    nameEn: response.name_en,
    cityHe: response.city_he,
    addressHe: response.address_he,
    geo: response.geo,
    distanceKm: response.distance_km,
    kashrut: response.kashrut,
    fit: response.fit,
    certifiers: response.certificates.map((certificate) => certificate.certifier),
    decidingCertifier: deciding ? deciding.certifier : null,
    dietType: response.diet_type,
    priceLevel: response.price_level,
    isOpenNow: null,
    closesAt: null,
    phone: response.phone,
    website: response.website,
    amenities: response.amenities,
    certificates: response.certificates,
  };
}

/**
 * One published attribute fact, ready to print: the key names the string-table
 * label, `published` is the certificate's own true/false. The absent (unknown)
 * keys are not in the list at all — nothing here is rendered as false by default.
 */
export interface PublishedFact {
  key: string;
  published: boolean;
}

/** A certificate on the profile-free page: facts as stored, nothing decided. */
export interface PublicCertificateView {
  certifier: PublicCertifierOut;
  status: CertificateState;
  validUntil: string | null;
  facts: PublishedFact[];
}

export interface PublicRestaurantView {
  id: string;
  nameHe: string;
  nameEn: string | null;
  cityHe: string | null;
  addressHe: string | null;
  geo: GeoPointOut | null;
  dietType: DietType | null;
  priceLevel: number | null;
  phone: string | null;
  website: string | null;
  amenities: Record<string, boolean>;
  certificates: PublicCertificateView[];
  updatedAt: string;
}

/**
 * The attribute map flattened into rows *here*, in the API layer, so the view
 * prints a list it was handed and never reads the map itself — the boundary
 * `src/test/no-client-kashrut-logic.test.ts` checks is textual, and it is kept
 * trivially true by keeping every `.attributes` read on this side of it.
 */
function toPublicCertificateView(certificate: PublicCertificateOut): PublicCertificateView {
  return {
    certifier: certificate.certifier,
    status: certificate.status,
    validUntil: certificate.valid_until,
    facts: Object.entries(certificate.attributes).map(([key, published]) => ({ key, published })),
  };
}

export function toPublicView(response: RestaurantPublicOut): PublicRestaurantView {
  return {
    id: response.restaurant_id,
    nameHe: response.name_he,
    nameEn: response.name_en,
    cityHe: response.city_he,
    addressHe: response.address_he,
    geo: response.geo,
    dietType: response.diet_type,
    priceLevel: response.price_level,
    phone: response.phone,
    website: response.website,
    amenities: response.amenities,
    certificates: response.certificates.map(toPublicCertificateView),
    updatedAt: response.updated_at,
  };
}

/** A certifier's two names as the directory hands them over — no id, no type. */
export interface DirectoryCertifierView {
  nameHe: string;
  nameEn: string | null;
}

/** One landing-page row: a name, an address and who certifies it. Nothing decided. */
export interface DirectoryRestaurantView {
  id: string;
  nameHe: string;
  nameEn: string | null;
  addressHe: string | null;
  /** In the API's order — alphabetical, which is not a ranking. */
  certifiers: DirectoryCertifierView[];
}

export interface DirectoryCityView {
  cityHe: string;
  restaurantCount: number;
  restaurants: DirectoryRestaurantView[];
}

export interface DirectoryView {
  totalRestaurants: number;
  cities: DirectoryCityView[];
}

function toDirectoryRestaurantView(item: DirectoryRestaurantOut): DirectoryRestaurantView {
  return {
    id: item.restaurant_id,
    nameHe: item.name_he,
    nameEn: item.name_en,
    addressHe: item.address_he,
    // The wire carries two parallel lists. They are zipped here so a view prints one
    // name per certifier and never lines the two lists up by index itself.
    certifiers: item.certifier_names_he.map((nameHe, index) => ({
      nameHe,
      nameEn: item.certifier_names_en[index] ?? null,
    })),
  };
}

function toDirectoryCityView(city: DirectoryCityOut): DirectoryCityView {
  return {
    cityHe: city.city_he,
    restaurantCount: city.restaurant_count,
    restaurants: city.restaurants.map(toDirectoryRestaurantView),
  };
}

export function toDirectoryView(response: DirectoryOut): DirectoryView {
  return {
    totalRestaurants: response.total_restaurants,
    cities: response.cities.map(toDirectoryCityView),
  };
}

export function toCertifierView(item: CertifierListItem): CertifierView {
  return {
    id: item.id,
    nameHe: item.name_he,
    nameEn: item.name_en,
    type: item.type,
    levels: item.levels,
  };
}

/**
 * The certificate the verdict was decided on, when the response carries enough to
 * identify it. Detail responses do; search responses do not.
 */
export function decidingCertificate(detail: DetailView): CertificateEvidenceOut | null {
  return (
    detail.certificates.find(
      (certificate) => certificate.certificate_id === detail.kashrut.deciding_certificate_id,
    ) ?? null
  );
}

const chipName = (certifier: CertifierChip, lang: "he" | "en"): string =>
  lang === "en" ? (certifier.name_en ?? certifier.name_he) : certifier.name_he;

/**
 * The certifier name to put on a card.
 *
 * Prefers the certifier that actually produced the verdict — that is what the
 * design's evidence line means. Only when the response does not identify one does
 * it name every certifier on the record, which is honest about the ambiguity rather
 * than picking one arbitrarily and attributing the verdict to the wrong body. The
 * join is not a ranking: it is the whole set, in the order the API sent it.
 */
export function certifierLabel(view: ResultView, lang: "he" | "en"): string | null {
  if (view.decidingCertifier) return chipName(view.decidingCertifier, lang);
  if (view.certifiers.length === 0) return null;
  return view.certifiers.map((certifier) => chipName(certifier, lang)).join(" · ");
}

/**
 * Whether any result in this list came back as a MATCH.
 *
 * Reading the verdicts the API already returned — not deriving one. It lives here
 * rather than in a view so no screen has to name a verdict value, which keeps the
 * "no client-side kashrut logic" boundary trivially checkable.
 */
export function hasVerifiedMatch(items: ResultView[]): boolean {
  return items.some((item) => item.kashrut.verdict === "match");
}

/** Empty soft preferences: the POC collects none of them in the UI yet. */
export function emptyPreferences(): Pick<
  ProfileRequest,
  "preferred_diets" | "preferred_price_level" | "wanted_amenities"
> {
  const diets: DietType[] = [];
  const amenities: AmenityKey[] = [];
  return { preferred_diets: diets, preferred_price_level: null, wanted_amenities: amenities };
}
