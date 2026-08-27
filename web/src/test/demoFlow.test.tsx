/**
 * The demo, walked end to end against the fixture server: preset → list → detail.
 *
 * Unit tests cover the pieces; this covers the wiring — routing, the onboarding
 * gate, profile persistence, and the fact that all three verdicts actually appear
 * on the data we plan to demo. If the Thursday script breaks, it breaks here first.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { STRINGS } from "../i18n/strings";
import { ThemeProvider } from "../theme/ThemeProvider";

function renderApp(route = "/", city = "jerusalem") {
  // The demo city is a live product decision, so tests name the one whose fixtures
  // they depend on instead of relying on whatever the default happens to be.
  localStorage.setItem("kashroot.city", city);
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

const he = STRINGS.he;

describe("demo flow", () => {
  it("sends a profileless visitor to onboarding rather than showing verdicts", async () => {
    renderApp("/");
    expect(await screen.findByText(he.onboarding.presetTitle)).toBeInTheDocument();
  });

  /**
   * The withdrawn "Local Rabbanut" preset. The corpus holds one Rabbanut, which does
   * not certify Jerusalem, so one tap from the opening screen produced a wall of red
   * that reads as "Jerusalem is not kosher" rather than "we hold no Jerusalem
   * Rabbanut data". A coverage decision, not a product opinion — see `PRESET_ORDER`.
   */
  it("does not offer the withdrawn Local Rabbanut preset", async () => {
    renderApp("/");
    await screen.findByText(he.presets.any.title);

    expect(screen.queryByText("רבנות מקומית")).toBeNull();
    expect(screen.queryByText("Local Rabbanut")).toBeNull();
    // The four that remain are all there — this is a removal, not a breakage.
    for (const preset of [he.presets.any, he.presets.mehadrin, he.presets.badatz, he.presets.custom])
      expect(screen.getByText(preset.title)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThanOrEqual(4);
  });

  it("walks preset → home list, and persists the profile", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // The list arrives with a headline that counts what was *checked*.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/\d/),
    );
    expect(localStorage.getItem("kashroot.profile.v2")).toContain("completedOnboarding");
  });

  it("shows all three verdicts on the demo data, so the script has something to point at", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await screen.findAllByText(new RegExp(he.verdict.match));
    // All three appear in the Jerusalem list under "any certification": a valid
    // certificate, a record with none, and a revoked one.
    expect(container.querySelectorAll(".verdict--match").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".verdict--unknown").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".verdict--no_match").length).toBeGreaterThan(0);
  });

  it("opens a fully-argued evidence panel on a MATCH", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // The home tile is one stretched anchor over the whole card, so the name is a
    // span inside it — the link is what gets clicked.
    const link = await screen.findAllByRole("link", { name: "מזנון הפסגה" });
    await user.click(link[0] as HTMLElement);

    const panel = await screen.findByLabelText(he.verdict.whyMatch);
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByText(he.restaurant.certificate)).toBeInTheDocument();
  });

  /**
   * A shared link is the only way most people meet this app, and it lands on a
   * device with no whitelist — so the gate sends it to onboarding. The link is only
   * worth sharing if onboarding then continues to the restaurant that was sent,
   * rather than dropping the visitor on home with the destination lost.
   */
  it("carries a shared restaurant link through onboarding instead of losing it", async () => {
    const user = userEvent.setup();
    renderApp("/r/r-hapisga");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    expect(await screen.findByText("מזנון הפסגה")).toBeInTheDocument();
    expect(await screen.findByLabelText(he.verdict.whyMatch)).toBeInTheDocument();

    // Back from a shared link goes to the list. What is behind it in history is
    // the onboarding it just completed, which is not a screen to return to.
    await user.click(screen.getByRole("button", { name: he.states.back }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/\d/),
    );
    expect(screen.queryByText(he.onboarding.presetTitle)).toBeNull();
  });

  /**
   * UNKNOWN has to arrive as considered as MATCH, not as a greyed-out version of it.
   * On the live corpus it comes from expiry, missing attributes, revocation and
   * unpublished levels rather than staleness; this walks the stale case because it
   * is the clearest, and the panel structure is identical whatever the cause.
   */
  it("argues an UNKNOWN as fully as a MATCH, and says what is actually missing", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // The home tile is one stretched anchor over the whole card, so the name is a
    // span inside it — the link is what gets clicked.
    const link = await screen.findAllByRole("link", { name: "קפה עלית" });
    await user.click(link[0] as HTMLElement);

    const panel = await screen.findByLabelText(he.verdict.whyUnknown);
    // It still shows what *is* established — the certifier is on your list —
    // alongside the thing that is missing.
    expect(within(panel).getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(panel.querySelector(".evidence__glyph--positive")).not.toBeNull();
    expect(panel.querySelector(".evidence__glyph--doubt")).not.toBeNull();
    // …and the closing paragraph names the cause rather than shrugging.
    expect(screen.getByText(he.verdict.followUp.evidence_stale)).toBeInTheDocument();
    // The certificate panel is present and complete, not suppressed.
    expect(screen.getByText(he.restaurant.certificate)).toBeInTheDocument();
  });

  /**
   * The demo-laptop failure: a profile persisted while the app ran on fixtures holds
   * certifier ids the live database has never seen, so every request 422s and the
   * app is stuck until storage is cleared by hand. Recovery must be silent.
   */
  it("discards a stored profile whose certifiers the server does not recognise", async () => {
    localStorage.setItem(
      "kashroot.profile.v2",
      JSON.stringify({
        version: 2,
        presetId: "any",
        whitelist: [{ certifier_id: "id-from-another-database", min_level: "regular" }],
        requiredAttributes: [],
        completedOnboarding: true,
      }),
    );
    renderApp("/");
    // Straight back to onboarding — no error screen, no retry loop.
    expect(await screen.findByText(he.onboarding.presetTitle)).toBeInTheDocument();
  });

  it("keeps a stored profile whose certifiers do resolve", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
    await screen.findByText(he.states.coverageNoteNearby);

    // Remount with the profile it just wrote: it survives.
    cleanup();
    renderApp("/");
    expect(await screen.findByText(he.states.coverageNoteNearby)).toBeInTheDocument();
  });

  /**
   * No maps key is configured in test (or on a fresh clone), which is precisely the
   * state the fallback exists for. The map screen must degrade to the design's
   * striped placeholder with an explanation and a way out — never a grey rectangle.
   */
  it("falls back to an explained placeholder when there is no maps key", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await user.click(await screen.findByRole("link", { name: he.nav.map }));

    expect(await screen.findByText(he.map.unavailableTitle)).toBeInTheDocument();
    expect(screen.getByText(he.map.unavailableNoKey)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.map.toList })).toBeInTheDocument();
  });

  it("tells the user the list is partial rather than implying it is everything", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    expect(await screen.findByText(he.states.coverageNoteNearby)).toBeInTheDocument();
  });

  /**
   * Home's grid tiles carry Layer 1 only. At half a row card's width there is
   * nowhere for a Fit Score to sit except beside the verdict pill, so it is not
   * drawn here at all — and that is asserted rather than assumed, because "we left
   * it out" stays true only until someone adds it back without a `.fit-row`.
   */
  it("shows the verdict but no Fit Score on the home tiles", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await waitFor(() => expect(container.querySelector(".card--grid")).not.toBeNull());

    const tiles = [...container.querySelectorAll(".card--grid")];
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.querySelector(".verdict")).not.toBeNull();
      expect(tile.querySelector(".fit")).toBeNull();
    }
    expect(container.querySelector(".fit")).toBeNull();
  });

  /**
   * The sliders button opens the soft filters, not the profile — the two are
   * different powers and must not be reachable through the same control. Filters
   * narrow which restaurants get asked about; the profile decides what the answer
   * is. Nothing on the filters screen can hide, sort or soften a verdict, which is
   * why it renders no verdict pill at all.
   */
  it("opens the soft filters from home, and keeps kashrut out of them", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await user.click(await screen.findByRole("button", { name: he.home.openFilters }));
    expect(await screen.findByText(he.filters.title)).toBeInTheDocument();
    // Kashrut is named here only to say it is not one of these controls.
    expect(screen.getByText(he.filters.kashrutTitle)).toBeInTheDocument();
    expect(container.querySelector(".verdict")).toBeNull();

    // A kitchen picked here is the one home shows as picked — one state, two views.
    await user.click(screen.getByRole("button", { name: he.diet.dairy, pressed: false }));
    await user.click(screen.getByRole("button", { name: he.filters.apply }));

    expect(await screen.findByRole("button", { name: he.home.tabs.dairy })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // …and home says so without being asked, so a narrowed list is never read as an
    // empty corpus.
    expect(screen.getByRole("button", { name: he.home.filtersActive })).toBeInTheDocument();
  });

  /**
   * The search grid was the hole: `VerdictPill` and `FitScoreBar` were DOM siblings
   * in `.card__tile-foot`, and the only thing keeping a kashrut verdict from sitting
   * beside a preference score — reading as one blended metric — was
   * `flex-direction: column` in a stylesheet no test could see. jsdom does no
   * layout, so the markup now carries the separation itself: the fit score lives in
   * a `.fit-row` of its own, which is asserted here rather than assumed.
   */
  it("keeps the two layers separate on the search tiles too, not only the home rows", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // Search is reached from home's search field now, not from a tab of its own.
    await user.click(await screen.findByRole("button", { name: he.nav.search }));
    await waitFor(() => expect(container.querySelector(".card--tile")).not.toBeNull());

    // The tiles really do show both layers — otherwise the assertions below pass
    // by rendering neither.
    const tiles = [...container.querySelectorAll(".card--tile")];
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.querySelector(".verdict")).not.toBeNull();
      expect(tile.querySelector(".fit")).not.toBeNull();
    }
    expectLayersSeparated(container, ".card--tile");
  });

  it("keeps them separate on the restaurant screen, where the verdict is largest", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    // The home tile is one stretched anchor over the whole card, so the name is a
    // span inside it — the link is what gets clicked.
    const link = await screen.findAllByRole("link", { name: "מזנון הפסגה" });
    await user.click(link[0] as HTMLElement);
    await screen.findByLabelText(he.verdict.whyMatch);

    expect(container.querySelector(".fit")).not.toBeNull();
    expectLayersSeparated(container, ".hero");
  });

  it("flips direction and language from the profile screen without a second tree", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await user.click(await screen.findByRole("link", { name: he.nav.profile }));
    expect(document.documentElement.dir).toBe("rtl");

    await user.click(await screen.findByRole("button", { name: "English" }));
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText(STRINGS.en.profile.title)).toBeInTheDocument();
  });
});

/**
 * The invariant, asserted structurally so it holds in jsdom, which computes no
 * layout at all:
 *
 *   1. every fit score sits inside a `.fit-row` container of its own;
 *   2. no `.fit-row` contains a verdict pill;
 *   3. no element has a verdict pill and a fit score among its children — they are
 *      never siblings, so no flex or grid change can line them up as one metric;
 *   4. the fit score never borrows a verdict colour class.
 *
 * `present` names a selector that must actually be on screen, so a test cannot pass
 * because the surface under examination failed to render.
 */
function expectLayersSeparated(container: HTMLElement, present: string) {
  expect(container.querySelector(present), `${present} did not render`).not.toBeNull();

  const fits = [...container.querySelectorAll(".fit")];
  expect(fits.length).toBeGreaterThan(0);
  for (const fit of fits) {
    const row = fit.closest(".fit-row");
    expect(row, "a fit score rendered outside a .fit-row container").not.toBeNull();
    expect(row?.querySelector(".verdict")).toBeNull();
    expect(fit.className).not.toMatch(/verdict/);
  }

  for (const verdict of container.querySelectorAll(".verdict")) {
    const siblings = [...(verdict.parentElement?.children ?? [])];
    expect(
      siblings.some((node) => node.classList.contains("fit") || node.querySelector(".fit")),
      "a verdict pill and a fit score share a parent and could be laid out as one row",
    ).toBe(false);
  }
}

/**
 * Belt to the markup's braces. The stylesheet still does the visual work, and these
 * two declarations are the ones that keep Layer 2 on its own line inside the search
 * tile. They were previously untested — flipping `flex-direction` alone used to put
 * the verdict and the fit score side by side with every test still green.
 */
describe("the stylesheet declarations the separation leans on", () => {
  const css = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles.css"),
    "utf8",
  );

  function block(selector: string): string {
    const start = css.indexOf(selector + " {");
    expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it("stacks the search tile's foot rather than lining it up", () => {
    const rule = block(".card--tile .card__tile-foot");
    expect(rule).toMatch(/flex-direction:\s*column/);
    // …and even under `row` the fit row would wrap onto a line of its own.
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
  });

  it("gives the fit row a whole line inside any card", () => {
    expect(block(".fit-row")).toMatch(/width:\s*100%/);
    expect(block(".card .fit-row")).toMatch(/flex:\s*0 0 100%/);
  });
});
