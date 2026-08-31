import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { LaunchScreen } from "./components/LaunchScreen";
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
        {/*
          * The launch animation lives here rather than inside <App> for two reasons:
          * it is not a route, and the tests render <App> directly — a splash that
          * gated the router would gate them too. It portals to <body>, so its
          * position in this tree only decides what context it can read.
          */}
        <LaunchScreen />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
