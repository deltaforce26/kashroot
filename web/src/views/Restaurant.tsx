/**
 * Restaurant — tinted hero, glass verdict panel (design 3d). The money screen.
 *
 * Order of the page is the order of the argument: the name of the place, then why
 * it matches you, both above the hero, then the hero verdict, then the certificate
 * that produced it with its provenance, then everything soft. The fit score sits
 * near the bottom, deliberately far from the verdict pill and under its own
 * explanatory label.
 *
 * The design's Shabbat/erev-chag hours block is not rendered: Israel hours logic is
 * out of POC scope and the detail response carries no hours, so inventing rows here
 * would be the one fabricated thing on the screen that matters most.
 */

import { Flag } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { CertificateEvidenceOut } from "../api/types";
import { decidingCertificate } from "../api/viewmodel";
import { CertificatePhotoSlot } from "../components/CertificatePhotoSlot";
import { EvidencePanel } from "../components/EvidencePanel";
import { FitScoreBar } from "../components/FitScoreBar";
import { tintClass } from "../components/RestaurantCard";
import { SaveToListHost } from "../components/SaveToListSheet";
import { ReportSheet } from "../components/ReportSheet";
import { VerdictPill } from "../components/VerdictPill";
import { BookmarkIcon, ChevronIcon, PhoneIcon, ShareIcon } from "../components/icons";
import { ErrorState, LoadingList, NotFoundState, OfflineBanner } from "../components/states";
import { useGoBack } from "../hooks/useReturnTo";
import { googleMapsUrl, wazeUrl } from "../location/directions";
import { useOrigin } from "../location/useOrigin";
import { isNetworkError, useRestaurant } from "../hooks/useApi";
import { formatDate, formatDistance, pickName, useI18n } from "../i18n/I18nProvider";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { useSaveToggle } from "../saved/useSaveToggle";
import { restaurantHead, uniqueCertifierNames } from "../seo/restaurantHead";
import { useDocumentHead } from "../seo/useDocumentHead";

function CertificateCard({
  restaurantId,
  evidence,
  onReport,
  onStale,
}: {
  restaurantId: string;
  evidence: CertificateEvidenceOut;
  onReport: () => void;
  onStale: () => void;
}) {
  const { t, lang } = useI18n();
  const validUntil = formatDate(evidence.valid_until);
  const certifierName =
    lang === "en" ? (evidence.certifier.name_en ?? evidence.certifier.name_he) : evidence.certifier.name_he;

  // The verification age is an API reason and already has its line in the evidence
  // panel above; this card carries the fact that panel does not — where the
  // certificate record came from.
  return (
    <section className="panel glass cert-card" aria-label={t.restaurant.certificate}>
      <CertificatePhotoSlot
        restaurantId={restaurantId}
        evidence={evidence}
        onReport={onReport}
        onStale={onStale}
      />
      <div className="cert-card__body">
        <div className="cert-card__title">{t.restaurant.certificate}</div>
        <span>{certifierName}</span>
        <span>{validUntil ? t.restaurant.validUntil(validUntil) : t.restaurant.noExpiry}</span>
        <span>
          {t.restaurant.source}: {t.restaurant.sources[evidence.provenance.source]}
        </span>
      </div>
    </section>
  );
}

export function Restaurant() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { profile } = useProfile();
  const { toggle, isSaved } = useSaveToggle();
  // The same origin the list measured from — or none, in which case no distance.
  const { origin } = useOrigin();
  // Landing here from a shared link leaves onboarding behind us, not a list.
  const goBack = useGoBack();

  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const openReport = useCallback(() => setReporting(true), []);
  const closeReport = useCallback(() => setReporting(false), []);

  const payload = useMemo(() => toPayload(profile), [profile]);
  // Same centre the list used, so the distance shown here is the same number.
  const { data, loading, error, reload } = useRestaurant(id, payload, origin ?? undefined);

  // The same head the profile-free page declares for this address: facts about the
  // place, and nothing about what the verdict below says — a crawler has no profile,
  // and the search result must not carry one visitor's answer to everyone.
  const facts = useMemo(
    () =>
      data
        ? {
            id: data.id,
            nameHe: data.nameHe,
            nameEn: data.nameEn,
            cityHe: data.cityHe,
            addressHe: data.addressHe,
            phone: data.phone,
            website: data.website,
            geo: data.geo,
            certifierNames: uniqueCertifierNames(data.certifiers, lang),
          }
        : null,
    [data, lang],
  );
  useDocumentHead(restaurantHead(facts, id ?? "", lang, t, !loading && !error && !data));

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
            <NotFoundState onBack={goBack} />
          )}
        </div>
      </div>
    );
  }

  const deciding = decidingCertificate(data);
  // With an approved photo on screen, the report button sits beside it and is the
  // card's only action; otherwise it lives at the foot of the page. Never both.
  const reportBesidePhoto = deciding?.photo_status === "accepted" && Boolean(deciding.photo_url);
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

  /**
   * Web Share where the browser has it (the native sheet is what a phone user
   * expects), clipboard otherwise. A cancelled share sheet is not an error and
   * must not fall through to a silent copy, so the two paths never chain.
   */
  async function handleShare() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, url });
      } catch {
        // Cancelled, or the sheet refused the payload. Nothing to report.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission — the address bar still holds the link.
    }
  }

  return (
    <div className="shell">
      <header className="shell__header" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="circle glass"
          aria-label={t.states.back}
          onClick={goBack}
        >
          <ChevronIcon />
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="circle glass"
            aria-label={t.restaurant.share}
            onClick={handleShare}
          >
            <ShareIcon />
          </button>
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
        {copied && (
          <p role="status" className="hint" style={{ margin: 0 }}>
            {t.restaurant.linkCopied}
          </p>
        )}

        <div>
          <h1 style={{ font: "700 28px Assistant, sans-serif", margin: 0 }}>{name}</h1>
          <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>{meta}</div>
        </div>

        <EvidencePanel match={data.kashrut} deciding={deciding} />

        <div className={`hero ${tintClass(data.dietType)}`}>
          <span className="hero__photo stripe" aria-hidden="true">
            {t.photoPlaceholder}
          </span>
          <span className="hero__verdict">
            <VerdictPill verdict={data.kashrut.verdict} size="lg" long />
          </span>
        </div>

        {deciding ? (
          <CertificateCard
            restaurantId={data.id}
            evidence={deciding}
            onReport={openReport}
            onStale={reload}
          />
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
            href={data.geo ? wazeUrl(data.geo) : "#"}
            target="_blank"
            rel="noreferrer"
          >
            {t.restaurant.navigateWaze}
          </a>
          <a
            className="cta cta--ghost"
            href={data.geo ? googleMapsUrl(data.geo) : "#"}
            target="_blank"
            rel="noreferrer"
          >
            {t.restaurant.navigateGoogle}
          </a>
          {data.phone && (
            <a className="action-circle glass" href={`tel:${data.phone}`} aria-label={t.restaurant.call}>
              <PhoneIcon />
            </a>
          )}
        </div>

        {!reportBesidePhoto && (
          <button type="button" className="report-link" onClick={openReport}>
            <Flag size={12} aria-hidden="true" />
            <span>{t.restaurant.report.open}</span>
          </button>
        )}
      </div>

      {reporting && (
        <ReportSheet
          restaurantId={data.id}
          {...(deciding ? { certificateId: deciding.certificate_id } : {})}
          onClose={closeReport}
        />
      )}
      <SaveToListHost />
    </div>
  );
}
