/**
 * The route-level 404 — an address that does not exist in the app.
 *
 * Distinct from `NotFoundState`, which is the *in-screen* answer to "this business
 * is not in our records": that one is a statement about the corpus, this one is a
 * statement about the URL. Conflating them would tell someone who mistyped a path
 * that our database is missing a restaurant, which is a lie about the product's
 * core promise — the same reason `EmptyCity` is kept apart from `EmptyResults`.
 *
 * The onboarding gate deliberately does not wrap this route. A wrong address is
 * wrong whether or not a profile exists, and bouncing a bad link into onboarding
 * would hide the mistake behind a screen that looks like normal first-run flow.
 */

import { Link, useLocation, useNavigate } from "react-router-dom";
import { SearchIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { useI18n } from "../i18n/I18nProvider";
import { isProfileUsable } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";

export function NotFound() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useProfile();

  // The tab bar is the way out of a dead end, but every tab is behind the
  // onboarding gate — showing it to someone without a profile offers four links
  // that all bounce to the same onboarding screen. They get the CTA instead.
  const canNavigate = profile.completedOnboarding && isProfileUsable(profile);

  return (
    <div className="shell">
      <div className="shell__scroll">
        <div className="state" role="status">
          <span className="state__mark tint-neutral" aria-hidden="true">
            <SearchIcon size={26} />
          </span>
          <h1 className="state__title">{t.notFoundPage.title}</h1>
          <p className="state__body">{t.notFoundPage.body}</p>
          {/* The path is user-supplied text rendered as text — never as a link. */}
          <p className="hint">{t.notFoundPage.path(location.pathname)}</p>
          <div className="state__actions">
            <Link className="cta" to="/">
              {t.notFoundPage.home}
            </Link>
            <button type="button" className="cta cta--ghost" onClick={() => navigate(-1)}>
              {t.notFoundPage.back}
            </button>
          </div>
        </div>
      </div>

      {canNavigate && <TabBar />}
    </div>
  );
}
