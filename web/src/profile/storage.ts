/**
 * Profile persistence — `localStorage` only. No accounts, no server copy: the
 * kashrut profile is religious personal data and the POC keeps it on the device.
 *
 * Reads are defensive. A corrupt or foreign-shaped blob is discarded rather than
 * partially trusted: a half-parsed whitelist would silently change what the user
 * is told matches them.
 */

import type { CertificateAttribute, CertificationLevel, WhitelistEntryRequest } from "../api/types";
import { EMPTY_PROFILE, type KashrutProfile, type PresetId } from "./profile";

/**
 * Storage key and schema version.
 *
 * The version is stored *inside* the payload as well as in the key, and both are
 * checked. This exists because of a real incident: a profile written while the app
 * ran on fixtures held fixture certifier ids, and once the app pointed at the live
 * API every request 422'd on an id the database had never heard of — a browser that
 * had merely *visited* the app was permanently broken until storage was cleared.
 *
 * A stored profile that does not match the current version is discarded outright.
 * Silent recovery: the user lands in onboarding, which takes seconds, rather than in
 * a loop of requests that cannot succeed.
 */
export const PROFILE_SCHEMA_VERSION = 2;

const KEY = `kashroot.profile.v${PROFILE_SCHEMA_VERSION}`;

/** Keys written by superseded schema versions, cleared on load. */
const LEGACY_KEYS = ["kashroot.profile.v1"];

const LEVELS: readonly CertificationLevel[] = ["unknown", "regular", "mehadrin"];
const ATTRIBUTES: readonly CertificateAttribute[] = [
  "glatt",
  "chalav_yisrael",
  "pas_yisrael",
  "bishul_yisrael",
  "yashan",
  "kitniyot_pesach",
  "sheruya",
];
/**
 * Recognised preset markers. `"rabbanut"` was withdrawn (see `profile.ts`), and a
 * profile still carrying it keeps working: only the marker is dropped, so the row
 * highlight is lost while the whitelist, required attributes and onboarding state
 * survive intact. The whitelist holds certifier ids, not a preset name, so nothing
 * the engine sees changes.
 */
const PRESETS: readonly PresetId[] = ["any", "mehadrin", "badatz", "custom"];

function parseWhitelist(value: unknown): WhitelistEntryRequest[] | null {
  if (!Array.isArray(value)) return null;
  const entries: WhitelistEntryRequest[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const { certifier_id: id, min_level: level } = raw as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) return null;
    if (typeof level !== "string" || !LEVELS.includes(level as CertificationLevel)) return null;
    entries.push({ certifier_id: id, min_level: level as CertificationLevel });
  }
  return entries;
}

export function parseProfile(raw: string | null): KashrutProfile | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const whitelist = parseWhitelist(record["whitelist"]);
  if (!whitelist) return null;

  const attributesRaw = record["requiredAttributes"];
  if (!Array.isArray(attributesRaw)) return null;
  const requiredAttributes: CertificateAttribute[] = [];
  for (const attribute of attributesRaw) {
    if (typeof attribute !== "string") return null;
    // Unknown attribute keys are dropped, never kept as an unenforceable requirement.
    if (ATTRIBUTES.includes(attribute as CertificateAttribute)) {
      requiredAttributes.push(attribute as CertificateAttribute);
    }
  }

  if (record["version"] !== PROFILE_SCHEMA_VERSION) return null;

  const presetRaw = record["presetId"];
  const presetId =
    typeof presetRaw === "string" && PRESETS.includes(presetRaw as PresetId)
      ? (presetRaw as PresetId)
      : null;

  return {
    presetId,
    whitelist,
    requiredAttributes,
    completedOnboarding: record["completedOnboarding"] === true,
  };
}

export function loadProfile(): KashrutProfile {
  try {
    for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
    return parseProfile(localStorage.getItem(KEY)) ?? EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveProfile(profile: KashrutProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...profile, version: PROFILE_SCHEMA_VERSION }));
  } catch {
    // Storage full or blocked: the profile still works for this session.
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
