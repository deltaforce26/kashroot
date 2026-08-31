/**
 * Restaurant — tinted hero, glass verdict panel (design 3d). The money screen.
 *
 * Order of the page is the order of the argument: the verdict, then why, then the
 * certificate that produced it with its provenance, then everything soft. The fit
 * score sits near the bottom, deliberately far from the verdict pill and under its
 * own explanatory label.
 *
 * The design's Shabbat/erev-chag hours block is not rendered: Israel hours logic is
 * out of POC scope and the detail response carries no hours, so inventing rows here
 * would be the one fabricated thing on the screen that matters most.
 */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CertificateEvidenceOut } from "../api/types";
import { decidingCertificate } from "../api/viewmodel";
import { EvidencePanel } from "../components/EvidencePanel";
import { FitScoreBar } from "../components/FitScoreBar";
import { tintClass } from "../components/RestaurantCard";
import { VerdictPill } from "../components/VerdictPill";
import { BookmarkIcon, ChevronIcon, PhoneIcon, ShareIcon } from "../components/icons";
import { ErrorState, LoadingList, NotFoundState, OfflineBanner } from "../components/states";
import { useCity } from "../location/useCity";
import { isNetworkError, useRestaurant } from "../hooks/useApi";
import { formatDate, formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";

function CertificateCard({ evidence }: { evidence: CertificateEvidenceOut }) {
  const { t, lang } = useI18n();
  const validUntil = formatDate(evidence.valid_until);
  const age = evidence.freshness.evidence_age_days;
  const certifierName =
    lang === "en" ? (evidence.certifier.name_en ?? evidence.certifier.name_he) : evidence.certifier.name_he;

  const freshness =
    age === null
      ? { text: t.restaurant.neverVerified, tone: "amber" as const }
      : {
          text: t.restaurant.verifiedAgo(age),
          tone: evidence.freshness.is_stale ? ("amber" as const) : ("green" as const),
        };

  return (
    <section className="panel glass cert-card" aria-label={t.restaurant.certificate}>
      <div className="cert-card__photo stripe-flat" aria-hidden="true">
        {t.restaurant.certificatePhoto}
      </div>
      <div className="cert-card__body">
        <div className="cert-card__title">{t.restaurant.certificate}</div>
        <span>{certifierName}</span>
        <span>{validUntil ? t.restaurant.validUntil(validUntil) : t.restaurant.noExpiry}</span>
        <span>
          {t.restaurant.source}: {t.restaurant.sources[evidence.provenance.source]}
          {evidence.provenance.verified_by_label
            ? ` · ${t.restaurant.verifiedBy(evidence.provenance.verified_by_label)}`
            : ""}
        </span>
        <span className={`badge-soft badge-soft--${freshness.tone}`}>{freshness.text}</span>
      </div>
    </section>
  );
}

export function Restaurant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  const { city } = useCity();

  const payload = useMemo(() => toPayload(profile), [profile]);
  // Same centre the list used, so the distance shown here is the same number.
  const { data, loading, error, reload } = useRestaurant(id, payload, city.center);

  if (loading) {
    return (
      <div className="shell">
        <div className="shell__scroll" style={{ paddingTop: 24 }}>
          <LoadingList rows={5} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const network = isNetworkError(error);
    return (
      <div className="shell">
        <div className="shell__scroll" style={{ paddingTop: 24 }}>
          {network ? (
            <>
              <OfflineBanner />
              <ErrorState isNetwork onRetry={reload} />
            </>
          ) : error ? (
            <ErrorState onRetry={reload} />
          ) : (
            <NotFoundState onBack={() => navigate(-1)} />
          )}
        </div>
      </div>
    );
  }

  const deciding = decidingCertificate(data);
  const others = data.certificates.filter((certificate) => certificate !== deciding);

  const name = pickName(lang, data.nameHe, data.nameEn);
  const meta = [
    data.dietType ? t.diet[data.dietType] : null,
    [data.addressHe, data.cityHe].filter(Boolean).join(", "),
    data.priceLevel ? "₪".repeat(data.priceLevel) : null,
    formatDistance(data.distanceKm, t),
  ]
    .filter(Boolean)
    .join(" · ");

  const saved = isSaved(data.id);

  return (
    <div className="shell">
      <header className="shell__header" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="circle glass"
          aria-label={t.states.back}
          onClick={() => navigate(-1)}
        >
          <ChevronIcon />
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="circle glass" aria-hidden="true">
            <ShareIcon />
          </span>
          <button
            type="button"
            className="circle glass"
            aria-label={saved ? t.restaurant.saved : t.restaurant.save}
            aria-pressed={saved}
            onClick={() => toggle(data)}
          >
            <BookmarkIcon size={17} filled={saved} />
          </button>
        </div>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 12 }}>
        <div className={`hero ${tintClass(data.dietType)}`}>
          <span className="hero__photo stripe" aria-hidden="true">
            {t.photoPlaceholder}
          </span>
          <span className="hero__verdict">
            <VerdictPill verdict={data.kashrut.verdict} size="lg" long />
          </span>
        </div>

        <div>
          <h1 style={{ font: "700 28px Assistant, sans-serif", margin: 0 }}>{name}</h1>
          <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>{meta}</div>
        </div>

        <EvidencePanel match={data.kashrut} deciding={deciding} />

        {deciding ? (
          <CertificateCard evidence={deciding} />
        ) : (
          <section className="panel glass" aria-label={t.restaurant.certificate}>
            <div className="cert-card__title">{t.restaurant.certificate}</div>
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "6px 0 0" }}>
              {t.restaurant.noCertificate}
            </p>
          </section>
        )}

        {others.length > 0 && (
          <details className="panel glass">
            <summary style={{ fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {t.restaurant.otherCertificates} ({others.length})
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {others.map((cert) => (
                <div
                  key={cert.certificate_id}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <VerdictPill verdict={cert.outcome} />
                  <span style={{ fontSize: 12.5, color: "var(--sub)" }}>
                    {lang === "en"
                      ? (cert.certifier.name_en ?? cert.certifier.name_he)
                      : cert.certifier.name_he}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Layer 2 lives here: below the facts, labelled, and never next to the pill.
            `fit-row` is the same structural container the cards use. */}
        <section className="panel glass fit-row" aria-label={t.fit.label}>
          <FitScoreBar fit={data.fit} />
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0", lineHeight: 1.5 }}>
            {t.fit.explain}
          </p>
        </section>

        <div className="actions">
          <a
            className="cta"
            href={
              data.geo
                ? `https://www.google.com/maps/dir/?api=1&destination=${data.geo.lat},${data.geo.lon}`
                : "#"
            }
            target="_blank"
            rel="noreferrer"
          >
            {t.restaurant.navigate}
          </a>
          {data.phone && (
            <a className="action-circle glass" href={`tel:${data.phone}`} aria-label={t.restaurant.call}>
              <PhoneIcon />
            </a>
          )}
          <button
            type="button"
            className="action-circle glass"
            aria-label={saved ? t.restaurant.saved : t.restaurant.save}
            aria-pressed={saved}
            onClick={() => toggle(data)}
          >
            <BookmarkIcon size={17} filled={saved} />
          </button>
        </div>

        <p className="hint" style={{ paddingBottom: 12 }}>
          {t.restaurant.report}
        </p>
      </div>
    </div>
  );
}
