import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type {
  CertificateOut,
  EvidencePhotoOut,
  Page,
  PhotoQueueItem,
  RestaurantBrief,
} from "../api/types";
import { ToastProvider } from "../components/Toast";
import { Photos } from "../views/Photos";

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
  attributes: {},
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

const photo: EvidencePhotoOut = {
  id: "55555555-5555-5555-5555-555555555555",
  certificate_id: certificate.id,
  storage_key: `cert-evidence/${certificate.id}/abc.jpg`,
  content_type: "image/jpeg",
  size_bytes: 123456,
  sha256: "deadbeef",
  status: "pending_review",
  uploaded_by: "moderator:tester",
  uploaded_at: "2026-08-05T09:00:00Z",
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  view_url: "https://media.example/presigned/abc.jpg?sig=1",
};

const queueItem: PhotoQueueItem = { photo, certificate, restaurant };

/** Same photo, but the certificate already records chalav_yisrael=yes. */
const recordedItem: PhotoQueueItem = {
  ...queueItem,
  certificate: { ...certificate, attributes: { chalav_yisrael: true } },
};

function pageOf(items: PhotoQueueItem[]): Page<PhotoQueueItem> {
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

function renderPhotos() {
  return render(
    <ToastProvider>
      <Photos />
    </ToastProvider>,
  );
}

async function expandRow() {
  await screen.findByText("The Kosher Place");
  await userEvent.click(screen.getByText("The Kosher Place"));
}

function reviewCalls(): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) =>
    url.includes("/review"),
  );
}

beforeEach(() => {
  setToken("test-token");
  fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/review") && init?.method === "POST") {
      return Promise.resolve(jsonResponse(200, { ...photo, status: "accepted" }));
    }
    return Promise.resolve(jsonResponse(200, pageOf([queueItem])));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Photos queue", () => {
  it("lists pending photos with Hebrew-safe restaurant name and a presigned thumbnail", async () => {
    renderPhotos();
    const hebrewName = await screen.findByText("מסעדת הכשרה");
    expect(hebrewName).toHaveAttribute("dir", "auto");
    const thumb = screen.getByAltText("certificate evidence");
    expect(thumb).toHaveAttribute("src", photo.view_url);
  });

  it("shows a labeled link instead of an inline image for PDF evidence", async () => {
    const pdfItem: PhotoQueueItem = {
      ...queueItem,
      photo: { ...photo, content_type: "application/pdf", storage_key: "cert-evidence/x.pdf" },
    };
    fetchMock.mockResolvedValue(jsonResponse(200, pageOf([pdfItem])));
    renderPhotos();
    const link = await screen.findByRole("link", { name: /pdf document/i });
    expect(link).toHaveAttribute("href", photo.view_url);
    expect(screen.queryByAltText("certificate evidence")).not.toBeInTheDocument();
  });

  it("fail-safe: accept sends ONLY touched attributes — untouched absent, explicit clears null", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/review") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(200, { ...photo, status: "accepted" }));
      }
      return Promise.resolve(jsonResponse(200, pageOf([recordedItem])));
    });
    renderPhotos();
    await expandRow();
    await userEvent.selectOptions(screen.getByLabelText("glatt"), "yes");
    await userEvent.selectOptions(screen.getByLabelText(/chalav_yisrael/), "no");
    // pas_yisrael (and every other attribute) stays untouched.
    await userEvent.type(screen.getByLabelText(/review note/i), "matches the certificate");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept photo" }));

    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    const [url, init] = reviewCalls()[0]!;
    expect(url).toBe(`/api/admin/photos/${photo.id}/review`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // Exact payload: only touched keys inside attributes, no valid_until key at all.
    expect(body).toEqual({
      decision: "accept",
      note: "matches the certificate",
      attributes: { glatt: true, chalav_yisrael: false },
    });
    expect("valid_until" in body).toBe(false);
    expect(Object.keys(body.attributes as object)).toEqual(["glatt", "chalav_yisrael"]);
  });

  it("clear-to-unknown is offered only for recorded attributes and sends an explicit null", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/review") && init?.method === "POST") {
        return Promise.resolve(jsonResponse(200, { ...photo, status: "accepted" }));
      }
      return Promise.resolve(jsonResponse(200, pageOf([recordedItem])));
    });
    renderPhotos();
    await expandRow();

    // The recorded attribute shows its current value and offers the clear option…
    expect(screen.getByText("currently: yes")).toBeInTheDocument();
    const chalavSelect = screen.getByLabelText(/chalav_yisrael/);
    expect(
      within(chalavSelect).getByRole("option", { name: "clear to unknown" }),
    ).toBeInTheDocument();
    // …while an unrecorded attribute has no clear option (unknown = untouched).
    const glattSelect = screen.getByLabelText("glatt");
    expect(
      within(glattSelect).queryByRole("option", { name: "clear to unknown" }),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(chalavSelect, "clear");
    await userEvent.type(screen.getByLabelText(/review note/i), "photo does not show chalav");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("1 attribute cleared to unknown: chalav_yisrael");
    await userEvent.click(within(dialog).getByRole("button", { name: "Accept photo" }));

    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    const body = JSON.parse(reviewCalls()[0]![1].body as string) as Record<string, unknown>;
    // null ONLY for the explicit clear; every untouched key absent.
    expect(body).toEqual({
      decision: "accept",
      note: "photo does not show chalav",
      attributes: { chalav_yisrael: null },
    });
  });

  it("accept with nothing touched omits the attributes key entirely", async () => {
    renderPhotos();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/review note/i), "photo is genuine");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept photo" }));

    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    const body = JSON.parse(reviewCalls()[0]![1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ decision: "accept", note: "photo is genuine" });
    expect("attributes" in body).toBe(false);
  });

  it("reject disables the attribute editor and never sends attributes or valid_until", async () => {
    renderPhotos();
    await expandRow();
    // Touch attributes and a date first — switching to reject must clear them.
    await userEvent.selectOptions(screen.getByLabelText("glatt"), "yes");
    await userEvent.click(screen.getByRole("radio", { name: /reject/i }));

    expect(screen.getByLabelText("glatt")).toBeDisabled();
    expect(screen.getByLabelText("pas_yisrael")).toBeDisabled();
    expect(screen.getByLabelText(/valid until/i)).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/review note/i), "blurry, unreadable");
    await userEvent.click(screen.getByRole("button", { name: "Reject photo" }));

    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    const body = JSON.parse(reviewCalls()[0]![1].body as string) as Record<string, unknown>;
    expect(body).toEqual({ decision: "reject", note: "blurry, unreadable" });
    expect("attributes" in body).toBe(false);
    expect("valid_until" in body).toBe(false);
  });

  it("accept opens a ConfirmDialog summarizing what will be written, and cancel aborts", async () => {
    renderPhotos();
    await expandRow();
    await userEvent.selectOptions(screen.getByLabelText("glatt"), "yes");
    await userEvent.selectOptions(screen.getByLabelText("pas_yisrael"), "no");
    await userEvent.type(screen.getByLabelText(/valid until/i), "2027-01-15");
    await userEvent.type(screen.getByLabelText(/review note/i), "verified against the wall copy");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("2 attributes: glatt=yes, pas_yisrael=no");
    expect(dialog).toHaveTextContent("expiry 2027-01-15");
    // official_list (authority 3) → moderator_verified (4) is a strict upgrade.
    expect(dialog).toHaveTextContent("source upgraded to moderator_verified");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reviewCalls()).toHaveLength(0);
  });

  it("requires a note of at least 5 characters before any review call", async () => {
    renderPhotos();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/review note/i), "abcd");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));
    expect(await screen.findByText(/at least 5 characters/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reviewCalls()).toHaveLength(0);
  });

  it("rejects a past valid-until client-side (mirror of the server rule)", async () => {
    renderPhotos();
    await expandRow();
    await userEvent.type(screen.getByLabelText(/valid until/i), "2020-01-01");
    await userEvent.type(screen.getByLabelText(/review note/i), "readable and genuine");
    await userEvent.click(screen.getByRole("button", { name: "Accept photo…" }));
    expect(await screen.findByText(/strictly in the future/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reviewCalls()).toHaveLength(0);
  });
});
