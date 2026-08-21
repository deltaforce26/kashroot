import { Fragment, useEffect, useState } from "react";

import { api, ApiError } from "../api/client";
import type {
  CertificateOut,
  DegradeRequest,
  EvidencePhotoOut,
  ExpiryQueueItem,
  VerifyRenewalRequest,
} from "../api/types";
import { DEFAULT_EXPIRY_WINDOW_DAYS } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PhotoUploadButton } from "../components/PhotoUploadButton";
import {
  CertificateSummary,
  certifierName,
  restaurantName,
  Data,
  shortId,
  todayInIsrael,
} from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";

const WINDOW_OPTIONS = [7, 14, 30];

export function Expiry() {
  const [days, setDays] = useState(DEFAULT_EXPIRY_WINDOW_DAYS);
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<ExpiryQueueItem>("/api/admin/queues/expiry", {
      days,
      city: city || undefined,
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>Expiry queue</h2>
      <div className="controls">
        <label className="control">
          Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message={`Queue is clear — no certificates expiring within ${days} days.`} />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>City</th>
              <th>Certificate</th>
              <th>Valid until</th>
              <th>Expiry</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const c = item.certificate;
              return (
                <Fragment key={c.id}>
                  <tr
                    className="row-clickable"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <td>{restaurantName(item.restaurant)}</td>
                    <td>
                      <Data value={item.restaurant.city_he ?? item.restaurant.city_slug} />
                    </td>
                    <td>
                      <Data value={certifierName(c)} /> · {c.level}
                    </td>
                    <td>{c.valid_until ?? "—"}</td>
                    <td>
                      {item.days_until_expiry < 0 ? (
                        <span className="badge badge-expired">
                          expired {-item.days_until_expiry}d ago
                        </span>
                      ) : (
                        <span className="badge badge-pending">in {item.days_until_expiry}d</span>
                      )}
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr className="row-detail">
                      <td colSpan={5}>
                        <ExpiryDetail
                          item={item}
                          onDone={() => {
                            setExpandedId(null);
                            removeItem((x) => x.certificate.id === c.id);
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

function ExpiryDetail({ item, onDone }: { item: ExpiryQueueItem; onDone: () => void }) {
  const { showToast } = useToast();
  const cert = item.certificate;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Degrade-now form
  const [degradeReason, setDegradeReason] = useState("");
  const [degradeValidation, setDegradeValidation] = useState<string | null>(null);
  const [confirmingDegrade, setConfirmingDegrade] = useState(false);

  // Verify-renewal form
  const [validUntil, setValidUntil] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [photoKey, setPhotoKey] = useState("");
  const [renewalValidation, setRenewalValidation] = useState<string | null>(null);
  const [confirmingRenewal, setConfirmingRenewal] = useState(false);

  // This certificate's evidence photos; only ACCEPTED ones qualify as renewal
  // evidence (the server enforces the same rule with a 409).
  const [photos, setPhotos] = useState<EvidencePhotoOut[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<EvidencePhotoOut[]>(`/api/admin/certificates/${cert.id}/photos`)
      .then((list) => {
        if (!cancelled) setPhotos(list);
      })
      .catch(() => {
        // Selector stays empty — note/URL evidence still works.
      });
    return () => {
      cancelled = true;
    };
  }, [cert.id]);
  const acceptedPhotos = photos.filter((p) => p.status === "accepted");

  async function degradeNow() {
    setActionError(null);
    setBusy(true);
    const body: DegradeRequest = { reason: degradeReason.trim() };
    try {
      await api<CertificateOut>(`/api/admin/certificates/${cert.id}/degrade`, {
        method: "POST",
        body,
      });
      showToast(
        "Certificate degraded — it now shows as UNKNOWN to users. This action is audited and cannot be undone.",
      );
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed unexpectedly");
    } finally {
      setBusy(false);
      setConfirmingDegrade(false);
    }
  }

  /** Mirrors the API's fail-safe rules: future date, valid http(s) URL, note >= 10 chars. */
  function validateRenewal(): boolean {
    const note = evidenceNote.trim();
    const url = evidenceUrl.trim();
    // Civil date in Israel, matching the server's ISRAEL_TZ rule.
    const today = todayInIsrael();
    if (!validUntil) {
      setRenewalValidation("A new valid-until date is required.");
      return false;
    }
    if (validUntil <= today) {
      setRenewalValidation("Valid-until must be strictly in the future.");
      return false;
    }
    if (!note && !url && !photoKey) {
      setRenewalValidation(
        "Renewal evidence required: provide an evidence note, URL or accepted photo (fail-safe: no evidence, no restore).",
      );
      return false;
    }
    if (note && note.length < 10) {
      setRenewalValidation("Evidence note must be at least 10 characters.");
      return false;
    }
    if (url && !isHttpUrl(url)) {
      setRenewalValidation("Evidence URL must be a valid http(s) URL.");
      return false;
    }
    setRenewalValidation(null);
    return true;
  }

  async function verifyRenewal() {
    setActionError(null);
    setBusy(true);
    const body: VerifyRenewalRequest = {
      valid_until: validUntil,
      evidence_note: evidenceNote.trim() || null,
      evidence_url: evidenceUrl.trim() || null,
      evidence_photo_key: photoKey || null,
    };
    try {
      await api<CertificateOut>(`/api/admin/certificates/${cert.id}/verify-renewal`, {
        method: "POST",
        body,
      });
      showToast(`Renewal verified until ${validUntil} — recorded in the audit log.`);
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed unexpectedly");
    } finally {
      setBusy(false);
      setConfirmingRenewal(false);
    }
  }

  return (
    <div className="detail">
      <CertificateSummary certificate={cert} />
      <PhotoUploadButton
        certificateId={cert.id}
        onUploaded={(photo) => setPhotos((prev) => [...prev, photo])}
      />
      {actionError && <p className="field-error">{actionError}</p>}
      <div className="expiry-forms">
        <div className="expiry-form">
          <h4>Degrade now</h4>
          <label className="note-label">
            Reason (required)
            <textarea
              value={degradeReason}
              onChange={(e) => setDegradeReason(e.target.value)}
              rows={2}
              placeholder="Why is this certificate being degraded?"
            />
          </label>
          {degradeValidation && <p className="field-error">{degradeValidation}</p>}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!degradeReason.trim()) {
                setDegradeValidation("A reason is required to degrade.");
                return;
              }
              setDegradeValidation(null);
              setConfirmingDegrade(true);
            }}
          >
            Degrade now
          </button>
        </div>
        <div className="expiry-form">
          <h4>Verify renewal</h4>
          <label className="note-label">
            New valid-until date
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <label className="note-label">
            Evidence note
            <textarea
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              rows={2}
              placeholder="e.g. called the certifier office, confirmed renewal"
            />
          </label>
          <label className="note-label">
            Evidence URL
            <input
              type="url"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="note-label">
            Evidence photo (accepted only)
            <select value={photoKey} onChange={(e) => setPhotoKey(e.target.value)}>
              <option value="">none</option>
              {acceptedPhotos.map((p) => (
                <option key={p.id} value={p.storage_key}>
                  {p.content_type} · uploaded {p.uploaded_at.slice(0, 10)} · {shortId(p.id)}
                </option>
              ))}
            </select>
          </label>
          {renewalValidation && <p className="field-error">{renewalValidation}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (validateRenewal()) setConfirmingRenewal(true);
            }}
          >
            Verify renewal
          </button>
        </div>
      </div>
      {confirmingDegrade && (
        <ConfirmDialog
          title="Degrade certificate now?"
          confirmLabel="Degrade certificate"
          busy={busy}
          onCancel={() => setConfirmingDegrade(false)}
          onConfirm={() => void degradeNow()}
        >
          <p>
            The certificate will show as <strong>UNKNOWN</strong> to users. The change is audited
            and cannot be undone from the console.
          </p>
        </ConfirmDialog>
      )}
      {confirmingRenewal && (
        <ConfirmDialog
          title="Verify renewal?"
          confirmLabel="Verify renewal"
          busy={busy}
          onCancel={() => setConfirmingRenewal(false)}
          onConfirm={() => void verifyRenewal()}
        >
          <p>
            This is the only status-raising action in the product: it marks this certificate as{" "}
            <strong>verified-renewed and active to users</strong>, valid until {validUntil}, based
            on the evidence you provided. The change is audited.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
