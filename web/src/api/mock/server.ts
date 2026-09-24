/**
 * A STAND-IN FOR THE SERVER — not client logic.
 *
 * Track B owns the real Layer 1 gate (`app/match/engine.py`) and Layer 2 fit score
 * (`app/match/fit.py`). This module replays the same rules over fixture data and
 * emits the *exact* wire shapes of `app/api/schemas_public.py`, so switching
 * `VITE_API_MODE=live` changes where the bytes come from and nothing else. It is
 * deleted wholesale once the endpoints are running.
 *
 * The boundary that makes this safe is enforced by a test
 * (`src/test/no-client-kashrut-logic.test.ts`): nothing outside `src/api/` imports
 * this directory, and no view, component or hook derives a verdict. The app renders
 * `kashrut.verdict` and `kashrut.reasons` exactly as they arrive.
 *
 * The rules replayed here, from `app/match/engine.py`:
 *   - Doubt → UNKNOWN, never doubt → MATCH.
 *   - NO_MATCH only on definitive facts (revoked, certifier not whitelisted, level
 *     below the requested minimum, attribute published as false).
 *   - Past expiry, or stale/absent verification evidence, auto-degrades to UNKNOWN
 *     however healthy the stored state says the certificate is.
 *   - Attributes are tri-state; an absent key never satisfies a requirement.
 *   - Combining certificates: MATCH beats UNKNOWN beats NO_MATCH.
 */

import { ApiError } from "../client";
import {
  PHOTO_MAX_BYTES,
  PHOTO_MIME_TYPES,
  type CertificateAttribute,
  type CertificateEvidenceOut,
  type CertifierChip,
  type CertifierListItem,
  type CertificationLevel,
  type Confidence,
  type DirectoryOut,
  type DirectoryRestaurantOut,
  type FlagCreatedOut,
  type FlagRequest,
  type FitComponentOut,
  type FitScoreOut,
  type FreshnessOut,
  type GeoPoint,
  type KashrutVerdictOut,
  type PhotoUploadOut,
  type ProfileRequest,
  type ReasonCode,
  type ReasonOut,
  type RestaurantDetailResponseOut,
  type RestaurantPublicOut,
  type SearchRequest,
  type SearchResponseOut,
  type SearchResultItemOut,
  type Verdict,
  type WhitelistEntryRequest,
} from "../types";
import {
  CERTIFIERS,
  RESTAURANTS,
  type FixtureCertificate,
  type FixturePhoto,
  type FixtureRestaurant,
} from "./fixtures";

/**
 * Evidence older than this is stale, and stale evidence degrades to UNKNOWN however
 * healthy the certificate's stored state is.
 *
 * Mirrors the backend's window and is the ONLY place the value appears on this side
 * — changing it here re-classifies every fixture at once. It is exported so tests
 * can express a certificate's age relative to the window ("comfortably fresh",
 * "past the window") instead of hardcoding a day count that silently changes
 * meaning when the product owner moves the window.
 *
 * 365 days, matching the backend: kashrut certificates are typically issued
 * annually. Verified against the live database, where 540 of 540 certificates are
 * fresh and none are stale — so stale-evidence UNKNOWN is a rare cause here, not the
 * dominant one. Exactly one fixture is deliberately stale to keep it covered.
 */
export const FRESHNESS_WINDOW_DAYS = 365;

/** Inside this many days of expiry, the engine adds an informational reason. */
export const EXPIRES_SOON_DAYS = 30;

/**
 * Mirrors `Settings.enforce_freshness` (app/core/config.py). Verification-age
 * staleness is a user decision override for the current app stage: it must not
 * affect the verdict. The staleness logic itself stays in `freshnessOf` and
 * `evaluateCertificate` below (switchable), just as it does on the backend — only
 * the reason emission is gated off. Expiry (`valid_until` past) is unaffected.
 */
export const ENFORCE_FRESHNESS = false;

const REASON_ORDER: ReasonCode[] = [
  "certifier_in_whitelist",
  "level_meets_minimum",
  "attribute_present",
  "certificate_valid",
  "evidence_fresh",
  "certificate_expires_soon",
  "certifier_not_in_whitelist",
  "level_below_minimum",
  "attribute_false",
  "certificate_revoked",
  "no_certificate",
  "level_unknown",
  "attribute_unknown",
  "certificate_expired",
  "certificate_not_yet_valid",
  "certificate_pending",
  "certificate_state_unrecognized",
  "evidence_stale",
  "no_freshness_evidence",
];

const LEVEL_ORDER = { unknown: -1, regular: 0, mehadrin: 1 } as const;
const VERDICT_PRECEDENCE: Record<Verdict, number> = { match: 0, unknown: 1, no_match: 2 };

const DAY_MS = 24 * 60 * 60 * 1000;

function sortReasons(reasons: ReasonOut[]): ReasonOut[] {
  return [...reasons].sort((a, b) => {
    const order = REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code);
    return order !== 0 ? order : (a.attribute ?? "").localeCompare(b.attribute ?? "");
  });
}

function reason(code: ReasonCode, attribute: CertificateAttribute | null = null): ReasonOut {
  return { code, attribute };
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function verifiedAtIso(cert: FixtureCertificate, now: Date): string | null {
  return cert.verified_days_ago === null
    ? null
    : new Date(now.getTime() - cert.verified_days_ago * DAY_MS).toISOString();
}

function freshnessOf(cert: FixtureCertificate, now: Date): FreshnessOut {
  const ageDays = cert.verified_days_ago;
  const daysUntilExpiry = cert.valid_until ? daysBetween(now, new Date(cert.valid_until)) : null;
  return {
    verified_at: verifiedAtIso(cert, now),
    evidence_age_days: ageDays,
    valid_until: cert.valid_until,
    days_until_expiry: daysUntilExpiry,
    is_stale: ageDays === null || ageDays > FRESHNESS_WINDOW_DAYS,
    expires_soon:
      daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= EXPIRES_SOON_DAYS,
  };
}

interface CertOutcome {
  outcome: Verdict;
  reasons: ReasonOut[];
  confidence: Confidence;
  freshness: FreshnessOut;
}

/** Certificate states that short-circuit before the profile is even consulted. */
function blockingState(cert: FixtureCertificate, now: Date): [Verdict, ReasonOut[]] | null {
  if (cert.state === "revoked") return ["no_match", [reason("certificate_revoked")]];
  if (cert.state === "pending") return ["unknown", [reason("certificate_pending")]];
  if (cert.state === "expired") return ["unknown", [reason("certificate_expired")]];
  if (cert.valid_until && daysBetween(now, new Date(cert.valid_until)) < 0) {
    return ["unknown", [reason("certificate_expired")]];
  }
  if (cert.valid_from && daysBetween(new Date(cert.valid_from), now) < 0) {
    return ["unknown", [reason("certificate_not_yet_valid")]];
  }
  return null;
}

function evaluateCertificate(
  cert: FixtureCertificate,
  profile: ProfileRequest,
  now: Date,
): CertOutcome {
  const freshness = freshnessOf(cert, now);
  const blocked = blockingState(cert, now);
  if (blocked) {
    return { outcome: blocked[0], reasons: sortReasons(blocked[1]), confidence: "low", freshness };
  }

  const positives: ReasonOut[] = [];
  const failures: ReasonOut[] = [];
  const doubts: ReasonOut[] = [];

  const entry: WhitelistEntryRequest | undefined = profile.whitelist.find(
    (candidate) => candidate.certifier_id === cert.certifier_id,
  );
  if (!entry) {
    failures.push(reason("certifier_not_in_whitelist"));
  } else {
    positives.push(reason("certifier_in_whitelist"));
    if (LEVEL_ORDER[entry.min_level] > LEVEL_ORDER.regular) {
      if (cert.level === "unknown") doubts.push(reason("level_unknown"));
      else if (LEVEL_ORDER[cert.level] < LEVEL_ORDER[entry.min_level])
        failures.push(reason("level_below_minimum"));
      else positives.push(reason("level_meets_minimum"));
    }
  }

  for (const attribute of profile.required_attributes) {
    const value = cert.attributes[attribute];
    if (value === true) positives.push(reason("attribute_present", attribute));
    else if (value === false) failures.push(reason("attribute_false", attribute));
    else doubts.push(reason("attribute_unknown", attribute));
  }

  if (ENFORCE_FRESHNESS) {
    if (freshness.evidence_age_days === null) doubts.push(reason("no_freshness_evidence"));
    else if (freshness.is_stale) doubts.push(reason("evidence_stale"));
    else positives.push(reason("evidence_fresh"));
  }

  if (freshness.expires_soon) positives.push(reason("certificate_expires_soon"));

  let outcome: Verdict;
  if (doubts.length > 0) outcome = "unknown";
  else if (failures.length > 0) outcome = "no_match";
  else {
    outcome = "match";
    positives.push(reason("certificate_valid"));
  }

  const confidence: Confidence =
    outcome === "match" && cert.source === "moderator_verified" && !freshness.is_stale
      ? "high"
      : doubts.length > 0
        ? "low"
        : "medium";

  return {
    outcome,
    reasons: sortReasons([...positives, ...failures, ...doubts]),
    confidence,
    freshness,
  };
}

function evaluateRestaurant(
  restaurant: FixtureRestaurant,
  profile: ProfileRequest,
  now: Date,
): { kashrut: KashrutVerdictOut; evaluations: CertOutcome[] } {
  if (restaurant.certificates.length === 0) {
    return {
      kashrut: {
        verdict: "unknown",
        reasons: [reason("no_certificate")],
        confidence: "low",
        freshness: null,
        deciding_certificate_id: null,
      },
      evaluations: [],
    };
  }

  const evaluations = restaurant.certificates.map((cert) => evaluateCertificate(cert, profile, now));
  let bestIndex = 0;
  evaluations.forEach((evaluation, index) => {
    const best = evaluations[bestIndex];
    if (!best) return;
    if (VERDICT_PRECEDENCE[evaluation.outcome] < VERDICT_PRECEDENCE[best.outcome]) bestIndex = index;
  });
  const best = evaluations[bestIndex];
  const bestCert = restaurant.certificates[bestIndex];
  if (!best || !bestCert) throw new Error("unreachable: non-empty certificate list");

  return {
    kashrut: {
      verdict: best.outcome,
      reasons: best.reasons,
      confidence: best.confidence,
      freshness: best.freshness,
      deciding_certificate_id: bestCert.certificate_id,
    },
    evaluations,
  };
}

/* ── Layer 2: soft preferences only. Takes no kashrut input, by construction. ── */

function haversineKm(a: GeoPoint, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function computeFit(restaurant: FixtureRestaurant, distanceKm: number | null): FitScoreOut {
  const components: FitComponentOut[] = [
    { name: "distance", value: distanceKm === null ? 0.5 : 0.5 ** (distanceKm / 1.5), weight: 0.35 },
    // Israel hours logic is out of POC scope, so open-now scores neutral for everyone.
    { name: "open_now", value: 0.5, weight: 0.25 },
    {
      name: "price",
      value: restaurant.price_level === null ? 0.5 : 1 - (restaurant.price_level - 1) / 4,
      weight: 0.15,
    },
    {
      name: "amenities",
      value: Object.values(restaurant.amenities).filter(Boolean).length / 5,
      weight: 0.15,
    },
    { name: "diet", value: 0.5, weight: 0.1 },
  ];
  const score = Math.round(
    components.reduce((total, component) => total + component.value * component.weight, 0) * 100,
  );
  return { score, components };
}

/* ── Mapping to wire shapes ──────────────────────────────────────────────── */

function chipById(id: string): CertifierChip {
  const found = CERTIFIERS.find((certifier) => certifier.id === id);
  if (!found) throw new Error(`unknown certifier ${id}`);
  return { id: found.id, name_he: found.name_he, name_en: found.name_en, type: found.type };
}

function restaurantChips(restaurant: FixtureRestaurant): CertifierChip[] {
  const ids = [...new Set(restaurant.certificates.map((cert) => cert.certifier_id))];
  return ids.map(chipById);
}

function toEvidence(
  cert: FixtureCertificate,
  evaluation: CertOutcome,
  now: Date,
  photo: FixturePhoto | null,
): CertificateEvidenceOut {
  return {
    certificate_id: cert.certificate_id,
    certifier: chipById(cert.certifier_id),
    level: cert.level,
    attributes: cert.attributes as Record<string, boolean>,
    state: cert.state,
    valid_from: cert.valid_from,
    valid_until: cert.valid_until,
    provenance: {
      source: cert.source,
      verified_by_label: cert.verified_by,
      verified_at: verifiedAtIso(cert, now),
      corroboration_count: 1,
    },
    outcome: evaluation.outcome,
    reasons: evaluation.reasons,
    confidence: evaluation.confidence,
    freshness: evaluation.freshness,
    photo_status: photo ? photo.status : "none",
    photo_url: photo?.status === "accepted" ? photo.url : null,
  };
}

/* ── Photo and report state, mutable like the server's tables ────────────── */

/** Keyed by certificate id — a fixture's `photo` is assigned to its first certificate. */
let photoState = new Map<string, FixturePhoto>();
let flagLog: Array<{ restaurant_id: string; body: FlagRequest }> = [];
let nextId = 1;

/** Back to the fixtures' own photo states, with no reports. For tests. */
export function resetMockSubmissions(): void {
  photoState = new Map(
    RESTAURANTS.flatMap((restaurant) => {
      const certificate = restaurant.certificates[0];
      return restaurant.photo && certificate
        ? [[certificate.certificate_id, { ...restaurant.photo }] as const]
        : [];
    }),
  );
  flagLog = [];
  nextId = 1;
}
resetMockSubmissions();

/** Every report the mock has taken since the last reset. For tests. */
export function mockFlags(): ReadonlyArray<{ restaurant_id: string; body: FlagRequest }> {
  return flagLog;
}

/* ── The three endpoints ─────────────────────────────────────────────────── */

const LATENCY_MS = 260;
const delay = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
const delayReject = <T,>(error: Error): Promise<T> =>
  new Promise((_, reject) => setTimeout(() => reject(error), LATENCY_MS));

export function mockCertifiers(): Promise<CertifierListItem[]> {
  const items: CertifierListItem[] = CERTIFIERS.map((certifier) => {
    const levels = [
      ...new Set(
        RESTAURANTS.flatMap((restaurant) =>
          restaurant.certificates
            .filter((cert) => cert.certifier_id === certifier.id && cert.level !== "unknown")
            .map((cert) => cert.level),
        ),
      ),
    ] as CertificationLevel[];
    return { ...chipById(certifier.id), levels };
  });
  return delay(items);
}

/**
 * `query`, as the API does it (app/api/public.py): a case-insensitive substring over
 * the Hebrew name, the English name and the Hebrew address — no fuzzy matching and no
 * Hebrew normalization, which is exactly what the search UI promises and no more.
 */
function matchesQuery(restaurant: (typeof RESTAURANTS)[number], query: string): boolean {
  const needle = query.toLowerCase();
  return [restaurant.name_he, restaurant.name_en, restaurant.address_he].some(
    (field) => typeof field === "string" && field.toLowerCase().includes(needle),
  );
}

export function mockSearch(request: SearchRequest, now = new Date()): Promise<SearchResponseOut> {
  // No centre means no distance and no distance filter: every row is in scope,
  // exactly as the API behaves. Nothing here invents a place to measure from.
  const center = request.center ?? null;
  const radiusKm = request.radius_km ?? 25;
  const dietTypes = request.filters?.diet_types ?? [];
  const certifierIds = request.filters?.certifier_ids ?? [];
  const query = request.query?.trim() ?? "";

  const items: SearchResultItemOut[] = [];
  for (const restaurant of RESTAURANTS) {
    const distanceKm = center ? haversineKm(center, restaurant) : null;
    if (distanceKm !== null && distanceKm > radiusKm) continue;
    if (query && !matchesQuery(restaurant, query)) continue;
    if (request.filters?.diet_type && restaurant.diet_type !== request.filters.diet_type) continue;
    if (dietTypes.length > 0 && !(restaurant.diet_type && dietTypes.includes(restaurant.diet_type)))
      continue;
    // Identity, not outcome: a certificate in any state counts, as on the API. The
    // API also accepts `open_now` and `min_rating` and applies neither — there is no
    // hours or rating data to apply them to — so neither does this.
    if (
      certifierIds.length > 0 &&
      !restaurant.certificates.some((cert) => certifierIds.includes(cert.certifier_id))
    )
      continue;
    if (
      request.filters?.price_level &&
      restaurant.price_level !== request.filters.price_level
    )
      continue;

    const { kashrut } = evaluateRestaurant(restaurant, request.profile, now);
    const deciding = restaurant.certificates.find(
      (cert) => cert.certificate_id === kashrut.deciding_certificate_id,
    );
    items.push({
      restaurant_id: restaurant.id,
      name_he: restaurant.name_he,
      // Null across the whole live corpus today — the English UI falls back to the
      // Hebrew name, so the fixtures exercise that path too.
      name_en: restaurant.name_en,
      city_he: restaurant.city_he,
      address_he: restaurant.address_he,
      geo: restaurant.lat === null || restaurant.lon === null
        ? null
        : { lat: restaurant.lat, lon: restaurant.lon },
      distance_km: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
      diet_type: restaurant.diet_type,
      kashrut,
      fit: computeFit(restaurant, distanceKm),
      certifiers: restaurantChips(restaurant),
      deciding_certificate: deciding
        ? {
            certificate_id: deciding.certificate_id,
            certifier: chipById(deciding.certifier_id),
            level: deciding.level,
          }
        : null,
    });
  }

  // Ordering is gate → fit: results group by verdict class (MATCH, then UNKNOWN,
  // then NO_MATCH) and the fit score only orders items *within* a class. The two
  // layers stay separate — fit never lifts a NO_MATCH above an UNKNOWN, and the
  // verdict never becomes a number. The client renders this order as received.
  items.sort((a, b) => {
    const gate =
      VERDICT_PRECEDENCE[a.kashrut.verdict] - VERDICT_PRECEDENCE[b.kashrut.verdict];
    return gate !== 0 ? gate : b.fit.score - a.fit.score;
  });

  const pageSize = request.page_size ?? 20;
  const page = request.page ?? 1;
  return delay({
    total: items.length,
    page,
    page_size: pageSize,
    items: items.slice((page - 1) * pageSize, page * pageSize),
  });
}

export function mockRestaurant(
  id: string,
  profile: ProfileRequest,
  now = new Date(),
  center?: GeoPoint,
): Promise<RestaurantDetailResponseOut> {
  const restaurant = RESTAURANTS.find((candidate) => candidate.id === id);
  if (!restaurant) return Promise.reject(new Error(`restaurant ${id} not found`));

  const { kashrut, evaluations } = evaluateRestaurant(restaurant, profile, now);
  // Distance exists only when a centre was given — same rule as the real endpoint,
  // so list and detail never disagree about how far away something is.
  const distanceKm = center ? haversineKm(center, restaurant) : null;

  return delay({
    restaurant_id: restaurant.id,
    name_he: restaurant.name_he,
    name_en: restaurant.name_en,
    address_he: restaurant.address_he,
    city_he: restaurant.city_he,
    phone: restaurant.phone,
    website: null,
    diet_type: restaurant.diet_type,
    price_level: restaurant.price_level,
    amenities: restaurant.amenities as Record<string, boolean>,
    geo: { lat: restaurant.lat, lon: restaurant.lon },
    distance_km: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
    kashrut,
    fit: computeFit(restaurant, distanceKm),
    certificates: restaurant.certificates.map((cert, index) => {
      const evaluation = evaluations[index];
      if (!evaluation) throw new Error("unreachable: evaluation per certificate");
      const photo = photoState.get(cert.certificate_id) ?? null;
      return toEvidence(cert, evaluation, now, photo);
    }),
  });
}

/**
 * GET /v1/restaurants/{id}, replayed (app/api/public_seo.py): the restaurant block
 * and every certificate's stored facts, with no profile and therefore no
 * evaluation — `evaluateRestaurant` is deliberately not called on this path. A
 * missing id is a 404, as on the API.
 */
export function mockRestaurantPublic(id: string, now = new Date()): Promise<RestaurantPublicOut> {
  const restaurant = RESTAURANTS.find((candidate) => candidate.id === id);
  if (!restaurant) return delayReject(new ApiError(404, "not_found"));

  return delay({
    restaurant_id: restaurant.id,
    name_he: restaurant.name_he,
    name_en: restaurant.name_en,
    address_he: restaurant.address_he,
    city_he: restaurant.city_he,
    phone: restaurant.phone,
    website: null,
    diet_type: restaurant.diet_type,
    price_level: restaurant.price_level,
    amenities: restaurant.amenities as Record<string, boolean>,
    geo: { lat: restaurant.lat, lon: restaurant.lon },
    certificates: restaurant.certificates.map((cert) => {
      const { id: certifierId, name_he, name_en } = chipById(cert.certifier_id);
      return {
        certifier: { id: certifierId, name_he, name_en },
        status: cert.state,
        valid_until: cert.valid_until,
        attributes: cert.attributes as Record<string, boolean>,
      };
    }),
    updated_at: now.toISOString(),
  });
}

/**
 * Mirrors `DIRECTORY_SAMPLE_PER_CITY` (app/api/consts.py): how many of a city's rows
 * the landing page is handed. The city's `restaurant_count` is the full count.
 */
export const DIRECTORY_SAMPLE_PER_CITY = 12;

const byHebrewName = (a: string, b: string): number => a.localeCompare(b, "he");

function toDirectoryRow(restaurant: FixtureRestaurant): DirectoryRestaurantOut {
  // Identity only, deduplicated by certifier and sorted by name — the same rule the
  // API applies. A certificate's state is deliberately not read here.
  const certifiers = restaurantChips(restaurant).sort((a, b) => byHebrewName(a.name_he, b.name_he));
  return {
    restaurant_id: restaurant.id,
    name_he: restaurant.name_he,
    name_en: restaurant.name_en,
    address_he: restaurant.address_he,
    certifier_names_he: certifiers.map((certifier) => certifier.name_he),
    certifier_names_en: certifiers.map((certifier) => certifier.name_en),
  };
}

/**
 * GET /v1/directory, replayed (app/api/public_seo.py): every fixture grouped by
 * `city_he`, cities from largest to smallest (ties alphabetical), each city's rows
 * alphabetical by name and capped at the sample size. `evaluateRestaurant` is not
 * called on this path — there is no profile, so there is nothing to evaluate — and
 * every ordering is alphabetical because the app never ranks.
 */
export function mockDirectory(): Promise<DirectoryOut> {
  const byCity = new Map<string, FixtureRestaurant[]>();
  for (const restaurant of RESTAURANTS) {
    const group = byCity.get(restaurant.city_he) ?? [];
    group.push(restaurant);
    byCity.set(restaurant.city_he, group);
  }

  const cities = [...byCity.entries()]
    .sort(([cityA, groupA], [cityB, groupB]) =>
      groupB.length - groupA.length || byHebrewName(cityA, cityB),
    )
    .map(([city_he, group]) => ({
      city_he,
      restaurant_count: group.length,
      restaurants: [...group]
        .sort((a, b) => byHebrewName(a.name_he, b.name_he))
        .slice(0, DIRECTORY_SAMPLE_PER_CITY)
        .map(toDirectoryRow),
    }));

  return delay({ total_restaurants: RESTAURANTS.length, cities });
}

/**
 * POST /v1/restaurants/{id}/certificate-photo, replayed: the same refusals in the
 * same order as the API — unknown restaurant or a `certificate_id` that is not one
 * of its own certificates 404, an accepted photo 409 `photo_exists`, one already
 * waiting 409 `photo_pending`, then 415 and 413.
 */
export function mockUploadCertificatePhoto(
  restaurantId: string,
  certificateId: string,
  file: File,
): Promise<PhotoUploadOut> {
  const restaurant = RESTAURANTS.find((candidate) => candidate.id === restaurantId);
  if (!restaurant) return delayReject(new ApiError(404, "not_found"));
  const certificate = restaurant.certificates.find(
    (candidate) => candidate.certificate_id === certificateId,
  );
  if (!certificate) return delayReject(new ApiError(404, "not_found"));

  const current = photoState.get(certificateId);
  if (current?.status === "accepted") return delayReject(new ApiError(409, "photo_exists"));
  if (current?.status === "pending") return delayReject(new ApiError(409, "photo_pending"));
  if (!PHOTO_MIME_TYPES.includes(file.type)) {
    return delayReject(new ApiError(415, "unsupported_media_type"));
  }
  if (file.size > PHOTO_MAX_BYTES) return delayReject(new ApiError(413, "file_too_large"));

  photoState.set(certificateId, { status: "pending", url: null });
  return delay({ photo_id: `mock-photo-${nextId++}`, status: "pending" as const });
}

/** POST /v1/restaurants/{id}/flags, replayed. A report never touches a verdict. */
export function mockReportRestaurant(restaurantId: string, body: FlagRequest): Promise<FlagCreatedOut> {
  const restaurant = RESTAURANTS.find((candidate) => candidate.id === restaurantId);
  if (!restaurant) return delayReject(new ApiError(404, "not_found"));
  if (
    body.certificate_id &&
    !restaurant.certificates.some((candidate) => candidate.certificate_id === body.certificate_id)
  ) {
    return delayReject(new ApiError(404, "not_found"));
  }
  flagLog.push({ restaurant_id: restaurantId, body });
  return delay({ flag_id: `mock-flag-${nextId++}`, state: "open" as const });
}
