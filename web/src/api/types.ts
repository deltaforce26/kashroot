/**
 * The consumer API wire contract, transcribed from Track B's Pydantic schemas in
 * `app/api/schemas_public.py`. These are the shapes that come off the socket; the
 * app itself consumes the view models in `./viewmodel.ts`.
 *
 * Wire conventions: snake_case keys, StrEnums as their lowercase value, ids as UUID
 * strings, dates as ISO `YYYY-MM-DD`, datetimes as ISO 8601 UTC. The profile travels
 * in the request body on every call — no auth, no accounts, no sessions.
 *
 * Layer separation is structural: `kashrut` is categorical with reason codes,
 * `fit` is a number, and neither type can express the other.
 */

/* ── Enums (app/match/types.py, app/models/enums.py) ─────────────────────── */

export type Verdict = "match" | "no_match" | "unknown";

export type Confidence = "high" | "medium" | "low";

/** In the backend's canonical display order: positive evidence first, then problems. */
export type ReasonCode =
  | "certifier_in_whitelist"
  | "level_meets_minimum"
  | "attribute_present"
  | "certificate_valid"
  | "evidence_fresh"
  | "certificate_expires_soon"
  | "certifier_not_in_whitelist"
  | "level_below_minimum"
  | "attribute_false"
  | "certificate_revoked"
  | "no_certificate"
  | "level_unknown"
  | "attribute_unknown"
  | "certificate_expired"
  | "certificate_not_yet_valid"
  | "certificate_pending"
  | "certificate_state_unrecognized"
  | "evidence_stale"
  | "no_freshness_evidence";

export type CertificateAttribute =
  | "glatt"
  | "chalav_yisrael"
  | "pas_yisrael"
  | "bishul_yisrael"
  | "yashan"
  | "kitniyot_pesach"
  | "sheruya";

export type CertificationLevel = "unknown" | "regular" | "mehadrin";

export type CertifierType = "rabbanut_local" | "rabbanut_national" | "badatz" | "private";

export type CertificateState = "active" | "expired" | "revoked" | "pending";

export type CertificateSource =
  | "certifier_portal"
  | "official_list"
  | "moderator_verified"
  | "owner_submitted"
  | "field_verification";

export type DietType = "meat" | "dairy" | "pareve" | "fish" | "mixed" | "dairy_pareve";

export type AmenityKey = "family" | "parking" | "accessibility" | "delivery" | "groups";

/* ── Requests ────────────────────────────────────────────────────────────── */

/** schemas_public.py :: WhitelistEntryRequest */
export interface WhitelistEntryRequest {
  certifier_id: string;
  min_level: CertificationLevel;
}

/**
 * schemas_public.py :: ProfileRequest. `whitelist` and `required_attributes` feed
 * Layer 1; the three preference fields feed Layer 2 and can never reach the verdict.
 */
export interface ProfileRequest {
  whitelist: WhitelistEntryRequest[];
  required_attributes: CertificateAttribute[];
  preferred_diets: DietType[];
  preferred_price_level: number | null;
  wanted_amenities: AmenityKey[];
}

/** schemas_public.py :: GeoPoint — note `lon`, not `lng`. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * schemas_public.py :: SearchFilters — facets that decide which restaurants are
 * asked about. None of them is a condition on the verdict.
 */
export interface SearchFilters {
  /** One kitchen; kept for compatibility. The filter bar sends `diet_types`. */
  diet_type?: DietType | null;
  /** Any of these kitchens. */
  diet_types?: DietType[];
  /**
   * Restaurants holding a certificate, in any state, from one of these certifiers.
   * Narrows on certificate identity; each survivor keeps its own verdict.
   */
  certifier_ids?: string[];
  price_level?: number | null;
  /** Accepted and ignored: the corpus records no opening hours yet. */
  open_now?: boolean | null;
  /** 0–5. Accepted and ignored: the corpus records no restaurant ratings. */
  min_rating?: number | null;
  amenities?: AmenityKey[];
}

/**
 * schemas_public.py :: SearchRequest. `center` is optional: without one the server
 * returns every row, ordered by verdict class then fit score, with `distance_km`
 * null. The client never scopes a search by city.
 */
export interface SearchRequest {
  profile: ProfileRequest;
  center?: GeoPoint;
  /**
   * Case-insensitive `ILIKE` substring over `name_he` / `name_en` / `address_he`.
   * Exact substring only — no fuzzy matching, no Hebrew normalization (niqqud,
   * plene/defective spelling). The corpus really does contain both פתח תקווה and
   * פתח תקוה, so a user typing one will not find the other. The UI must not imply
   * otherwise: no "did you mean", no fuzzy affordance. Max 200 chars.
   */
  query?: string;
  radius_km?: number;
  filters?: SearchFilters;
  page?: number;
  page_size?: number;
}

/** Longest `query` the API accepts. */
export const MAX_QUERY_LENGTH = 200;

/** schemas_public.py :: RestaurantDetailRequest */
export interface RestaurantDetailRequest {
  profile: ProfileRequest;
  center?: GeoPoint;
}

/* ── Responses ───────────────────────────────────────────────────────────── */

export interface ReasonOut {
  code: ReasonCode;
  attribute: string | null;
}

export interface FreshnessOut {
  verified_at: string | null;
  evidence_age_days: number | null;
  valid_until: string | null;
  days_until_expiry: number | null;
  is_stale: boolean;
  expires_soon: boolean;
}

/** Layer 1. The only field a client may render as a kashrut judgement. */
export interface KashrutVerdictOut {
  verdict: Verdict;
  reasons: ReasonOut[];
  confidence: Confidence;
  freshness: FreshnessOut | null;
  deciding_certificate_id: string | null;
}

export interface FitComponentOut {
  name: string;
  value: number;
  weight: number;
}

/** Layer 2. Soft preferences only; cannot see the verdict. */
export interface FitScoreOut {
  score: number;
  components: FitComponentOut[];
}

/** Display identity only — the app never ranks certifiers against each other. */
export interface CertifierChip {
  id: string;
  name_he: string;
  name_en: string | null;
  type: CertifierType;
}

/** `GET /v1/certifiers` returns a bare array of these. */
export interface CertifierListItem extends CertifierChip {
  /** Levels this certifier has actually published, excluding UNKNOWN. */
  levels: CertificationLevel[];
}

export interface GeoPointOut {
  lat: number;
  lon: number;
}

/**
 * schemas_public.py :: DecidingCertificateOut — an identity pointer, not evidence.
 * The full evidence for this certificate lives on the detail endpoint.
 */
export interface DecidingCertificateOut {
  certificate_id: string;
  certifier: CertifierChip;
  level: CertificationLevel;
}

export interface SearchResultItemOut {
  restaurant_id: string;
  name_he: string;
  name_en: string | null;
  city_he: string | null;
  address_he: string | null;
  geo: GeoPointOut | null;
  /** Null when the search had no `center` (an unscoped, everywhere search). */
  distance_km: number | null;
  diet_type: DietType | null;
  kashrut: KashrutVerdictOut;
  fit: FitScoreOut;
  certifiers: CertifierChip[];
  /** Null only when the gate resolved on no certificate at all. */
  deciding_certificate: DecidingCertificateOut | null;
}

export interface SearchResponseOut {
  total: number;
  page: number;
  page_size: number;
  items: SearchResultItemOut[];
}

export interface ProvenanceOut {
  source: CertificateSource;
  verified_by_label: string | null;
  verified_at: string | null;
  corroboration_count: number;
}

export interface CertificateEvidenceOut {
  certificate_id: string;
  certifier: CertifierChip;
  level: CertificationLevel;
  /** Tri-state: present key = published fact, absent key = unknown. */
  attributes: Record<string, boolean>;
  state: CertificateState;
  valid_from: string | null;
  valid_until: string | null;
  provenance: ProvenanceOut;
  outcome: Verdict;
  reasons: ReasonOut[];
  confidence: Confidence;
  freshness: FreshnessOut;
  /**
   * The certificate photo's review state. A public upload waits as `pending` until a
   * moderator accepts it; the photo itself never changes the verdict.
   */
  photo_status: PhotoStatus;
  /** A presigned URL, set only when `photo_status` is `accepted`. */
  photo_url: string | null;
}

export type PhotoStatus = "none" | "pending" | "accepted";

/** app/models/enums.py :: FlagType — what a public report says is wrong. */
export type FlagType =
  | "closed"
  | "no_certificate_displayed"
  | "different_certifier"
  | "expired_certificate"
  | "wrong_details"
  | "wrong_hours"
  | "other";

export const FLAG_TYPES: readonly FlagType[] = [
  "closed",
  "no_certificate_displayed",
  "different_certifier",
  "expired_certificate",
  "wrong_details",
  "wrong_hours",
  "other",
];

/** Longest free-text message a report may carry (the API rejects longer). */
export const FLAG_MESSAGE_MAX = 1000;

/** POST /v1/restaurants/{id}/flags. */
export interface FlagRequest {
  type: FlagType;
  /** The certificate card being reported, if any — the id from `CertificateEvidenceOut`. */
  certificate_id?: string;
  message?: string;
}

export interface FlagCreatedOut {
  flag_id: string;
  state: "open";
}

/** POST /v1/restaurants/{id}/certificate-photo → 201. */
export interface PhotoUploadOut {
  photo_id: string;
  status: "pending";
}

/** The image types the public upload accepts; PDFs stay admin-only. */
export const PHOTO_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** The server's upload ceiling, checked on the client first to save the round trip. */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

export interface RestaurantDetailResponseOut {
  restaurant_id: string;
  name_he: string;
  name_en: string | null;
  address_he: string | null;
  city_he: string | null;
  phone: string | null;
  website: string | null;
  diet_type: DietType | null;
  price_level: number | null;
  amenities: Record<string, boolean>;
  geo: GeoPointOut | null;
  distance_km: number | null;
  kashrut: KashrutVerdictOut;
  fit: FitScoreOut;
  certificates: CertificateEvidenceOut[];
}

/* ── The profile-free path (app/api/schemas_public_seo.py) ──────────────── */

/** schemas_public_seo.py :: CertifierFactOut — identity only, no `type`. */
export interface PublicCertifierOut {
  id: string;
  name_he: string;
  name_en: string | null;
}

/**
 * schemas_public_seo.py :: CertificateFactOut. A certificate exactly as stored and
 * nothing evaluated: no outcome, no reasons, no confidence, no freshness. `status`
 * is the certificate's own state — never a kashrut verdict.
 */
export interface PublicCertificateOut {
  certifier: PublicCertifierOut;
  status: CertificateState;
  valid_until: string | null;
  /** Tri-state, as on `CertificateEvidenceOut`: absent key = unknown, never false. */
  attributes: Record<string, boolean>;
}

/**
 * `GET /v1/restaurants/{id}` — the restaurant block of the detail response with
 * `kashrut`, `fit` and `distance_km` dropped. There is no profile on this path, so
 * there is nothing to evaluate against and no centre to measure from.
 */
export interface RestaurantPublicOut
  extends Omit<RestaurantDetailResponseOut, "distance_km" | "kashrut" | "fit" | "certificates"> {
  certificates: PublicCertificateOut[];
  /** ISO 8601 UTC datetime. */
  updated_at: string;
}

/**
 * schemas_public_seo.py :: DirectoryRestaurantOut — identity only: enough for a
 * landing-page row and its link to `/r/<id>`. No certificate state, no attributes,
 * no verdict.
 */
export interface DirectoryRestaurantOut {
  restaurant_id: string;
  name_he: string;
  name_en: string | null;
  address_he: string | null;
  /** Active certifiers, deduplicated, alphabetical by `name_he` — never by type. */
  certifier_names_he: string[];
  /** Parallel to `certifier_names_he`; `null` where a certifier has no English name. */
  certifier_names_en: (string | null)[];
}

/** schemas_public_seo.py :: DirectoryCityOut */
export interface DirectoryCityOut {
  city_he: string;
  /**
   * The city's English name, from `Restaurant.city_en` across its restaurants: the
   * most common non-null value (ties alphabetical), or `null` when none has one. A
   * display label only — grouping is keyed by `city_he`.
   */
  city_en: string | null;
  /** The full count for the city, however many rows `restaurants` samples. */
  restaurant_count: number;
  /** A sample of at most twelve, alphabetical by `name_he`. */
  restaurants: DirectoryRestaurantOut[];
}

/**
 * `GET /v1/directory` — every public restaurant grouped by city, facts only, for
 * the landing page a visitor without a profile (and every crawler) sees at `/`.
 * Cities are ordered by `restaurant_count` descending. Nothing in the tree is a
 * verdict, and nothing in it is ordered by anything but size and the alphabet.
 */
export interface DirectoryOut {
  total_restaurants: number;
  cities: DirectoryCityOut[];
}
