/**
 * The certificate card's photo slot — the one place a visitor can add evidence.
 *
 * Three states, straight from the API's `photo_status`:
 *   - `accepted`: the moderator-approved photo, tap for full size, and a small
 *     report button as the only action. No second upload.
 *   - `pending`: a photo is waiting in the moderation queue. Nothing to do here, so
 *     nothing is offered — one pending photo per certificate is the limit.
 *   - `none`: an upload button with two ways in, the camera or a file.
 *
 * An upload is evidence for a human to review, never a fact: it lands as pending and
 * the verdict above does not move until a moderator accepts it on the server.
 */

import { Camera, Clock, Flag, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { ApiError, PHOTO_MAX_BYTES, PHOTO_MIME_TYPES, kashrootApi, photoConflict } from "../api";
import type { CertificateEvidenceOut, PhotoStatus } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import type { Strings } from "../i18n/strings";

type Phase = "idle" | "uploading" | "sent" | "error";
type ErrorKey = keyof Strings["restaurant"]["photo"]["errors"];

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);

  const status: PhotoStatus = localStatus ?? evidence.photo_status;
  const photoUrl = status === "accepted" ? evidence.photo_url : null;

  useEffect(() => {
    if (!menuOpen && !viewerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setViewerOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (menuRoot.current && !menuRoot.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen, viewerOpen]);

  function fail(key: ErrorKey) {
    setErrorKey(key);
    setPhase("error");
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again after an error still fires a change.
    event.target.value = "";
    setMenuOpen(false);
    if (!file) return;
    if (!PHOTO_MIME_TYPES.includes(file.type)) return fail("badType");
    if (file.size > PHOTO_MAX_BYTES) return fail("tooLarge");

    setErrorKey(null);
    setPhase("uploading");
    try {
      await kashrootApi.uploadCertificatePhoto(restaurantId, evidence.certificate_id, file);
      setLocalStatus("pending");
      setPhase("sent");
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

  const statusLine =
    phase === "sent" ? strings.sent : phase === "error" && errorKey ? strings.errors[errorKey] : null;

  return (
    <>
      <div className="cert-photo" ref={menuRoot}>
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
              <Flag size={12} aria-hidden="true" />
              <span>{t.restaurant.report.button}</span>
            </button>
          </>
        ) : status === "pending" || status === "accepted" ? (
          <div className="cert-card__photo stripe-flat cert-photo__pending">
            <Clock size={16} aria-hidden="true" />
            <span className="cert-photo__badge">{strings.pending}</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="cert-card__photo cert-photo__upload"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={phase === "uploading"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <ImagePlus size={18} aria-hidden="true" />
              <span>{phase === "uploading" ? strings.uploading : strings.upload}</span>
            </button>
            {menuOpen && (
              <div className="cert-photo__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera size={15} aria-hidden="true" />
                  {strings.takePhoto}
                </button>
                <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}>
                  <ImagePlus size={15} aria-hidden="true" />
                  {strings.chooseFile}
                </button>
              </div>
            )}
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
              aria-label={strings.takePhoto}
              onChange={handlePick}
            />
            <input
              ref={fileInput}
              type="file"
              accept={PHOTO_MIME_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              aria-label={strings.chooseFile}
              onChange={handlePick}
            />
          </>
        )}
      </div>

      {statusLine && (
        <p
          className={`cert-photo__status${phase === "error" ? " cert-photo__status--error" : ""}`}
          role="status"
        >
          {statusLine}
        </p>
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
              className="circle circle--sm glass photo-viewer__close"
              aria-label={strings.close}
              onClick={() => setViewerOpen(false)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
