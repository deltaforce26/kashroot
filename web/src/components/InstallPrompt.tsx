/**
 * Install prompt (C8). Captures `beforeinstallprompt`, then offers it as a card in
 * the app's own language rather than letting the browser's mini-infobar carry it.
 *
 * Dismissal is remembered, and the card never appears when the app is already
 * running standalone — which is how it will be shown in the demo.
 */

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "kashroot.install.dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  const { t } = useI18n();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // storage blocked — still offer the prompt
    }
    const handler = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!event) return null;

  const dismiss = () => {
    setEvent(null);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="install glass" role="dialog" aria-label={t.install.title}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{t.install.title}</div>
        <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>{t.install.body}</div>
      </div>
      <div className="install__row">
        <button
          type="button"
          className="cta"
          onClick={() => {
            void event.prompt().then(() => setEvent(null));
          }}
        >
          {t.install.action}
        </button>
        <button type="button" className="cta cta--ghost" onClick={dismiss}>
          {t.install.dismiss}
        </button>
      </div>
    </div>
  );
}
