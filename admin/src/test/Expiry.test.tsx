import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type {
  CertificateOut,
  EvidencePhotoOut,
  ExpiryQueueItem,
  Page,
  RestaurantBrief,
} from "../api/types";
import { MAX_PHOTO_BYTES } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Expiry } from "../views/Expiry";

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
  valid_until: "2026-08-15",
  state: "active",
  source: "official_list",
  source_document_id: null,
  evidence_photo_key: null,
  verified_by_label: null,
  verified_at: null,
  corroboration_count: 1,
  notes: null,
};

const acceptedPhoto: EvidencePhotoOut = {
  id: "55555555-5555-5555-5555-555555555555",
  certificate_id: certificate.id,
  storage_key: `cert-evidence/${certificate.id}/accepted.jpg`,
  content_type: "image/jpeg",
  size_bytes: 1000,
  sha256: "aaaa",
  status: "accepted",
  uploaded_by: "moderator:tester",
  uploaded_at: "2026-08-02T09:00:00Z",
  reviewed_by: "moderator:tester",
  reviewed_at: "2026-08-03T09:00:00Z",
  review_note: "readable",
  view_url: "https://media.example/presigned/accepted.jpg",
};

const pendingPhoto: EvidencePhotoOut = {
  ...acceptedPhoto,
  id: "66666666-6666-6666-6666-666666666666",
  storage_key: `cert-evidence/${certificate.id}/pending.jpg`,
  status: "pending_review",
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
};

const expiryItem: ExpiryQueueItem = {
  certificate,
  restaurant,
  days_until_expiry: 8,
};

function pageOf(items: ExpiryQueueItem[]): Page<ExpiryQueueItem> {
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

function renderExpiry() {
  return render(
    <ToastProvider>
      <Expiry />
    </ToastProvider>,
  );
}

async function expandRow() {
  await screen.findByText("The Kosher Place");
  await userEvent.click(screen.getByText("The Kosher Place"));
}

function callsTo(fragment: string, method?: string): Array<[string, RequestInit | undefined]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(
    ([url, init]) => url.includes(fragment) && (!method || init?.method === method),
  );
}

beforeEach(() => {
  setToken("test-token");
  fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.endsWith("/photos") && init?.method === "POST") {
      return Promise.resolve(jsonResponse(201, pendingPhoto));
    }
    if (typeof url === "string" && url.includes(`/certificates/${certificate.id}/photos`)) {
      return Promise.resolve(jsonResponse(200, [acceptedPhoto, pendingPhoto]));
    }
    if (typeof url === "string" && url.includes("/verify-renewal")) {
      return Promise.resolve(jsonResponse(200, { ...certificate, valid_until: "2030-01-01" }));
    }
    return Promise.resolve(jsonResponse(200, pageOf([expiryItem])));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Expiry queue — certificate photo upload", () => {
  it("uploads a photo as multipart FormData with auth and no manual Content-Type", async () => {
    renderExpiry();
    await expandRow();
    const input = screen.getByLabelText("קובץ תמונת תעודה");
    const file = new File(["fake-jpeg-bytes"], "cert.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(callsTo("/photos", "POST")).toHaveLength(1));
    const [url, init] = callsTo("/photos", "POST")[0]!;
    expect(url).toBe(`/api/admin/certificates/${certificate.id}/photos`);
    const headers = init!.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Content-Type");
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(init!.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBe(file);
    expect(await screen.findByText(/התמונה הועלתה/)).toBeInTheDocument();
  });

  it("rejects a file over 15 MB client-side without calling the API", async () => {
    renderExpiry();
    await expandRow();
    const input = screen.getByLabelText("קובץ תמונת תעודה");
    const big = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_PHOTO_BYTES + 1 });
    fireEvent.change(input, { target: { files: [big] } });

    expect(await screen.findByText(/חורג ממגבלת 15 MB/)).toBeInTheDocument();
    expect(callsTo("/photos", "POST")).toHaveLength(0);
  });
});

describe("Expiry queue — verify renewal with photo evidence", () => {
  it("lists only ACCEPTED photos in the evidence selector and sends the chosen storage key", async () => {
    renderExpiry();
    await expandRow();
    const selector = await screen.findByLabelText(/תמונת ראיה/);
    // "none" + the one accepted photo; the pending photo never qualifies as evidence.
    await waitFor(() => expect(within(selector).getAllByRole("option")).toHaveLength(2));

    await userEvent.selectOptions(selector, acceptedPhoto.storage_key);
    await userEvent.type(screen.getByLabelText(/תאריך תוקף חדש/), "2030-01-01");
    await userEvent.click(screen.getByRole("button", { name: "אימות חידוש" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "אימות החידוש" }));

    await waitFor(() => expect(callsTo("/verify-renewal", "POST")).toHaveLength(1));
    const [, init] = callsTo("/verify-renewal", "POST")[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      valid_until: "2030-01-01",
      evidence_note: null,
      evidence_url: null,
      evidence_photo_key: acceptedPhoto.storage_key,
    });
  });

  it("still requires some evidence: no note, URL or photo blocks the renewal client-side", async () => {
    renderExpiry();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/תאריך תוקף חדש/), "2030-01-01");
    await userEvent.click(screen.getByRole("button", { name: "אימות חידוש" }));
    expect(await screen.findByText(/נדרשת ראיה לחידוש/)).toBeInTheDocument();
    expect(callsTo("/verify-renewal", "POST")).toHaveLength(0);
  });
});
