/**
 * The certificate photo slot and the report sheet.
 *
 *   - three slot states, each offering exactly what it should and nothing more;
 *   - an upload lands as pending, and the server's 409s land where a person can read
 *     them;
 *   - a report sends a flag type and an optional message, and says thank you;
 *   - on the page, one report button, never two.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { ApiError, kashrootApi } from "../api";
import {
  mockFlags,
  mockRestaurant,
  mockUploadCertificatePhoto,
  resetMockSubmissions,
} from "../api/mock/server";
import { CERTIFIERS } from "../api/mock/fixtures";
import type { ProfileRequest } from "../api/types";
import { CertificatePhotoSlot } from "../components/CertificatePhotoSlot";
import { ReportSheet } from "../components/ReportSheet";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import { ProfileProvider } from "../profile/ProfileProvider";
import { SavedProvider } from "../saved/SavedProvider";
import { ThemeProvider } from "../theme/ThemeProvider";

const he = STRINGS.he;
const photo = he.restaurant.photo;
const report = he.restaurant.report;

function renderHe(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

function image(name = "cert.jpg", type = "image/jpeg", size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetMockSubmissions();
});

describe("CertificatePhotoSlot", () => {
  it("accepted: shows the photo, opens it full size, and offers only a report", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "accepted", photo_url: "https://example.test/c.jpg" }}
        onReport={onReport}
      />,
    );

    const thumb = screen.getByRole("button", { name: photo.view });
    expect(within(thumb).getByRole("img")).toHaveAttribute("src", "https://example.test/c.jpg");
    expect(screen.queryByRole("button", { name: photo.upload })).toBeNull();

    await user.click(screen.getByRole("button", { name: report.button }));
    expect(onReport).toHaveBeenCalledOnce();

    await user.click(thumb);
    const viewer = screen.getByRole("dialog", { name: photo.alt });
    expect(within(viewer).getByRole("img")).toHaveAttribute("src", "https://example.test/c.jpg");
    await user.click(within(viewer).getByRole("button", { name: photo.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pending: a badge, and neither an upload nor a report", () => {
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "pending", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    expect(screen.getByText(photo.pending)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(photo.takePhoto)).toBeNull();
  });

  it("none: an upload button whose menu offers the camera and a file", async () => {
    const user = userEvent.setup();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: report.button })).toBeNull();

    await user.click(screen.getByRole("button", { name: photo.upload }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: photo.takePhoto })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: photo.chooseFile })).toBeInTheDocument();

    const camera = screen.getByLabelText(photo.takePhoto);
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(screen.getByLabelText(photo.chooseFile)).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });

  it("uploads, says so, and switches to pending", async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(kashrootApi, "uploadCertificatePhoto")
      .mockResolvedValue({ photo_id: 7, status: "pending" });
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );

    const file = image();
    await user.upload(screen.getByLabelText(photo.chooseFile), file);

    expect(upload).toHaveBeenCalledWith("r-1", file);
    expect(await screen.findByRole("status")).toHaveTextContent(photo.sent);
    expect(screen.getByText(photo.pending)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: photo.upload })).toBeNull();
  });

  it("maps 409 photo_pending to a message and the pending state", async () => {
    const user = userEvent.setup();
    vi.spyOn(kashrootApi, "uploadCertificatePhoto").mockRejectedValue(
      new ApiError(409, "photo_pending"),
    );
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    await user.upload(screen.getByLabelText(photo.chooseFile), image());

    expect(await screen.findByRole("status")).toHaveTextContent(photo.errors.pending);
    expect(screen.getByText(photo.pending)).toBeInTheDocument();
  });

  it("maps 409 photo_exists to a message and asks for a refetch", async () => {
    const user = userEvent.setup();
    const onStale = vi.fn();
    vi.spyOn(kashrootApi, "uploadCertificatePhoto").mockRejectedValue(
      new ApiError(409, "photo_exists"),
    );
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
        onStale={onStale}
      />,
    );
    await user.upload(screen.getByLabelText(photo.chooseFile), image());

    expect(await screen.findByRole("status")).toHaveTextContent(photo.errors.exists);
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("refuses a wrong type or an oversize file before sending anything", async () => {
    const upload = vi.spyOn(kashrootApi, "uploadCertificatePhoto");
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(photo.takePhoto);

    fireEvent.change(input, { target: { files: [image("c.heic", "image/heic")] } });
    expect(await screen.findByRole("status")).toHaveTextContent(photo.errors.badType);

    fireEvent.change(input, { target: { files: [image("c.jpg", "image/jpeg", 16 * 1024 * 1024)] } });
    expect(await screen.findByRole("status")).toHaveTextContent(photo.errors.tooLarge);

    expect(upload).not.toHaveBeenCalled();
  });
});

describe("ReportSheet", () => {
  it("sends the chosen type and message, then thanks the reporter", async () => {
    const user = userEvent.setup();
    const send = vi
      .spyOn(kashrootApi, "reportRestaurant")
      .mockResolvedValue({ flag_id: 3, state: "open" });
    renderHe(<ReportSheet restaurantId="r-1" onClose={vi.fn()} />);

    const submit = screen.getByRole("button", { name: report.submit });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: report.types.expired_certificate }));
    await user.type(screen.getByLabelText(report.messageLabel), "  פג בחודש שעבר ");
    await user.click(submit);

    expect(send).toHaveBeenCalledWith("r-1", {
      type: "expired_certificate",
      message: "פג בחודש שעבר",
    });
    expect(await screen.findByText(report.sent)).toBeInTheDocument();
  });

  it("leaves the message out when it is blank, and shows an error on failure", async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(kashrootApi, "reportRestaurant").mockRejectedValue(new ApiError(500, "x"));
    renderHe(<ReportSheet restaurantId="r-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: report.types.closed }));
    await user.click(screen.getByRole("button", { name: report.submit }));

    expect(send).toHaveBeenCalledWith("r-1", { type: "closed" });
    expect(await screen.findByRole("alert")).toHaveTextContent(report.error);
  });
});

describe("mock submissions", () => {
  const NOW = new Date("2026-08-17T12:00:00Z");
  const PROFILE: ProfileRequest = {
    whitelist: CERTIFIERS.map((c) => ({ certifier_id: c.id, min_level: "regular" as const })),
    required_attributes: [],
    preferred_diets: [],
    preferred_price_level: null,
    wanted_amenities: [],
  };

  it("an upload turns the deciding certificate pending, and a second is refused", async () => {
    const before = await mockRestaurant("r-katzefet", PROFILE, NOW);
    expect(before.certificates[0]?.photo_status).toBe("none");

    await mockUploadCertificatePhoto("r-katzefet", image());
    const after = await mockRestaurant("r-katzefet", PROFILE, NOW);
    expect(after.certificates[0]?.photo_status).toBe("pending");
    expect(after.certificates[0]?.photo_url).toBeNull();
    expect(after.kashrut).toEqual(before.kashrut);

    await expect(mockUploadCertificatePhoto("r-katzefet", image())).rejects.toMatchObject({
      status: 409,
      message: "photo_pending",
    });
    await expect(mockUploadCertificatePhoto("r-nougatine", image())).rejects.toMatchObject({
      status: 409,
      message: "photo_exists",
    });
    await expect(mockUploadCertificatePhoto("r-sushi-bvg", image())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a report is recorded and changes nothing", async () => {
    const before = await mockRestaurant("r-katzefet", PROFILE, NOW);
    await kashrootApi.reportRestaurant("r-katzefet", { type: "closed" });
    expect(mockFlags()).toEqual([{ restaurant_id: "r-katzefet", body: { type: "closed" } }]);
    expect((await mockRestaurant("r-katzefet", PROFILE, NOW)).kashrut).toEqual(before.kashrut);
  });
});

describe("restaurant page", () => {
  function renderApp(route: string) {
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

  async function open(route: string) {
    const user = userEvent.setup();
    renderApp(route);
    await screen.findByText(he.presets.any.title);
    await user.click(screen.getByText(he.presets.any.title));
    await user.click(screen.getByRole("button", { name: he.onboarding.continue }));
    return { user, card: await screen.findByRole("region", { name: he.restaurant.certificate }) };
  }

  it("with an approved photo, the report sits beside it and nowhere else", async () => {
    const { user, card } = await open("/r/r-nougatine");
    expect(within(card).getByRole("button", { name: photo.view })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: report.button })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: report.open })).toBeNull();

    await user.click(within(card).getByRole("button", { name: report.button }));
    expect(await screen.findByRole("dialog", { name: report.title })).toBeInTheDocument();
  });

  it("without one, upload in the card and the report at the foot of the page", async () => {
    const { card } = await open("/r/r-katzefet");
    expect(within(card).getByRole("button", { name: photo.upload })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: report.button })).toBeNull();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: report.open })).toHaveLength(1),
    );
  });
});
