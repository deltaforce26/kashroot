import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import type { CertificateOut, CertifierOption, Page, RestaurantDetail } from "../api/types";
import { ToastProvider } from "../components/Toast";
import { clearCertifierOptionsCache } from "../hooks/useCertifierOptions";
import { Restaurants } from "../views/Restaurants";

const ACTIVE_CERTIFIER = "33333333-3333-3333-3333-333333333333";
const RETIRED_CERTIFIER = "44444444-4444-4444-4444-444444444444";

const certifiers: CertifierOption[] = [
  {
    id: ACTIVE_CERTIFIER,
    slug: "badatz-eda",
    name_he: "בד״ץ העדה החרדית",
    name_en: "Eda HaChareidis",
    type: "badatz",
    is_active: true,
  },
  {
    id: RETIRED_CERTIFIER,
    slug: "old-council",
    name_he: "רבנות מועצה ישנה",
    name_en: null,
    type: "rabbanut_local",
    is_active: false,
  },
];

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

/** What the server stamps on the way back — never anything the client sent. */
const createdCertificate: CertificateOut = {
  id: "22222222-2222-2222-2222-222222222222",
  restaurant_id: restaurant.id,
  certifier_id: ACTIVE_CERTIFIER,
  certifier: { name_he: "בד״ץ העדה החרדית", name_en: "Eda HaChareidis" },
  level: "mehadrin",
  attributes: { glatt: true },
  valid_from: "2026-01-01",
  valid_until: "2026-12-31",
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
  return { total: 1, limit: 50, offset: 0, items: [restaurant] };
}

function certifierPage(): Page<CertifierOption> {
  return { total: certifiers.length, limit: 200, offset: 0, items: certifiers };
}

let fetchMock: ReturnType<typeof vi.fn>;

function urls(): string[] {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).map((call) => String(call[0]));
}

function getCallCount(): number {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    (call) => (call[1]?.method ?? "GET") === "GET",
  ).length;
}

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

function renderDirectory() {
  return render(
    <ToastProvider>
      <Restaurants />
    </ToastProvider>,
  );
}

/** Expand the row only — deliberately stops short of the certificate panel. */
async function expandRow(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/The Kosher Place/);
  await user.click(screen.getByText(/The Kosher Place/));
  await screen.findByRole("button", { name: /שמירת שינויים/ });
}

/** Expand the row and open the certificate panel; hands back its submit button. */
async function openCertificatePanel(user: ReturnType<typeof userEvent.setup>) {
  await expandRow(user);
  await user.click(screen.getByRole("button", { name: "הוספת תעודה" }));

  return screen.findByRole("button", { name: "הוספת התעודה…" });
}

async function chooseCertifier(user: ReturnType<typeof userEvent.setup>, id = ACTIVE_CERTIFIER) {
  await waitFor(() => expect(screen.getByLabelText(/^גוף כשרות$/)).toBeEnabled());
  await user.selectOptions(screen.getByLabelText(/^גוף כשרות$/), id);
}

describe("Adding a certificate by hand", () => {
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

  it("fetches no certifiers until the moderator asks to add a certificate", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await expandRow(user);

    // Merely expanding a row must issue no certifier request: the panel mounts
    // lazily, which is what lets every other directory test keep its fetch mock.
    expect(urls().some((url) => url.includes("/api/admin/certifiers"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "הוספת תעודה" }));

    await waitFor(() =>
      expect(urls().some((url) => url.includes("/api/admin/certifiers"))).toBe(true),
    );
  });

  it("marks an inactive certifier in the picker instead of hiding it", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await openCertificatePanel(user);

    const picker = await screen.findByLabelText(/^גוף כשרות$/);
    expect(within(picker).getByRole("option", { name: /רבנות מועצה ישנה.*לא פעיל/ })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: /בד״ץ העדה החרדית/ })).toBeEnabled();
  });

  it("blocks a submit with no certifier chosen", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await waitFor(() => expect(screen.getByLabelText(/^גוף כשרות$/)).toBeEnabled());

    await user.click(submit);

    expect(await screen.findByText(/יש לבחור גוף כשרות\./)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postCalls().length).toBe(0);
  });

  it("blocks a submit with no state chosen — the state is never defaulted", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);

    await user.click(submit);

    expect(await screen.findByText(/יש לבחור את מצב התעודה/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postCalls().length).toBe(0);
  });

  it("blocks a valid_until that precedes valid_from, client-side", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "pending");
    await user.type(screen.getByLabelText(/בתוקף מתאריך/), "2026-05-01");
    await user.type(screen.getByLabelText(/בתוקף עד תאריך/), "2026-01-01");

    await user.click(submit);

    expect(await screen.findByText(/אינו יכול להקדים/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postCalls().length).toBe(0);
  });

  it("sends only the attributes the moderator affirmed", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "pending");
    await user.selectOptions(screen.getByLabelText(/גלאט/), "yes");
    await user.selectOptions(screen.getByLabelText(/חלב ישראל/), "no");

    await user.click(submit);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { ...createdCertificate, state: "pending" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הוספת התעודה" }));

    await waitFor(() => expect(postCalls().length).toBe(1));
    // An attribute nobody touched stays absent — absent is unknown, never false.
    expect(lastPostBody().attributes).toEqual({ glatt: true, chalav_yisrael: false });
  });

  /**
   * LOCKED PRODUCT DECISION — do not "fix" this into a validation block.
   *
   * A moderator may record a certificate as `active` with no evidence attached.
   * It was raised with the user and chosen deliberately: the moderator is the
   * evidence, and the compensating control is the audit row naming them. The
   * console states the consequence in the confirmation; it never refuses.
   */
  it("lets an active certificate through with no evidence, stating the consequence", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "active");

    await user.click(submit);

    const dialog = await screen.findByRole("dialog");
    // One line, saying both halves: no evidence is attached, and the choice is
    // recorded in this moderator's name.
    expect(within(dialog).getByText(/ללא ראיה מצורפת/)).toHaveTextContent(
      /על שם המודרטור המחובר/,
    );
    expect(within(dialog).getByText(/אומת בידי מודרטור/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse(201, createdCertificate));
    await user.click(within(dialog).getByRole("button", { name: "הוספת התעודה" }));

    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(lastPostBody().state).toBe("active");
  });

  it("posts to the restaurant's certificates path and never stamps provenance itself", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^רמת הכשרות$/), "mehadrin");
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "active");

    await user.click(submit);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, createdCertificate));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הוספת התעודה" }));

    await waitFor(() => expect(postCalls().length).toBe(1));
    const [url] = postCalls()[0] ?? [];
    expect(url).toBe(`/api/admin/restaurants/${restaurant.id}/certificates`);
    const body = lastPostBody();
    expect(body).toEqual({ certifier_id: ACTIVE_CERTIFIER, level: "mehadrin", state: "active" });
    for (const forbidden of [
      "source",
      "verified_by_label",
      "verified_at",
      "corroboration_count",
      "restaurant_id",
      "is_demo_seed",
      "import_key",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("shows the new certificate on the row without refetching anything", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "active");

    await user.click(submit);
    const getsBefore = getCallCount();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, createdCertificate));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הוספת התעודה" }));

    expect(await screen.findByText(/התעודה נוספה ותועדה/)).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const row = within(table).getAllByRole("row")[1];
    // The badge count on the summary row goes 0 → 1 straight from the response.
    await waitFor(() => expect(row).toHaveTextContent("בתוקף"));
    expect(row).not.toHaveTextContent("אין");
    expect(getCallCount()).toBe(getsBefore);
  });

  it("surfaces an API failure with the draft still on screen", async () => {
    const user = userEvent.setup();
    renderDirectory();
    const submit = await openCertificatePanel(user);
    await chooseCertifier(user);
    await user.selectOptions(screen.getByLabelText(/^מצב התעודה$/), "expired");
    await user.selectOptions(screen.getByLabelText(/גלאט/), "yes");

    await user.click(submit);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ["body", "valid_until"], msg: "bad date" }] }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "הוספת התעודה" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/bad date/);
    expect(screen.getByLabelText(/^מצב התעודה$/)).toHaveValue("expired");
    expect(screen.getByLabelText(/גלאט/)).toHaveValue("yes");
  });
});
