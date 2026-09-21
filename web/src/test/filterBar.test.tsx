/**
 * The filter bar: chips, their popovers and the sheet — one state, three views.
 *
 * jsdom does no layout, so these pin down the interaction contract rather than the
 * look: a chip applies as it is tapped, a single choice closes its popover and a
 * multi choice summarises itself, and the sheet stages everything until applied.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilterBar } from "../components/filters/FilterBar";
import {
  DEFAULT_FILTERS,
  normalizeFilters,
  toSearchFilters,
  type FilterState,
} from "../filters/model";
import type { FilterId } from "../filters/registry";
import { useFilters } from "../filters/useFilters";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";

const he = STRINGS.he;
const KEY = "kashroot.filters.v2";

function StateProbe() {
  const { filters } = useFilters();
  return <output data-testid="state">{JSON.stringify(filters)}</output>;
}

const stored = (): FilterState =>
  JSON.parse(screen.getByTestId("state").textContent ?? "{}") as FilterState;

function renderBar(props: { exclude?: FilterId[]; chips?: FilterId[] } = {}) {
  return render(
    <I18nProvider>
      <ProfileProvider>
        <div className="shell">
          <FilterBar {...props} />
          <StateProbe />
        </div>
      </ProfileProvider>
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("filter bar", () => {
  it("draws three chips, and leaves the rest to the sliders button", () => {
    const { container } = renderBar();
    const row = container.querySelector<HTMLElement>(".fbar__chips");
    expect(row).not.toBeNull();

    // Exactly the three worth a chip, in the bar's own order.
    const chips = within(row as HTMLElement).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      he.filters.kashrut,
      he.filters.diet,
      he.filters.openNow,
    ]);
    // The other two are reachable, but not from the row.
    expect(screen.queryByRole("button", { name: he.filters.radius })).toBeNull();
    expect(screen.queryByRole("button", { name: he.filters.rating })).toBeNull();
    expect(row?.contains(screen.getByRole("button", { name: he.home.openFilters }))).toBe(false);

    // Every chip leads with an icon; only the ones that open options carry a chevron.
    for (const chip of chips) expect(chip.querySelector("svg")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: he.filters.openNow }).querySelector(".fchip__chevron"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: he.filters.diet }).querySelector(".fchip__chevron"),
    ).not.toBeNull();
  });

  /**
   * jsdom does no layout, so the row's one structural promise is asserted against the
   * stylesheet itself. A row that scrolled or wrapped would put a filter off the edge
   * or onto a second line, which is the thing a three-chip bar exists to prevent.
   */
  it("declares a row that neither scrolls nor wraps", () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles.css"),
      "utf8",
    );
    const start = css.indexOf(".fbar__chips {");
    expect(start, "no rule for .fbar__chips").toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule).not.toMatch(/overflow/);
  });

  /**
   * The row spans the same width as the search bar above it and the tab bar below:
   * all three hang off the one gutter token, and the chips grow to reach the far edge.
   * Asserted against the stylesheet for the same reason as above — jsdom cannot measure.
   */
  it("spans the same width as the search bar and the tab bar", () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles.css"),
      "utf8",
    );
    const ruleFor = (selector: string) => {
      const start = css.indexOf(selector + " {");
      expect(start, "no rule for " + selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(ruleFor(".fbar")).toMatch(/padding-inline:\s*var\(--gutter\)/);
    expect(ruleFor(".tabbar")).toMatch(/inset-inline:\s*var\(--gutter\)/);
    expect(ruleFor(".fchip")).toMatch(/flex:\s*1 1 auto/);
  });

  it("counts the filters only the sheet draws, so one set there is never invisible", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_FILTERS, radiusKm: 3, minRating: 4 }));
    renderBar();

    // Neither has a chip to show it…
    expect(screen.queryByRole("button", { name: he.filters.radiusValue(3) })).toBeNull();
    // …so the sliders button is the only thing that can say the list is narrowed.
    const sliders = screen.getByRole("button", { name: he.home.filtersActive });
    expect(sliders).toHaveTextContent("2");

    await user.click(sliders);
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    expect(
      within(sheet).getByRole("button", { name: he.filters.radiusValue(3) }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(sheet).getByRole("button", { name: he.filters.ratingValue(4) }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles open-now in place, and the sliders button counts it", async () => {
    const user = userEvent.setup();
    renderBar();

    const chip = screen.getByRole("button", { name: he.filters.openNow });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(stored().openNow).toBe(true);
    expect(screen.getByRole("button", { name: he.home.filtersActive })).toHaveTextContent("1");
  });

  it("multi-selects food types, keeps the popover open, and summarises the chip", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: he.filters.diet }));
    const popover = screen.getByRole("dialog", { name: he.filters.diet });

    await user.click(within(popover).getByRole("button", { name: he.diet.meat }));
    // One pick names itself on the chip…
    expect(screen.getByRole("button", { name: he.diet.meat, expanded: true })).toBeInTheDocument();

    await user.click(within(popover).getByRole("button", { name: he.diet.dairy }));
    // …two summarise, and the popover is still open for a third.
    expect(
      screen.getByRole("button", { name: he.filters.summary(he.filters.diet, 2) }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(stored().diets).toEqual(["meat", "dairy"]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Radius is sheet-only on the real bar, so it is put on a chip here: the
  // single-choice popover is the shape the next such filter will use.
  it("closes a single-choice popover on pick and shows the value on the chip", async () => {
    const user = userEvent.setup();
    renderBar({ chips: ["radius"] });

    await user.click(screen.getByRole("button", { name: he.filters.radius }));
    const popover = screen.getByRole("dialog", { name: he.filters.radius });
    expect(within(popover).getByRole("button", { name: he.filters.radiusValue(10) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(popover).getByRole("button", { name: he.filters.radiusValue(3) }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: he.filters.radiusValue(3) })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(stored().radiusKm).toBe(3);
  });

  it("clears a minimum rating when the same one is picked again", async () => {
    const user = userEvent.setup();
    renderBar({ chips: ["rating"] });

    await user.click(screen.getByRole("button", { name: he.filters.rating }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: he.filters.ratingValue(4) }),
    );
    expect(stored().minRating).toBe(4);

    await user.click(screen.getByRole("button", { name: he.filters.ratingValue(4) }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: he.filters.ratingValue(4) }),
    );
    expect(stored().minRating).toBeNull();
    expect(screen.getByRole("button", { name: he.filters.rating })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("lists certifiers alphabetically and narrows to several", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: he.filters.kashrut }));
    const popover = screen.getByRole("dialog", { name: he.filters.kashrut });
    const options = await within(popover).findAllByRole("button", { pressed: false });
    expect(options.length).toBeGreaterThan(1);

    const names = options.map((option) => option.textContent ?? "");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "he")));

    await user.click(options[0] as HTMLElement);
    await user.click(options[1] as HTMLElement);

    expect(stored().certifierIds).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: he.filters.summary(he.filters.kashrut, 2) }),
    ).toBeInTheDocument();
  });
});

describe("filter sheet", () => {
  it("stages its changes until they are applied", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: he.home.openFilters }));
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    await user.click(within(sheet).getByRole("button", { name: he.diet.dairy }));
    await user.click(within(sheet).getByRole("switch", { name: he.filters.openNow }));

    // Nothing has reached the bar yet.
    expect(stored()).toEqual(DEFAULT_FILTERS);

    await user.click(within(sheet).getByRole("button", { name: he.filters.apply }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored()).toMatchObject({ diets: ["dairy"], openNow: true });
    expect(screen.getByRole("button", { name: he.diet.dairy })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: he.filters.openNow })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("throws the draft away when it is closed", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: he.home.openFilters }));
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    await user.click(within(sheet).getByRole("button", { name: he.diet.dairy }));
    await user.click(within(sheet).getByRole("button", { name: he.filters.close }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored().diets).toEqual([]);
    expect(screen.getByRole("button", { name: he.filters.diet })).toBeInTheDocument();
  });

  it("clears every filter in one action", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...DEFAULT_FILTERS, diets: ["meat"], openNow: true, minRating: 4 }),
    );
    renderBar();

    await user.click(screen.getByRole("button", { name: he.home.filtersActive }));
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    const clearAll = within(sheet).getByRole("button", { name: he.filters.clearAll });
    await user.click(clearAll);
    expect(clearAll).toBeDisabled();

    await user.click(within(sheet).getByRole("button", { name: he.filters.apply }));

    expect(stored()).toEqual(DEFAULT_FILTERS);
    expect(screen.getByRole("button", { name: he.home.openFilters })).toBeInTheDocument();
  });

  // `exclude` is the stronger word: a screen that cannot answer a filter loses it
  // from the sheet as well, even when something asks for it as a chip.
  it("leaves an excluded filter out of both the bar and the sheet", async () => {
    const user = userEvent.setup();
    renderBar({ exclude: ["radius"], chips: ["radius", "diet"] });

    expect(screen.queryByRole("button", { name: he.filters.radius })).toBeNull();

    await user.click(screen.getByRole("button", { name: he.home.openFilters }));
    const sheet = screen.getByRole("dialog", { name: he.filters.title });
    expect(within(sheet).queryByRole("heading", { name: he.filters.radius })).toBeNull();
    expect(within(sheet).getByRole("heading", { name: he.filters.diet })).toBeInTheDocument();
  });
});

describe("filter state model", () => {
  it("sends no facets at all while every filter is at its default", () => {
    expect(toSearchFilters(DEFAULT_FILTERS)).toBeUndefined();
  });

  it("maps the state onto the API's facets, sorted, and never the radius", () => {
    expect(
      toSearchFilters({
        certifierIds: ["b", "a"],
        openNow: true,
        radiusKm: 3,
        diets: ["fish", "dairy"],
        minRating: 4.5,
      }),
    ).toEqual({
      certifier_ids: ["a", "b"],
      open_now: true,
      diet_types: ["dairy", "fish"],
      min_rating: 4.5,
    });
  });

  it("falls back to the default for anything it does not recognise", () => {
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(
      normalizeFilters({
        certifierIds: ["a", 3, "a"],
        openNow: "yes",
        radiusKm: 12,
        diets: ["dairy", "mixed", "soup"],
        minRating: 5,
      }),
    ).toEqual({ certifierIds: ["a"], openNow: false, radiusKm: 10, diets: ["dairy"], minRating: null });
  });
});
