/**
 * "This stopped matching since you saved it."
 *
 * The saved screens' real job. A place saved while it matched can stop matching —
 * an expired certificate, a renewed one with different attributes, a corrected
 * record — and the design treats that as a first-class visible state rather than a
 * silently different pill.
 *
 * No rule is evaluated here. The snapshot holds the verdict the API gave at save
 * time, the screen re-asked the API now, and `hasDegraded` compares those two
 * answers. The sentence is assembled from the API's own reason codes.
 */

import { decidingCertificate, type DetailView } from "../api/viewmodel";
import { formatDate, pickName, useI18n } from "../i18n/I18nProvider";
import { primaryReason, reasonText } from "../i18n/reasons";
import type { SavedPlace } from "../saved/saved";
import { BellIcon } from "./icons";
import { verdictLabel } from "./VerdictPill";

export function DegradationBanner({
  listName,
  place,
  detail,
}: {
  listName: string;
  place: SavedPlace;
  detail: DetailView;
}) {
  const { t, lang } = useI18n();
  const name = pickName(lang, place.nameHe, place.nameEn);
  const deciding = decidingCertificate(detail);
  const explaining = primaryReason(detail.kashrut.reasons);
  const why = explaining
    ? reasonText(explaining, t, lang, {
        certifierName: deciding
          ? lang === "en"
            ? (deciding.certifier.name_en ?? deciding.certifier.name_he)
            : deciding.certifier.name_he
          : place.certifierLabel,
        validUntil: formatDate(detail.kashrut.freshness?.valid_until ?? null),
        evidenceAgeDays: detail.kashrut.freshness?.evidence_age_days ?? null,
        daysUntilExpiry: detail.kashrut.freshness?.days_until_expiry ?? null,
      })
    : "";

  return (
    <div className="banner tint-sweet banner--amber" role="status">
      <span style={{ color: "var(--amber)", flex: "none", paddingTop: 1 }} aria-hidden="true">
        <BellIcon size={16} />
      </span>
      <div>
        <div className="banner__title">{t.saved.degradeTitle(listName)}</div>
        <div className="banner__body">
          {t.saved.degradeBody(name, why, verdictLabel(detail.kashrut.verdict, t))}
        </div>
      </div>
    </div>
  );
}
