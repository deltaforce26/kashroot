/**
 * Onboarding step 2 — presets on glass (design 3b). The demo's opening move.
 *
 * A preset is a shortcut for filling the whitelist, expanded over the certifiers the
 * API returned. It is not a recommendation and not a ranking: the copy under each
 * row states what the selection contains, and the note at the foot restates that the
 * app does not rule on halacha.
 */

import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { useProfile } from "../profile/ProfileProvider";
import { PICKER_PRESETS, PRESET_ORDER, profileFromPreset, type PresetId } from "../profile/profile";
import { CheckIcon } from "../components/icons";
import { ErrorState, LoadingList } from "../components/states";
import { useState } from "react";

export function OnboardingPreset() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { profile, setProfile, certifiers, certifiersLoading, certifiersFailed, reloadCertifiers } =
    useProfile();
  const [selected, setSelected] = useState<PresetId | null>(profile.presetId);

  const skip = () => {
    // Skipping still needs a usable profile, so it lands on the widest one.
    setProfile({ ...profileFromPreset("any", certifiers), completedOnboarding: true });
    navigate("/", { replace: true });
  };

  const advance = () => {
    if (!selected) return;
    const next = profileFromPreset(selected, certifiers);
    if (PICKER_PRESETS.includes(selected)) {
      setProfile(next);
      navigate("/onboarding/certifiers");
      return;
    }
    setProfile({ ...next, completedOnboarding: true });
    navigate("/", { replace: true });
  };

  return (
    <div className="shell">
      <div className="shell__pad" style={{ paddingBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="steps" aria-label="2 / 4">
            <span data-on="true" />
            <span data-on="true" />
            <span />
            <span />
          </div>
          <button type="button" className="sub" style={{ fontSize: 13 }} onClick={skip}>
            {t.onboarding.skip}
          </button>
        </div>
      </div>

      <div className="shell__scroll" style={{ paddingTop: 4 }}>
        <div>
          <h1 className="display" style={{ font: "700 30px/1.25 Assistant, sans-serif", margin: 0 }}>
            {t.onboarding.presetTitle}
          </h1>
          <p style={{ fontSize: 14, color: "var(--sub)", lineHeight: 1.5, margin: "6px 0 0" }}>
            {t.onboarding.presetLead}
          </p>
        </div>

        {certifiersFailed ? (
          <ErrorState onRetry={reloadCertifiers} />
        ) : certifiersLoading ? (
          // Skeleton row count follows the real list — four since the "Local
          // Rabbanut" preset was withdrawn (see profile.ts), so the screen does not
          // reflow when the certifiers arrive.
          <LoadingList rows={PRESET_ORDER.length} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PRESET_ORDER.map((preset) => {
              const active = selected === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  className={`select-row ${active ? "tint-dairy" : "glass"}`}
                  aria-pressed={active}
                  onClick={() => setSelected(preset)}
                >
                  <span>
                    <span className="select-row__title">{t.presets[preset].title}</span>
                    <span className="select-row__sub" style={{ display: "block" }}>
                      {t.presets[preset].subtitle}
                    </span>
                  </span>
                  {active && (
                    <span className="check" data-on="true" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "8px 24px 20px", flex: "none" }}>
        <button type="button" className="cta" onClick={advance} disabled={!selected}>
          {t.onboarding.continue}
        </button>
        <p className="hint" style={{ marginTop: 12 }}>
          {t.onboarding.neutralityNote}
        </p>
      </div>
    </div>
  );
}
