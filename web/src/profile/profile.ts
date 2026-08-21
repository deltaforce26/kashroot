/**
 * The user's kashrut profile: the whitelist they chose and the attributes they
 * require. Pure data + pure functions — no React, no storage, no network, so the
 * whole thing is directly unit-testable.
 *
 * Nothing here ranks certifiers. A preset is a *selection rule* over the certifier
 * list the API returned (by type, which is a published fact), plus a per-certifier
 * minimum level — which is an ordering *within one certifier's own published
 * levels*, never a comparison between certifiers.
 */

import type {
  CertificateAttribute,
  CertificationLevel,
  ProfileRequest,
  WhitelistEntryRequest,
} from "../api/types";
import { emptyPreferences, type CertifierView } from "../api/viewmodel";

export type PresetId = "any" | "mehadrin" | "badatz" | "custom";

/** Presets that route into the certifier picker instead of finishing onboarding. */
export const PICKER_PRESETS: readonly PresetId[] = ["badatz", "custom"];

/**
 * WITHDRAWN: `"rabbanut"` — the one-tap "Local Rabbanut" / "רבנות מקומית" preset.
 *
 * This is a data-coverage decision, not a product opinion, and not a statement about
 * Rabbanut certification. The corpus holds exactly one Rabbanut — Rabbanut Bnei Brak
 * — and it does not certify Jerusalem. Tapping the preset in the lead city therefore
 * returned 2 MATCH / 98 NO_MATCH. Every one of those verdicts was correct, and every
 * one of them was unreadable: a screen of red says "Jerusalem is not kosher" when the
 * truth is "we hold no Jerusalem Rabbanut data". That misreading sat one tap from the
 * opening screen, which made it the most damaging thing the app could do.
 *
 * The capability is untouched — a user can still select Rabbanut Bnei Brak by hand
 * through the certifier picker, which is honest because they chose it knowingly.
 * Only the one-tap shortcut is gone.
 *
 * RESTORE IT when national Rabbanut data lands: put `"rabbanut"` back on `PresetId`,
 * in the list below, in `expandPreset`, in `storage.ts`'s `PRESETS`, and re-add
 * `presets.rabbanut` to both string tables. Do not restore it before then.
 */
export const PRESET_ORDER: readonly PresetId[] = ["any", "mehadrin", "badatz", "custom"];

export interface KashrutProfile {
  /** Which preset seeded this profile; kept so the UI can show it as selected. */
  presetId: PresetId | null;
  whitelist: WhitelistEntryRequest[];
  requiredAttributes: CertificateAttribute[];
  completedOnboarding: boolean;
}

export const EMPTY_PROFILE: KashrutProfile = {
  presetId: null,
  whitelist: [],
  requiredAttributes: [],
  completedOnboarding: false,
};

/** Attributes offered in the picker, in the design's order. */
export const OFFERED_ATTRIBUTES: readonly CertificateAttribute[] = [
  "chalav_yisrael",
  "pas_yisrael",
  "glatt",
  "bishul_yisrael",
  "yashan",
];

const isRabbanut = (certifier: CertifierView): boolean =>
  certifier.type === "rabbanut_local" || certifier.type === "rabbanut_national";

/**
 * Expands a preset over the certifiers the API returned.
 *
 * `any` accepts the base published level; `mehadrin` asks each Rabbanut for its own
 * Mehadrin level and takes every Badatz at its base level. `badatz` and `custom` are
 * starting points for the picker, not final answers.
 */
export function expandPreset(preset: PresetId, certifiers: CertifierView[]): WhitelistEntryRequest[] {
  const entry = (certifier: CertifierView, min_level: CertificationLevel): WhitelistEntryRequest => ({
    certifier_id: certifier.id,
    min_level,
  });

  switch (preset) {
    case "any":
      return certifiers.map((certifier) => entry(certifier, "regular"));
    case "mehadrin":
      return certifiers.map((certifier) =>
        entry(certifier, isRabbanut(certifier) ? "mehadrin" : "regular"),
      );
    case "badatz":
      return certifiers
        .filter((certifier) => certifier.type === "badatz")
        .map((certifier) => entry(certifier, "regular"));
    case "custom":
      return [];
    default:
      return [];
  }
}

export function profileFromPreset(preset: PresetId, certifiers: CertifierView[]): KashrutProfile {
  return {
    presetId: preset,
    whitelist: expandPreset(preset, certifiers),
    requiredAttributes: [],
    completedOnboarding: false,
  };
}

export function isWhitelisted(profile: KashrutProfile, certifierId: string): boolean {
  return profile.whitelist.some((entry) => entry.certifier_id === certifierId);
}

export function minLevelFor(
  profile: KashrutProfile,
  certifierId: string,
): CertificationLevel | null {
  return profile.whitelist.find((entry) => entry.certifier_id === certifierId)?.min_level ?? null;
}

/** Toggling a certifier makes the profile custom: it no longer *is* the preset. */
export function toggleCertifier(
  profile: KashrutProfile,
  certifierId: string,
  minLevel: CertificationLevel = "regular",
): KashrutProfile {
  const present = isWhitelisted(profile, certifierId);
  const whitelist = present
    ? profile.whitelist.filter((entry) => entry.certifier_id !== certifierId)
    : [...profile.whitelist, { certifier_id: certifierId, min_level: minLevel }];
  return { ...profile, whitelist, presetId: "custom" };
}

export function toggleAttribute(
  profile: KashrutProfile,
  attribute: CertificateAttribute,
): KashrutProfile {
  const present = profile.requiredAttributes.includes(attribute);
  return {
    ...profile,
    requiredAttributes: present
      ? profile.requiredAttributes.filter((value) => value !== attribute)
      : [...profile.requiredAttributes, attribute],
  };
}

/** A profile with no certifier at all has nothing to check against. */
export function isProfileUsable(profile: KashrutProfile): boolean {
  return profile.whitelist.length > 0;
}

/**
 * The wire shape. Sorted so identical profiles produce identical request bodies.
 *
 * The Layer 2 preference fields go out empty: the POC's UI collects no soft
 * preferences, and sending a guessed one would quietly reorder results.
 */
export function toPayload(profile: KashrutProfile): ProfileRequest {
  return {
    whitelist: [...profile.whitelist].sort((a, b) => a.certifier_id.localeCompare(b.certifier_id)),
    required_attributes: [...profile.requiredAttributes].sort(),
    ...emptyPreferences(),
  };
}

/**
 * Certifiers in a neutral display order: alphabetical by the name shown. Explicitly
 * not by type, stringency or popularity — the list must not imply a ranking.
 */
export function sortCertifiersForDisplay(
  certifiers: CertifierView[],
  lang: "he" | "en",
): CertifierView[] {
  const locale = lang === "he" ? "he" : "en";
  return [...certifiers].sort((a, b) =>
    certifierName(a, lang).localeCompare(certifierName(b, lang), locale),
  );
}

/** English names are optional on the wire; Hebrew always exists. */
export function certifierName(certifier: CertifierView, lang: "he" | "en"): string {
  return lang === "en" ? (certifier.nameEn ?? certifier.nameHe) : certifier.nameHe;
}
