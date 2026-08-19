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

/** schemas_public.py :: SearchFilters — ordinary facets, never kashrut conditions. */
export interface SearchFilters {
  diet_type?: DietType | null;
  price_level?: number | null;
  open_now?: boolean | null;
  amenities?: AmenityKey[];
}

/** schemas_public.py :: SearchRequest. `center` or `city` is required. */
export interface SearchRequest {
  profile: ProfileRequest;
  center?: GeoPoint;
  /** `Restaurant.city_slug`, e.g. "jerusalem". */
  city?: string;
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
  /** Null when the search had no `center` (city-only search). */
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
}

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
