/**
 * Routes and the onboarding gate.
 *
 * Anything under the app proper needs a usable profile — a whitelist with at least
 * one certifier — because without one there is nothing to check a restaurant
 * against. Users without one are sent to onboarding rather than shown a list of
 * verdicts derived from an empty profile.
 */

import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { API_MODE } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useI18n } from "./i18n/I18nProvider";
import { isProfileUsable } from "./profile/profile";
import { useProfile } from "./profile/ProfileProvider";
import { Filters } from "./views/Filters";
import { Home } from "./views/Home";
import { MapView } from "./views/MapView";
import { NotFound } from "./views/NotFound";
import { OnboardingCertifiers } from "./views/OnboardingCertifiers";
import { OnboardingPreset } from "./views/OnboardingPreset";
import { Profile } from "./views/Profile";
import { Restaurant } from "./views/Restaurant";
import { Saved } from "./views/Saved";
import { Search } from "./views/Search";

function RequireProfile({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const location = useLocation();
  if (!profile.completedOnboarding || !isProfileUsable(profile)) {
    return <Navigate to="/onboarding/preset" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
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
        <Route
          path="/filters"
          element={
            <RequireProfile>
              <Filters />
            </RequireProfile>
          }
        />
        <Route
          path="/search"
          element={
            <RequireProfile>
              <Search />
            </RequireProfile>
          }
        />
        <Route
          path="/r/:id"
          element={
            <RequireProfile>
              <Restaurant />
            </RequireProfile>
          }
        />
        <Route
          path="/saved"
          element={
            <RequireProfile>
              <Saved />
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
    </ErrorBoundary>
  );
}
