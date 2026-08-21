import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { ProfileProvider } from "./profile/ProfileProvider";
import { SavedProvider } from "./saved/SavedProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles.css";

// Auto-update: a demo should never be pinned to a stale build by a live worker.
registerSW({ immediate: true });

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ProfileProvider>
          <SavedProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SavedProvider>
        </ProfileProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
