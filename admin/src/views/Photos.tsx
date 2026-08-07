import { Fragment, useState } from "react";

import { api, ApiError } from "../api/client";
import type {
  CertificateAttribute,
  EvidencePhotoOut,
  PhotoQueueItem,
  PhotoReviewDecision,
  ReviewPhotoRequest,
} from "../api/types";
import { CERTIFICATE_ATTRIBUTES, SOURCE_AUTHORITY } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  CertificateSummary,
  certifierName,
  Data,
  formatDateTime,
  restaurantName,
  todayInIsrael,
} from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";

export function Photos() {
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<PhotoQueueItem>("/api/admin/queues/photos", {
      city: city || undefined,
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>Photos queue</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="Queue is clear — no evidence photos awaiting review." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Certifier</th>
              <th>Uploaded</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const p = item.photo;
              return (
                <Fragment key={p.id}>
                  <tr
                    className="row-clickable"
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  >
                    <td>{restaurantName(item.restaurant)}</td>
                    <td>
                      <Data value={certifierName(item.certificate)} /> · {item.certificate.level}
                    </td>
                    <td>
                      <Data value={p.uploaded_by} />
                      <div className="muted">{formatDateTime(p.uploaded_at)}</div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <PhotoThumb photo={p} />
                    </td>
                  </tr>
                  {expandedId === p.id && (
                    <tr className="row-detail">
                      <td colSpan={4}>
                        <PhotoReviewPanel
                          item={item}
                          onDone={() => {
                            setExpandedId(null);
                            removeItem((x) => x.photo.id === p.id);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <Pager total={total} offset={offset} shown={items.length} onPrev={prev} onNext={next} />
    </section>
  );
}

/** Inline thumbnail for images; a labeled link for PDFs (nothing to inline). */
function PhotoThumb({ photo }: { photo: EvidencePhotoOut }) {
  if (!photo.view_url) return <span className="muted">no preview</span>;
  if (photo.content_type === "application/pdf") {
    return (
      <a href={photo.view_url} target="_blank" rel="noreferrer">
        PDF document — open
      </a>
    );
  }
  return (
    <a href={photo.view_url} target="_blank" rel="noreferrer">
      <img className="photo-thumb" src={photo.view_url} alt="certificate evidence" />
    </a>
  );
}

/**
 * Editor position per attribute. "unknown" = untouched, absent from the payload
 * (the certificate keeps whatever it has). "clear" = explicit null in the payload,
 * clearing a previously recorded value back to unknown (doubt → UNKNOWN fail-safe);
 * only offered when the certificate already records a value for that attribute.
 */
type TriState = "unknown" | "yes" | "no" | "clear";

function emptyTriState(): Record<CertificateAttribute, TriState> {
  return Object.fromEntries(CERTIFICATE_ATTRIBUTES.map((a) => [a, "unknown"])) as Record<
    CertificateAttribute,
    TriState
  >;
}

function PhotoReviewPanel({ item, onDone }: { item: PhotoQueueItem; onDone: () => void }) {
  const { showToast } = useToast();
  const photo = item.photo;
  const cert = item.certificate;

  const [decision, setDecision] = useState<PhotoReviewDecision>("accept");
  const [note, setNote] = useState("");
  const [attrs, setAttrs] = useState<Record<CertificateAttribute, TriState>>(emptyTriState);
  const [validUntil, setValidUntil] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingAccept, setConfirmingAccept] = useState(false);

  const rejecting = decision === "reject";

  /**
   * ONLY the touched keys — an untouched attribute stays absent (fail-safe).
   * An explicit clear is sent as null, which erases the recorded value.
   */
  function touchedAttributes(): Partial<Record<CertificateAttribute, boolean | null>> {
    const touched: Partial<Record<CertificateAttribute, boolean | null>> = {};
    for (const key of CERTIFICATE_ATTRIBUTES) {
      if (attrs[key] === "yes") touched[key] = true;
      else if (attrs[key] === "no") touched[key] = false;
      else if (attrs[key] === "clear") touched[key] = null;
    }
    return touched;
  }

  function selectDecision(next: PhotoReviewDecision) {
    setDecision(next);
    if (next === "reject") {
      // Mirror the server's schema-level refusal: a rejected photo can never
      // write attributes or an expiry onto the certificate.
      setAttrs(emptyTriState());
      setValidUntil("");
    }
  }

  /** Mirrors server rules: note >= 5 chars; valid_until strictly future. */
  function validate(): boolean {
    if (note.trim().length < 5) {
      setValidation("A review note is required (at least 5 characters).");
      return false;
    }
    if (decision === "accept" && validUntil) {
      // Civil date in Israel, matching the server's ISRAEL_TZ rule.
      const today = todayInIsrael();
      if (validUntil <= today) {
        setValidation("Valid-until must be strictly in the future.");
        return false;
      }
    }
    setValidation(null);
    return true;
  }

  async function submit() {
    setActionError(null);
    setBusy(true);
    const body: ReviewPhotoRequest = { decision, note: note.trim() };
    if (decision === "accept") {
      const touched = touchedAttributes();
      if (Object.keys(touched).length > 0) body.attributes = touched;
      if (validUntil) body.valid_until = validUntil;
    }
    try {
      await api<EvidencePhotoOut>(`/api/admin/photos/${photo.id}/review`, {
        method: "POST",
        body,
      });
      showToast(
        decision === "accept"
          ? "Photo accepted — the recorded facts are written to the certificate and audited."
          : "Photo rejected — nothing was written to the certificate. The decision is audited.",
      );
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed unexpectedly");
    } finally {
      setBusy(false);
      setConfirmingAccept(false);
    }
  }

  const touched = touchedAttributes();
  const touchedEntries = Object.entries(touched) as Array<[CertificateAttribute, boolean | null]>;
  const setEntries = touchedEntries.filter(([, v]) => v !== null) as Array<
    [CertificateAttribute, boolean]
  >;
  const clearedEntries = touchedEntries.filter(([, v]) => v === null);
  const sourceUpgraded = SOURCE_AUTHORITY.moderator_verified > SOURCE_AUTHORITY[cert.source];

  return (
    <div className="detail">
      <CertificateSummary certificate={cert} />
      <div className="photo-viewer">
        {photo.view_url ? (
          photo.content_type === "application/pdf" ? (
            <a href={photo.view_url} target="_blank" rel="noreferrer">
              PDF document — open in new tab
            </a>
          ) : (
            <a href={photo.view_url} target="_blank" rel="noreferrer" title="Open full size in new tab">
              <img src={photo.view_url} alt="certificate evidence (full)" />
            </a>
          )
        ) : (
          <span className="muted">no preview available</span>
        )}
        <div className="muted">
          {photo.content_type} · {(photo.size_bytes / 1024).toFixed(0)} KB · uploaded by{" "}
          <Data value={photo.uploaded_by} /> at {formatDateTime(photo.uploaded_at)}
        </div>
      </div>

      <fieldset className="decision-group">
        <legend>Decision</legend>
        <label>
          <input
            type="radio"
            name={`decision-${photo.id}`}
            checked={decision === "accept"}
            onChange={() => selectDecision("accept")}
          />{" "}
          Accept — the photo genuinely shows this certificate
        </label>
        <label>
          <input
            type="radio"
            name={`decision-${photo.id}`}
            checked={decision === "reject"}
            onChange={() => selectDecision("reject")}
          />{" "}
          Reject — unusable or does not match this certificate
        </label>
      </fieldset>

      <div className="tristate-editor">
        <h4>Certificate attributes shown in the photo</h4>
        <p className="muted">
          Only mark what the photo actually shows — an untouched attribute is not sent and stays
          unknown on the certificate.
        </p>
        {rejecting && (
          <p className="muted">A rejected photo never writes anything onto the certificate.</p>
        )}
        <div className="tristate-grid">
          {CERTIFICATE_ATTRIBUTES.map((key) => {
            const recorded: boolean | undefined = cert.attributes[key];
            return (
              <label key={key} className="tristate-row">
                {key}
                {recorded !== undefined && (
                  <span className="muted">currently: {recorded ? "yes" : "no"}</span>
                )}
                <select
                  value={attrs[key]}
                  disabled={rejecting}
                  onChange={(e) =>
                    setAttrs((prev) => ({ ...prev, [key]: e.target.value as TriState }))
                  }
                >
                  <option value="unknown">
                    {recorded !== undefined ? "not sent (keep current)" : "unknown (not sent)"}
                  </option>
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                  {recorded !== undefined && <option value="clear">clear to unknown</option>}
                </select>
              </label>
            );
          })}
        </div>
        <label className="note-label">
          Valid until (optional, as printed on the certificate)
          <input
            type="date"
            value={validUntil}
            disabled={rejecting}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </label>
      </div>

      <label className="note-label">
        Review note (required)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What does the photo show, and how did you verify it?"
        />
      </label>
      {validation && <p className="field-error">{validation}</p>}
      {actionError && <p className="field-error">{actionError}</p>}
      <div className="action-row">
        <button
          type="button"
          className={rejecting ? "danger" : undefined}
          disabled={busy}
          onClick={() => {
            if (!validate()) return;
            if (decision === "accept") setConfirmingAccept(true);
            else void submit();
          }}
        >
          {rejecting ? "Reject photo" : "Accept photo…"}
        </button>
      </div>

      {confirmingAccept && (
        <ConfirmDialog
          title="Accept photo and write these facts?"
          confirmLabel="Accept photo"
          busy={busy}
          onCancel={() => setConfirmingAccept(false)}
          onConfirm={() => void submit()}
        >
          <p>This review is audited and will write onto the certificate:</p>
          <ul>
            <li>
              {setEntries.length > 0
                ? `${setEntries.length} attribute${setEntries.length === 1 ? "" : "s"}: ` +
                  setEntries.map(([k, v]) => `${k}=${v ? "yes" : "no"}`).join(", ")
                : "no attribute changes"}
            </li>
            {clearedEntries.length > 0 && (
              <li>
                {`${clearedEntries.length} attribute${clearedEntries.length === 1 ? "" : "s"} cleared to unknown: `}
                {clearedEntries.map(([k]) => k).join(", ")}
              </li>
            )}
            <li>{validUntil ? `expiry ${validUntil}` : "no expiry change"}</li>
            <li>
              {sourceUpgraded
                ? "source upgraded to moderator_verified"
                : `source unchanged (already ${cert.source})`}
            </li>
          </ul>
          <p>
            The certificate state is untouched — restoring an expired certificate still requires
            verify-renewal.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
