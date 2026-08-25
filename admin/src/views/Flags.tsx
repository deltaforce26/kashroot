import { Fragment, useState } from "react";

import { api, ApiError } from "../api/client";
import type { FlagOut, FlagOutcome, ResolveFlagRequest } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CertificateSummary, Data, Ltr, restaurantName } from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { FLAG_TYPE_LABELS, label, RECORD_STATE_LABELS } from "../labels";

export function Flags() {
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<FlagOut>("/api/admin/queues/flags", { city: city || undefined });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>דיווחים</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="התור נקי — אין דיווחים פתוחים." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מסעדה</th>
              <th>סוג הדיווח</th>
              <th>מצב</th>
              <th>תוכן הדיווח</th>
              <th>נפתח</th>
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
                  <td>{label(FLAG_TYPE_LABELS, flag.type)}</td>
                  <td>
                    {flag.state === "in_review" ? (
                      <span className="badge badge-pending">ממתין לבדיקת שטח</span>
                    ) : (
                      <span className="badge">פתוח</span>
                    )}
                  </td>
                  <td>
                    <Data value={flag.message} />
                  </td>
                  <td className="nowrap">
                    <Ltr value={flag.created_at.slice(0, 10)} />
                  </td>
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
          "סטטוס התעודה הורד — היא מוצגת כעת למשתמשים כ־UNKNOWN. הפעולה מתועדת ואינה ניתנת לביטול.",
        );
      } else if (outcome === "dismissed") {
        showToast("הדיווח נדחה ותועד — הוסר מהתור.");
      } else {
        showToast("נשלח לבדיקת שטח — המסעדה נוספה לתור הבדיקה.");
      }
      onResolved();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
      setConfirmingDegrade(false);
    }
  }

  /** ה־API דורש הערה של 5 תווים לפחות בכל הכרעת דיווח. */
  function requireNote(): boolean {
    if (note.trim().length < 5) {
      setValidation("נדרשת הערה לכל הכרעת דיווח (5 תווים לפחות).");
      return false;
    }
    setValidation(null);
    return true;
  }

  return (
    <div className="detail">
      <dl className="detail-grid">
        <dt>מסעדה</dt>
        <dd>
          {restaurantName(flag.restaurant)} — <Data value={flag.restaurant.address_he} />,{" "}
          <Data value={flag.restaurant.city_he ?? flag.restaurant.city_slug} />
        </dd>
        <dt>מצב הרשומה</dt>
        <dd>{label(RECORD_STATE_LABELS, flag.restaurant.record_state)}</dd>
        <dt>תוכן הדיווח</dt>
        <dd>
          <Data value={flag.message} />
        </dd>
        {flag.photo_key && (
          <>
            <dt>מפתח התמונה</dt>
            <dd>
              <code>{flag.photo_key}</code>
            </dd>
          </>
        )}
      </dl>
      {flag.certificate ? (
        <CertificateSummary certificate={flag.certificate} />
      ) : (
        <p className="muted">לא מצורפת תעודה לדיווח זה.</p>
      )}
      <label className="note-label">
        הערת הכרעה (חובה)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="אילו ראיות בדקת?"
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
          דחיית הדיווח
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy || flag.certificate === null}
          title={
            flag.certificate === null ? "לדיווח לא מצורפת תעודה; אין מה להוריד" : ""
          }
          onClick={() => {
            if (requireNote()) setConfirmingDegrade(true);
          }}
        >
          אישור הורדת סטטוס
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (requireNote()) void submit("needs_field_check");
          }}
        >
          דרושה בדיקת שטח
        </button>
      </div>
      {confirmingDegrade && (
        <ConfirmDialog
          title="להוריד את סטטוס התעודה?"
          confirmLabel="הורדת סטטוס התעודה"
          busy={busy}
          onCancel={() => setConfirmingDegrade(false)}
          onConfirm={() => void submit("confirmed_degrade")}
        >
          <p>
            התעודה תוצג למשתמשים כ־<strong>UNKNOWN</strong>. פעולה זו סוגרת את הדיווח כמטופל.
            השינוי מתועד ואינו ניתן לביטול מהקונסולה.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
