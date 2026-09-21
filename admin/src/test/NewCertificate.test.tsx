import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type { CertificateOut, CertifierOption, Page, RestaurantDetail } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { clearCertifierOptionsCache } from "../hooks/useCertifierOptions";
import { NewCertificate } from "../views/NewCertificate";

const ACTIVE_CERTIFIER = "33333333-3333-3333-3333-333333333333";

const certifiers: CertifierOption[] = [
  {
    id: ACTIVE_CERTIFIER,
    slug: "badatz-eda",
    name_he: "בד״ץ העדה החרדית",
    name_en: "Eda HaChareidis",
    type: "badatz",
    is_active: true,
  },
];

/** Two branches of the same chain — the picker exists to tell them apart. */
const branchA: RestaurantDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  name_he: "מסעדת הכשרה",
  name_en: "The Kosher Place",
  branch_label: "הרצל",
  address_he: "רחוב הרצל 1",
  address_en: null,
  city_he: "ירושלים",
  city_en: null,
  city_slug: "jerusalem",
  neighborhood_he: null,
  phone: "02-1234567",
  website: null,
  menu_url: null,
  business_type_he: "מסעדה",
  diet_type: "meat",
  price_level: 2,
  amenities: {},
  status: "open",
  record_state: "list_verified",
  needs_review: false,
  corroboration_count: 1,
  notes: null,
  dedupe_key: "מסעדת הכשרה|ירושלים|רחוב הרצל 1",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  certificates: [],
};

const branchB: RestaurantDetail = {
  ...branchA,
  id: "55555555-5555-5555-5555-555555555555",
  branch_label: "יפו",
  address_he: "רחוב יפו 5",
  record_state: "moderator_verified",
  dedupe_key: "מסעדת הכשרה|ירושלים|רחוב יפו 5",
};

/** What the server stamps on the way back — never anything the client sent. */
const createdCertificate: CertificateOut = {
  id: "22222222-2222-2222-2222-222222222222",
  restaurant_id: branchA.id,
  certifier_id: ACTIVE_CERTIFIER,
  certifier: { name_he: "בד״ץ העדה החרדית", name_en: "Eda HaChareidis" },
  level: "unknown",
  attributes: {},
  valid_from: null,
  valid_until: null,
  state: "active",
  source: "moderator_verified",
  source_document_id: null,
  evidence_photo_key: null,
  verified_by_label: "moderator:dev-moderator",
  verified_at: "2026-09-01T09:00:00Z",
  corroboration_count: 1,
  notes: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function restaurantPage(): Page<RestaurantDetail> {
  return { total: 2, limit: 50, offset: 0, items: [branchA, branchB] };
}

function certifierPage(): Page<CertifierOption> {
  return { total: certifiers.length, limit: 200, offset: 0, items: certifiers };
}

let fetchMock: ReturnType<typeof vi.fn>;

function calls(): Array<[string, RequestInit]> {
  return fetchMock.mock.calls as Array<[string, RequestInit]>;
}

function urls(): string[] {
  return calls().map((call) => decodeURIComponent(String(call[0])));
}

function postCalls(): Array<[string, RequestInit]> {
  return calls().filter((call) => call[1]?.method === "POST");
}

function renderScreen() {
  return render(
    <ToastProvider>
      <NewCertificate />
    </ToastProvider>,
  );
}

/** Type a query and submit it — the screen fetches nothing before this happens. */
async function search(user: ReturnType<typeof userEvent.setup>, q = "הכשרה") {
  await user.type(screen.getByLabelText(/חיפוש מסעדה/), q);
  await user.click(screen.getByRole("button", { name: "חיפוש" }));

  return screen.findByRole("table");
}

/** Pick the branch whose row carries `branchLabel`. */
async function pick(user: ReturnType<typeof userEvent.setup>, branchLabel: string) {
  const table = await screen.findByRole("table");
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => candidate.textContent?.includes(branchLabel));
  if (!row) throw new Error(`no result row for branch ${branchLabel}`);
  await user.click(within(row).getByRole("button", { name: "בחירה" }));

  return screen.findByRole("button", { name: "הוספת התעודה…" });
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByLabelText(/^גוף כשרות$/)).toBeEnabled());
  await user.selectOptions(screen.getByLabelText(/^גוף כשרות$/), ACTIVE_CERTIFIER);
  await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "active");
  await user.click(screen.getByRole("button", { name: "הוספת התעודה…" }));
  const dialog = await screen.findByRole("dialog");
  fetchMock.mockResolvedValueOnce(jsonResponse(201, createdCertificate));
  await user.click(within(dialog).getByRole("button", { name: "הוספת התעודה" }));
}

describe("Adding a certificate from the standalone screen", () => {
  beforeEach(() => {
    setToken("test-token");
    clearCertifierOptionsCache();
    fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).startsWith("/api/admin/certifiers")
          ? jsonResponse(200, certifierPage())
          : jsonResponse(200, restaurantPage()),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches nothing on mount, and refuses to search on an empty query", async () => {
    const user = userEvent.setup();
    renderScreen();

    // The whole restaurant table must not load because a moderator opened the
    // screen: this view searches, it does not browse.
    expect(await screen.findByText(/עד אז לא נטענות רשומות/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "חיפוש" })).toBeDisabled();

    await user.type(screen.getByLabelText(/חיפוש מסעדה/), "  ");
    expect(screen.getByRole("button", { name: "חיפוש" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches on submit and shows enough to disambiguate two branches", async () => {
    const user = userEvent.setup();
    renderScreen();
    const table = await search(user);

    expect(urls().some((url) => url.includes("/api/admin/restaurants?q=הכשרה"))).toBe(true);
    const rows = within(table).getAllByRole("row");
    // Name, city, address and record state — the columns that tell branches apart.
    expect(rows[1]).toHaveTextContent("הרצל");
    expect(rows[1]).toHaveTextContent("ירושלים");
    expect(rows[1]).toHaveTextContent("רחוב הרצל 1");
    expect(rows[1]).toHaveTextContent("אומת מול רשימה רשמית");
    expect(rows[2]).toHaveTextContent("רחוב יפו 5");
    expect(rows[2]).toHaveTextContent("אומת בידי מודרטור");

    // Still nothing certifier-shaped: the form has not been asked for yet.
    expect(urls().some((url) => url.includes("/api/admin/certifiers"))).toBe(false);
  });

  it("reveals the shared certificate form only once a restaurant is picked", async () => {
    const user = userEvent.setup();
    renderScreen();
    await search(user);

    expect(screen.queryByRole("button", { name: "הוספת התעודה…" })).not.toBeInTheDocument();

    await pick(user, "הרצל");

    expect(screen.getByText("הוספת תעודה לרשומה הזו")).toBeInTheDocument();
    // The results table gives way to the chosen record.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירת מסעדה אחרת" })).toBeInTheDocument();
    await waitFor(() =>
      expect(urls().some((url) => url.includes("/api/admin/certifiers"))).toBe(true),
    );
  });

  it("posts to the picked restaurant's certificates path", async () => {
    const user = userEvent.setup();
    renderScreen();
    await search(user);
    await pick(user, "הרצל");
    await fillAndSubmit(user);

    await waitFor(() => expect(postCalls().length).toBe(1));
    const [url, init] = postCalls()[0] ?? [];
    expect(url).toBe(`/api/admin/restaurants/${branchA.id}/certificates`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // The restaurant is the path, never a body field.
    expect(body).not.toHaveProperty("restaurant_id");
    expect(body.certifier_id).toBe(ACTIVE_CERTIFIER);
  });

  it("keeps the moderator on the same restaurant after a success", async () => {
    const user = userEvent.setup();
    renderScreen();
    await search(user);
    await pick(user, "הרצל");
    await fillAndSubmit(user);

    expect(await screen.findByText(/התעודה נוספה ותועדה/)).toBeInTheDocument();
    // Still on this record, with the server's certificate listed on it.
    expect(screen.getByRole("button", { name: "בחירת מסעדה אחרת" })).toBeInTheDocument();
    expect(screen.queryByText(/אין תעודות ברשומה זו/)).not.toBeInTheDocument();
    expect(screen.getByText(/בד״ץ העדה החרדית/)).toBeInTheDocument();

    // And a blank form is one click away, rather than the screen resetting itself.
    await user.click(screen.getByRole("button", { name: "הוספת תעודה למסעדה זו" }));
    const state = await screen.findByLabelText(/^מצב התעודה$/);
    expect(state).toHaveValue("");
  });

  it("lets the moderator swap to the other branch and posts to that one", async () => {
    const user = userEvent.setup();
    renderScreen();
    await search(user);
    await pick(user, "הרצל");

    await user.click(screen.getByRole("button", { name: "בחירת מסעדה אחרת" }));
    // The search is preserved — correcting a branch must not mean retyping.
    await pick(user, "יפו");
    await fillAndSubmit(user);

    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(postCalls()[0]?.[0]).toBe(`/api/admin/restaurants/${branchB.id}/certificates`);
  });

  it("surfaces a failed search with a retry rather than an empty screen", async () => {
    const user = userEvent.setup();
    renderScreen();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: "המאגר אינו זמין" }));
    await user.type(screen.getByLabelText(/חיפוש מסעדה/), "הכשרה");
    await user.click(screen.getByRole("button", { name: "חיפוש" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/המאגר אינו זמין/);
    await user.click(screen.getByRole("button", { name: "נסה שוב" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
