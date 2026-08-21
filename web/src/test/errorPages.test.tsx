/**
 * The two page-level failure screens: a bad address, and a render that threw.
 *
 * Both replace the whole screen, so both are easy to get wrong in ways nothing else
 * catches — a 404 that silently redirects looks like a working link, and an
 * uncaught crash unmounts the tree into a white page that is indistinguishable from
 * a PWA that failed to load. These are the guarantees, asserted rather than trusted.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { PROFILE_SCHEMA_VERSION } from "../profile/storage";
import { SavedProvider } from "../saved/SavedProvider";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;

/** A profile with one whitelisted certifier — enough to clear the onboarding gate. */
function seedProfile() {
  localStorage.setItem(
    `kashroot.profile.v${PROFILE_SCHEMA_VERSION}`,
    JSON.stringify({
      version: PROFILE_SCHEMA_VERSION,
      presetId: "any",
      whitelist: [{ certifier_id: "cert-rubin", min_level: "unknown" }],
      requiredAttributes: [],
      completedOnboarding: true,
    }),
  );
}

function renderApp(route: string) {
  localStorage.setItem("kashroot.city", "jerusalem");
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ProfileProvider>
          <SavedProvider>
            <MemoryRouter initialEntries={[route]}>
              <App />
            </MemoryRouter>
          </SavedProvider>
        </ProfileProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("the not-found page", () => {
  it("answers an unknown address instead of bouncing it home", async () => {
    seedProfile();
    renderApp("/no-such-screen");

    expect(await screen.findByText(he.notFoundPage.title)).toBeInTheDocument();
    expect(screen.queryByText(he.home.nearYou)).toBeNull();
  });

  it("names the address that was asked for", async () => {
    seedProfile();
    renderApp("/oops/typo");

    expect(await screen.findByText(he.notFoundPage.path("/oops/typo"))).toBeInTheDocument();
  });

  /**
   * The 404 is not behind the onboarding gate. A wrong address is wrong either way,
   * and sending a broken link into onboarding hides the mistake behind a screen
   * that looks like a normal first run.
   */
  it("shows a profileless visitor the 404, not onboarding", async () => {
    renderApp("/no-such-screen");

    expect(await screen.findByText(he.notFoundPage.title)).toBeInTheDocument();
    expect(screen.queryByText(he.onboarding.presetTitle)).toBeNull();
  });

  /** Every tab is gated, so offering them without a profile offers four dead links. */
  it("offers the tab bar only once a profile exists", async () => {
    renderApp("/no-such-screen");
    await screen.findByText(he.notFoundPage.title);
    expect(screen.queryByRole("navigation")).toBeNull();

    cleanup();
    seedProfile();
    renderApp("/no-such-screen");
    await screen.findByText(he.notFoundPage.title);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("leads back to the home screen", async () => {
    seedProfile();
    renderApp("/no-such-screen");

    const home = await screen.findByRole("link", { name: he.notFoundPage.home });
    expect(home).toHaveAttribute("href", "/");
  });
});

function Boom(): ReactNode {
  throw new Error("fixture crash: pretend a view dereferenced null");
}

function renderBoundary(children: ReactNode, route = "/") {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[route]}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("the error page", () => {
  it("replaces a crashed render rather than unmounting the app", () => {
    // React logs the caught error itself; the boundary logs it again on purpose.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBoundary(<Boom />);

    expect(screen.getByText(he.errorPage.title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  /**
   * The rule `ErrorState` was written under, restated for the crash screen: the
   * technical text goes to the console. What is left on screen is the sentence we
   * wrote — a stack trace on a Hebrew consumer screen is the app breaking twice.
   * A dev build adds a collapsed drawer, which is not the copy and stays shut.
   */
  it("keeps the crash detail out of the user-facing copy", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderBoundary(<Boom />);

    const alert = screen.getByRole("alert");
    const copy = [...alert.querySelectorAll(".state__title, .state__body")]
      .map((node) => node.textContent)
      .join(" ");
    expect(copy).not.toContain("fixture crash");

    const drawer = alert.querySelector("details");
    if (drawer) expect(drawer).not.toHaveAttribute("open");
    consoleError.mockRestore();
  });

  /**
   * Without this the first crash is permanent: the boundary would keep rendering
   * the crash screen while the URL moved on underneath it.
   */
  it("clears the crash when the location changes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // The link sits outside the boundary so it survives the crash — this asserts the
    // reset, not the crash screen's own buttons.
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Link to="/safe">leave</Link>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Boom />} />
              <Route path="/safe" element={<p>recovered</p>} />
            </Routes>
          </ErrorBoundary>
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByText(he.errorPage.title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "leave" }));

    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(screen.queryByText(he.errorPage.title)).toBeNull();
    consoleError.mockRestore();
  });
});
