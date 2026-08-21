/**
 * Renders the API's reason codes into sentences. Rendering only.
 *
 * Every line the evidence panel shows starts life as a `ReasonCode` emitted by the
 * match engine against a specific certificate. This module maps code → glyph +
 * sentence and nothing else: it never decides a verdict, never infers a missing
 * fact, and never composes a claim the API did not make. If a code arrives that
 * this table does not know, it is shown as doubt — the fail-safe direction.
 */

import type { CertificateAttribute, ReasonOut, ReasonCode } from "../api/types";
import type { Lang, Strings } from "./strings";

/** How a reason reads, for glyph and colour only. Mirrors the backend's grouping. */
export type Polarity = "positive" | "negative" | "doubt" | "info";

const POLARITY: Record<ReasonCode, Polarity> = {
  certifier_in_whitelist: "positive",
  level_meets_minimum: "positive",
  attribute_present: "positive",
  certificate_valid: "positive",
  evidence_fresh: "positive",
  certificate_expires_soon: "info",
  certifier_not_in_whitelist: "negative",
  level_below_minimum: "negative",
  attribute_false: "negative",
  certificate_revoked: "negative",
  no_certificate: "doubt",
  level_unknown: "doubt",
  attribute_unknown: "doubt",
  certificate_expired: "doubt",
  certificate_not_yet_valid: "doubt",
  certificate_pending: "doubt",
  certificate_state_unrecognized: "doubt",
  evidence_stale: "doubt",
  no_freshness_evidence: "doubt",
};

export function reasonPolarity(code: ReasonCode): Polarity {
  return POLARITY[code] ?? "doubt";
}

export const POLARITY_GLYPH: Record<Polarity, string> = {
  positive: "✓",
  negative: "✕",
  doubt: "?",
  info: "•",
};

/**
 * The single reason a compact card has room for.
 *
 * Reason lists arrive in the backend's canonical order — positive evidence first —
 * which reads correctly in the full panel but would make a NO_MATCH card lead with
 * "verified 6 days ago". So a card leads with the first reason that actually moved
 * the verdict, falling back to the first reason when everything is positive. This
 * only *selects* among reasons the API sent; it never invents or reweighs one.
 */
export function primaryReason<T extends { code: ReasonCode }>(reasons: T[]): T | undefined {
  const deciding = reasons.find((reason) => {
    const polarity = reasonPolarity(reason.code);
    return polarity === "negative" || polarity === "doubt";
  });
  return deciding ?? reasons[0];
}

/**
 * The closing paragraph for a non-MATCH verdict, chosen by the reason that actually
 * caused it.
 *
 * UNKNOWN is a primary path through this product — with the real corpus, an entire
 * certifier's restaurants land here because its published list is older than the
 * freshness window. So "we don't know" has to say *which* thing is missing and what
 * would change it, in the same considered voice as the MATCH panel. Selection only:
 * the reason came from the API, and no verdict is derived here.
 */
export function followUpText(reasons: ReasonOut[], strings: Strings): string | null {
  const table = strings.verdict.followUp as Record<string, string | undefined>;
  for (const reason of reasons) {
    const text = table[reason.code];
    if (text) return text;
  }
  return null;
}

export interface ReasonContext {
  certifierName?: string | null;
  /** Already formatted for the active language. */
  validUntil?: string | null;
  evidenceAgeDays?: number | null;
  daysUntilExpiry?: number | null;
}

const ATTRIBUTE_KEYS = new Set<string>([
  "glatt",
  "chalav_yisrael",
  "pas_yisrael",
  "bishul_yisrael",
  "yashan",
  "kitniyot_pesach",
  "sheruya",
]);

/**
 * The wire carries `attribute` as a plain string, so an unrecognised key is shown
 * raw rather than dropped — hiding evidence is worse than an unlovely label.
 */
function attributeLabel(attribute: string | null, strings: Strings): string {
  if (!attribute) return "";
  return ATTRIBUTE_KEYS.has(attribute)
    ? strings.attributes[attribute as CertificateAttribute]
    : attribute;
}

/**
 * One reason as a sentence. Deliberately literal: each line states a published fact
 * and, where relevant, that the fact was checked against the user's own list.
 */
export function reasonText(
  reason: ReasonOut,
  strings: Strings,
  lang: Lang,
  context: ReasonContext = {},
): string {
  const attribute = attributeLabel(reason.attribute, strings);
  const certifier = context.certifierName ?? (lang === "he" ? "גוף הכשרות" : "the certifier");
  const he = lang === "he";

  switch (reason.code) {
    case "certifier_in_whitelist":
      return he ? `${certifier} — ברשימה שלך` : `${certifier} — on your list`;
    case "level_meets_minimum":
      return he
        ? "רמת התעודה עונה על המינימום שהגדרתם"
        : "The certificate level meets the minimum you set";
    case "attribute_present":
      return attribute;
    case "certificate_valid":
      return context.validUntil
        ? he
          ? `תעודה בתוקף עד ${context.validUntil}`
          : `Certificate valid until ${context.validUntil}`
        : he
          ? "תעודה פעילה"
          : "Certificate active";
    case "evidence_fresh":
      return context.evidenceAgeDays === null || context.evidenceAgeDays === undefined
        ? he
          ? "אומת לאחרונה"
          : "Recently verified"
        : strings.restaurant.verifiedAgo(context.evidenceAgeDays);
    case "certificate_expires_soon":
      return context.daysUntilExpiry === null || context.daysUntilExpiry === undefined
        ? he
          ? "התוקף עומד לפוג"
          : "Expiring soon"
        : he
          ? `התוקף פג בעוד ${context.daysUntilExpiry} ימים`
          : `Expires in ${context.daysUntilExpiry} days`;
    case "certifier_not_in_whitelist":
      return he
        ? `${certifier} — לא ברשימה שלך`
        : `${certifier} — not on your list`;
    case "level_below_minimum":
      return he
        ? "רמת התעודה נמוכה מהמינימום שהגדרתם"
        : "The certificate level is below the minimum you set";
    case "attribute_false":
      return he
        ? `${attribute} — פורסם במפורש שלא מתקיים`
        : `${attribute} — explicitly published as not held`;
    case "certificate_revoked":
      return he ? "התעודה בוטלה על ידי גוף הכשרות" : "The certificate was revoked by the certifier";
    case "no_certificate":
      return he
        ? "אין אצלנו תעודה עבור העסק הזה"
        : "We hold no certificate for this business";
    case "level_unknown":
      return he
        ? "רמת התעודה לא פורסמה — ולכן לא ניתן לאשר את המינימום שהגדרתם"
        : "The certificate level was not published — so your minimum cannot be confirmed";
    case "attribute_unknown":
      return he
        ? `${attribute} — לא מופיע בתעודה, ואנחנו לא מניחים`
        : `${attribute} — not stated on the certificate, and we don't assume`;
    case "certificate_expired":
      return context.validUntil
        ? he
          ? `התעודה פגה ב־${context.validUntil} ואין ראיה לחידוש`
          : `The certificate expired on ${context.validUntil} with no evidence of renewal`
        : he
          ? "התעודה פגה ואין ראיה לחידוש"
          : "The certificate expired with no evidence of renewal";
    case "certificate_not_yet_valid":
      return he ? "התעודה עוד לא נכנסה לתוקף" : "The certificate is not in force yet";
    case "certificate_pending":
      return he ? "התעודה ממתינה לאימות אצלנו" : "The certificate is awaiting our verification";
    case "certificate_state_unrecognized":
      return he
        ? "מצב התעודה לא מזוהה — ולכן לא נחשב כראיה"
        : "The certificate state is unrecognized — so it is not treated as evidence";
    case "evidence_stale":
      return context.evidenceAgeDays === null || context.evidenceAgeDays === undefined
        ? he
          ? "האימות האחרון ישן מדי"
          : "The last verification is too old"
        : he
          ? `האימות האחרון היה לפני ${context.evidenceAgeDays} ימים — ישן מדי`
          : `Last verified ${context.evidenceAgeDays} days ago — too old to rely on`;
    case "no_freshness_evidence":
      return he
        ? "לא אימתנו את הרשומה הזו מעולם"
        : "We have never verified this record";
    default:
      // Unknown code: show it, in the doubt direction, rather than hide evidence.
      return he ? "פרט נוסף שלא זיהינו" : "An additional detail we don't recognize";
  }
}
