import { Fragment, useState } from "react";

import { api, ApiError } from "../api/client";
import type { FlagOut, FlagOutcome, ResolveFlagRequest } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CertificateSummary, Data, restaurantName } from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";

export function Flags() {
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<FlagOut>("/api/admin/queues/flags", { city: city || undefined });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>Flags</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="Queue is clear — no open flags." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Flag type</th>
              <th>State</th>
              <th>Message</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {items.map((flag) => (
              <Fragment key={flag.id}>
                <tr
                  className="row-clickable"
                  onClick={() => setExpandedId(expandedId === flag.id ? null : flag.id)}
                >
                  <td>{restaurantName(flag.restaurant)}</td>
                  <td>{flag.type.replaceAll("_", " ")}</td>
                  <td>
                    {flag.state === "in_review" ? (
                      <span className="badge badge-pending">field check pending</span>
                    ) : (
                      <span className="badge">open</span>
                    )}
                  </td>
                  <td>
                    <Data value={flag.message} />
                  </td>
                  <td>{flag.created_at.slice(0, 10)}</td>
                </tr>
                {expandedId === flag.id && (
                  <tr className="row-detail">
                    <td colSpan={5}>
                      <FlagDetail
                        flag={flag}
                        onResolved={() => {
                          setExpandedId(null);
                          removeItem((f) => f.id === flag.id);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <Pager total={total} offset={offset} shown={items.length} onPrev={prev} onNext={next} />
    </section>
  );
}

function FlagDetail({ flag, onResolved }: { flag: FlagOut; onResolved: () => void }) {
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDegrade, setConfirmingDegrade] = useState(false);

  async function submit(outcome: FlagOutcome) {
    setActionError(null);
    setBusy(true);
    const body: ResolveFlagRequest = { outcome, note: note.trim() };
    try {
      await api<FlagOut>(`/api/admin/flags/${flag.id}/resolve`, { method: "POST", body });
      if (outcome === "confirmed_degrade") {
        showToast(
          "Certificate degraded — it now shows as UNKNOWN to users. This action is audited and cannot be undone.",
        );
      } else if (outcome === "dismissed") {
        showToast("Flag dismissed and audited — removed from queue.");
      } else {
        showToast("Sent for field check — restaurant added to the review queue.");
      }
      onResolved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed unexpectedly");
    } finally {
      setBusy(false);
      setConfirmingDegrade(false);
    }
  }

  /** API requires a note of at least 5 characters on every flag resolution. */
  function requireNote(): boolean {
    if (note.trim().length < 5) {
      setValidation("A note is required for every flag resolution (at least 5 characters).");
      return false;
    }
    setValidation(null);
    return true;
  }

  return (
    <div className="detail">
      <dl className="detail-grid">
        <dt>Restaurant</dt>
        <dd>
          {restaurantName(flag.restaurant)} — <Data value={flag.restaurant.address_he} />,{" "}
          <Data value={flag.restaurant.city_he ?? flag.restaurant.city_slug} />
        </dd>
        <dt>Record state</dt>
        <dd>{flag.restaurant.record_state}</dd>
        <dt>Flag message</dt>
        <dd>
          <Data value={flag.message} />
        </dd>
        {flag.photo_key && (
          <>
            <dt>Photo key</dt>
            <dd>{flag.photo_key}</dd>
          </>
        )}
      </dl>
      {flag.certificate ? (
        <CertificateSummary certificate={flag.certificate} />
      ) : (
        <p className="muted">No certificate attached to this flag.</p>
      )}
      <label className="note-label">
        Resolution note (required)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What evidence did you check?"
        />
      </label>
      {validation && <p className="field-error">{validation}</p>}
      {actionError && <p className="field-error">{actionError}</p>}
      <div className="action-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (requireNote()) void submit("dismissed");
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy || flag.certificate === null}
          title={
            flag.certificate === null ? "Flag has no certificate attached; nothing to degrade" : ""
          }
          onClick={() => {
            if (requireNote()) setConfirmingDegrade(true);
          }}
        >
          Confirm degrade
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (requireNote()) void submit("needs_field_check");
          }}
        >
          Needs field check
        </button>
      </div>
      {confirmingDegrade && (
        <ConfirmDialog
          title="Degrade certificate?"
          confirmLabel="Degrade certificate"
          busy={busy}
          onCancel={() => setConfirmingDegrade(false)}
          onConfirm={() => void submit("confirmed_degrade")}
        >
          <p>
            The certificate will show as <strong>UNKNOWN</strong> to users. This closes the flag as
            resolved. The change is audited and cannot be undone from the console.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
