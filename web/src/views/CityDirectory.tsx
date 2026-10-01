/**
 * `/city/:citySlug` and `/city/:citySlug/:certifierSlug` — one city's restaurants,
 * facts only, for crawlers and for anyone who has not set a profile. Never behind
 * the onboarding gate, and never the verdict screen: with or without a profile
 * this page is the same list of facts, because a list of verdicts is a question
 * only a profile can ask, and a directory page is addressed by a city, not a person.
 *
 * Three parts: a heading and one sentence counting what is on record; the city's
 * certifiers as links to the narrowed page, each with its count — a facet, not a
 * ranking, in alphabetical order; and every restaurant as a real anchor to its
 * facts page. Narrowed to a certifier, the list shrinks, the facets stay whole and
 * an "all" link leads back to the city. What it never says is which certifier is
 * worth what: the app reports who certifies, and the reader decides.
 *
 * A city or certifier the API does not know gets a not-in-our-records page that
 * says `noindex` itself — a soft 404, since the server answers 200 for every path.
 */

import { useId, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { CityDirectoryView } from "../api/viewmodel";
import { Breadcrumbs, DirectoryNotFound, DirectoryRow } from "../components/directory";
import { ErrorState, LoadingList, OfflineBanner } from "../components/states";
import { isNetworkError, isNotFoundError, useCityDirectory } from "../hooks/useApi";
import { pickName, useI18n } from "../i18n/I18nProvider";
import {
  cityDirectoryHead,
  cityDisplayName,
  cityPath,
  type CityDirectoryFacts,
} from "../seo/directoryHead";
import { useDocumentHead } from "../seo/useDocumentHead";

function toFacts(data: CityDirectoryView): CityDirectoryFacts {
  return {
    citySlug: data.citySlug,
    cityHe: data.cityHe,
    cityEn: data.cityEn,
    restaurantCount: data.restaurantCount,
    certifier: data.selectedCertifier,
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

export function CityDirectory() {
  const { citySlug, certifierSlug } = useParams<{ citySlug: string; certifierSlug?: string }>();
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useCityDirectory(citySlug, certifierSlug);
  const facetsId = useId();
  const listId = useId();

  const facts = useMemo(() => (data ? toFacts(data) : null), [data]);
  useDocumentHead(
    cityDirectoryHead(facts, citySlug ?? "", certifierSlug, lang, t, isNotFoundError(error)),
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

  const city = cityDisplayName(data.cityHe, data.cityEn, lang, t);
  const selected = data.selectedCertifier;
  const certifierName = selected ? pickName(lang, selected.nameHe, selected.nameEn) : null;
  const title = certifierName ? t.directory.cityCertifierTitle(city, certifierName) : city;
  const intro = certifierName
    ? t.directory.cityCertifierIntro(city, certifierName, data.restaurants.length)
    : t.directory.cityIntro(city, data.restaurantCount);

  return (
    <Shell>
      <Breadcrumbs
        crumbs={[
          { name: t.directory.home, path: "/" },
          certifierName
            ? { name: city, path: cityPath(data.citySlug) }
            : { name: city },
          ...(certifierName ? [{ name: certifierName }] : []),
        ]}
      />

      <header className="directory__head">
        <h1 className="landing__title">{title}</h1>
        <p className="landing__body">{intro}</p>
      </header>

      <section className="panel glass" aria-labelledby={facetsId}>
        <h2 id={facetsId} className="landing__cityName">
          {t.directory.facetsTitle}
        </h2>
        {/* Alphabetical, with counts: a facet list. The order is the API's and
            nothing here reorders, because an order would read as a ranking. */}
        <ul className="directory__facets">
          {selected && (
            <li>
              <Link className="directory__facet" to={cityPath(data.citySlug)}>
                <span>{t.directory.allInCity(city)}</span>
                <span className="landing__count">
                  {t.landing.restaurantCount(data.restaurantCount)}
                </span>
              </Link>
            </li>
          )}
          {data.certifiers.map((facet) => {
            const current = selected?.slug === facet.slug;
            return (
              <li key={facet.slug}>
                <Link
                  className={`directory__facet${current ? " directory__facet--current" : ""}`}
                  to={cityPath(data.citySlug, facet.slug)}
                  {...(current ? { "aria-current": "page" as const } : {})}
                >
                  <span>{pickName(lang, facet.nameHe, facet.nameEn)}</span>
                  <span className="landing__count">
                    {t.landing.restaurantCount(facet.restaurantCount)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel glass" aria-labelledby={listId}>
        <div className="landing__cityHead">
          <h2 id={listId} className="landing__cityName">
            {t.directory.restaurantsTitle}
          </h2>
          <span className="landing__count">{t.landing.restaurantCount(data.restaurants.length)}</span>
        </div>
        <ul className="landing__rows">
          {data.restaurants.map((restaurant) => (
            <DirectoryRow key={restaurant.id} restaurant={restaurant} />
          ))}
        </ul>
      </section>

      {/* A count is what we hold, not what the city has — said as the landing says it. */}
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
