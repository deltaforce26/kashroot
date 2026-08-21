/**
 * "למה זה מתאים לך" — the product's core claim, and the screen this whole app
 * exists to reach (design 3d).
 *
 * Every line is one `ReasonCode` the API emitted about one certificate, rendered
 * through the reason table. Nothing here inspects certificate attributes to decide
 * what to say, nothing infers a missing fact, and nothing writes a sentence the API
 * did not stand behind. If the reasons array is empty, the panel says so rather
 * than filling the gap.
 */

import type { CertificateEvidenceOut, KashrutVerdictOut, ReasonOut } from "../api/types";
import { formatDate, useI18n } from "../i18n/I18nProvider";
import {
  POLARITY_GLYPH,
  followUpText,
  reasonPolarity,
  reasonText,
  type ReasonContext,
} from "../i18n/reasons";

const VERDICT_TONE = {
  match: { color: "var(--green)", glyph: "✓" },
  no_match: { color: "var(--red)", glyph: "✕" },
  unknown: { color: "var(--amber)", glyph: "?" },
} as const;

interface EvidencePanelProps {
  match: KashrutVerdictOut;
  /** The certificate the verdict was decided on, when there is one. */
  deciding: CertificateEvidenceOut | null;
}

/**
 * Consecutive per-attribute reasons of the same code collapse onto one row, which
 * is how the design writes them ("✓ חלב ישראל · ✓ פת ישראל"). Grouping is display
 * only — no reason is dropped, reordered across codes, or merged across polarity.
 */
function groupReasons(reasons: ReasonOut[]): ReasonOut[][] {
  const groups: ReasonOut[][] = [];
  for (const reason of reasons) {
    const last = groups[groups.length - 1];
    const groupable = reason.attribute !== null;
    if (groupable && last && last[0]?.code === reason.code) last.push(reason);
    else groups.push([reason]);
  }
  return groups;
}

export function EvidencePanel({ match, deciding }: EvidencePanelProps) {
  const { t, lang } = useI18n();
  const tone = VERDICT_TONE[match.verdict];

  const title =
    match.verdict === "match"
      ? t.verdict.whyMatch
      : match.verdict === "no_match"
        ? t.verdict.whyNoMatch
        : t.verdict.whyUnknown;

  const certifierName = deciding
    ? lang === "en"
      ? (deciding.certifier.name_en ?? deciding.certifier.name_he)
      : deciding.certifier.name_he
    : null;

  const context: ReasonContext = {
    certifierName,
    validUntil: formatDate(match.freshness?.valid_until ?? null),
    evidenceAgeDays: match.freshness?.evidence_age_days ?? null,
    daysUntilExpiry: match.freshness?.days_until_expiry ?? null,
  };

  const groups = groupReasons(match.reasons);

  return (
    <section className="panel glass" aria-label={title}>
      <div className="panel__head">
        <span className="panel__badge" style={{ background: tone.color }} aria-hidden="true">
          {tone.glyph}
        </span>
        <h2 className="panel__title" style={{ color: tone.color, margin: 0 }}>
          {title}
        </h2>
      </div>

      <ul className="evidence">
        {groups.map((group, index) => {
          const first = group[0];
          if (!first) return null;
          const polarity = reasonPolarity(first.code);
          return (
            <li className="evidence__row" key={`${first.code}-${index}`}>
              <span className={`evidence__glyph evidence__glyph--${polarity}`} aria-hidden="true">
                {POLARITY_GLYPH[polarity]}
              </span>
              <span>
                {group.map((reason) => reasonText(reason, t, lang, context)).join(" · ")}
              </span>
            </li>
          );
        })}
      </ul>

      {match.verdict !== "match" && (
        <p className="evidence__note">
          {followUpText(match.reasons, t) ??
            (match.verdict === "unknown" ? t.verdict.unknownHelp : t.verdict.noMatchHelp)}
        </p>
      )}
    </section>
  );
}
