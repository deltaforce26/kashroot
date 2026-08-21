/**
 * Onboarding step 3 — whitelist + required attributes (design 3c).
 *
 * The certifier list is flat and alphabetical. No grouping by type, no "recommended",
 * no ordering by stringency, no badge that implies one body is stricter than another.
 * The user decides; the app only records the decision.
 *
 * Required attributes carry the fail-safe in their own copy: each one must appear
 * explicitly on a certificate to count, so adding one narrows results into UNKNOWN
 * rather than quietly passing.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { useProfile } from "../profile/ProfileProvider";
import {
  OFFERED_ATTRIBUTES,
  isWhitelisted,
  certifierName,
  sortCertifiersForDisplay,
  toggleAttribute,
  toggleCertifier,
} from "../profile/profile";
import { CheckIcon } from "../components/icons";
import { ErrorState, LoadingList } from "../components/states";

export function OnboardingCertifiers({ standalone = false }: { standalone?: boolean }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { profile, setProfile, certifiers, certifiersLoading, certifiersFailed, reloadCertifiers } =
    useProfile();
  const [draft, setDraft] = useState(profile);

  const ordered = sortCertifiersForDisplay(certifiers, lang);
  const usable = draft.whitelist.length > 0;

  const finish = () => {
    setProfile({ ...draft, completedOnboarding: true });
    navigate("/", { replace: true });
  };

  return (
    <div className="shell">
      <div className="shell__pad" style={{ paddingBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="steps" aria-label="3 / 4">
            <span data-on="true" />
            <span data-on="true" />
            <span data-on="true" />
            <span />
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

        <div>
          <h2 style={{ font: "700 16px Assistant, sans-serif", margin: "14px 0 4px" }}>
            {t.onboarding.extraRequirements}
          </h2>
          <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>
            {t.onboarding.extraRequirementsLead}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {OFFERED_ATTRIBUTES.map((attribute) => {
              const on = draft.requiredAttributes.includes(attribute);
              return (
                <button
                  key={attribute}
                  type="button"
                  className={`tag ${on ? "" : "glass"}`}
                  aria-pressed={on}
                  onClick={() => setDraft(toggleAttribute(draft, attribute))}
                >
                  {t.attributes[attribute]}
                  {on ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        </div>
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
