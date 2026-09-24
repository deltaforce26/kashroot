/**
 * The report sheet — "something here is wrong", in two taps.
 *
 * A report opens a flag in the moderation queue and does nothing else: community
 * signals never raise a status, and never move one on their own either. The sheet
 * says so after sending, so nobody expects the verdict to change under them.
 */

import { useEffect, useState } from "react";
import { FLAG_MESSAGE_MAX, FLAG_TYPES, kashrootApi } from "../api";
import type { FlagType } from "../api/types";
import { useI18n } from "../i18n/I18nProvider";
import { CloseIcon } from "./icons";

type Phase = "idle" | "sending" | "sent" | "error";

export function ReportSheet({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  const { t } = useI18n();
  const strings = t.restaurant.report;

  const [type, setType] = useState<FlagType | null>(null);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!type || phase === "sending") return;
    setPhase("sending");
    const trimmed = message.trim();
    try {
      await kashrootApi.reportRestaurant(restaurantId, {
        type,
        ...(trimmed ? { message: trimmed } : {}),
      });
      setPhase("sent");
    } catch {
      setPhase("error");
    }
  }

  return (
    <>
      <button type="button" className="sheet__scrim" aria-label={strings.close} onClick={onClose} />
      <section className="sheet report-sheet" role="dialog" aria-modal="true" aria-label={strings.title}>
        <div className="sheet__head">
          <h2 className="sheet__title">{strings.title}</h2>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={strings.close}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {phase === "sent" ? (
          <div className="report-sheet__done" role="status">
            <strong>{strings.sent}</strong>
            <p className="hint sheet__note">{strings.sentLead}</p>
            <button type="button" className="cta" onClick={onClose}>
              {strings.close}
            </button>
          </div>
        ) : (
          <form
            className="report-sheet__form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <span className="filter-group__title" id="report-type-label">
              {strings.lead}
            </span>
            <div className="report-sheet__types" role="group" aria-labelledby="report-type-label">
              {FLAG_TYPES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="tag"
                  aria-pressed={type === value}
                  onClick={() => setType(value)}
                >
                  {strings.types[value]}
                </button>
              ))}
            </div>

            <label className="filter-group__title" htmlFor="report-message">
              {strings.messageLabel}
            </label>
            <textarea
              id="report-message"
              className="report-sheet__message glass"
              rows={3}
              maxLength={FLAG_MESSAGE_MAX}
              placeholder={strings.messagePlaceholder}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />

            {phase === "error" && (
              <p className="hint sheet__note report-sheet__error" role="alert">
                {strings.error}
              </p>
            )}

            <button type="submit" className="cta" disabled={!type || phase === "sending"}>
              {phase === "sending" ? strings.sending : strings.submit}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
