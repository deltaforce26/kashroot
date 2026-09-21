import { useState } from "react";

import type { CertificateOut, RestaurantDetail } from "../api/types";
import { CreateCertificatePanel } from "../components/CreateCertificatePanel";
import { CertificateSummary, Data, restaurantName } from "../components/data";
import { Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { label, RECORD_STATE_LABELS, RESTAURANT_STATUS_LABELS } from "../labels";

/**
 * Standalone hand-entry of a certificate: pick the restaurant first, then fill the
 * same form the directory row uses.
 *
 * This is an entry point, not a second implementation. The form is
 * `CreateCertificatePanel` unchanged, and the write is still
 * `POST /api/admin/restaurants/{id}/certificates` — the restaurant is the path,
 * never a body field, exactly as it is from the directory. Nothing here can create
 * a restaurant: a certificate is attached to a record that already exists.
 */
export function NewCertificate() {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  /** The `q` actually searched. Empty means: no request has been made yet. */
  const [searched, setSearched] = useState("");
  const [picked, setPicked] = useState<RestaurantDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /**
   * Remount key for the form. A created certificate leaves the moderator on the
   * same restaurant, and the next one must start from a blank draft — bumping the
   * key is how that happens without the shared panel growing a reset of its own.
   */
  const [formKey, setFormKey] = useState(0);

  const canSearch = query.trim() !== "";

  function search() {
    // Nothing is fetched on mount, and an empty query is not a search: it would
    // pull the whole restaurant table, which is what the directory view is for.
    if (!canSearch) return;
    setSearched(query.trim());
  }

  function pick(restaurant: RestaurantDetail) {
    setPicked(restaurant);
    setFormOpen(true);
    setFormKey((n) => n + 1);
  }

  function unpick() {
    // The search stays on screen: changing branch is a common correction, and
    // re-typing the query for it would be punishment.
    setPicked(null);
    setFormOpen(false);
  }

  return (
    <section>
      <h2>תעודה חדשה</h2>
      <p className="muted">
        יש לבחור תחילה את המסעדה שאליה משויכת התעודה, ואז למלא את פרטי התעודה. היצירה
        מתועדת ביומן הביקורת על שם המודרטור המחובר. לא ניתן ליצור כאן מסעדה חדשה.
      </p>

      {picked === null ? (
        <>
          <div className="controls">
            <label className="control">
              חיפוש מסעדה
              <input
                type="search"
                dir="auto"
                placeholder="שם, כתובת או עיר"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") search();
                }}
              />
            </label>
            <div className="action-row">
              <button type="button" disabled={!canSearch} onClick={search}>
                חיפוש
              </button>
            </div>
          </div>
          {searched === "" ? (
            <EmptyState message="יש להקליד שם, כתובת או עיר וללחוץ על חיפוש. עד אז לא נטענות רשומות." />
          ) : (
            <RestaurantResults query={searched} onPick={pick} />
          )}
        </>
      ) : (
        <>
          <div className="picked-restaurant">
            <div>
              <strong>{restaurantName(picked)}</strong>
            </div>
            <div className="muted">
              <Data value={picked.city_he ?? picked.city_slug} /> ·{" "}
              <Data value={picked.address_he ?? "—"} /> ·{" "}
              {label(RECORD_STATE_LABELS, picked.record_state)} ·{" "}
              {label(RESTAURANT_STATUS_LABELS, picked.status)}
            </div>
            <div className="action-row">
              <button type="button" onClick={unpick}>
                בחירת מסעדה אחרת
              </button>
            </div>
          </div>

          <div className="cert-block">
            <h3>תעודות ברשומה</h3>
            {picked.certificates.length === 0 ? (
              <p className="muted">אין תעודות ברשומה זו.</p>
            ) : (
              picked.certificates.map((certificate) => (
                <CertificateSummary key={certificate.id} certificate={certificate} />
              ))
            )}
            <p className="muted">
              התעודות מוצגות לקריאה בלבד — כדי למנוע רישום כפול. שינוי מצב של תעודה קיימת
              עובר דרך תורי הבדיקה, הדיווחים, פקיעת התוקף והתמונות.
            </p>
          </div>

          {formOpen ? (
            <CreateCertificatePanel
              key={formKey}
              restaurantId={picked.id}
              onCancel={() => setFormOpen(false)}
              onCreated={(created: CertificateOut) => {
                // The server's row, not the draft: what is on screen is what was stored.
                setPicked((prev) =>
                  prev === null ? prev : { ...prev, certificates: [...prev.certificates, created] },
                );
                setFormOpen(false);
                showToast("התעודה נוספה ותועדה על שם המודרטור.");
              }}
            />
          ) : (
            <div className="action-row">
              <button
                type="button"
                onClick={() => {
                  setFormOpen(true);
                  setFormKey((n) => n + 1);
                }}
              >
                הוספת תעודה למסעדה זו
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The search results. Mounted only once a query has been submitted, which is what
 * keeps the screen request-free until the moderator actually searches — the paged
 * query fetches on mount by design.
 *
 * Enough columns to tell two branches of a chain apart: name, city, address, and
 * the record state (how the row itself was verified). No certificate state is shown
 * as a judgement here; that belongs to the record, below, after the pick.
 */
function RestaurantResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (restaurant: RestaurantDetail) => void;
}) {
  const { items, total, loading, error, offset, reload, next, prev } =
    usePagedQuery<RestaurantDetail>("/api/admin/restaurants", { q: query });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0) {
    return <EmptyState message="אין מסעדות התואמות לחיפוש הזה. אפשר לנסות שם, כתובת או עיר אחרים." />;
  }

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>מסעדה</th>
            <th>עיר</th>
            <th>כתובת</th>
            <th>מצב הרשומה</th>
            <th>תעודות</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                {restaurantName(item)}
                {item.needs_review && (
                  <>
                    {" "}
                    <span className="badge badge-pending">דרושה בדיקה</span>
                  </>
                )}
              </td>
              <td>
                <Data value={item.city_he ?? item.city_slug} />
              </td>
              <td>
                <Data value={item.address_he ?? "—"} />
              </td>
              <td>{label(RECORD_STATE_LABELS, item.record_state)}</td>
              <td className="nowrap">{item.certificates.length}</td>
              <td>
                <button type="button" onClick={() => onPick(item)}>
                  בחירה
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={total} offset={offset} shown={items.length} onPrev={prev} onNext={next} />
    </>
  );
}
