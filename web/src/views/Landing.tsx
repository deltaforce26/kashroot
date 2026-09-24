/**
 * The front door for a visitor with no profile — which is every crawler, and every
 * first-time visitor who typed the address rather than following a shared link.
 *
 * Until now `/` sent anyone without a usable profile to onboarding, so the site's
 * root was a redirect: nothing for Google to index, and no page from which the
 * restaurant pages were linked. This screen is the root instead. Three parts: what
 * the app does and one button into onboarding; every city in the records with a
 * sample of its restaurants, each row a real anchor to `/r/<id>` — the links that
 * get the long tail crawled; and one sentence saying the rows are facts, not
 * rulings. With a profile the same address renders Home; see `HomeRoute` in App.tsx.
 *
 * What it never shows is a verdict, for the reason `RestaurantPublic` gives: a
 * verdict is (Certificate × Profile) and there is no profile here. The directory
 * the API hands it carries none either — names, addresses and certifier names, in
 * the API's order, which is alphabetical and not a ranking. The hero and its call to
 * action do not depend on that request: a landing whose list failed to load still
 * says what the app is and still leads into onboarding.
 *
 * No tab bar: every tab is behind the gate, and this is the screen before the app.
 * The call to action carries no `from`: onboarding's default return is `/`, which
 * is Home the moment a profile exists.
 */

import { useId, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { DirectoryCityView, DirectoryRestaurantView } from "../api/viewmodel";
import { ErrorState, LoadingList, OfflineBanner } from "../components/states";
import { isNetworkError, useDirectory } from "../hooks/useApi";
import { pickName, useI18n } from "../i18n/I18nProvider";
import { siteHead } from "../seo/siteHead";
import { useDocumentHead } from "../seo/useDocumentHead";

/** Where the hero's secondary link points: the city list further down this screen. */
const CITIES_ID = "cities";

/** The Kaf Bowl at rest — the launch screen's mark, drawn and still. */
function BrandMark() {
  return (
    <svg viewBox="0 0 120 120" width="36" height="36" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="landingMark" x1="20" y1="20" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--mark-from)" />
          <stop stopColor="var(--mark-to)" offset="1" />
        </linearGradient>
      </defs>
      <path
        d="M24 46v12c0 20 16 36 36 36s36-16 36-36V46"
        stroke="url(#landingMark)"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <circle cx="60" cy="20" r="9" fill="url(#landingMark)" />
    </svg>
  );
}

function RestaurantRow({ restaurant }: { restaurant: DirectoryRestaurantView }) {
  const { t, lang } = useI18n();
  // Every certifier on the record, joined — the whole set in the API's order, which
  // is alphabetical. Not a ranking, and not a pick of one over another.
  const certifiers = restaurant.certifiers
    .map((certifier) => pickName(lang, certifier.nameHe, certifier.nameEn))
    .join(" · ");

  return (
    <li>
      {/* A real anchor: this is the link a crawler follows to the restaurant page. */}
      <Link className="landing__row" to={`/r/${restaurant.id}`}>
        <span className="landing__rowName">
          {pickName(lang, restaurant.nameHe, restaurant.nameEn)}
        </span>
        {restaurant.addressHe && <span className="landing__rowSub">{restaurant.addressHe}</span>}
        <span className="landing__rowSub">{certifiers || t.landing.noCertificate}</span>
      </Link>
    </li>
  );
}

function CityPanel({ city }: { city: DirectoryCityView }) {
  const { t } = useI18n();
  const headingId = useId();
  // The records spell cities in Hebrew; the English UI has names for the launch
  // cities and shows any other city as the records spell it.
  const name = t.landing.cityNames[city.cityHe] ?? city.cityHe;

  return (
    <section className="panel glass" aria-labelledby={headingId}>
      <div className="landing__cityHead">
        <h3 id={headingId} className="landing__cityName">
          {name}
        </h3>
        <span className="landing__count">{t.landing.restaurantCount(city.restaurantCount)}</span>
      </div>
      <ul className="landing__rows">
        {city.restaurants.map((restaurant) => (
          <RestaurantRow key={restaurant.id} restaurant={restaurant} />
        ))}
      </ul>
    </section>
  );
}

export function Landing() {
  const { t, lang, setLang } = useI18n();
  useDocumentHead(siteHead(t));
  const { data, loading, error, reload } = useDirectory();

  // The list lives in the shell's own scroller, so a fragment link is scrolled by
  // hand where the browser supports it; the `href` stays for everything else.
  const browse = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(CITIES_ID);
    if (target && typeof target.scrollIntoView === "function") {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="shell">
      <div className="shell__scroll" style={{ paddingTop: 28 }}>
        <header className="landing__hero">
          {/* The lockup, not UI copy — the Hebrew mark stays the mark in the English
              UI, as on the launch screen. */}
          <p className="landing__brand">
            <BrandMark />
            <span className="landing__brandHe">כשרות</span>
            <span className="landing__brandLatin">KASHROOT</span>
          </p>
          <h1 className="landing__title">{t.landing.tagline}</h1>
          <p className="landing__body">{t.landing.body}</p>
          <Link className="cta" to="/onboarding/preset">
            {t.landing.cta}
          </Link>
          <a className="landing__browse" href={`#${CITIES_ID}`} onClick={browse}>
            {t.landing.browse}
          </a>
        </header>

        <section id={CITIES_ID} className="landing__cities" aria-labelledby="landing-cities-title">
          <h2 id="landing-cities-title" className="landing__sectionTitle">
            {t.landing.citiesTitle}
          </h2>
          {loading ? (
            <LoadingList rows={3} label={t.landing.loading} />
          ) : error || !data ? (
            <>
              {isNetworkError(error) && <OfflineBanner />}
              <ErrorState isNetwork={isNetworkError(error)} onRetry={reload} />
            </>
          ) : (
            <>
              {data.cities.map((city) => (
                <CityPanel key={city.cityHe} city={city} />
              ))}
              {/* A city's count is what we hold, not what the city has. Said here as
                  it is said under Home's list, so a number never reads as coverage. */}
              <p className="hint" style={{ margin: 0 }}>
                {t.states.coverageNoteEverywhere}
              </p>
            </>
          )}
        </section>

        <footer className="landing__foot">
          <p className="hint" style={{ margin: 0 }}>
            {t.landing.footer}
          </p>
          {/* The same control the profile screen has; this screen sits before it. */}
          <span className="segmented" role="group" aria-label={t.profile.language}>
            <button type="button" aria-pressed={lang === "he"} onClick={() => setLang("he")}>
              עברית
            </button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
              English
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
