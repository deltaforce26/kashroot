/**
 * The restaurant page for a visitor with no profile — which is every crawler, and
 * every first-time visitor arriving from a search result or a shared link.
 *
 * Until now `/r/:id` sat behind the onboarding gate, so Googlebot saw a redirect
 * and the app had no indexable page at all. This screen is what it sees instead:
 * the place, its address, and each certificate's facts *as stored* — certifier,
 * state, expiry, the attributes it lists. What it never shows is a verdict. A
 * verdict is the answer to (Certificate × Profile), and there is no profile here;
 * printing MATCH / NO_MATCH / UNKNOWN on this page would be printing an answer to a
 * question nobody asked. So there is no pill, no fit score, no reason list, and the
 * copy says in as many words that facts are not a ruling.
 *
 * The one call to action leads to onboarding with this address stashed as `from`,
 * the same way the gate hands over a shared link — so finishing onboarding lands
 * back here, now on the `Restaurant` screen with the verdict the new profile earns.
 *
 * The view prints the fact rows the API layer handed it (`PublicCertificateView`)
 * and reads no attribute map itself; see `toPublicView` for why.
 */

import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PublicCertificateView, PublicRestaurantView } from "../api/viewmodel";
import { tintClass } from "../components/RestaurantCard";
import { ChevronIcon, PhoneIcon } from "../components/icons";
import { ErrorState, LoadingList, NotFoundState, OfflineBanner } from "../components/states";
import { isNetworkError, isNotFoundError, useRestaurantPublic } from "../hooks/useApi";
import { formatDate, pickName, useI18n } from "../i18n/I18nProvider";
import { googleMapsUrl, wazeUrl } from "../location/directions";
import { restaurantHead, uniqueCertifierNames, type RestaurantFacts } from "../seo/restaurantHead";
import { useDocumentHead } from "../seo/useDocumentHead";

function toFacts(data: PublicRestaurantView, lang: "he" | "en"): RestaurantFacts {
  return {
    id: data.id,
    nameHe: data.nameHe,
    nameEn: data.nameEn,
    cityHe: data.cityHe,
    addressHe: data.addressHe,
    phone: data.phone,
    website: data.website,
    geo: data.geo,
    certifierNames: uniqueCertifierNames(
      data.certificates.map((certificate) => certificate.certifier),
      lang,
    ),
  };
}

function CertificateFacts({ certificate }: { certificate: PublicCertificateView }) {
  const { t, lang } = useI18n();
  const validUntil = formatDate(certificate.validUntil);
  // The attribute labels live in the string table; an attribute key this build has
  // no label for is printed as its key rather than dropped, so a fact the certifier
  // published is never silently missing from the page.
  const labels = t.attributes as Record<string, string | undefined>;

  return (
    <section className="panel glass cert-card" aria-label={t.restaurant.certificate}>
      <div className="cert-card__body">
        <div className="cert-card__title">{t.restaurant.certificate}</div>
        <span style={{ fontWeight: 700 }}>
          {pickName(lang, certificate.certifier.name_he, certificate.certifier.name_en)}
        </span>
        <span>
          {t.publicRestaurant.status}: {t.publicRestaurant.states[certificate.status]}
        </span>
        <span>{validUntil ? t.restaurant.validUntil(validUntil) : t.restaurant.noExpiry}</span>
        {certificate.facts.length > 0 ? (
          <>
            <span style={{ marginTop: 6 }}>{t.publicRestaurant.listed}:</span>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {certificate.facts.map((fact) => (
                <li key={fact.key}>
                  {labels[fact.key] ?? fact.key}:{" "}
                  {fact.published ? t.publicRestaurant.yes : t.publicRestaurant.no}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <span>{t.publicRestaurant.nothingListed}</span>
        )}
      </div>
    </section>
  );
}

export function RestaurantPublic() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useRestaurantPublic(id);

  const facts = useMemo(() => (data ? toFacts(data, lang) : null), [data, lang]);
  useDocumentHead(restaurantHead(facts, id ?? "", lang, t, isNotFoundError(error)));

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
          ) : error && !isNotFoundError(error) ? (
            <ErrorState onRetry={reload} />
          ) : (
            <NotFoundState onBack={() => navigate("/", { replace: true })} />
          )}
        </div>
      </div>
    );
  }

  const name = pickName(lang, data.nameHe, data.nameEn);
  const meta = [
    data.dietType ? t.diet[data.dietType] : null,
    [data.addressHe, data.cityHe].filter(Boolean).join(", "),
    data.priceLevel ? "₪".repeat(data.priceLevel) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const updated = formatDate(data.updatedAt);
  // Where onboarding returns to, in the same shape `RequireProfile` stashes it.
  const here = `/r/${data.id}`;

  return (
    <div className="shell">
      <header className="shell__header" style={{ justifyContent: "space-between" }}>
        {/* A landing from search has no history to go back through, so this is a
            link to the front door rather than a back button. */}
        <Link className="circle glass" to="/" aria-label={t.notFoundPage.home}>
          <ChevronIcon />
        </Link>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 12 }}>
        <div>
          <h1 style={{ font: "700 28px Assistant, sans-serif", margin: 0 }}>{name}</h1>
          <div style={{ fontSize: 13, color: "var(--sub)", marginTop: 2 }}>{meta}</div>
        </div>

        {/* The invitation sits where the verdict panel sits for a visitor who has a
            profile: it is the answer this page cannot give, and why. */}
        <section className={`panel ${tintClass(data.dietType)}`} aria-label={t.publicRestaurant.ctaTitle}>
          <h2 style={{ font: "700 18px Assistant, sans-serif", margin: 0 }}>
            {t.publicRestaurant.ctaTitle}
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "6px 0 12px" }}>
            {t.publicRestaurant.ctaBody}
          </p>
          <Link className="cta" to="/onboarding/preset" state={{ from: here }}>
            {t.publicRestaurant.cta}
          </Link>
        </section>

        <p className="hint" style={{ margin: 0 }}>
          {t.publicRestaurant.factsLead}
        </p>

        {data.certificates.length > 0 ? (
          data.certificates.map((certificate, index) => (
            <CertificateFacts key={`${certificate.certifier.id}-${index}`} certificate={certificate} />
          ))
        ) : (
          <section className="panel glass" aria-label={t.restaurant.certificate}>
            <div className="cert-card__title">{t.restaurant.certificate}</div>
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "6px 0 0" }}>
              {t.restaurant.noCertificate}
            </p>
          </section>
        )}

        <div className="actions">
          <a className="cta" href={data.geo ? wazeUrl(data.geo) : "#"} target="_blank" rel="noreferrer">
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

        {data.website && (
          <a className="cta cta--ghost" href={data.website} target="_blank" rel="noreferrer">
            {t.publicRestaurant.website}
          </a>
        )}

        {updated && (
          <p className="hint" style={{ margin: 0 }}>
            {t.publicRestaurant.updatedAt(updated)}
          </p>
        )}
      </div>
    </div>
  );
}
