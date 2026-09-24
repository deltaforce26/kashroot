/**
 * The certificate card's photo slot — the one place a visitor can add evidence.
 *
 * Three states, straight from the API's `photo_status`:
 *   - `accepted`: the moderator-approved photo, tap for full size, and a small
 *     report button as the only action. No second upload.
 *   - `pending`: a photo is waiting in the moderation queue. Nothing to do here, so
 *     nothing is offered — one pending photo per certificate is the limit.
 *   - `none`: a full-width "Upload certificate photo" button under the card (the
 *     empty photo box opens the same thing), leading to a bottom sheet with two ways
 *     in — the camera or the gallery — then a preview to confirm before anything is
 *     sent.
 *
 * An upload is evidence for a human to review, never a fact: it lands as pending and
 * the verdict above does not move until a moderator accepts it on the server.
 */

import { Camera, Clock, Flag, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, PHOTO_MAX_BYTES, PHOTO_MIME_TYPES, kashrootApi, photoConflict } from "../api";
import type { CertificateEvidenceOut, PhotoStatus } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import {
  PhotoUploadSheet,
  type PhotoErrorKey,
  type PhotoSource,
  type SheetStep,
} from "./PhotoUploadSheet";

/** A preview URL for the picked file; absent in engines without object URLs. */
function objectUrl(file: File): string | null {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
}

export function CertificatePhotoSlot({
  restaurantId,
  evidence,
  onReport,
  onStale,
}: {
  restaurantId: string;
  evidence: Pick<CertificateEvidenceOut, "certificate_id" | "photo_status" | "photo_url">;
  /** Opens the report sheet; the button lives here only when a photo is shown. */
  onReport: () => void;
  /** The server knows of a photo this screen does not — refetch the detail. */
  onStale?: () => void;
}) {
  const { t } = useI18n();
  const strings = t.restaurant.photo;

  // A successful upload flips the slot to pending without waiting for a refetch.
  const [localStatus, setLocalStatus] = useState<PhotoStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [step, setStep] = useState<SheetStep>("choose");
  const [source, setSource] = useState<PhotoSource>("camera");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<PhotoErrorKey | null>(null);
  // The card's own line once the sheet is gone: "sent, pending approval".
  const [sent, setSent] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const status: PhotoStatus = localStatus ?? evidence.photo_status;
  const photoUrl = status === "accepted" ? evidence.photo_url : null;

  // One object URL per picked file, released when the file changes or the slot goes.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = objectUrl(file);
    setPreviewUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen]);

  function openSheet() {
    setStep("choose");
    setFile(null);
    setErrorKey(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setFile(null);
    setErrorKey(null);
  }

  function fail(key: PhotoErrorKey) {
    setErrorKey(key);
    setStep("error");
  }

  function pick(from: PhotoSource) {
    setSource(from);
    (from === "camera" ? cameraInput : fileInput).current?.click();
  }

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    // Cleared so picking the same file again after an error still fires a change.
    event.target.value = "";
    if (!picked) return;
    setSource(event.target === cameraInput.current ? "camera" : "gallery");
    // The checks run before the preview, so nothing unsendable is ever offered.
    if (!PHOTO_MIME_TYPES.includes(picked.type)) {
      setFile(null);
      return fail("badType");
    }
    if (picked.size > PHOTO_MAX_BYTES) {
      setFile(null);
      return fail("tooLarge");
    }
    setErrorKey(null);
    setFile(picked);
    setStep("preview");
  }

  async function send() {
    if (!file || step === "uploading") return;
    setErrorKey(null);
    setStep("uploading");
    try {
      await kashrootApi.uploadCertificatePhoto(restaurantId, evidence.certificate_id, file);
      setLocalStatus("pending");
      setSent(true);
      setStep("sent");
    } catch (error) {
      if (!(error instanceof ApiError)) return fail("generic");
      if (error.isNetwork) return fail("network");
      const conflict = photoConflict(error);
      if (conflict === "photo_pending") {
        setLocalStatus("pending");
        return fail("pending");
      }
      if (conflict === "photo_exists") {
        fail("exists");
        onStale?.();
        return;
      }
      if (error.status === 413) return fail("tooLarge");
      if (error.status === 415) return fail("badType");
      fail("generic");
    }
  }

  return (
    <>
      <div className="cert-photo">
        {status === "accepted" && photoUrl ? (
          <>
            <button
              type="button"
              className="cert-card__photo cert-photo__thumb"
              aria-label={strings.view}
              onClick={() => setViewerOpen(true)}
            >
              <img src={photoUrl} alt={strings.alt} />
            </button>
            <button type="button" className="cert-photo__report" onClick={onReport}>
              <Flag size={14} aria-hidden="true" />
              <span>{t.restaurant.report.button}</span>
            </button>
          </>
        ) : status === "pending" || status === "accepted" ? (
          <div className="cert-card__photo stripe-flat cert-photo__pending">
            <Clock size={16} aria-hidden="true" />
            <span className="cert-photo__badge">{strings.pending}</span>
          </div>
        ) : (
          // A second, bigger target for the same sheet. Out of the tab order and the
          // accessibility tree: the labelled button below is the one control.
          <button
            type="button"
            className="cert-card__photo cert-photo__add"
            tabIndex={-1}
            aria-hidden="true"
            onClick={openSheet}
          >
            <Camera size={26} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {status === "none" && (
        <div className="cert-photo__cta">
          <button
            type="button"
            className="cta cert-photo__upload"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={openSheet}
          >
            <Camera size={20} aria-hidden="true" />
            <span>{strings.upload}</span>
          </button>
          <p className="cert-photo__hint">{strings.uploadHint}</p>
          {/* Mobile browsers open the camera for `capture`; desktop falls back to a
              file dialog. The second input keeps to the types the server takes. */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="photo-camera-input"
            onChange={handlePick}
          />
          <input
            ref={fileInput}
            type="file"
            accept={PHOTO_MIME_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="photo-gallery-input"
            onChange={handlePick}
          />
        </div>
      )}

      {sent && !sheetOpen && (
        <p className="cert-photo__status" role="status">
          {strings.sent}
        </p>
      )}

      {sheetOpen && (
        <PhotoUploadSheet
          step={step}
          source={source}
          previewUrl={previewUrl}
          errorKey={errorKey}
          onPick={pick}
          onSend={() => void send()}
          onClose={closeSheet}
        />
      )}

      {/* Portalled: the card is glass, and a backdrop filter traps fixed children. */}
      {viewerOpen &&
        photoUrl &&
        createPortal(
          <>
            <button
              type="button"
              className="photo-viewer__scrim"
              aria-label={strings.close}
              onClick={() => setViewerOpen(false)}
            />
            <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={strings.alt}>
              <img src={photoUrl} alt={strings.alt} />
              <button
                type="button"
                className="circle glass photo-viewer__close"
                aria-label={strings.close}
                onClick={() => setViewerOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
