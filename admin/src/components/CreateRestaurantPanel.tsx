import { useState } from "react";

import { api, ApiError } from "../api/client";
import {
  AMENITY_KEYS,
  DIET_TYPES,
  RESTAURANT_STATUSES,
  type CreateRestaurantRequest,
  type DietType,
  type RestaurantDetail,
  type RestaurantStatus,
} from "../api/types";
import {
  AMENITY_CHOICE_LABELS,
  AMENITY_CHOICES,
  amenitiesFrom,
  FIELD_GROUPS,
  FIELD_LABELS,
  LTR_FIELDS,
  type TextField,
} from "./restaurantFields";
import {
  AMENITY_LABELS,
  DIET_TYPE_LABELS,
  label,
  RECORD_STATE_LABELS,
  RESTAURANT_STATUS_LABELS,
} from "../labels";

/** Mirrors the server's city_slug rule, so an obvious typo never costs a round trip. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A dedupe collision is the failure a moderator will actually hit here, and the
 * server's detail alone ("dedupe key already taken") does not say what to do about
 * it. The gloss sits above the server's own wording rather than replacing it.
 */
const DUPLICATE_GLOSS =
  "כבר קיימת מסעדה עם אותו שם, עיר וכתובת. יש לחפש אותה במדריך ולערוך אותה — אין ליצור כפילות.";

interface CreateDraft {
  text: Record<TextField, string>;
  diet_type: DietType | "";
  price_level: string;
  status: RestaurantStatus;
  amenities: Record<string, string>;
  /** The review-routing checkbox. The server maps it to the record_state pair. */
  queueForReview: boolean;
  note: string;
}

function emptyDraft(): CreateDraft {
  const text = {} as Record<TextField, string>;
  for (const field of Object.keys(FIELD_LABELS) as TextField[]) {
    text[field] = "";
  }
  const amenities: Record<string, string> = {};
  for (const key of AMENITY_KEYS) {
    amenities[key] = "";
  }

  return {
    text,
    diet_type: "",
    price_level: "",
    status: "open",
    amenities,
    queueForReview: true,
    note: "",
  };
}

/**
 * The POST body.
 *
 * An empty optional is OMITTED, never sent as `null`: a `null` means "clear this
 * column" in the PATCH semantics this console also speaks, and clearing has no
 * meaning on a row that does not exist yet. Always present, because they are the
 * fields the server will default or derive from otherwise: `name_he`, `status`,
 * `amenities` and `needs_review`.
 */
function buildCreateBody(draft: CreateDraft): CreateRestaurantRequest {
  const body: CreateRestaurantRequest = {
    name_he: draft.text.name_he.trim(),
    status: draft.status,
    amenities: amenitiesFrom(draft.amenities),
    needs_review: draft.queueForReview,
  };
  const optional = body as unknown as Record<string, unknown>;
  for (const field of Object.keys(FIELD_LABELS) as TextField[]) {
    if (field === "name_he") continue;
    const value = draft.text[field].trim();
    if (value !== "") optional[field] = value;
  }
  if (draft.diet_type !== "") optional.diet_type = draft.diet_type;
  if (draft.price_level !== "") optional.price_level = Number(draft.price_level);
  const note = draft.note.trim();
  if (note !== "") optional.note = note;

  return body;
}

/**
 * Hand-entry of a restaurant, inline on the directory.
 *
 * It can reach exactly the fields the row editor can reach and no more: the same
 * `FIELD_GROUPS`, the same tri-state amenities, and no way to express a kashrut
 * fact. A certificate is a separate, separately audited act on the created row.
 *
 * The one field that is not an editor field is the review checkbox, and it is not a
 * column write either — the server turns it into the (record_state, needs_review)
 * pair, so the console cannot mint a record state of its own choosing.
 */
export function CreateRestaurantPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (created: RestaurantDetail) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft);
  const [validation, setValidation] = useState<string | null>(null);
  const [errorGloss, setErrorGloss] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setText(field: TextField, value: string) {
    setDraft((prev) => ({ ...prev, text: { ...prev.text, [field]: value } }));
  }

  /** Mirrors the server's own rules, before any fetch. */
  function validate(): boolean {
    if (draft.text.name_he.trim() === "") {
      setValidation("שם (עברית) הוא שדה חובה.");
      return false;
    }
    const slug = draft.text.city_slug.trim();
    if (slug !== "" && !SLUG_PATTERN.test(slug)) {
      setValidation("מזהה עיר (slug) חייב להיות אותיות לטיניות קטנות, ספרות ומקפים בלבד.");
      return false;
    }
    setValidation(null);

    return true;
  }

  async function save() {
    setErrorGloss(null);
    setActionError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const created = await api<RestaurantDetail>("/api/admin/restaurants", {
        method: "POST",
        body: buildCreateBody(draft),
      });
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setErrorGloss(DUPLICATE_GLOSS);
        setActionError(err.message);
      } else {
        setActionError("היצירה נכשלה באופן בלתי צפוי");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail create-panel">
      <div className="create-panel-header">
        <h3>הוספת מסעדה חדשה</h3>
        <button type="button" disabled={busy} onClick={onCancel}>
          ביטול
        </button>
      </div>

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
                  {label(RESTAURANT_STATUS_LABELS, value)}
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

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.queueForReview}
          disabled={busy}
          onChange={(e) => setDraft((prev) => ({ ...prev, queueForReview: e.target.checked }))}
        />
        שליחה לתור בדיקה
      </label>
      <p className="muted">
        {draft.queueForReview
          ? `הרשומה תיווצר במצב "${label(RECORD_STATE_LABELS, "unknown_pending_verification")}" ותמתין בתור הבדיקה.`
          : `הרשומה תיווצר במצב "${label(RECORD_STATE_LABELS, "moderator_verified")}" ולא תגיע לתור הבדיקה.`}
      </p>

      <label className="note-label">
        סיבת ההוספה (מתועדת)
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
          {errorGloss && (
            <>
              {errorGloss}
              <br />
            </>
          )}
          {actionError}
        </p>
      )}

      <div className="action-row">
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "יוצר…" : "יצירת המסעדה"}
        </button>
        <span className="muted">היצירה מתועדת ביומן הביקורת על שם המודרטור המחובר.</span>
      </div>
    </div>
  );
}
