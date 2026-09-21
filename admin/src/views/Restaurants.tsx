import { Fragment, useMemo, useState } from "react";

import { api, ApiError } from "../api/client";
import {
  AMENITY_KEYS,
  DIET_TYPES,
  RESTAURANT_STATUSES,
  type CertificateOut,
  type DietType,
  type RestaurantDetail,
  type RestaurantStatus,
  type UpdateRestaurantRequest,
} from "../api/types";
import {
  CertificateSummary,
  Data,
  formatDateTime,
  Ltr,
  restaurantName,
} from "../components/data";
import { CreateCertificatePanel } from "../components/CreateCertificatePanel";
import { CreateRestaurantPanel } from "../components/CreateRestaurantPanel";
import { CityFilter, Pager } from "../components/QueueControls";
import {
  AMENITY_CHOICE_LABELS,
  AMENITY_CHOICES,
  amenitiesFrom,
  FIELD_GROUPS,
  FIELD_LABELS,
  LTR_FIELDS,
  type TextField,
} from "../components/restaurantFields";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { useToast } from "../components/Toast";
import { usePagedQuery } from "../hooks/usePagedQuery";
import {
  AMENITY_LABELS,
  CERTIFICATE_STATE_LABELS,
  DIET_TYPE_LABELS,
  label,
  RECORD_STATE_LABELS,
  RESTAURANT_STATUS_LABELS,
} from "../labels";

const STATUS_LABELS = RESTAURANT_STATUS_LABELS;

interface Draft {
  text: Record<TextField, string>;
  diet_type: DietType | "";
  price_level: string;
  status: RestaurantStatus;
  amenities: Record<string, string>;
  note: string;
}

function draftOf(item: RestaurantDetail): Draft {
  const text = {} as Record<TextField, string>;
  for (const field of Object.keys(FIELD_LABELS) as TextField[]) {
    text[field] = item[field] ?? "";
  }
  const amenities: Record<string, string> = {};
  for (const key of AMENITY_KEYS) {
    const recorded = item.amenities[key];
    amenities[key] = recorded === undefined ? "" : String(recorded);
  }

  return {
    text,
    diet_type: item.diet_type ?? "",
    price_level: item.price_level === null ? "" : String(item.price_level),
    status: item.status,
    amenities,
    note: "",
  };
}

/**
 * The PATCH body: only what the moderator actually changed.
 *
 * This mirrors the server's PATCH semantics rather than posting the whole form — an
 * absent field is untouched, so a concurrent edit to a field this moderator never
 * looked at is not silently overwritten, and the audit row lists only real changes.
 */
function buildPatch(item: RestaurantDetail, draft: Draft): UpdateRestaurantRequest {
  const patch: UpdateRestaurantRequest = {};
  for (const field of Object.keys(FIELD_LABELS) as TextField[]) {
    const next = draft.text[field].trim();
    if (next === (item[field] ?? "")) continue;
    // A cleared optional field is an explicit null; name_he cannot be cleared.
    (patch as Record<string, unknown>)[field] = next === "" ? null : next;
  }
  if (draft.diet_type !== (item.diet_type ?? "")) {
    patch.diet_type = draft.diet_type === "" ? null : draft.diet_type;
  }
  const price = draft.price_level === "" ? null : Number(draft.price_level);
  if (price !== item.price_level) patch.price_level = price;
  if (draft.status !== item.status) patch.status = draft.status;
  const amenities = amenitiesFrom(draft.amenities);
  if (JSON.stringify(amenities) !== JSON.stringify(item.amenities)) patch.amenities = amenities;

  return patch;
}

export function Restaurants() {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const { showToast } = useToast();
  const { items, total, loading, error, offset, reload, replaceItem, prependItem, next, prev } =
    usePagedQuery<RestaurantDetail>("/api/admin/restaurants", {
      q: query || undefined,
      city: city || undefined,
      status: status || undefined,
    });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <h2>מסעדות</h2>
      <div className="create-bar">
        <button type="button" onClick={() => setCreating((open) => !open)}>
          {creating ? "סגירת טופס ההוספה" : "הוספת מסעדה"}
        </button>
        <span className="muted">
          הזנה ידנית של מסעדה שאינה במאגר. היצירה מתועדת, ואינה יוצרת שום עובדת כשרות.
        </span>
      </div>
      {creating && (
        <CreateRestaurantPanel
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            // The server's row, not the draft: what is on screen is what was stored.
            prependItem(created);
            setCreating(false);
            setExpandedId(created.id);
            showToast("המסעדה נוצרה ותועדה. אפשר להוסיף לה תעודה עכשיו.");
          }}
        />
      )}
      <div className="controls">
        <label className="control">
          חיפוש
          <input
            type="search"
            placeholder="שם, כתובת או עיר"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <CityFilter value={city} onChange={setCity} />
        <label className="control">
          סטטוס
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">כל הסטטוסים</option>
            {RESTAURANT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="אין מסעדות התואמות לסינון הזה." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מסעדה</th>
              <th>עיר</th>
              <th>יצירת קשר</th>
              <th>סטטוס</th>
              <th>תעודות</th>
              <th>עודכן</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className="row-clickable"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
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
                  <td className="nowrap">
                    <Ltr value={item.phone ?? "—"} />
                  </td>
                  <td>
                    <span className={item.status === "open" ? undefined : "badge badge-expired"}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td>
                    {item.certificates.length === 0 ? (
                      <span className="muted">אין</span>
                    ) : (
                      item.certificates.map((c) => (
                        <span key={c.id} className={`badge badge-${c.state}`}>
                          {label(CERTIFICATE_STATE_LABELS, c.state)}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="nowrap">
                    <Ltr value={item.updated_at.slice(0, 10)} />
                  </td>
                </tr>
                {expandedId === item.id && (
                  <tr className="row-detail">
                    <td colSpan={6}>
                      <RestaurantEditor
                        item={item}
                        onSaved={(updated) => replaceItem((r) => r.id === updated.id, updated)}
                        onCertificateCreated={(created) =>
                          replaceItem((r) => r.id === item.id, {
                            ...item,
                            certificates: [...item.certificates, created],
                          })
                        }
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

/**
 * The details editor. Kashrut is never *edited* here: the details form cannot carry
 * a certificate field, and an existing certificate below it is read-only. Adding a
 * new certificate is a separate act in its own panel, separately audited — a create
 * is not a status raise, because there is no prior status to raise.
 *
 * `draftOf(item)` is a `useState` initializer and nothing more: a new `item` prop —
 * after a certificate is attached to this row, say — must NOT clobber edits in
 * progress. Do not "fix" this with a useEffect.
 */
function RestaurantEditor({
  item,
  onSaved,
  onCertificateCreated,
}: {
  item: RestaurantDetail;
  onSaved: (updated: RestaurantDetail) => void;
  onCertificateCreated: (created: CertificateOut) => void;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [addingCertificate, setAddingCertificate] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = useMemo(() => buildPatch(item, draft), [item, draft]);
  const dirty = Object.keys(patch).length > 0;

  function setText(field: TextField, value: string) {
    setDraft((prev) => ({ ...prev, text: { ...prev.text, [field]: value } }));
  }

  async function save() {
    setActionError(null);
    // Mirror of the server rule: name_he is NOT NULL and cannot be blanked.
    if (draft.text.name_he.trim() === "") {
      setValidation("שם (עברית) הוא שדה חובה — לא ניתן לרוקן אותו.");
      return;
    }
    setValidation(null);
    setBusy(true);
    const body: UpdateRestaurantRequest = { ...patch, note: draft.note.trim() || null };
    try {
      const updated = await api<RestaurantDetail>(`/api/admin/restaurants/${item.id}`, {
        method: "PATCH",
        body,
      });
      showToast(`נשמר ותועד — ${Object.keys(patch).length} שדות עודכנו.`);
      onSaved(updated);
      setDraft(draftOf(updated));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "השמירה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail">
      {FIELD_GROUPS.map((group) => (
        <fieldset key={group.title} className="tristate-editor">
          <legend>{group.title}</legend>
          <div className="tristate-grid">
            {group.fields.map((field) => (
              <label key={field} className="tristate-row">
                {FIELD_LABELS[field]}
                <input
                  type="text"
                  dir="auto"
                  className={LTR_FIELDS.has(field) ? "ltr" : undefined}
                  value={draft.text[field]}
                  disabled={busy}
                  onChange={(e) => setText(field, e.target.value)}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="tristate-editor">
        <legend>עסק</legend>
        <div className="tristate-grid">
          <label className="tristate-row">
            {FIELD_LABELS.business_type_he}
            <input
              type="text"
              dir="auto"
              value={draft.text.business_type_he}
              disabled={busy}
              onChange={(e) => setText("business_type_he", e.target.value)}
            />
          </label>
          <label className="tristate-row">
            סוג מטבח
            <select
              value={draft.diet_type}
              disabled={busy}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, diet_type: e.target.value as DietType | "" }))
              }
            >
              <option value="">— לא נרשם</option>
              {DIET_TYPES.map((value) => (
                <option key={value} value={value}>
                  {label(DIET_TYPE_LABELS, value)}
                </option>
              ))}
            </select>
          </label>
          <label className="tristate-row">
            רמת מחיר
            <select
              value={draft.price_level}
              disabled={busy}
              onChange={(e) => setDraft((prev) => ({ ...prev, price_level: e.target.value }))}
            >
              <option value="">— לא נרשם</option>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={String(value)}>
                  {"₪".repeat(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="tristate-row">
            סטטוס
            <select
              value={draft.status}
              disabled={busy}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, status: e.target.value as RestaurantStatus }))
              }
            >
              {RESTAURANT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="tristate-editor">
        <legend>מתקנים ושירותים</legend>
        <p>
          העדפות רכות בלבד (ציון התאמה). הן לעולם אינן משפיעות על הכרעת כשרות. עדיף להשאיר
          ערך ללא רישום מאשר לנחש אותו.
        </p>
        <div className="tristate-grid">
          {AMENITY_KEYS.map((key) => (
            <label key={key} className="tristate-row">
              {label(AMENITY_LABELS, key)}
              <select
                value={draft.amenities[key]}
                disabled={busy}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    amenities: { ...prev.amenities, [key]: e.target.value },
                  }))
                }
              >
                {AMENITY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {AMENITY_CHOICE_LABELS[choice]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="note-label">
        {FIELD_LABELS.notes}
        <textarea
          dir="auto"
          rows={2}
          value={draft.text.notes}
          disabled={busy}
          onChange={(e) => setText("notes", e.target.value)}
        />
      </label>

      <label className="note-label">
        סיבת העריכה (מתועדת)
        <textarea
          rows={2}
          value={draft.note}
          disabled={busy}
          onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
        />
      </label>

      {validation && <p className="field-error">{validation}</p>}
      {actionError && (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="action-row">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "שומר…" : "שמירת שינויים"}
        </button>
        <button type="button" disabled={busy || !dirty} onClick={() => setDraft(draftOf(item))}>
          ביטול שינויים
        </button>
        <span className="muted">
          {dirty
            ? `${Object.keys(patch).length} שדות שונו`
            : "אין שינויים — אין מה לשמור"}
        </span>
      </div>

      <dl className="detail-grid">
        <dt>מצב הרשומה</dt>
        <dd>
          {label(RECORD_STATE_LABELS, item.record_state)} · אימות מוצלב ×
          {item.corroboration_count}
          {item.needs_review && " · נמצאת בתור הבדיקה"}
        </dd>
        <dt>מפתח איחוד כפילויות</dt>
        <dd>
          <code>{item.dedupe_key}</code>
        </dd>
        <dt>עודכן לאחרונה</dt>
        <dd>
          <Ltr value={formatDateTime(item.updated_at)} />
        </dd>
      </dl>

      <div className="cert-block">
        <h4>תעודות ברשומה</h4>
        {item.certificates.length === 0 ? (
          <p className="muted">אין תעודות ברשומה זו.</p>
        ) : (
          item.certificates.map((certificate) => (
            <CertificateSummary key={certificate.id} certificate={certificate} />
          ))
        )}
        <p className="muted">
          אפשר להוסיף כאן תעודה חדשה, והיצירה מתועדת. תעודה קיימת אינה ניתנת לעריכה מכאן —
          שינוי מצב של תעודה עובר דרך תורי הבדיקה, הדיווחים, פקיעת התוקף והתמונות, שהם
          המסלולים המוגנים והמתועדים.
        </p>
        <div className="action-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => setAddingCertificate((open) => !open)}
          >
            {addingCertificate ? "סגירת טופס התעודה" : "הוספת תעודה"}
          </button>
        </div>
        {addingCertificate && (
          <CreateCertificatePanel
            restaurantId={item.id}
            onCancel={() => setAddingCertificate(false)}
            onCreated={(created) => {
              setAddingCertificate(false);
              onCertificateCreated(created);
              showToast("התעודה נוספה ותועדה על שם המודרטור.");
            }}
          />
        )}
      </div>
    </div>
  );
}
