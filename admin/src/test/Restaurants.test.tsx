import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type { CertificateOut, Page, RestaurantDetail } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Restaurants } from "../views/Restaurants";

const certificate: CertificateOut = {
  id: "22222222-2222-2222-2222-222222222222",
  restaurant_id: "11111111-1111-1111-1111-111111111111",
  certifier_id: "33333333-3333-3333-3333-333333333333",
  certifier: { name_he: "הרבנות ירושלים", name_en: "Jerusalem Rabbanut" },
  level: "mehadrin",
  attributes: { glatt: true },
  valid_from: "2026-01-01",
  valid_until: "2026-12-31",
  state: "active",
  source: "official_list",
  source_document_id: null,
  evidence_photo_key: null,
  verified_by_label: null,
  verified_at: null,
  corroboration_count: 1,
  notes: null,
};

const restaurant: RestaurantDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  name_he: "מסעדת הכשרה",
  name_en: "The Kosher Place",
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
  amenities: { parking: true },
  status: "open",
  record_state: "list_verified",
  needs_review: false,
  corroboration_count: 1,
  notes: null,
  dedupe_key: "מסעדת הכשרה|ירושלים|רחוב הרצל 1",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  certificates: [certificate],
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

function renderDirectory() {
  return render(
    <ToastProvider>
      <Restaurants />
    </ToastProvider>,
  );
}

/** Open the row's editor and hand back the expanded detail cell. */
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/The Kosher Place/);
  await user.click(screen.getByText(/The Kosher Place/));

  return screen.findByRole("button", { name: /שמירת שינויים/ });
}

function lastCall(): [string, RequestInit] {
  const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("no fetch call recorded");
  return call;
}

function lastPatchBody(): Record<string, unknown> {
  const calls = (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    (call) => call[1]?.method === "PATCH",
  );
  const call = calls[calls.length - 1];
  if (!call) throw new Error("no PATCH request was sent");
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

describe("Restaurant directory", () => {
  beforeEach(() => {
    setToken("test-token");
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pageOf([restaurant])));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists every restaurant, not just the ones sitting in a queue", async () => {
    renderDirectory();

    await screen.findByText(/The Kosher Place/);
    const [url] = lastCall();
    expect(url).toContain("/api/admin/restaurants");
    expect(url).not.toContain("/queues/");
    expect(screen.getByText("02-1234567")).toBeInTheDocument();
  });

  it("sends the search and status filters to the API", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await screen.findByText(/The Kosher Place/);

    await user.type(screen.getByPlaceholderText(/שם, כתובת או עיר/), "הזהב");
    await user.selectOptions(screen.getByLabelText(/^סטטוס$/), "closed_perm");

    await waitFor(() => {
      const url = String(lastCall()[0]);
      expect(url).toContain("status=closed_perm");
      expect(decodeURIComponent(url)).toContain("q=הזהב");
    });
  });

  it("opens an editor prefilled from the record, with saving disabled until something changes", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    expect(save).toBeDisabled();
    expect(screen.getByLabelText(/^שם \(אנגלית\)$/)).toHaveValue("The Kosher Place");
    expect(screen.getByLabelText(/מזהה עיר/)).toHaveValue("jerusalem");
    expect(screen.getByText(/אין שינויים/)).toBeInTheDocument();
  });

  it("PATCHes only the fields that actually changed", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    await user.clear(screen.getByLabelText(/^טלפון$/));
    await user.type(screen.getByLabelText(/^טלפון$/), "02-7654321");
    await user.type(screen.getByLabelText(/סיבת העריכה/), "owner called");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...restaurant, phone: "02-7654321" }),
    );
    await user.click(save);

    await waitFor(() => expect(lastPatchBody()).toEqual({ phone: "02-7654321", note: "owner called" }));
    expect(await screen.findByText(/נשמר ותועד/)).toBeInTheDocument();
    expect(await screen.findByText("02-7654321")).toBeInTheDocument();
  });

  it("clears an optional field with an explicit null", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    await user.clear(screen.getByLabelText(/^שם \(אנגלית\)$/));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...restaurant, name_en: null }));
    await user.click(save);

    await waitFor(() => expect(lastPatchBody().name_en).toBeNull());
  });

  it("refuses to blank the Hebrew name client-side, and sends nothing", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);
    const callsBefore = fetchMock.mock.calls.length;

    await user.clear(screen.getByLabelText(/^שם \(עברית\)$/));
    await user.click(save);

    expect(await screen.findByText(/שם \(עברית\) הוא שדה חובה/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("records an amenity as a tri-state and never guesses an unrecorded one", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    expect(screen.getByLabelText(/^חניה$/)).toHaveValue("true");
    expect(screen.getByLabelText(/^משלוחים$/)).toHaveValue("");

    await user.selectOptions(screen.getByLabelText(/^משלוחים$/), "false");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, restaurant));
    await user.click(save);

    await waitFor(() =>
      expect(lastPatchBody().amenities).toEqual({ parking: true, delivery: false }),
    );
  });

  it("shows certificates as read-only context and can never submit a kashrut field", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    expect(screen.getByText(/תעודות — לקריאה בלבד כאן/)).toBeInTheDocument();
    expect(screen.getByText(/עובדות כשרות לעולם אינן נערכות מתוך המדריך/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/גלאט/)).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^טלפון$/));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...restaurant, phone: null }));
    await user.click(save);

    await waitFor(() => {
      const body = lastPatchBody();
      for (const forbidden of [
        "certificates",
        "attributes",
        "state",
        "record_state",
        "needs_review",
        "corroboration_count",
        "dedupe_key",
      ]) {
        expect(body).not.toHaveProperty(forbidden);
      }
    });
  });

  it("surfaces the API error detail and keeps the edit on screen", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    await user.clear(screen.getByLabelText(/מזהה עיר/));
    await user.type(screen.getByLabelText(/מזהה עיר/), "Tel Aviv");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ["body", "city_slug"], msg: "must be a slug" }] }),
    );
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be a slug/i);
    expect(screen.getByLabelText(/מזהה עיר/)).toHaveValue("Tel Aviv");
  });

  it("discards local edits without touching the API", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);
    const callsBefore = fetchMock.mock.calls.length;

    await user.type(screen.getByLabelText(/^שם \(אנגלית\)$/), " Extra");
    expect(save).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /ביטול שינויים/ }));

    expect(screen.getByLabelText(/^שם \(אנגלית\)$/)).toHaveValue("The Kosher Place");
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("keeps the row and the database in step by rendering the server's response", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const save = await openEditor(user);

    await user.clear(screen.getByLabelText(/^שם \(אנגלית\)$/));
    await user.type(screen.getByLabelText(/^שם \(אנגלית\)$/), "Client Guess");
    // The server normalizes/decides; the row must show what came back, not the guess.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...restaurant, name_en: "Server Truth" }),
    );
    await user.click(save);

    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText(/Server Truth/)).toBeInTheDocument());
    expect(within(table).queryByText(/Client Guess/)).not.toBeInTheDocument();
  });
});
