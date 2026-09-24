/**
 * Routes and the onboarding gate.
 *
 * Anything under the app proper needs a usable profile — a whitelist with at least
 * one certifier — because without one there is nothing to check a restaurant
 * against. Users without one are sent to onboarding rather than shown a list of
 * verdicts derived from an empty profile.
 *
 * The one exception is `/r/:id`. A restaurant page is the address search engines
 * and shared links land on, and behind the gate it was a redirect — invisible to
 * Googlebot and to the person who tapped the link. Without a profile it now renders
 * the facts on record and an invitation to set one (`RestaurantPublic`); with a
 * profile it is the verdict screen it always was. The gate is not weakened: no
 * verdict is shown without a profile, because the profile-free page has none.
 */

import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { API_MODE } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useI18n } from "./i18n/I18nProvider";
import { isProfileUsable } from "./profile/profile";
import { SaveTargetProvider } from "./saved/SaveTargetProvider";
import { useProfile } from "./profile/ProfileProvider";
import { Home } from "./views/Home";
import { MapView } from "./views/MapView";
import { NotFound } from "./views/NotFound";
import { OnboardingCertifiers } from "./views/OnboardingCertifiers";
import { OnboardingPreset } from "./views/OnboardingPreset";
import { Profile } from "./views/Profile";
import { Restaurant } from "./views/Restaurant";
import { RestaurantPublic } from "./views/RestaurantPublic";
import { Saved } from "./views/Saved";
import { SavedList } from "./views/SavedList";
import { Search } from "./views/Search";

function hasUsableProfile(profile: ReturnType<typeof useProfile>["profile"]): boolean {
  return profile.completedOnboarding && isProfileUsable(profile);
}

function RequireProfile({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const location = useLocation();
  if (!hasUsableProfile(profile)) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/onboarding/preset" replace state={{ from }} />;
  }
  return <>{children}</>;
}

/** `/r/:id` — the verdict screen with a profile, the public facts page without one. */
function RestaurantRoute() {
  const { profile } = useProfile();
  return hasUsableProfile(profile) ? <Restaurant /> : <RestaurantPublic />;
}

/** Visible while the fixtures stand in for Track B — so no one demos it unknowingly. */
function MockRibbon() {
  const { t } = useI18n();
  if (API_MODE !== "mock") return null;
  return <div className="mock-ribbon">{t.mockBanner}</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <MockRibbon />
      {/*
        * Every route sits inside the save-target provider: the save button on a card
        * can appear on any of them, and the sheet it opens needs one shared target.
        */}
      <SaveTargetProvider>
        <Routes>
          <Route path="/onboarding/preset" element={<OnboardingPreset />} />
          <Route path="/onboarding/certifiers" element={<OnboardingCertifiers />} />
          <Route
            path="/"
            element={
              <RequireProfile>
                <Home />
              </RequireProfile>
            }
          />
          {/* The filters screen became the filter bar's bottom sheet, which opens in
              place over home and search. The old address still lands somewhere real. */}
          <Route path="/filters" element={<Navigate to="/" replace />} />
          <Route
            path="/search"
            element={
              <RequireProfile>
                <Search />
              </RequireProfile>
            }
          />
          {/* Deliberately not behind RequireProfile — see the header comment. */}
          <Route path="/r/:id" element={<RestaurantRoute />} />
          <Route
            path="/saved"
            element={
              <RequireProfile>
                <Saved />
              </RequireProfile>
            }
          />
          <Route
            path="/saved/:listId"
            element={
              <RequireProfile>
                <SavedList />
              </RequireProfile>
            }
          />
          <Route
            path="/map"
            element={
              <RequireProfile>
                <MapView />
              </RequireProfile>
            }
          />
          {/* The map's list was a second, differently-filtered answer to the question
              home already answers, so home is the list now. Same as /filters above:
              the old address still lands somewhere real, which matters for anyone
              whose installed PWA kept it. */}
          <Route path="/map/list" element={<Navigate to="/map" replace />} />
          <Route
            path="/profile"
            element={
              <RequireProfile>
                <Profile />
              </RequireProfile>
            }
          />
          {/*
            * A bad address gets a page that says so, not a silent bounce home. The
            * redirect it replaces made every broken link look like a working one.
            */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </SaveTargetProvider>
    </ErrorBoundary>
  );
}
