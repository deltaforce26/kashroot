/**
 * The certificate photo slot and the report sheet.
 *
 *   - three slot states, each offering exactly what it should and nothing more;
 *   - an upload goes camera/gallery -> preview -> Send, in a bottom sheet that a
 *     phone can drive: Escape, the scrim and the back gesture all close it;
 *   - an upload lands as pending, and the server's 409s land where a person can read
 *     them;
 *   - a report sends a flag type and an optional message, and says thank you;
 *   - on the page, one report button, never two.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// jsdom has no object URLs; the preview needs one.
beforeAll(() => {
  URL.createObjectURL = () => "blob:preview";
  URL.revokeObjectURL = () => {};
});

const cameraInput = () => screen.getByTestId<HTMLInputElement>("photo-camera-input");
const galleryInput = () => screen.getByTestId<HTMLInputElement>("photo-gallery-input");

/** Opens the upload sheet, picks `file` through `input`, and returns the sheet. */
async function pickInSheet(
  user: ReturnType<typeof userEvent.setup>,
  input: () => HTMLInputElement,
  file: File,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: photo.upload }));
  const sheet = screen.getByRole("dialog", { name: photo.sheetTitle });
  await user.upload(input(), file);
  await within(sheet).findByRole("button", { name: photo.send });
  return sheet;
}

describe("CertificatePhotoSlot", () => {
  it("accepted: shows the photo, opens it full size, and offers only a report", async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{
          certificate_id: "c-1",
          photo_status: "accepted",
          photo_url: "https://example.test/c.jpg",
        }}
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
        evidence={{ certificate_id: "c-1", photo_status: "pending", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    expect(screen.getByText(photo.pending)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(photo.takePhoto)).toBeNull();
  });

  it("none: a full-width upload button and a hint; the sheet offers the camera and the gallery", async () => {
    const user = userEvent.setup();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: report.button })).toBeNull();
    expect(screen.getByText(photo.uploadHint)).toBeInTheDocument();

    const upload = screen.getByRole("button", { name: photo.upload });
    expect(upload).toHaveAttribute("aria-haspopup", "dialog");
    expect(upload).toHaveAttribute("aria-expanded", "false");
    await user.click(upload);

    const sheet = screen.getByRole("dialog", { name: photo.sheetTitle });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    // Portalled to <body>, out of the glass card that would clip it.
    expect(sheet.parentElement).toBe(document.body);
    expect(upload).toHaveAttribute("aria-expanded", "true");
    expect(document.body.style.overflow).toBe("hidden");

    const camera = within(sheet).getByRole("button", { name: photo.takePhoto });
    expect(camera).toHaveAccessibleDescription(photo.takePhotoHint);
    expect(within(sheet).getByRole("button", { name: photo.chooseFile })).toBeInTheDocument();
    // Focus moves into the sheet.
    expect(sheet).toContainElement(document.activeElement as HTMLElement);

    expect(cameraInput()).toHaveAttribute("capture", "environment");
    expect(cameraInput()).toHaveAttribute("accept", "image/*");
    expect(galleryInput()).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");

    const click = vi.spyOn(cameraInput(), "click");
    await user.click(camera);
    expect(click).toHaveBeenCalledOnce();

    await user.click(within(sheet).getByRole("button", { name: photo.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(upload).toHaveFocus();
  });

  it("closes the sheet on Escape, on the scrim, and on the back gesture", async () => {
    const user = userEvent.setup();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const upload = screen.getByRole("button", { name: photo.upload });

    await user.click(upload);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(upload);
    fireEvent.click(document.querySelector(".bsheet__scrim")!);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Let the closed sheet drop its history entry before opening the next.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await user.click(upload);
    expect(window.history.state).toMatchObject({ kashrootSheet: true });
    window.history.replaceState({}, "");
    fireEvent.popState(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("previews the picked photo, sends only on Send, then says so and switches to pending", async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(kashrootApi, "uploadCertificatePhoto")
      .mockResolvedValue({ photo_id: "mock-photo-7", status: "pending" });
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );

    const file = image();
    const sheet = await pickInSheet(user, galleryInput, file);

    expect(within(sheet).getByRole("img", { name: photo.previewAlt })).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(within(sheet).getByRole("button", { name: photo.chooseAnother })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole("button", { name: photo.send }));
    expect(upload).toHaveBeenCalledWith("r-1", "c-1", file);
    expect(await within(sheet).findByRole("status")).toHaveTextContent(photo.sentLead);
    expect(screen.getByText(photo.pending)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: photo.upload })).toBeNull();

    await user.click(within(sheet).getByRole("button", { name: photo.done }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(photo.sent);
  });

  it("shows progress while sending and holds the buttons", async () => {
    const user = userEvent.setup();
    let resolve: (value: { photo_id: string; status: "pending" }) => void = () => {};
    vi.spyOn(kashrootApi, "uploadCertificatePhoto").mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const sheet = await pickInSheet(user, cameraInput, image());
    expect(within(sheet).getByRole("button", { name: photo.retake })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: photo.send }));
    expect(within(sheet).getByRole("progressbar", { name: photo.uploading })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: photo.uploading })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: photo.retake })).toBeDisabled();

    resolve({ photo_id: "p", status: "pending" });
    expect(await within(sheet).findByText(photo.sentLead)).toBeInTheDocument();
  });

  it("retake re-opens the same source", async () => {
    const user = userEvent.setup();
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const sheet = await pickInSheet(user, cameraInput, image());
    const click = vi.spyOn(cameraInput(), "click");
    await user.click(within(sheet).getByRole("button", { name: photo.retake }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("a network failure offers a retry of the same photo", async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(kashrootApi, "uploadCertificatePhoto")
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValueOnce({ photo_id: "p", status: "pending" });
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const file = image();
    const sheet = await pickInSheet(user, galleryInput, file);
    await user.click(within(sheet).getByRole("button", { name: photo.send }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.network);
    await user.click(within(sheet).getByRole("button", { name: photo.tryAgain }));
    expect(upload).toHaveBeenNthCalledWith(2, "r-1", "c-1", file);
    expect(await within(sheet).findByText(photo.sentLead)).toBeInTheDocument();
  });

  it("maps a 429 to a friendly rate-limit message and offers a retry", async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(kashrootApi, "uploadCertificatePhoto")
      .mockRejectedValueOnce(new ApiError(429, "rate_limited"))
      .mockResolvedValueOnce({ photo_id: "p", status: "pending" });
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const file = image();
    const sheet = await pickInSheet(user, galleryInput, file);
    await user.click(within(sheet).getByRole("button", { name: photo.send }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.rateLimited);
    await user.click(within(sheet).getByRole("button", { name: photo.tryAgain }));
    expect(upload).toHaveBeenNthCalledWith(2, "r-1", "c-1", file);
    expect(await within(sheet).findByText(photo.sentLead)).toBeInTheDocument();
  });

  it("maps 409 photo_pending to a message and the pending state", async () => {
    const user = userEvent.setup();
    vi.spyOn(kashrootApi, "uploadCertificatePhoto").mockRejectedValue(
      new ApiError(409, "photo_pending"),
    );
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    const sheet = await pickInSheet(user, galleryInput, image());
    await user.click(within(sheet).getByRole("button", { name: photo.send }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.pending);
    expect(within(sheet).queryByRole("button", { name: photo.tryAgain })).toBeNull();
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
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
        onStale={onStale}
      />,
    );
    const sheet = await pickInSheet(user, galleryInput, image());
    await user.click(within(sheet).getByRole("button", { name: photo.send }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.exists);
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("refuses a wrong type or an oversize file before any preview or request", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(kashrootApi, "uploadCertificatePhoto");
    renderHe(
      <CertificatePhotoSlot
        restaurantId="r-1"
        evidence={{ certificate_id: "c-1", photo_status: "none", photo_url: null }}
        onReport={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: photo.upload }));
    const sheet = screen.getByRole("dialog", { name: photo.sheetTitle });

    fireEvent.change(cameraInput(), { target: { files: [image("c.heic", "image/heic")] } });
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.badType);
    expect(within(sheet).queryByRole("img")).toBeNull();
    expect(within(sheet).queryByRole("button", { name: photo.send })).toBeNull();
    expect(within(sheet).getByRole("button", { name: photo.retake })).toBeInTheDocument();

    fireEvent.change(cameraInput(), {
      target: { files: [image("c.jpg", "image/jpeg", 16 * 1024 * 1024)] },
    });
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(photo.errors.tooLarge);

    expect(upload).not.toHaveBeenCalled();
  });
});

describe("ReportSheet", () => {
  it("sends the chosen type and message, then thanks the reporter", async () => {
    const user = userEvent.setup();
    const send = vi
      .spyOn(kashrootApi, "reportRestaurant")
      .mockResolvedValue({ flag_id: "mock-flag-3", state: "open" });
    renderHe(<ReportSheet restaurantId="r-1" certificateId="c-1" onClose={vi.fn()} />);

    const submit = screen.getByRole("button", { name: report.submit });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: report.types.expired_certificate }));
    await user.type(screen.getByLabelText(report.messageLabel), "  פג בחודש שעבר ");
    await user.click(submit);

    expect(send).toHaveBeenCalledWith("r-1", {
      type: "expired_certificate",
      certificate_id: "c-1",
      message: "פג בחודש שעבר",
    });
    expect(await screen.findByText(report.sent)).toBeInTheDocument();
  });

  it("leaves out certificate_id and message when neither is given, and shows an error on failure", async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(kashrootApi, "reportRestaurant").mockRejectedValue(new ApiError(500, "x"));
    renderHe(<ReportSheet restaurantId="r-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: report.types.closed }));
    await user.click(screen.getByRole("button", { name: report.submit }));

    expect(send).toHaveBeenCalledWith("r-1", { type: "closed" });
    expect(await screen.findByRole("alert")).toHaveTextContent(report.error);
  });

  it("maps a 429 to a friendly rate-limit message", async () => {
    const user = userEvent.setup();
    vi.spyOn(kashrootApi, "reportRestaurant").mockRejectedValue(new ApiError(429, "rate_limited"));
    renderHe(<ReportSheet restaurantId="r-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: report.types.closed }));
    await user.click(screen.getByRole("button", { name: report.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(report.rateLimited);
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

  it("an upload turns the named certificate pending, and a second is refused", async () => {
    const before = await mockRestaurant("r-katzefet", PROFILE, NOW);
    expect(before.certificates[0]?.photo_status).toBe("none");

    await mockUploadCertificatePhoto("r-katzefet", "c-katzefet-1", image());
    const after = await mockRestaurant("r-katzefet", PROFILE, NOW);
    expect(after.certificates[0]?.photo_status).toBe("pending");
    expect(after.certificates[0]?.photo_url).toBeNull();
    expect(after.kashrut).toEqual(before.kashrut);

    await expect(
      mockUploadCertificatePhoto("r-katzefet", "c-katzefet-1", image()),
    ).rejects.toMatchObject({
      status: 409,
      message: "photo_pending",
    });
    await expect(
      mockUploadCertificatePhoto("r-nougatine", "c-nougatine-1", image()),
    ).rejects.toMatchObject({
      status: 409,
      message: "photo_exists",
    });
    await expect(
      mockUploadCertificatePhoto("r-sushi-bvg", "c-does-not-exist", image()),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      mockUploadCertificatePhoto("r-katzefet", "c-nougatine-1", image()),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a report is recorded and changes nothing", async () => {
    const before = await mockRestaurant("r-katzefet", PROFILE, NOW);
    await kashrootApi.reportRestaurant("r-katzefet", {
      type: "closed",
      certificate_id: "c-katzefet-1",
    });
    expect(mockFlags()).toEqual([
      {
        restaurant_id: "r-katzefet",
        body: { type: "closed", certificate_id: "c-katzefet-1" },
      },
    ]);
    expect((await mockRestaurant("r-katzefet", PROFILE, NOW)).kashrut).toEqual(before.kashrut);
  });

  it("rejects a certificate_id that belongs to a different restaurant", async () => {
    await expect(
      kashrootApi.reportRestaurant("r-katzefet", {
        type: "other",
        certificate_id: "c-nougatine-1",
      }),
    ).rejects.toMatchObject({ status: 404 });
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
    // No profile yet: the facts page, whose call to action opens onboarding.
    await user.click(await screen.findByRole("link", { name: he.publicRestaurant.cta }));
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
