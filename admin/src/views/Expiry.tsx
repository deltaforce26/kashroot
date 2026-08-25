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
  Ltr,
  shortId,
  todayInIsrael,
} from "../components/data";
import { CityFilter, Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { CERTIFICATION_LEVEL_LABELS, label } from "../labels";

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
      <h2>תור פקיעת תוקף</h2>
      <div className="controls">
        <label className="control">
          חלון זמן
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} ימים
              </option>
            ))}
          </select>
        </label>
        <CityFilter value={city} onChange={setCity} />
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message={`התור נקי — אין תעודות שפג תוקפן בתוך ${days} ימים.`} />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מסעדה</th>
              <th>עיר</th>
              <th>תעודה</th>
              <th>בתוקף עד</th>
              <th>פקיעה</th>
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
                      <Data value={certifierName(c)} /> ·{" "}
                      {label(CERTIFICATION_LEVEL_LABELS, c.level)}
                    </td>
                    <td className="nowrap">
                      <Ltr value={c.valid_until ?? "—"} />
                    </td>
                    <td>
                      {item.days_until_expiry < 0 ? (
                        <span className="badge badge-expired">
                          פג לפני {-item.days_until_expiry} ימים
                        </span>
                      ) : (
                        <span className="badge badge-pending">
                          בעוד {item.days_until_expiry} ימים
                        </span>
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

  // טופס הורדת סטטוס מיידית
  const [degradeReason, setDegradeReason] = useState("");
  const [degradeValidation, setDegradeValidation] = useState<string | null>(null);
  const [confirmingDegrade, setConfirmingDegrade] = useState(false);

  // טופס אימות חידוש
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
        "סטטוס התעודה הורד — היא מוצגת כעת למשתמשים כ־UNKNOWN. הפעולה מתועדת ואינה ניתנת לביטול.",
      );
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
      setConfirmingDegrade(false);
    }
  }

  /** משקף את כללי ה־fail-safe של ה־API: תאריך עתידי, כתובת http(s) תקינה, הערה באורך 10 תווים לפחות. */
  function validateRenewal(): boolean {
    const note = evidenceNote.trim();
    const url = evidenceUrl.trim();
    // Civil date in Israel, matching the server's ISRAEL_TZ rule.
    const today = todayInIsrael();
    if (!validUntil) {
      setRenewalValidation("נדרש תאריך תוקף חדש.");
      return false;
    }
    if (validUntil <= today) {
      setRenewalValidation("תאריך התוקף חייב להיות עתידי בלבד.");
      return false;
    }
    if (!note && !url && !photoKey) {
      setRenewalValidation(
        "נדרשת ראיה לחידוש: יש לספק הערת ראיה, קישור או תמונה מאושרת (כלל fail-safe: אין ראיה, אין שחזור).",
      );
      return false;
    }
    if (note && note.length < 10) {
      setRenewalValidation("הערת הראיה חייבת להיות באורך 10 תווים לפחות.");
      return false;
    }
    if (url && !isHttpUrl(url)) {
      setRenewalValidation("קישור הראיה חייב להיות כתובת http(s) תקינה.");
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
      showToast(`החידוש אומת עד ${validUntil} — נרשם ביומן הביקורת.`);
      onDone();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה באופן בלתי צפוי");
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
          <h4>הורדת סטטוס עכשיו</h4>
          <label className="note-label">
            סיבה (חובה)
            <textarea
              value={degradeReason}
              onChange={(e) => setDegradeReason(e.target.value)}
              rows={2}
              placeholder="מדוע מורידים את סטטוס התעודה?"
            />
          </label>
          {degradeValidation && <p className="field-error">{degradeValidation}</p>}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!degradeReason.trim()) {
                setDegradeValidation("נדרשת סיבה להורדת הסטטוס.");
                return;
              }
              setDegradeValidation(null);
              setConfirmingDegrade(true);
            }}
          >
            הורדת סטטוס עכשיו
          </button>
        </div>
        <div className="expiry-form">
          <h4>אימות חידוש</h4>
          <label className="note-label">
            תאריך תוקף חדש
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <label className="note-label">
            הערת ראיה
            <textarea
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              rows={2}
              placeholder="לדוגמה: התקשרנו למשרד גוף הכשרות ואישרו את החידוש"
            />
          </label>
          <label className="note-label">
            קישור לראיה
            <input
              type="url"
              className="ltr"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="note-label">
            תמונת ראיה (מאושרות בלבד)
            <select value={photoKey} onChange={(e) => setPhotoKey(e.target.value)}>
              <option value="">ללא</option>
              {acceptedPhotos.map((p) => (
                <option key={p.id} value={p.storage_key}>
                  {p.content_type} · הועלתה {p.uploaded_at.slice(0, 10)} · {shortId(p.id)}
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
            אימות חידוש
          </button>
        </div>
      </div>
      {confirmingDegrade && (
        <ConfirmDialog
          title="להוריד את סטטוס התעודה עכשיו?"
          confirmLabel="הורדת סטטוס התעודה"
          busy={busy}
          onCancel={() => setConfirmingDegrade(false)}
          onConfirm={() => void degradeNow()}
        >
          <p>
            התעודה תוצג למשתמשים כ־<strong>UNKNOWN</strong>. השינוי מתועד ואינו ניתן לביטול
            מהקונסולה.
          </p>
        </ConfirmDialog>
      )}
      {confirmingRenewal && (
        <ConfirmDialog
          title="לאמת את החידוש?"
          confirmLabel="אימות החידוש"
          busy={busy}
          onCancel={() => setConfirmingRenewal(false)}
          onConfirm={() => void verifyRenewal()}
        >
          <p>
            זו הפעולה היחידה במוצר שמעלה סטטוס: היא מסמנת את התעודה כ
            <strong>מחודשת ומאומתת, פעילה עבור המשתמשים</strong>, בתוקף עד{" "}
            <Ltr value={validUntil} />, על סמך הראיות שסיפקת. השינוי מתועד.
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
