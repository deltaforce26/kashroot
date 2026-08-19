/**
 * The Layer 1 verdict, as the design draws it: a glyph and a word on a pill.
 *
 * Three constraints this component exists to enforce:
 *   1. It renders `verdict` exactly as the API sent it. There is no path here that
 *      derives, softens or upgrades a verdict.
 *   2. It never shows a number. No score, no percentage, no star, no ordering.
 *   3. NO_MATCH — absent from the source design — is a colour sibling of the other
 *      two, not a louder or heavier treatment.
 */

import type { Verdict } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";

const GLYPH: Record<Verdict, string> = { match: "✓", no_match: "✕", unknown: "?" };

export function verdictLabel(verdict: Verdict, t: ReturnType<typeof useI18n>["t"], long = false) {
  switch (verdict) {
    case "match":
      return long ? t.verdict.matchLong : t.verdict.match;
    case "no_match":
      return long ? t.verdict.noMatchLong : t.verdict.noMatch;
    default:
      return long ? t.verdict.unknownLong : t.verdict.unknown;
  }
}

interface VerdictPillProps {
  verdict: Verdict;
  size?: "sm" | "lg";
  long?: boolean;
}

export function VerdictPill({ verdict, size = "sm", long = false }: VerdictPillProps) {
  const { t } = useI18n();
  return (
    <span className={`verdict verdict--${verdict}${size === "lg" ? " verdict--lg" : ""}`}>
      <span className="verdict__glyph" aria-hidden="true">
        {GLYPH[verdict]}
      </span>
      {verdictLabel(verdict, t, long)}
    </span>
  );
}
