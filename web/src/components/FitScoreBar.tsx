/**
 * The Layer 2 fit score — soft preferences only.
 *
 * Rendered deliberately unlike the verdict pill: muted, labelled with what it
 * measures, no verdict colour, no pill. The two never share a row, so they cannot
 * be read as one metric. This number ranks distance, hours, price and amenities;
 * it says nothing about kashrut and the copy says so.
 */

import type { FitScoreOut } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";

export function FitScoreBar({ fit }: { fit: FitScoreOut }) {
  const { t } = useI18n();
  const score = Math.max(0, Math.min(100, Math.round(fit.score)));
  return (
    <div className="fit" title={t.fit.explain}>
      <span className="fit__label">{t.fit.label}</span>
      <span className="fit__bar" aria-hidden="true">
        <span className="fit__fill" style={{ width: `${score}%` }} />
      </span>
      <span className="fit__value" aria-hidden="true">
        {score}
      </span>
      <span className="sr-only">{t.fit.aria(score)}</span>
    </div>
  );
}
