/**
 * The launch animation, and the three things about it that are easy to break.
 *
 * It is a splash screen, so every failure mode is "the app is now unreachable":
 * an exit that never fires, an #root left `aria-hidden`, or a gate that replays the
 * animation on every reload. Each gets a test.
 *
 * The timings under test are real (1.35s draw-on + 0.32s exit ≈ 1.7s). Fake
 * timers would have to mock `requestAnimationFrame` and `document.fonts` together to
 * drive the readiness promise, which pins the implementation rather than the
 * behaviour; the file's budget fits inside the 15s test timeout as it is.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "../i18n/strings";

/** The overlay reaches for #root to hold and release the app behind it. */
function installRoot() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

/**
 * A fresh module instance each time: the once-per-session gate is cached at module
 * scope, so clearing session storage alone would not re-arm it.
 *
 * The provider has to come from the same reset graph as the component. A statically
 * imported `I18nProvider` would hold a different React context object than the one
 * the freshly-imported `LaunchScreen` reads, and every test would fail claiming the
 * component was rendered outside its provider.
 */
async function mountLaunch() {
  vi.resetModules();
  const { LaunchScreen } = await import("../components/LaunchScreen");
  const { I18nProvider } = await import("../i18n/I18nProvider");
  return render(
    <I18nProvider>
      <LaunchScreen />
    </I18nProvider>,
  );
}

/** Stalls readiness for ever, which is what "slow" means to the launch screen. */
function stallFonts() {
  Object.defineProperty(document, "fonts", {
    value: { ready: new Promise<void>(() => {}) },
    configurable: true,
  });
}

beforeEach(() => {
  sessionStorage.clear();
  installRoot();
});

afterEach(() => {
  sessionStorage.clear();
  document.getElementById("root")?.remove();
  document.documentElement.removeAttribute("data-launch");
  // @ts-expect-error — jsdom has no FontFaceSet; a stalled stub must not leak.
  delete document.fonts;
});

describe("launch animation", () => {
  it("draws the mark on a first launch, and holds the app out of the way while it does", async () => {
    await mountLaunch();

    expect(screen.getByText("כשרות")).toBeInTheDocument();
    expect(screen.getByText("KASHROOT")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-launch")).toBe("hold");
    expect(document.getElementById("root")).toHaveAttribute("aria-hidden", "true");
  });

  it("ends: the mark goes, and the app is left visible and readable", async () => {
    await mountLaunch();

    await waitFor(() => expect(screen.queryByText("KASHROOT")).not.toBeInTheDocument(), {
      timeout: 6000,
    });

    // The two ways a splash strands the app: a leftover opacity:0 rule, and a
    // leftover aria-hidden that leaves it invisible to a screen reader only.
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
    expect(document.getElementById("root")).not.toHaveAttribute("aria-hidden");
  });

  it("plays once per session — a reload inside the session goes straight to the app", async () => {
    const first = await mountLaunch();
    expect(screen.getByText("KASHROOT")).toBeInTheDocument();
    first.unmount();

    // A reload keeps session storage; only the module cache is rebuilt.
    await mountLaunch();
    expect(screen.queryByText("KASHROOT")).not.toBeInTheDocument();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
  });

  it("says nothing about waiting while the wait is still short", async () => {
    stallFonts();
    await mountLaunch();

    expect(screen.queryByText(STRINGS.he.launch.loading)).not.toBeInTheDocument();
  });

  it("explains the wait once it is long enough to look stuck", async () => {
    stallFonts();
    await mountLaunch();

    expect(
      await screen.findByText(STRINGS.he.launch.loading, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
    // Still the mark, never a spinner — the design is explicit about this.
    expect(screen.getByText("KASHROOT")).toBeInTheDocument();
  });

  it("ends anyway if readiness never resolves, rather than holding the app for ever", async () => {
    stallFonts();
    await mountLaunch();

    await waitFor(() => expect(screen.queryByText("KASHROOT")).not.toBeInTheDocument(), {
      timeout: 12000,
    });
    expect(document.getElementById("root")).not.toHaveAttribute("aria-hidden");
  });

  it("keeps the Hebrew lockup in the English UI — it is the mark, not UI copy", async () => {
    localStorage.setItem("kashroot.lang", "en");
    stallFonts();
    await mountLaunch();

    expect(screen.getByText("כשרות")).toBeInTheDocument();
    expect(
      await screen.findByText(STRINGS.en.launch.loading, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  });
});
