import { Fragment, useState } from "react";

import { api, ApiError } from "../api/client";
import type {
  RestaurantBrief,
  ResolveReviewRequest,
  ReviewQueueItem,
  ReviewResolution,
} from "../api/types";
import {
  CertificateSummary,
  certifierName,
  Data,
  Ltr,
  restaurantName,
} from "../components/data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PhotoUploadButton } from "../components/PhotoUploadButton";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import {
  CERTIFICATE_STATE_LABELS,
  CERTIFICATION_LEVEL_LABELS,
  DIET_TYPE_LABELS,
  label,
  RECORD_STATE_LABELS,
  RESTAURANT_STATUS_LABELS,
} from "../labels";

const RESOLUTION_LABELS: Record<ReviewResolution, string> = {
  approve: "אישור",
  reject: "דחייה",
  needs_more_info: "דרוש מידע נוסף",
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
      <h2>תור בדיקה</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="התור נקי — אין רשומות הממתינות לבדיקה." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מסעדה</th>
              <th>עיר</th>
              <th>גופי כשרות</th>
              <th>מצב הרשומה</th>
              <th>מקור ואימות</th>
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
                      <span className="muted">אין תעודות</span>
                    ) : (
                      item.certificates.map((c) => (
                        <span key={c.id} className={`badge badge-${c.state}`}>
                          <Data value={certifierName(c)} /> ·{" "}
                          {label(CERTIFICATION_LEVEL_LABELS, c.level)} ·{" "}
                          {label(CERTIFICATE_STATE_LABELS, c.state)}
                        </span>
                      ))
                    )}
                  </td>
                  <td>{label(RECORD_STATE_LABELS, item.record_state)}</td>
                  <td>
                    אימות מוצלב ×{item.corroboration_count}
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

  /** ה־API דורש 5 תווים לפחות בדחייה / דרוש מידע נוסף; אישור מסתפק בהערה כלשהי. */
  function validateNote(resolution: ReviewResolution): boolean {
    const min = resolution === "approve" ? 1 : 5;
    if (note.trim().length < min) {
      setValidation(
        min === 1
          ? "נדרשת הערה לכל הכרעה."
          : "נדרשת הערה (5 תווים לפחות).",
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
        showToast("נשאר בתור; ההערה נרשמה ביומן הביקורת.");
      } else {
        showToast(
          `ההכרעה "${RESOLUTION_LABELS[resolution]}" נרשמה ותועדה — הרשומה הוסרה מהתור.`,
        );
      }
      onResolved(resolution);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
      setConfirmingReject(false);
    }
  }

  return (
    <div className="detail">
      <dl className="detail-grid">
        <dt>כתובת</dt>
        <dd>
          <Data value={item.address_he} />
        </dd>
        <dt>טלפון</dt>
        <dd>
          <Ltr value={item.phone ?? "—"} />
        </dd>
        <dt>סוג מטבח</dt>
        <dd>{item.diet_type ? label(DIET_TYPE_LABELS, item.diet_type) : "—"}</dd>
        <dt>סטטוס</dt>
        <dd>{label(RESTAURANT_STATUS_LABELS, item.status)}</dd>
        <dt>נוצר</dt>
        <dd>
          <Ltr value={item.created_at} />
        </dd>
      </dl>
      {item.certificates.map((c) => (
        <div key={c.id} className="cert-block">
          <CertificateSummary certificate={c} />
          <PhotoUploadButton certificateId={c.id} />
        </div>
      ))}
      <label className="note-label">
        הערת הכרעה (חובה)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="מה בדקת, ומה מצאת?"
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
          אישור
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (validateNote("reject")) setConfirmingReject(true);
          }}
        >
          דחייה
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (validateNote("needs_more_info")) void resolve("needs_more_info");
          }}
        >
          דרוש מידע נוסף
        </button>
      </div>
      {confirmingReject && (
        <ConfirmDialog
          title="לדחות את הרשומה?"
          confirmLabel="דחיית הרשומה"
          busy={busy}
          onCancel={() => setConfirmingReject(false)}
          onConfirm={() => void resolve("reject")}
        >
          <p>
            הרשומה לא אומתה: מצב הרשומה יורד ל<strong>לא ידוע — ממתין לאימות</strong>, והיא
            תוצג למשתמשים כ־<strong>UNKNOWN</strong>. ההחלטה מתועדת ואינה ניתנת לביטול
            מהקונסולה.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
