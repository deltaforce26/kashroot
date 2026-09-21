/**
 * API types hand-derived from app/api/schemas.py + app/models/enums.py.
 * Keep in sync with the backend Pydantic schemas — this file is the single
 * source of truth for request/response shapes on the frontend.
 */

// ----------------------------------------------------------------- enums

export type DietType =
  | "meat"
  | "dairy"
  | "pareve"
  | "fish"
  | "mixed"
  | "dairy_pareve";

export type RestaurantStatus = "open" | "closed_temp" | "closed_perm";

/** Keys allowed in Restaurant.amenities (AmenityKey in enums.py). Layer 2 only. */
export type AmenityKey = "family" | "parking" | "accessibility" | "delivery" | "groups";

export type RecordState =
  | "list_verified"
  | "moderator_verified"
  | "owner_submitted"
  | "field_verified"
  | "unknown_pending_verification";

export type CertificationLevel = "unknown" | "regular" | "mehadrin";

export type CertificateSource =
  | "certifier_portal"
  | "official_list"
  | "moderator_verified"
  | "owner_submitted"
  | "field_verification";

export type CertificateState = "active" | "expired" | "revoked" | "pending";

/**
 * CertifierType from app/models/enums.py. Display-only: the console never ranks
 * certifiers, and a type is a description of who issues the certificate, not a
 * statement about how good it is.
 */
export type CertifierType =
  | "rabbanut_local"
  | "rabbanut_national"
  | "badatz"
  | "private";

export type FlagType =
  | "closed"
  | "no_certificate_displayed"
  | "different_certifier"
  | "expired_certificate"
  | "wrong_details"
  | "wrong_hours"
  | "other";

export type FlagState = "open" | "in_review" | "resolved" | "rejected";

export type AuditAction = "create" | "update" | "delete" | "state_change";

export type EvidencePhotoStatus = "pending_review" | "accepted" | "rejected";

/** Keys allowed in Certificate.attributes (CertificateAttribute in enums.py). */
export type CertificateAttribute =
  | "glatt"
  | "chalav_yisrael"
  | "pas_yisrael"
  | "bishul_yisrael"
  | "yashan"
  | "kitniyot_pesach"
  | "sheruya";

/** Enum order from app/models/enums.py — drives the restaurant details editor. */
export const DIET_TYPES: readonly DietType[] = [
  "meat",
  "dairy",
  "pareve",
  "fish",
  "mixed",
  "dairy_pareve",
];

export const RESTAURANT_STATUSES: readonly RestaurantStatus[] = [
  "open",
  "closed_temp",
  "closed_perm",
];

export const AMENITY_KEYS: readonly AmenityKey[] = [
  "family",
  "parking",
  "accessibility",
  "delivery",
  "groups",
];

/**
 * Enum order from app/models/enums.py — drives the certificate state select.
 * There is no default: the moderator must pick one, so a certificate can never
 * become `active` because nobody chose otherwise.
 */
export const CERTIFICATE_STATES: readonly CertificateState[] = [
  "active",
  "expired",
  "revoked",
  "pending",
];

/** Enum order from app/models/enums.py — drives the certificate level select. */
export const CERTIFICATION_LEVELS: readonly CertificationLevel[] = [
  "unknown",
  "regular",
  "mehadrin",
];

/** Enum order from app/models/enums.py — drives the tri-state attribute editor. */
export const CERTIFICATE_ATTRIBUTES: readonly CertificateAttribute[] = [
  "glatt",
  "chalav_yisrael",
  "pas_yisrael",
  "bishul_yisrael",
  "yashan",
  "kitniyot_pesach",
  "sheruya",
];

/**
 * SOURCE_AUTHORITY from app/models/enums.py — higher = more authoritative.
 * Used only to *predict* whether an accepted photo review will upgrade the
 * certificate source (the server enforces the actual rule).
 */
export const SOURCE_AUTHORITY: Record<CertificateSource, number> = {
  certifier_portal: 5,
  moderator_verified: 4,
  official_list: 3,
  field_verification: 2,
  owner_submitted: 1,
};

// ------------------------------------------------------------- responses

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface CertifierBrief {
  name_he: string;
  name_en: string | null;
}

/**
 * CertifierOption (schemas_certificates.py) — the certificate picker's row.
 *
 * Deliberately carries NO levels field. A list of levels rendered beside a
 * certifier reads as a ranking, and the app never ranks certifiers: the user
 * whitelists, the app reports facts. Inactive certifiers are still selectable —
 * a real historical certificate must be recordable — and are marked as such.
 */
export interface CertifierOption {
  id: string;
  slug: string;
  name_he: string;
  name_en: string | null;
  type: CertifierType;
  is_active: boolean;
}

export interface CertificateOut {
  id: string;
  restaurant_id: string;
  certifier_id: string;
  /** Joined certifier name (backend contract addition, Aug 2026). */
  certifier: CertifierBrief | null;
  level: CertificationLevel;
  attributes: Record<string, boolean>;
  valid_from: string | null; // ISO date
  valid_until: string | null; // ISO date
  state: CertificateState;
  source: CertificateSource;
  source_document_id: string | null;
  evidence_photo_key: string | null;
  verified_by_label: string | null;
  verified_at: string | null; // ISO datetime (UTC)
  corroboration_count: number;
  notes: string | null;
}

export interface RestaurantBrief {
  id: string;
  name_he: string;
  name_en: string | null;
  branch_label: string | null;
  address_he: string | null;
  city_he: string | null;
  city_slug: string | null;
  phone: string | null;
  diet_type: DietType | null;
  status: RestaurantStatus;
  record_state: RecordState;
  needs_review: boolean;
  corroboration_count: number;
  notes: string | null;
  created_at: string; // ISO datetime (UTC)
  updated_at: string; // ISO datetime (UTC)
}

export interface ReviewQueueItem extends RestaurantBrief {
  certificates: CertificateOut[];
}

/**
 * RestaurantDetail (schemas_restaurants.py) — every field the directory shows or
 * writes, plus read-only context. `certificates` is context only: no kashrut fact is
 * editable from the directory, and `UpdateRestaurantRequest` cannot express one.
 */
export interface RestaurantDetail extends RestaurantBrief {
  address_en: string | null;
  city_en: string | null;
  neighborhood_he: string | null;
  website: string | null;
  menu_url: string | null;
  business_type_he: string | null;
  price_level: number | null;
  amenities: Record<string, boolean>;
  /** Derived from name/city/address by ingestion — never entered by hand. */
  dedupe_key: string;
  certificates: CertificateOut[];
}

export interface FlagOut {
  id: string;
  restaurant_id: string;
  certificate_id: string | null;
  type: FlagType;
  state: FlagState;
  message: string | null;
  photo_key: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  restaurant: RestaurantBrief;
  certificate: CertificateOut | null;
}

export interface ExpiryQueueItem {
  certificate: CertificateOut;
  restaurant: RestaurantBrief;
  /** Negative when the certificate is already past its valid_until. */
  days_until_expiry: number;
}

export interface EvidencePhotoOut {
  id: string;
  certificate_id: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: EvidencePhotoStatus;
  uploaded_by: string;
  uploaded_at: string; // ISO datetime (UTC)
  reviewed_by: string | null;
  reviewed_at: string | null; // ISO datetime (UTC)
  review_note: string | null;
  /** Presigned GET URL (short-lived), minted per response — never stored. */
  view_url: string | null;
}

export interface PhotoQueueItem {
  photo: EvidencePhotoOut;
  certificate: CertificateOut;
  restaurant: RestaurantBrief;
}

export interface AuditChange {
  before: unknown;
  after: unknown;
}

export interface AuditLogOut {
  id: string;
  /** Authoritative "newest first" sort key. */
  seq: number;
  entity_type: string;
  entity_id: string | null;
  action: AuditAction;
  changes: Record<string, AuditChange>;
  actor: string | null;
  evidence: Record<string, unknown>;
  ingestion_run_id: string | null;
  created_at: string;
}

// -------------------------------------------------------------- requests

export type ReviewResolution = "approve" | "reject" | "needs_more_info";

export interface ResolveReviewRequest {
  resolution: ReviewResolution;
  note?: string | null;
}

export type FlagOutcome = "dismissed" | "confirmed_degrade" | "needs_field_check";

export interface ResolveFlagRequest {
  outcome: FlagOutcome;
  /** Required by the API: min 5 chars after trim, for every outcome. */
  note: string;
}

export interface DegradeRequest {
  /** Required by the API: 1–2000 chars, not blank. */
  reason: string;
}

export interface VerifyRenewalRequest {
  valid_until: string; // ISO date
  evidence_note?: string | null;
  evidence_url?: string | null;
  evidence_photo_key?: string | null;
}

/**
 * UpdateRestaurantRequest (schemas_restaurants.py). PATCH semantics, mirrored
 * client-side: send ONLY the fields the moderator actually changed — an absent field
 * is untouched, an explicit `null` clears an optional one. `name_he`, `status` and
 * `amenities` refuse an explicit null (their columns are NOT NULL).
 *
 * There is deliberately no way to express a kashrut fact here: certificates, their
 * attributes and their states are not fields of this request, and record_state /
 * needs_review / corroboration_count belong to the review queue and to ingestion.
 * diet_type, price_level and amenities are Fit Score (Layer 2) inputs only.
 */
export interface UpdateRestaurantRequest {
  name_he?: string;
  name_en?: string | null;
  branch_label?: string | null;
  address_he?: string | null;
  address_en?: string | null;
  city_he?: string | null;
  city_en?: string | null;
  /** Lowercase ASCII slug, e.g. "tel-aviv" — the key city filters run on. */
  city_slug?: string | null;
  neighborhood_he?: string | null;
  phone?: string | null;
  website?: string | null;
  menu_url?: string | null;
  business_type_he?: string | null;
  diet_type?: DietType | null;
  /** 1–4. */
  price_level?: number | null;
  amenities?: Partial<Record<AmenityKey, boolean>>;
  status?: RestaurantStatus;
  notes?: string | null;
  /** Audited with the change; never stored on the restaurant row. */
  note?: string | null;
}

/**
 * CreateRestaurantRequest (schemas_restaurants.py). POST semantics, not PATCH:
 * an omitted optional is simply not set, so the client omits empty fields rather
 * than sending `null` (a `null` means "clear", which has no meaning on create).
 *
 * `needs_review` is the "send to the review queue" checkbox, not a direct column
 * write: the server maps it to the (record_state, needs_review) pair —
 * true → unknown_pending_verification, false → moderator_verified.
 *
 * Inexpressible on purpose: `record_state`, `dedupe_key` (derived from
 * name/city/address by ingestion), `corroboration_count`, and anything about a
 * certificate. Creating a restaurant never creates a kashrut fact.
 */
export interface CreateRestaurantRequest {
  name_he: string;
  name_en?: string;
  branch_label?: string;
  address_he?: string;
  address_en?: string;
  city_he?: string;
  city_en?: string;
  /** Lowercase ASCII slug, e.g. "tel-aviv" — the key city filters run on. */
  city_slug?: string;
  neighborhood_he?: string;
  phone?: string;
  website?: string;
  menu_url?: string;
  business_type_he?: string;
  diet_type?: DietType;
  /** 1–4. */
  price_level?: number;
  amenities: Partial<Record<AmenityKey, boolean>>;
  status: RestaurantStatus;
  notes?: string;
  /** Routes the new row: true → review queue, false → moderator_verified. */
  needs_review: boolean;
  /** Audited with the creation; never stored on the restaurant row. */
  note?: string;
}

/**
 * CreateCertificateRequest (schemas_certificates.py). The restaurant is the path
 * parameter, never a body field.
 *
 * `state` is required and undefaulted — a locked product decision. The moderator
 * chooses freely across the whole enum with no server-side evidence gate, and the
 * compensating control is the audit row naming them. Requiring the field is what
 * stops a certificate becoming `active` because nobody chose otherwise.
 *
 * `attributes` is tri-state by omission: send only the keys the moderator can
 * affirm, and an absent key stays unknown. Unlike the photo-review request there
 * is NO `null` variant — there is nothing to clear on a row that does not exist.
 *
 * Inexpressible on purpose: `source`, `verified_by_label`, `verified_at`,
 * `corroboration_count`, `import_key`, `source_document_id`, `evidence_photo_key`
 * and `is_demo_seed` — all server-stamped provenance.
 */
export interface CreateCertificateRequest {
  certifier_id: string;
  level: CertificationLevel;
  state: CertificateState;
  attributes?: Partial<Record<CertificateAttribute, boolean>>;
  valid_from?: string; // ISO date
  valid_until?: string; // ISO date
  notes?: string;
  /** Audited with the creation; never stored on the certificate row. */
  note?: string;
}

export type PhotoReviewDecision = "accept" | "reject";

/**
 * ReviewPhotoRequest (schemas.py). Fail-safe, mirrored client-side:
 * `attributes` / `valid_until` are only expressible on an "accept" decision.
 * `attributes` is tri-state — send ONLY the keys the photo actually shows;
 * an absent key stays untouched on the certificate. An explicit `null` CLEARS
 * a previously recorded attribute back to unknown (doubt → UNKNOWN fail-safe).
 */
export interface ReviewPhotoRequest {
  decision: PhotoReviewDecision;
  /** Required by the API: min 5 chars after trim. */
  note: string;
  attributes?: Partial<Record<CertificateAttribute, boolean | null>>;
  valid_until?: string; // ISO date, strictly future (civil date in Israel)
}

// ---------------------------------------------------------------- limits

/** Server-side page cap (MAX_PAGE_LIMIT in app/api/admin.py). */
export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_PAGE_LIMIT = 50;
export const DEFAULT_EXPIRY_WINDOW_DAYS = 14;

/** Server-side upload cap (MAX_PHOTO_BYTES in app/api/admin.py). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** Accepted evidence upload types (_PHOTO_EXTENSIONS in app/api/admin.py). */
export const ACCEPTED_PHOTO_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
