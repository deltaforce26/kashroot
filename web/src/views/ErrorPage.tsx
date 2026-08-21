/**
 * The crash screen: what is left when a render throws and there is no screen.
 *
 * Same rule as `ErrorState` — the technical detail never reaches the user. A stack
 * trace is English, about our components rather than their world, and on a Hebrew
 * consumer screen it reads as the app breaking twice. `ErrorBoundary` logs it once
 * to the console; here it is shown only in a dev build, collapsed, for whoever is
 * running `vite dev` and staring at the same crash.
 *
 * Deliberately thin: no providers beyond i18n, no data, no tab bar. This component
 * renders *because* something else already threw, and a fallback that throws in
 * turn escapes its own boundary and blanks the app.
 */

import { useI18n } from "../i18n/I18nProvider";
import { AlertIcon } from "../components/icons";

export function ErrorPage({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  const { t } = useI18n();

  // A full document load rather than a client-side navigation: the state that
  // produced the crash is in memory, and only a reload is guaranteed to drop it.
  const reload = () => window.location.reload();
  const goHome = () => window.location.assign("/");

  return (
    <div className="shell">
      <div className="shell__scroll">
        <div className="state" role="alert">
          <span className="state__mark tint-sweet" aria-hidden="true">
            <AlertIcon size={26} />
          </span>
          <h1 className="state__title">{t.errorPage.title}</h1>
          <p className="state__body">{t.errorPage.body}</p>

          <div className="state__actions">
            <button type="button" className="cta" onClick={onRetry ?? reload}>
              {t.errorPage.retry}
            </button>
            <button type="button" className="cta cta--ghost" onClick={goHome}>
              {t.errorPage.home}
            </button>
          </div>

          {import.meta.env.DEV && error && (
            <details className="hint" style={{ textAlign: "start", maxWidth: "100%" }}>
              <summary style={{ cursor: "pointer" }}>{t.errorPage.devDetails}</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  direction: "ltr",
                  textAlign: "left",
                  marginTop: 8,
                }}
              >
                {error.stack ?? error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
