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
  attributeLabel,
  CertificateSummary,
  certifierName,
  Data,
  formatDateTime,
  Ltr,
  restaurantName,
  todayInIsrael,
} from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import {
  CERTIFICATE_SOURCE_LABELS,
  CERTIFICATION_LEVEL_LABELS,
  label,
} from "../labels";

export function Photos() {
  const [city, setCity] = useState("");
  const { items, total, loading, error, offset, reload, removeItem, next, prev } =
    usePagedQuery<PhotoQueueItem>("/api/admin/queues/photos", {
      city: city || undefined,
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2>תור התמונות</h2>
      <div className="controls">
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="התור נקי — אין תמונות ראיה הממתינות לבדיקה." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מסעדה</th>
              <th>גוף כשרות</th>
              <th>הועלתה</th>
              <th>ראיה</th>
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
                      <Data value={certifierName(item.certificate)} /> ·{" "}
                      {label(CERTIFICATION_LEVEL_LABELS, item.certificate.level)}
                    </td>
                    <td>
                      <Data value={p.uploaded_by} />
                      <div className="muted">
                        <Ltr value={formatDateTime(p.uploaded_at)} />
                      </div>
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
  if (!photo.view_url) return <span className="muted">אין תצוגה מקדימה</span>;
  if (photo.content_type === "application/pdf") {
    return (
      <a href={photo.view_url} target="_blank" rel="noreferrer">
        מסמך PDF — פתיחה
      </a>
    );
  }
  return (
    <a href={photo.view_url} target="_blank" rel="noreferrer">
      <img className="photo-thumb" src={photo.view_url} alt="ראיית תעודה" />
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
      setValidation("נדרשת הערת בדיקה (5 תווים לפחות).");
      return false;
    }
    if (decision === "accept" && validUntil) {
      // Civil date in Israel, matching the server's ISRAEL_TZ rule.
      const today = todayInIsrael();
      if (validUntil <= today) {
        setValidation("תאריך התוקף חייב להיות עתידי בלבד.");
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
          ? "התמונה אושרה — הנתונים שנרשמו נכתבים לתעודה והפעולה מתועדת."
          : "התמונה נדחתה — דבר לא נכתב לתעודה. ההחלטה מתועדת.",
      );
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה באופן בלתי צפוי");
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
              מסמך PDF — פתיחה בלשונית חדשה
            </a>
          ) : (
            <a
              href={photo.view_url}
              target="_blank"
              rel="noreferrer"
              title="פתיחה בגודל מלא בלשונית חדשה"
            >
              <img src={photo.view_url} alt="ראיית תעודה (בגודל מלא)" />
            </a>
          )
        ) : (
          <span className="muted">אין תצוגה מקדימה זמינה</span>
        )}
        <div className="muted">
          <Ltr value={photo.content_type} /> ·{" "}
          <Ltr value={`${(photo.size_bytes / 1024).toFixed(0)} KB`} /> · הועלתה בידי{" "}
          <Data value={photo.uploaded_by} /> בתאריך{" "}
          <Ltr value={formatDateTime(photo.uploaded_at)} />
        </div>
      </div>

      <fieldset className="decision-group">
        <legend>הכרעה</legend>
        <label>
          <input
            type="radio"
            name={`decision-${photo.id}`}
            checked={decision === "accept"}
            onChange={() => selectDecision("accept")}
          />{" "}
          אישור — התמונה אכן מציגה את התעודה הזו
        </label>
        <label>
          <input
            type="radio"
            name={`decision-${photo.id}`}
            checked={decision === "reject"}
            onChange={() => selectDecision("reject")}
          />{" "}
          דחייה — אינה שמישה או שאינה תואמת לתעודה הזו
        </label>
      </fieldset>

      <div className="tristate-editor">
        <h4>מאפייני התעודה הנראים בתמונה</h4>
        <p className="muted">
          יש לסמן רק את מה שהתמונה באמת מראה — מאפיין שלא נגעת בו אינו נשלח ונשאר לא ידוע
          בתעודה.
        </p>
        {rejecting && (
          <p className="muted">תמונה שנדחתה לעולם אינה כותבת דבר לתעודה.</p>
        )}
        <div className="tristate-grid">
          {CERTIFICATE_ATTRIBUTES.map((key) => {
            const recorded: boolean | undefined = cert.attributes[key];
            return (
              <label key={key} className="tristate-row">
                {attributeLabel(key)}
                {/* The raw key stays visible: it is what the audit log and the API speak. */}
                <code>{key}</code>
                {recorded !== undefined && (
                  <span className="muted">כרגע: {recorded ? "כן" : "לא"}</span>
                )}
                <select
                  value={attrs[key]}
                  disabled={rejecting}
                  onChange={(e) =>
                    setAttrs((prev) => ({ ...prev, [key]: e.target.value as TriState }))
                  }
                >
                  <option value="unknown">
                    {recorded !== undefined ? "לא נשלח (שמירת הקיים)" : "לא ידוע (לא נשלח)"}
                  </option>
                  <option value="yes">כן</option>
                  <option value="no">לא</option>
                  {recorded !== undefined && <option value="clear">איפוס ללא ידוע</option>}
                </select>
              </label>
            );
          })}
        </div>
        <label className="note-label">
          בתוקף עד (רשות, כפי שמודפס על התעודה)
          <input
            type="date"
            value={validUntil}
            disabled={rejecting}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </label>
      </div>

      <label className="note-label">
        הערת בדיקה (חובה)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="מה התמונה מראה, וכיצד אימתת אותה?"
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
          {rejecting ? "דחיית התמונה" : "אישור התמונה…"}
        </button>
      </div>

      {confirmingAccept && (
        <ConfirmDialog
          title="לאשר את התמונה ולכתוב את הנתונים האלה?"
          confirmLabel="אישור התמונה"
          busy={busy}
          onCancel={() => setConfirmingAccept(false)}
          onConfirm={() => void submit()}
        >
          <p>הבדיקה הזו מתועדת, ותיכתב לתעודה כך:</p>
          <ul>
            <li>
              {setEntries.length > 0
                ? `${setEntries.length} מאפיינים: ` +
                  setEntries
                    .map(([k, v]) => `${attributeLabel(k)}: ${v ? "כן" : "לא"}`)
                    .join(", ")
                : "אין שינוי במאפיינים"}
            </li>
            {clearedEntries.length > 0 && (
              <li>
                {`${clearedEntries.length} מאפיינים אופסו ללא ידוע: `}
                {clearedEntries.map(([k]) => attributeLabel(k)).join(", ")}
              </li>
            )}
            <li>{validUntil ? `תוקף עד ${validUntil}` : "אין שינוי בתאריך הפקיעה"}</li>
            <li>
              {sourceUpgraded
                ? `המקור משתדרג ל"${CERTIFICATE_SOURCE_LABELS.moderator_verified}"`
                : `המקור נשאר ללא שינוי (כבר "${label(CERTIFICATE_SOURCE_LABELS, cert.source)}")`}
            </li>
          </ul>
          <p>
            מצב התעודה עצמו אינו משתנה — שחזור תעודה שפג תוקפה עדיין מחייב אימות חידוש.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
