/**
 * Saved lists, end to end: create one from the plus, open it, share it, empty it.
 *
 * The shape of the feature is what is asserted here, because it is the part that
 * was wrong before: lists that expanded in place had no page of their own, so there
 * was nowhere for a name, a share action or a stable link to live. The index is a
 * shelf of cards; a card opens `/saved/:listId`; that page — and only that page —
 * shares.
 *
 * The pure helpers underneath get their own tests below: they are what keeps "remove
 * from this list" from quietly emptying another list holding the same restaurant.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import {
  countVerdicts,
  createList,
  hasDegraded,
  hasListNamed,
  listById,
  removePlace,
  removePlaceFromList,
  type SavedPlace,
  type SavedState,
} from "../saved/saved";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;

function renderApp(route = "/", city = "jerusalem") {
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

type User = ReturnType<typeof userEvent.setup>;

/** Onboarding, the shortest way through it, then the saved tab. */
async function openSaved(user: User) {
  await screen.findByText(he.presets.any.title);
  await user.click(screen.getByText(he.presets.any.title));
  await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/\d/));
  await user.click(screen.getByRole("link", { name: he.nav.saved }));
  await screen.findByRole("heading", { name: he.saved.title });
}

/** The new-list sheet, named and with one restaurant picked. */
async function createListNamed(user: User, name: string, pick?: string) {
  await user.click(screen.getAllByRole("button", { name: he.saved.newList })[0] as HTMLElement);
  const sheet = await screen.findByRole("dialog", { name: he.saved.create.title });
  await user.type(within(sheet).getByLabelText(he.saved.create.nameLabel), name);
  if (pick) {
    await user.type(
      within(sheet).getByRole("searchbox", { name: he.saved.picker.searchPlaceholder }),
      pick.slice(0, 3),
    );
    await user.click(await within(sheet).findByRole("checkbox", { name: new RegExp(pick) }));
  }
  return sheet;
}

describe("saved lists", () => {
  it("offers a plus and no share on the index — sharing belongs to a list", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    expect(screen.getAllByRole("button", { name: he.saved.newList }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: he.saved.share })).toBeNull();
    expect(screen.getByText(he.saved.empty.title)).toBeInTheDocument();
  });

  it("creates a named list with places picked in the sheet, and lands on its page", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    const sheet = await createListNamed(user, "טיול צפון", "נוגטין");
    expect(within(sheet).getByText(he.saved.create.selected(1))).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));

    // The list's own page: its name is the heading, and it is the screen that shares.
    expect(await screen.findByRole("heading", { name: "טיול צפון" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: he.saved.share })).toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: "נוגטין" })).not.toHaveLength(0);
    expect(localStorage.getItem("kashroot.saved.v1")).toContain("טיול צפון");
  });

  it("refuses a name already in use rather than making a second list with it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    let sheet = await createListNamed(user, "טיול צפון");
    await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));
    await screen.findByRole("heading", { name: "טיול צפון" });

    await user.click(screen.getByRole("button", { name: he.saved.back }));
    sheet = await createListNamed(user, "טיול צפון");
    expect(within(sheet).getByText(he.saved.create.nameTaken)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: he.saved.create.submit })).toBeDisabled();
  });

  /**
   * The index is a shelf: one card per list, and the card is a link. Places are on
   * the list's page — the index must not grow a copy of them.
   */
  it("opens a list from its card on the index", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    const sheet = await createListNamed(user, "טיול צפון", "נוגטין");
    await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));
    await screen.findByRole("heading", { name: "טיול צפון" });
    await user.click(screen.getByRole("button", { name: he.saved.back }));

    // Back on the index: the list is one card, and the restaurant it holds is not
    // printed here.
    expect(await screen.findByText("טיול צפון")).toBeInTheDocument();
    expect(screen.queryByText("נוגטין")).toBeNull();

    await user.click(screen.getByRole("link", { name: he.saved.openList("טיול צפון") }));
    expect(await screen.findByRole("heading", { name: "טיול צפון" })).toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: "נוגטין" })).not.toHaveLength(0);
  });

  /** The list's places are stacked rows, not the home screen's two-up grid. */
  it("lists places one per line rather than in a grid", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");
    await openSaved(user);

    const sheet = await createListNamed(user, "טיול צפון", "נוגטין");
    await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));
    await screen.findByRole("heading", { name: "טיול צפון" });

    await waitFor(() => expect(container.querySelector(".card--row")).not.toBeNull());
    expect(container.querySelector(".grid")).toBeNull();
    expect(container.querySelector(".card--grid")).toBeNull();
  });

  /**
   * The gap the create-sheet alone left: a list named last week has to be fillable
   * from the list itself, and a tick there is committed the moment it is made.
   */
  it("adds places to an existing list from the list's own page", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    const sheet = await createListNamed(user, "טיול צפון");
    await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));
    await screen.findByRole("heading", { name: "טיול צפון" });
    expect(screen.getByText(he.saved.listEmpty.title)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: he.saved.add.title("טיול צפון") }));
    const adder = await screen.findByRole("dialog", { name: he.saved.add.title("טיול צפון") });
    await user.type(
      within(adder).getByRole("searchbox", { name: he.saved.picker.searchPlaceholder }),
      "נוג",
    );
    const row = await within(adder).findByRole("checkbox", { name: /נוגטין/ });
    await user.click(row);
    // Committed on the tap: the row is ticked and the list behind the sheet has it.
    await waitFor(() => expect(row).toHaveAttribute("aria-checked", "true"));
    await user.click(within(adder).getByRole("button", { name: he.saved.add.done }));
    expect(await screen.findAllByRole("link", { name: "נוגטין" })).not.toHaveLength(0);

    // And ticking it again takes it back out.
    await user.click(screen.getByRole("button", { name: he.saved.add.title("טיול צפון") }));
    const again = await screen.findByRole("dialog", { name: he.saved.add.title("טיול צפון") });
    await user.type(
      within(again).getByRole("searchbox", { name: he.saved.picker.searchPlaceholder }),
      "נוג",
    );
    await user.click(await within(again).findByRole("checkbox", { name: /נוגטין/ }));
    await user.click(within(again).getByRole("button", { name: he.saved.add.done }));
    expect(await screen.findByText(he.saved.listEmpty.title)).toBeInTheDocument();
  });

  /** One list is not a question, so the heart does not ask one. */
  it("saves straight into the default list while there is nothing to choose between", async () => {
    const user = userEvent.setup();
    renderApp("/r/r-nougatine");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    await user.click(await screen.findByRole("button", { name: he.restaurant.save }));
    expect(screen.queryByRole("dialog", { name: he.saved.saveTo.title })).toBeNull();
    await waitFor(() =>
      expect(localStorage.getItem("kashroot.saved.v1")).toContain(he.saved.defaultList),
    );
  });

  /**
   * Two lists make the tap ambiguous, and guessing is the wrong answer: it would
   * drop every save into "Saved" while the named lists sit unused.
   */
  it("asks which list once there is more than one, and saves into the one picked", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openSaved(user);

    for (const name of ["טיול צפון", "עם ההורים"]) {
      const sheet = await createListNamed(user, name);
      await user.click(within(sheet).getByRole("button", { name: he.saved.create.submit }));
      await screen.findByRole("heading", { name });
      await user.click(screen.getByRole("button", { name: he.saved.back }));
    }

    await user.click(screen.getByRole("link", { name: he.nav.home }));
    const card = await screen.findAllByRole("link", { name: "נוגטין" });
    await user.click(card[0] as HTMLElement);

    await user.click(await screen.findByRole("button", { name: he.restaurant.save }));
    const picker = await screen.findByRole("dialog", { name: he.saved.saveTo.title });
    await user.click(within(picker).getByRole("checkbox", { name: /עם ההורים/ }));
    await user.click(within(picker).getByRole("button", { name: he.saved.add.done }));

    // The restaurant screen has no tab bar — back to the list, then to saved.
    await user.click(screen.getByRole("button", { name: he.states.back }));
    await user.click(await screen.findByRole("link", { name: he.nav.saved }));
    await user.click(await screen.findByRole("link", { name: he.saved.openList("עם ההורים") }));
    expect(await screen.findAllByRole("link", { name: "נוגטין" })).not.toHaveLength(0);

    // The other list is untouched — the pick was a choice, not a broadcast.
    await user.click(screen.getByRole("button", { name: he.saved.back }));
    await user.click(await screen.findByRole("link", { name: he.saved.openList("טיול צפון") }));
    expect(await screen.findByText(he.saved.listEmpty.title)).toBeInTheDocument();
  });

  it("says an unknown list id does not exist instead of showing an empty one", async () => {
    const user = userEvent.setup();
    renderApp("/saved/list-does-not-exist");

    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));

    expect(await screen.findByText(he.saved.notFound.title)).toBeInTheDocument();
  });
});

/* ── The pure list operations the screens are built on ────────────────────── */

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    restaurantId: "r-1",
    nameHe: "נוגטין",
    nameEn: null,
    cityHe: "ירושלים",
    dietType: null,
    verdictAtSave: "match",
    certifierLabel: null,
    savedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("saved list operations", () => {
  const empty: SavedState = { lists: [] };

  it("creates a list already holding its places, without duplicates", () => {
    const [state, list] = createList(empty, "טיול צפון", [place(), place(), place({ restaurantId: "r-2" })]);
    expect(list.places.map((p) => p.restaurantId)).toEqual(["r-1", "r-2"]);
    expect(listById(state, list.id)?.name).toBe("טיול צפון");
    expect(listById(state, "nope")).toBeNull();
  });

  it("compares names trimmed and case-insensitively", () => {
    const [state] = createList(empty, "Shabbat");
    expect(hasListNamed(state, " shabbat ")).toBe(true);
    expect(hasListNamed(state, "Sunday")).toBe(false);
  });

  /**
   * The distinction the two removals draw. The heart on a restaurant says "this is
   * not saved" and clears it everywhere; taking a place out of one list must leave
   * the other list that holds it untouched.
   */
  it("removes from one list without emptying another that holds the same place", () => {
    const [withFirst, first] = createList(empty, "א", [place()]);
    const [both, second] = createList(withFirst, "ב", [place()]);

    const afterList = removePlaceFromList(both, first.id, "r-1");
    expect(listById(afterList, first.id)?.places).toEqual([]);
    expect(listById(afterList, second.id)?.places).toHaveLength(1);

    const afterAll = removePlace(both, "r-1");
    expect(listById(afterAll, first.id)?.places).toEqual([]);
    expect(listById(afterAll, second.id)?.places).toEqual([]);
  });

  it("counts only the verdicts the API has actually answered with", () => {
    expect(countVerdicts(["match", "match", undefined, "unknown"])).toEqual({
      match: 2,
      unknown: 1,
      no_match: 0,
    });
  });

  /** Degradation is a comparison of two API answers — never a rule of our own. */
  it("flags a place that no longer matches, and only that", () => {
    expect(hasDegraded(place({ verdictAtSave: "match" }), "unknown")).toBe(true);
    expect(hasDegraded(place({ verdictAtSave: "match" }), "no_match")).toBe(true);
    expect(hasDegraded(place({ verdictAtSave: "match" }), "match")).toBe(false);
    // Saved as unverified and still unverified — nothing changed, nothing to say.
    expect(hasDegraded(place({ verdictAtSave: "unknown" }), "no_match")).toBe(false);
  });
});
