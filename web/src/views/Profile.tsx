/**
 * Profile (design 3h). 3h is drawn in English — it is the same screen as the rest
 * of the app with `dir` flipped, so this component is the RTL/LTR proof: switching
 * the language toggle here re-renders every screen in the other direction without a
 * second component tree existing anywhere.
 */

import { useNavigate } from "react-router-dom";
import { SettingsIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { useI18n } from "../i18n/I18nProvider";
import { certifierName, sortCertifiersForDisplay } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { DARK_MODE_ENABLED, useTheme } from "../theme/ThemeProvider";
import { useDocumentHead } from "../seo/useDocumentHead";

export function Profile() {
  const { t, lang, setLang } = useI18n();
  // The reader's own religious preferences: never a page for the index.
  useDocumentHead({ title: t.profile.title, description: t.seo.siteDescription, noindex: true });
  const navigate = useNavigate();
  const { profile, certifiers, reset } = useProfile();
  const { isDark, toggle } = useTheme();

  const chosen = sortCertifiersForDisplay(
    certifiers.filter((certifier) =>
      profile.whitelist.some((entry) => entry.certifier_id === certifier.id),
    ),
    lang,
  );

  return (
    <div className="shell">
      <header className="shell__header">
        <div style={{ flex: 1 }}>
          <h1 style={{ font: "700 24px Assistant, sans-serif", margin: 0 }}>{t.profile.title}</h1>
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{t.profile.lead}</div>
        </div>
        <span className="circle glass" aria-hidden="true">
          <SettingsIcon />
        </span>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        <section className="panel glass">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t.profile.certifiers}</span>
            <button
              type="button"
              style={{ fontSize: 12, color: "var(--sub)" }}
              onClick={() => navigate("/onboarding/certifiers")}
            >
              {t.profile.edit}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
            {chosen.length === 0 ? (
              <span style={{ fontSize: 12, color: "var(--amber)" }}>{t.profile.none}</span>
            ) : (
              chosen.map((certifier) => (
                <span key={certifier.id} className="tag-static">
                  {certifierName(certifier, lang)}
                </span>
              ))
            )}
          </div>
        </section>

        <section className="panel glass">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t.profile.required}</span>
            <button
              type="button"
              style={{ fontSize: 12, color: "var(--sub)" }}
              onClick={() => navigate("/onboarding/certifiers")}
            >
              {t.profile.edit}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
            {profile.requiredAttributes.length === 0 ? (
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{t.profile.none}</span>
            ) : (
              profile.requiredAttributes.map((attribute) => (
                <span key={attribute} className="tag-static tag-static--outline">
                  {t.attributes[attribute]} ✓
                </span>
              ))
            )}
          </div>
        </section>

        <section className="panel glass rows">
          <div className="row">
            <span>{t.profile.language}</span>
            <span className="segmented">
              <button type="button" aria-pressed={lang === "he"} onClick={() => setLang("he")}>
                עברית
              </button>
              <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
                English
              </button>
            </span>
          </div>

          <div className="row">
            <span>{t.profile.notifications}</span>
            <span className="row__value">{t.profile.notificationsValue}</span>
          </div>

          {DARK_MODE_ENABLED && (
            <button type="button" className="row" role="switch" aria-checked={isDark} onClick={toggle}>
              <span>
                <span style={{ display: "block" }}>{t.profile.darkMode}</span>
                <span style={{ fontSize: 11.5, color: "var(--sub)" }}>{t.profile.darkModeSub}</span>
              </span>
              <span className="toggle" aria-checked={isDark} aria-hidden="true">
                <span className="toggle__knob" />
              </span>
            </button>
          )}
        </section>

        <p className="hint">{t.profile.neutrality}</p>

        <button
          type="button"
          className="cta cta--ghost"
          style={{ marginBottom: 8 }}
          onClick={() => {
            reset();
            navigate("/onboarding/preset", { replace: true });
          }}
        >
          {t.profile.resetProfile}
        </button>
      </div>

      <TabBar />
    </div>
  );
}
