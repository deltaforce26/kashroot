/**
 * Profile state for the app: the stored profile plus the certifier list it is
 * expressed against. Certifiers come from `GET /v1/certifiers`; until they load,
 * the presets cannot be expanded, so the onboarding screen waits on them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { kashrootApi } from "../api";
import type { CertifierView } from "../api/viewmodel";
import { EMPTY_PROFILE, type KashrutProfile } from "./profile";
import { clearProfile, loadProfile, saveProfile } from "./storage";

interface ProfileValue {
  profile: KashrutProfile;
  setProfile: (profile: KashrutProfile) => void;
  reset: () => void;
  certifiers: CertifierView[];
  certifiersLoading: boolean;
  /** A flag, not a message — server text never reaches the UI. */
  certifiersFailed: boolean;
  reloadCertifiers: () => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<KashrutProfile>(loadProfile);
  const [certifiers, setCertifiers] = useState<CertifierView[]>([]);
  const [certifiersLoading, setLoading] = useState(true);
  const [certifiersFailed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    kashrootApi
      .getCertifiers(controller.signal)
      .then((response) => {
        setCertifiers(response);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[kashroot] GET /v1/certifiers failed:", error);
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  /**
   * Reconcile the stored profile against the certifiers the server actually knows.
   *
   * A version bump catches a schema change, but not a profile whose ids were valid
   * when written and are not any more — a reseeded database, a certifier merged
   * away, or a profile carried over from the fixture server. Any unresolvable id
   * would make every subsequent request fail validation, so the profile is discarded
   * and the user is routed to onboarding. Silent: nothing here is the user's fault.
   */
  useEffect(() => {
    if (certifiersLoading || certifiers.length === 0) return;
    if (profile.whitelist.length === 0) return;
    const known = new Set(certifiers.map((certifier) => certifier.id));
    const unresolved = profile.whitelist.filter((entry) => !known.has(entry.certifier_id));
    if (unresolved.length === 0) return;
    console.warn(
      "[kashroot] discarding a stored profile with %d unrecognised certifier id(s)",
      unresolved.length,
    );
    clearProfile();
    setProfileState(EMPTY_PROFILE);
  }, [certifiers, certifiersLoading, profile.whitelist]);

  const setProfile = useCallback((next: KashrutProfile) => {
    setProfileState(next);
    saveProfile(next);
  }, []);

  const reset = useCallback(() => {
    clearProfile();
    setProfileState(EMPTY_PROFILE);
  }, []);

  const value = useMemo<ProfileValue>(
    () => ({
      profile,
      setProfile,
      reset,
      certifiers,
      certifiersLoading,
      certifiersFailed,
      reloadCertifiers: () => setReloadToken((token) => token + 1),
    }),
    [profile, setProfile, reset, certifiers, certifiersLoading, certifiersFailed],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used inside <ProfileProvider>");
  return value;
}
