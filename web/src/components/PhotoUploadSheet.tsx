/**
 * The bottom sheet behind "Upload certificate photo". Presentational: the slot that
 * opens it owns the file, the request and the outcome, and this draws whichever step
 * it is on —
 *
 *   - `choose`: two thumb-sized rows, the camera or the gallery, and Cancel;
 *   - `preview`: the picked photo, full width, with Send and Retake — nothing leaves
 *     the phone until the person has seen what they are sending;
 *   - `uploading`: the same preview under an indeterminate bar, actions held;
 *   - `sent`: a thank-you that says a person reviews it and nothing changes yet;
 *   - `error`: what went wrong, with the one next step that can fix it.
 */

import { AlertCircle, Camera, CheckCircle2, ImagePlus, RotateCcw } from "lucide-react";
import { useId } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { Strings } from "../i18n/strings";
import { BottomSheet } from "./BottomSheet";
import { CloseIcon } from "./icons";

export type SheetStep = "choose" | "preview" | "uploading" | "sent" | "error";
export type PhotoSource = "camera" | "gallery";
export type PhotoErrorKey = keyof Strings["restaurant"]["photo"]["errors"];

/** Errors a fresh pick can fix, errors a resend can fix, and ones nothing here can. */
const PICK_AGAIN: readonly PhotoErrorKey[] = ["badType", "tooLarge"];
const SEND_AGAIN: readonly PhotoErrorKey[] = ["network", "generic", "rateLimited"];

export function PhotoUploadSheet({
  step,
  source,
  previewUrl,
  errorKey,
  onPick,
  onSend,
  onClose,
}: {
  step: SheetStep;
  source: PhotoSource;
  /** The picked photo, when there is one to show. */
  previewUrl: string | null;
  errorKey: PhotoErrorKey | null;
  onPick: (source: PhotoSource) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const strings = t.restaurant.photo;
  const ids = useId();

  const repick = source === "camera" ? strings.retake : strings.chooseAnother;
  const showPreview = previewUrl !== null && step !== "choose" && step !== "sent";
  const title =
    step === "sent" ? strings.sent : showPreview ? strings.previewTitle : strings.sheetTitle;

  return (
    <BottomSheet
      className="photo-sheet"
      label={strings.sheetTitle}
      closeLabel={strings.close}
      onClose={onClose}
    >
      <div className="sheet__head">
        <h2 className="sheet__title">{title}</h2>
        <button
          type="button"
          className="circle glass bsheet__close"
          aria-label={strings.close}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </div>

      {step === "choose" && (
        <>
          <p className="hint sheet__note">{strings.sheetLead}</p>
          <div className="bsheet__actions">
            {(
              [
                ["camera", Camera, strings.takePhoto, strings.takePhotoHint],
                ["gallery", ImagePlus, strings.chooseFile, strings.chooseFileHint],
              ] as const
            ).map(([key, Icon, label, hint]) => (
              <button
                key={key}
                type="button"
                className="bsheet__action glass"
                aria-labelledby={`${ids}-${key}`}
                aria-describedby={`${ids}-${key}-hint`}
                onClick={() => onPick(key)}
              >
                <span className="bsheet__action-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className="bsheet__action-text">
                  <span id={`${ids}-${key}`} className="bsheet__action-label">
                    {label}
                  </span>
                  <span id={`${ids}-${key}-hint`} className="bsheet__action-hint">
                    {hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="cta cta--ghost bsheet__button" onClick={onClose}>
            {strings.cancel}
          </button>
        </>
      )}

      {showPreview && (
        <figure className="photo-sheet__preview">
          <img src={previewUrl} alt={strings.previewAlt} />
          {step === "uploading" && (
            <div
              className="photo-sheet__progress"
              role="progressbar"
              aria-label={strings.uploading}
              aria-busy="true"
            >
              <span />
            </div>
          )}
        </figure>
      )}

      {(step === "preview" || step === "uploading") && (
        <>
          <p className="hint sheet__note">{strings.previewLead}</p>
          <button
            type="button"
            className="cta bsheet__button"
            disabled={step === "uploading"}
            onClick={onSend}
          >
            {step === "uploading" ? strings.uploading : strings.send}
          </button>
          <button
            type="button"
            className="cta cta--ghost bsheet__button"
            disabled={step === "uploading"}
            onClick={() => onPick(source)}
          >
            <RotateCcw size={16} aria-hidden="true" />
            {repick}
          </button>
        </>
      )}

      {step === "sent" && (
        <div className="photo-sheet__result photo-sheet__result--ok" role="status">
          <CheckCircle2 size={44} aria-hidden="true" />
          <p>{strings.sentLead}</p>
          <button type="button" className="cta bsheet__button" onClick={onClose}>
            {strings.done}
          </button>
        </div>
      )}

      {step === "error" && errorKey && (
        <>
          <p className="photo-sheet__error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{strings.errors[errorKey]}</span>
          </p>
          {SEND_AGAIN.includes(errorKey) && previewUrl && (
            <button type="button" className="cta bsheet__button" onClick={onSend}>
              {strings.tryAgain}
            </button>
          )}
          {(PICK_AGAIN.includes(errorKey) || SEND_AGAIN.includes(errorKey)) && (
            <button
              type="button"
              className={`cta bsheet__button${SEND_AGAIN.includes(errorKey) && previewUrl ? " cta--ghost" : ""}`}
              onClick={() => onPick(source)}
            >
              {repick}
            </button>
          )}
          <button type="button" className="cta cta--ghost bsheet__button" onClick={onClose}>
            {PICK_AGAIN.includes(errorKey) || SEND_AGAIN.includes(errorKey)
              ? strings.cancel
              : strings.close}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
