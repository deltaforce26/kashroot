import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type { CertificateOut, FlagOut, Page, RestaurantBrief } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Flags } from "../views/Flags";

const restaurant: RestaurantBrief = {
  id: "11111111-1111-1111-1111-111111111111",
  name_he: "מסעדת הכשרה",
  name_en: "The Kosher Place",
  branch_label: null,
  address_he: "רחוב הרצל 1",
  city_he: "ירושלים",
  city_slug: "jerusalem",
  phone: null,
  diet_type: "meat",
  status: "open",
  record_state: "list_verified",
  needs_review: false,
  corroboration_count: 1,
  notes: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const certificate: CertificateOut = {
  id: "22222222-2222-2222-2222-222222222222",
  restaurant_id: restaurant.id,
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

const flag: FlagOut = {
  id: "44444444-4444-4444-4444-444444444444",
  restaurant_id: restaurant.id,
  certificate_id: certificate.id,
  type: "expired_certificate",
  state: "open",
  message: "התעודה על הקיר פגה תוקף",
  photo_key: null,
  resolution: null,
  resolved_at: null,
  created_at: "2026-08-05T09:00:00Z",
  restaurant,
  certificate,
};

function pageOf(items: FlagOut[]): Page<FlagOut> {
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

function renderFlags() {
  return render(
    <ToastProvider>
      <Flags />
    </ToastProvider>,
  );
}

async function expandRow() {
  await screen.findByText("The Kosher Place");
  await userEvent.click(screen.getByText("The Kosher Place"));
}

function actionCalls(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) =>
    url.includes("/resolve"),
  );
}

beforeEach(() => {
  setToken("test-token");
  fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, pageOf([flag])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Flags queue", () => {
  it("shows the empty state when there are no open flags", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, pageOf([])));
    renderFlags();
    expect(await screen.findByText(/התור נקי/)).toBeInTheDocument();
  });

  it("requires a note of at least 5 characters and does not call the API without one", async () => {
    renderFlags();
    await expandRow();
    await userEvent.click(screen.getByRole("button", { name: "דחיית הדיווח" }));
    expect(await screen.findByText(/נדרשת הערה/)).toBeInTheDocument();
    // Too-short notes (server minimum is 5 chars) are also rejected client-side.
    await userEvent.type(screen.getByLabelText(/הערת הכרעה/), "abcd");
    await userEvent.click(screen.getByRole("button", { name: "דחיית הדיווח" }));
    expect(await screen.findByText(/5 תווים לפחות/)).toBeInTheDocument();
    expect(actionCalls()).toHaveLength(0);
  });

  it("badges in_review flags as pending field check and keeps them resolvable", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, pageOf([{ ...flag, state: "in_review" as const }])),
    );
    renderFlags();
    expect(await screen.findByText("ממתין לבדיקת שטח")).toBeInTheDocument();
    await userEvent.click(screen.getByText("The Kosher Place"));
    expect(screen.getByRole("button", { name: "דחיית הדיווח" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "אישור הורדת סטטוס" })).toBeEnabled();
  });

  it("dismisses a flag: POSTs outcome+note, optimistically removes the row, shows a toast", async () => {
    renderFlags();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/הערת הכרעה/), "wrong report");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...flag, state: "rejected" }));
    await userEvent.click(screen.getByRole("button", { name: "דחיית הדיווח" }));

    await waitFor(() => expect(screen.queryByText("The Kosher Place")).not.toBeInTheDocument());
    const calls = actionCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe(`/api/admin/flags/${flag.id}/resolve`);
    expect(JSON.parse(init.body as string)).toEqual({
      outcome: "dismissed",
      note: "wrong report",
    });
    expect(screen.getByText(/הדיווח נדחה ותועד/)).toBeInTheDocument();
  });

  it("confirm degrade opens a confirmation dialog stating the UNKNOWN consequence, and cancel aborts", async () => {
    renderFlags();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/הערת הכרעה/), "verified expired on site");
    await userEvent.click(screen.getByRole("button", { name: "אישור הורדת סטטוס" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/תוצג למשתמשים/);
    expect(dialog).toHaveTextContent("UNKNOWN");

    await userEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actionCalls()).toHaveLength(0);
    expect(screen.getAllByText("The Kosher Place").length).toBeGreaterThan(0);
  });

  it("confirming the degrade dialog POSTs confirmed_degrade and removes the row with an audited toast", async () => {
    renderFlags();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/הערת הכרעה/), "verified expired on site");
    await userEvent.click(screen.getByRole("button", { name: "אישור הורדת סטטוס" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...flag, state: "resolved" }));
    await userEvent.click(screen.getByRole("button", { name: "הורדת סטטוס התעודה" }));

    await waitFor(() => expect(screen.queryByText("The Kosher Place")).not.toBeInTheDocument());
    const calls = actionCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      outcome: "confirmed_degrade",
      note: "verified expired on site",
    });
    expect(screen.getByText(/אינה ניתנת לביטול/)).toBeInTheDocument();
  });

  it("shows the API error detail and keeps the row when an action fails", async () => {
    renderFlags();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/הערת הכרעה/), "checked with certifier");
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "flag is already resolved" }));
    await userEvent.click(screen.getByRole("button", { name: "דחיית הדיווח" }));

    expect(await screen.findByText("flag is already resolved")).toBeInTheDocument();
    expect(screen.getAllByText("The Kosher Place").length).toBeGreaterThan(0);
  });

  it("renders Hebrew data fields with dir=auto", async () => {
    renderFlags();
    const hebrewName = await screen.findByText("מסעדת הכשרה");
    expect(hebrewName).toHaveAttribute("dir", "auto");
    const message = screen.getByText("התעודה על הקיר פגה תוקף");
    expect(message).toHaveAttribute("dir", "auto");
  });
});
