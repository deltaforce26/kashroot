/**
 * `/certifier/:certifierSlug` — every restaurant on record holding a certificate
 * from one certifier, facts only, outside the onboarding gate. The counterpart of
 * `CityDirectory`: that page is a city faceted by certifier, this one a certifier
 * faceted by city.
 *
 * The page names the certifier and counts what is on record; it does not describe
 * the certifier. No level, no type, no comparison with any other body — the app
 * reports who certifies and never what that is worth. The cities are links to the
 * city page narrowed to this certifier, largest first as the API orders them (a
 * count, not a judgement); the restaurants are real anchors to their facts pages,
 * each row naming its city since the list spans several.
 */

import { useId, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { CertifierDirectoryView } from "../api/viewmodel";
import { Breadcrumbs, DirectoryNotFound, DirectoryRow } from "../components/directory";
import { ErrorState, LoadingList, OfflineBanner } from "../components/states";
import { isNetworkError, isNotFoundError, useCertifierDirectory } from "../hooks/useApi";
import { pickName, useI18n } from "../i18n/I18nProvider";
import {
  certifierDirectoryHead,
  cityDisplayName,
  cityPath,
  type CertifierDirectoryFacts,
} from "../seo/directoryHead";
import { useDocumentHead } from "../seo/useDocumentHead";

function toFacts(data: CertifierDirectoryView): CertifierDirectoryFacts {
  return {
    slug: data.slug,
    nameHe: data.nameHe,
    nameEn: data.nameEn,
    restaurantCount: data.restaurantCount,
    cityCount: data.cities.length,
    restaurants: data.restaurants,
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <div className="shell__scroll" style={{ paddingTop: 24 }}>
        {children}
      </div>
    </div>
  );
}

export function CertifierDirectory() {
  const { certifierSlug } = useParams<{ certifierSlug: string }>();
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useCertifierDirectory(certifierSlug);
  const citiesId = useId();
  const listId = useId();

  const facts = useMemo(() => (data ? toFacts(data) : null), [data]);
  useDocumentHead(
    certifierDirectoryHead(facts, certifierSlug ?? "", lang, t, isNotFoundError(error)),
  );

  if (loading) {
    return (
      <Shell>
        <LoadingList rows={5} label={t.landing.loading} />
      </Shell>
    );
  }

  if (error || !data) {
    const network = isNetworkError(error);
    return (
      <Shell>
        {network ? (
          <>
            <OfflineBanner />
            <ErrorState isNetwork onRetry={reload} />
          </>
        ) : error && !isNotFoundError(error) ? (
          <ErrorState onRetry={reload} />
        ) : (
          <DirectoryNotFound />
        )}
      </Shell>
    );
  }

  const name = pickName(lang, data.nameHe, data.nameEn);

  return (
    <Shell>
      <Breadcrumbs crumbs={[{ name: t.directory.home, path: "/" }, { name }]} />

      <header className="directory__head">
        <h1 className="landing__title">{name}</h1>
        <p className="landing__body">
          {t.directory.certifierIntro(name, data.restaurantCount, data.cities.length)}
        </p>
      </header>

      {data.cities.length > 0 && (
        <section className="panel glass" aria-labelledby={citiesId}>
          <h2 id={citiesId} className="landing__cityName">
            {t.directory.citiesTitle}
          </h2>
          <ul className="directory__facets">
            {data.cities.map((city) => (
              <li key={city.citySlug}>
                <Link className="directory__facet" to={cityPath(city.citySlug, data.slug)}>
                  <span>{cityDisplayName(city.cityHe, city.cityEn, lang, t)}</span>
                  <span className="landing__count">
                    {t.landing.restaurantCount(city.restaurantCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel glass" aria-labelledby={listId}>
        <div className="landing__cityHead">
          <h2 id={listId} className="landing__cityName">
            {t.directory.restaurantsTitle}
          </h2>
          <span className="landing__count">{t.landing.restaurantCount(data.restaurants.length)}</span>
        </div>
        <ul className="landing__rows">
          {data.restaurants.map((restaurant) => (
            <DirectoryRow
              key={restaurant.id}
              restaurant={restaurant}
              cityLabel={
                restaurant.cityHe ? cityDisplayName(restaurant.cityHe, restaurant.cityEn, lang, t) : null
              }
            />
          ))}
        </ul>
      </section>

      <p className="hint" style={{ margin: 0 }}>
        {t.states.coverageNoteEverywhere}
      </p>
      <p className="hint" style={{ margin: 0 }}>
        {t.landing.footer}
      </p>
      <Link className="cta" to="/onboarding/preset">
        {t.landing.cta}
      </Link>
    </Shell>
  );
}
