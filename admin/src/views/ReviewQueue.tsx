import { Fragment, useState } from "react";

import { api, ApiError } from "../api/client";
import type {
  RestaurantBrief,
  ResolveReviewRequest,
  ReviewQueueItem,
  ReviewResolution,
} from "../api/types";
import { CertificateSummary, certifierName, Data, restaurantName } from "../components/data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PhotoUploadButton } from "../components/PhotoUploadButton";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";

const RESOLUTION_LABELS: Record<ReviewResolution, string> = {
  approve: "Approve",
  reject: "Reject",
  needs_more_info: "Needs more info",
};

export function ReviewQueue() {
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<ReviewQueueItem>("/api/admin/queues/review", {
      city: city || undefined,
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>Review queue</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="Queue is clear — nothing needs review." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>City</th>
              <th>Certifier(s)</th>
              <th>Record state</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className="row-clickable"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  <td>{restaurantName(item)}</td>
                  <td>
                    <Data value={item.city_he ?? item.city_slug} />
                  </td>
                  <td>
                    {item.certificates.length === 0 ? (
                      <span className="muted">no certificates</span>
                    ) : (
                      item.certificates.map((c) => (
                        <span key={c.id} className={`badge badge-${c.state}`}>
                          <Data value={certifierName(c)} /> · {c.level} · {c.state}
                        </span>
                      ))
                    )}
                  </td>
                  <td>{item.record_state}</td>
                  <td>
                    corroboration ×{item.corroboration_count}
                    {item.notes && (
                      <>
                        {" · "}
                        <Data value={item.notes} />
                      </>
                    )}
                  </td>
                </tr>
                {expandedId === item.id && (
                  <tr className="row-detail">
                    <td colSpan={5}>
                      <ReviewDetail
                        item={item}
                        onResolved={(resolution) => {
                          setExpandedId(null);
                          if (resolution !== "needs_more_info") {
                            removeItem((r) => r.id === item.id);
                          }
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

function ReviewDetail({
  item,
  onResolved,
}: {
  item: ReviewQueueItem;
  onResolved: (resolution: ReviewResolution) => void;
}) {
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);

  /** API requires min 5 chars on reject / needs_more_info; approve just needs a note. */
  function validateNote(resolution: ReviewResolution): boolean {
    const min = resolution === "approve" ? 1 : 5;
    if (note.trim().length < min) {
      setValidation(
        min === 1
          ? "A note is required for every resolution."
          : "A note is required (at least 5 characters).",
      );
      return false;
    }
    setValidation(null);
    return true;
  }

  async function resolve(resolution: ReviewResolution) {
    setActionError(null);
    setBusy(true);
    const body: ResolveReviewRequest = { resolution, note: note.trim() };
    try {
      await api<RestaurantBrief>(`/api/admin/restaurants/${item.id}/resolve-review`, {
        method: "POST",
        body,
      });
      if (resolution === "needs_more_info") {
        showToast("Kept in queue; note recorded in the audit log.");
      } else {
        showToast(
          `${RESOLUTION_LABELS[resolution]} recorded and audited — removed from queue.`,
        );
      }
      onResolved(resolution);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed unexpectedly");
    } finally {
      setBusy(false);
      setConfirmingReject(false);
    }
  }

  return (
    <div className="detail">
      <dl className="detail-grid">
        <dt>Address</dt>
        <dd>
          <Data value={item.address_he} />
        </dd>
        <dt>Phone</dt>
        <dd>
          <Data value={item.phone} />
        </dd>
        <dt>Diet type</dt>
        <dd>{item.diet_type ?? "—"}</dd>
        <dt>Status</dt>
        <dd>{item.status}</dd>
        <dt>Created</dt>
        <dd>{item.created_at}</dd>
      </dl>
      {item.certificates.map((c) => (
        <div key={c.id} className="cert-block">
          <CertificateSummary certificate={c} />
          <PhotoUploadButton certificateId={c.id} />
        </div>
      ))}
      <label className="note-label">
        Resolution note (required)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What did you check, and what did you find?"
        />
      </label>
      {validation && <p className="field-error">{validation}</p>}
      {actionError && <p className="field-error">{actionError}</p>}
      <div className="action-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (validateNote("approve")) void resolve("approve");
          }}
        >
          Approve
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (validateNote("reject")) setConfirmingReject(true);
          }}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (validateNote("needs_more_info")) void resolve("needs_more_info");
          }}
        >
          Needs more info
        </button>
      </div>
      {confirmingReject && (
        <ConfirmDialog
          title="Reject record?"
          confirmLabel="Reject record"
          busy={busy}
          onCancel={() => setConfirmingReject(false)}
          onConfirm={() => void resolve("reject")}
        >
          <p>
            The record could not be verified: its record state degrades to{" "}
            <strong>unknown pending verification</strong> and it will show as{" "}
            <strong>UNKNOWN</strong> to users. The decision is audited and cannot be undone from
            the console.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
