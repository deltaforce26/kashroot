/**
 * Onboarding step 2 of 2 — certifier whitelist (design 3c).
 *
 * The certifier list is flat and alphabetical. No grouping by type, no "recommended",
 * no ordering by stringency, no badge that implies one body is stricter than another.
 * The user decides; the app only records the decision.
 *
 * The design's required-attributes picker is hidden for now: the corpus carries no
 * certificate-level attributes yet, so any requirement would turn every place UNKNOWN.
 * See `toPayload` in profile.ts.
 */

import { useState } from "react";
import { trackOnboardingComplete } from "../analytics";
import { useNavigate } from "react-router-dom";
import { ROOTLESS, useReturnTo } from "../hooks/useReturnTo";
import { useI18n } from "../i18n/I18nProvider";
import { useProfile } from "../profile/ProfileProvider";
import {
  isWhitelisted,
  certifierName,
  sortCertifiersForDisplay,
  toggleCertifier,
} from "../profile/profile";
import { CheckIcon } from "../components/icons";
import { ErrorState, LoadingList } from "../components/states";
import { useDocumentHead } from "../seo/useDocumentHead";

export function OnboardingCertifiers({ standalone = false }: { standalone?: boolean }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // Step two of the same flow: same title, same one-liner, same noindex.
  useDocumentHead({ title: t.seo.onboardingTitle, description: t.seo.siteDescription, noindex: true });
  const returnTo = useReturnTo();
  const { profile, setProfile, certifiers, certifiersLoading, certifiersFailed, reloadCertifiers } =
    useProfile();
  const [draft, setDraft] = useState(profile);

  const ordered = sortCertifiersForDisplay(certifiers, lang);
  const usable = draft.whitelist.length > 0;

  const finish = () => {
    setProfile({ ...draft, completedOnboarding: true });
    trackOnboardingComplete({
      path: "certifiers",
      preset: draft.presetId ?? "custom",
      certifiers: draft.whitelist.length,
      first: !profile.completedOnboarding,
    });
    navigate(returnTo, { replace: true, state: ROOTLESS });
  };

  return (
    <div className="shell">
      <div className="shell__pad" style={{ paddingBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="steps" aria-label="2 / 2">
            <span data-on="true" />
            <span data-on="true" />
          </div>
          {!standalone && (
            <button
              type="button"
              className="sub"
              style={{ fontSize: 13 }}
              onClick={() => navigate(-1)}
            >
              {t.states.back}
            </button>
          )}
        </div>
      </div>

      <div className="shell__scroll" style={{ paddingTop: 4 }}>
        <div>
          <h1 style={{ font: "700 26px/1.25 Assistant, sans-serif", margin: 0 }}>
            {t.onboarding.certifiersTitle}
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "6px 0 0", lineHeight: 1.5 }}>
            {t.onboarding.certifiersLead}
          </p>
        </div>

        {certifiersFailed ? (
          <ErrorState onRetry={reloadCertifiers} />
        ) : certifiersLoading ? (
          <LoadingList rows={4} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="group">
            {ordered.map((certifier) => {
              const on = isWhitelisted(draft, certifier.id);
              return (
                <button
                  key={certifier.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`certifier-row ${on ? "tint-dairy" : "glass"}`}
                  onClick={() => setDraft(toggleCertifier(draft, certifier.id))}
                >
                  <span className="check check--sm" data-on={on} aria-hidden="true">
                    {on && <CheckIcon size={11} />}
                  </span>
                  <span className="certifier-row__name">
                    {certifierName(certifier, lang)}
                  </span>
                  <span
                    className={`certifier-row__mark ${on ? "stripe" : "stripe-flat"}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "8px 24px 20px", flex: "none" }}>
        {!usable && (
          <p className="hint" style={{ marginBottom: 10, color: "var(--amber)" }}>
            {t.onboarding.noneSelected}
          </p>
        )}
        <button type="button" className="cta" onClick={finish} disabled={!usable}>
          {t.onboarding.finish}
        </button>
      </div>
    </div>
  );
}
