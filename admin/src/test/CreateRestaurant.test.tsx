import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type { Page, RestaurantDetail } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Restaurants } from "../views/Restaurants";

const existing: RestaurantDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  name_he: "מסעדה קיימת",
  name_en: "The Existing Place",
  branch_label: null,
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
  dedupe_key: "מסעדה קיימת|ירושלים|רחוב הרצל 1",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  certificates: [],
};

const created: RestaurantDetail = {
  ...existing,
  id: "99999999-9999-9999-9999-999999999999",
  name_he: "מסעדה חדשה",
  name_en: "The Brand New Place",
  address_he: "רחוב יפו 5",
  record_state: "unknown_pending_verification",
  needs_review: true,
  dedupe_key: "מסעדה חדשה|ירושלים|רחוב יפו 5",
};

function pageOf(items: RestaurantDetail[]): Page<RestaurantDetail> {
  return { total: items.length, limit: 50, offset: 0, items };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function postCalls(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    (call) => call[1]?.method === "POST",
  );
}

function lastPostBody(): Record<string, unknown> {
  const call = postCalls()[postCalls().length - 1];
  if (!call) throw new Error("no POST request was sent");

  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

function getCallCount(): number {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    (call) => (call[1]?.method ?? "GET") === "GET",
  ).length;
}

/** Open the create panel and hand back its submit button. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/The Existing Place/);
  await user.click(screen.getByRole("button", { name: "הוספת מסעדה" }));

  return screen.findByRole("button", { name: "יצירת המסעדה" });
}

/** The minimum a create needs: a Hebrew name. */
async function fillName(user: ReturnType<typeof userEvent.setup>, value = "מסעדה חדשה") {
  await user.type(screen.getByLabelText(/^שם \(עברית\)$/), value);
}

describe("Creating a restaurant by hand", () => {
  beforeEach(() => {
    setToken("test-token");
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pageOf([existing])));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens and closes the create panel without touching the API", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const callsBefore = fetchMock.mock.calls.length;
    const submit = await openPanel(user);

    expect(submit).toBeInTheDocument();
    expect(screen.getByLabelText(/^שם \(עברית\)$/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "ביטול" }));

    expect(screen.queryByRole("button", { name: "יצירת המסעדה" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("POSTs the create body with the defaults the server expects", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    await user.type(screen.getByLabelText(/^עיר \(עברית\)$/), "ירושלים");
    await user.type(screen.getByLabelText(/מזהה עיר/), "jerusalem");
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(submit);

    await waitFor(() => {
      const [url, init] = postCalls()[0] ?? [];
      expect(url).toBe("/api/admin/restaurants");
      expect(init?.method).toBe("POST");
    });
    expect(lastPostBody()).toEqual({
      name_he: "מסעדה חדשה",
      city_he: "ירושלים",
      city_slug: "jerusalem",
      // Defaulted, not guessed: the checkbox starts ticked, status starts "open",
      // and an amenity nobody recorded is simply absent.
      status: "open",
      amenities: {},
      needs_review: true,
    });
  });

  it("sends needs_review: false when the review checkbox is unticked", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    await user.click(screen.getByLabelText(/שליחה לתור בדיקה/));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { ...created, needs_review: false }));
    await user.click(submit);

    await waitFor(() => expect(lastPostBody().needs_review).toBe(false));
  });

  it("omits an empty optional instead of sending null", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(submit);

    await waitFor(() => expect(lastPostBody().name_he).toBe("מסעדה חדשה"));
    const body = lastPostBody();
    // A null means "clear" in this console's PATCH semantics and has no meaning
    // on a row that does not exist yet.
    for (const field of ["name_en", "address_he", "city_slug", "phone", "notes", "note"]) {
      expect(body).not.toHaveProperty(field);
    }
    expect(Object.values(body)).not.toContain(null);
  });

  it("blocks a blank Hebrew name client-side and sends nothing", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);
    const callsBefore = fetchMock.mock.calls.length;

    await user.click(submit);

    expect(await screen.findByText(/שם \(עברית\) הוא שדה חובה/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("blocks a non-slug city id client-side and sends nothing", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    await user.type(screen.getByLabelText(/מזהה עיר/), "Tel Aviv");
    const callsBefore = fetchMock.mock.calls.length;
    await user.click(submit);

    expect(await screen.findByText(/חייב להיות אותיות לטיניות קטנות/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(screen.getByLabelText(/מזהה עיר/)).toHaveValue("Tel Aviv");
  });

  it("surfaces a 409 duplicate with the typed values preserved", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    await user.type(screen.getByLabelText(/^כתובת \(עברית\)$/), "רחוב יפו 5");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { detail: "dedupe key already taken" }),
    );
    await user.click(submit);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/dedupe key already taken/);
    expect(alert).toHaveTextContent(/כבר קיימת מסעדה/);
    expect(screen.getByLabelText(/^שם \(עברית\)$/)).toHaveValue("מסעדה חדשה");
    expect(screen.getByLabelText(/^כתובת \(עברית\)$/)).toHaveValue("רחוב יפו 5");
  });

  it("puts the created row at the top, already expanded, without refetching", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);
    const getsBefore = getCallCount();

    await fillName(user);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(submit);

    const table = await screen.findByRole("table");
    await waitFor(() =>
      expect(within(table).getByText(/The Brand New Place/)).toBeInTheDocument(),
    );
    const rows = within(table).getAllByRole("row");
    // [0] is the header row; the new record must lead the body.
    expect(rows[1]).toHaveTextContent(/The Brand New Place/);
    // Already expanded, so a certificate can be attached immediately.
    expect(await screen.findByRole("button", { name: "הוספת תעודה" })).toBeInTheDocument();
    // The row came back from the POST — nothing was re-read.
    expect(getCallCount()).toBe(getsBefore);
  });

  it("can never express a record state, a dedupe key or a kashrut fact", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openPanel(user);

    await fillName(user);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(submit);

    await waitFor(() => expect(postCalls().length).toBe(1));
    const body = lastPostBody();
    for (const forbidden of [
      "record_state",
      "dedupe_key",
      "corroboration_count",
      "certificates",
      "id",
      "geo",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });
});

function renderDirectory() {
  return render(
    <ToastProvider>
      <Restaurants />
    </ToastProvider>,
  );
}
