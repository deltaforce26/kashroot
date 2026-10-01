/**
 * The pieces the directory pages share — the landing page's city panels, the city
 * page and the certifier page all print the same restaurant row, and the two
 * directory pages share a breadcrumb trail and a not-in-our-records state.
 *
 * A row is one real anchor to `/r/<id>`: the link a crawler follows to the facts
 * page. Its accessible name is the restaurant's name alone; the address, the city
 * and the certifier names stay visible as text, and the separators between
 * certifier names are decoration. Certifier names are text here, not links — an
 * anchor cannot hold another anchor — and the page's facet list is where they link.
 * Every certifier on the record is printed, in the API's order, which is
 * alphabetical and not a ranking.
 */

import { Link } from "react-router-dom";
import type { DirectoryRestaurantView } from "../api/viewmodel";
import { pickName, useI18n } from "../i18n/I18nProvider";
import { AlertIcon } from "./icons";

/** The visual " · " between certifier names; hidden from the accessible tree. */
const SEPARATOR = " · ";

export function DirectoryRow({
  restaurant,
  cityLabel,
}: {
  restaurant: DirectoryRestaurantView;
  /** The certifier page lists several cities in one list, so each row names its own. */
  cityLabel?: string | null;
}) {
  const { t, lang } = useI18n();
  const name = pickName(lang, restaurant.nameHe, restaurant.nameEn);
  const certifiers = restaurant.certifiers.map((certifier) =>
    pickName(lang, certifier.nameHe, certifier.nameEn),
  );
  const where = [restaurant.addressHe, cityLabel].filter(Boolean).join(", ");

  return (
    <li>
      <Link className="landing__row" to={`/r/${restaurant.id}`} aria-label={name}>
        <span className="landing__rowName">{name}</span>
        {where && <span className="landing__rowSub">{where}</span>}
        <span className="landing__rowSub">
          {certifiers.length === 0
            ? t.landing.noCertificate
            : certifiers.map((certifier, index) => (
                <span key={`${index}-${certifier}`}>
                  {index > 0 && <span aria-hidden="true">{SEPARATOR}</span>}
                  {certifier}
                </span>
              ))}
        </span>
      </Link>
    </li>
  );
}

export interface Crumb {
  name: string;
  /** Omitted on the last crumb, which is the page itself. */
  path?: string;
}

/** The trail back to the root. The last crumb is the current page and not a link. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useI18n();
  return (
    <nav className="directory__crumbs" aria-label={t.directory.breadcrumbs}>
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={`${index}-${crumb.name}`}>
            {index > 0 && <span aria-hidden="true">›</span>}
            {crumb.path ? (
              <Link to={crumb.path}>{crumb.name}</Link>
            ) : (
              <span aria-current="page">{crumb.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A city or certifier the API does not know. Worded as a gap in our records, not
 * a statement about the city or the certifier — the same care `NothingHere` takes.
 * The page's `noindex` is declared by the view's head, not here.
 */
export function DirectoryNotFound() {
  const { t } = useI18n();
  return (
    <div className="state" role="status">
      <span className="state__mark tint-neutral" aria-hidden="true">
        <AlertIcon size={26} />
      </span>
      <h1 className="state__title">{t.directory.notFoundTitle}</h1>
      <p className="state__body">{t.directory.notFoundBody}</p>
      <div className="state__actions">
        <Link className="cta" to="/">
          {t.directory.notFoundHome}
        </Link>
      </div>
    </div>
  );
}
