import { useState } from "react";

import { api, ApiError } from "../api/client";
import {
  CERTIFICATE_ATTRIBUTES,
  CERTIFICATE_STATES,
  CERTIFICATION_LEVELS,
  type CertificateAttribute,
  type CertificateOut,
  type CertificateState,
  type CertificationLevel,
  type CertifierOption,
  type CreateCertificateRequest,
} from "../api/types";
import { useCertifierOptions } from "../hooks/useCertifierOptions";
import {
  CERTIFICATE_SOURCE_LABELS,
  CERTIFICATE_STATE_LABELS,
  CERTIFICATION_LEVEL_LABELS,
  CERTIFIER_TYPE_LABELS,
  label,
} from "../labels";
import { ConfirmDialog } from "./ConfirmDialog";
import { attributeLabel, Data, Ltr } from "./data";

/**
 * Editor position per attribute. "unknown" = untouched and absent from the payload,
 * which is what the certificate will record: unknown. There is deliberately no
 * "clear" position here, unlike the photo-review editor — nothing exists yet to
 * clear, and `CreateCertificateRequest.attributes` has no null variant.
 */
type TriState = "unknown" | "yes" | "no";

function emptyAttributes(): Record<CertificateAttribute, TriState> {
  return Object.fromEntries(CERTIFICATE_ATTRIBUTES.map((a) => [a, "unknown"])) as Record<
    CertificateAttribute,
    TriState
  >;
}

/**
 * Said in the panel and again in the confirmation, whenever the chosen state is
 * `active`. It is a STATEMENT, NOT A GATE.
 *
 * Recording an active certificate here with no attached evidence is a locked
 * product decision: the moderator is the evidence, and the compensating control is
 * the audit row naming them. Do not turn this into a validation block — that is a
 * product conversation, not a bug fix. The Hebrew for the state itself still comes
 * from the label map, so the wire value stays English.
 */
function noEvidenceLine(): string {
  return `מצב התעודה נקבע ל"${label(CERTIFICATE_STATE_LABELS, "active")}" ללא ראיה מצורפת. הבחירה נרשמת על שם המודרטור המחובר.`;
}

function optionLabel(option: CertifierOption): string {
  const type = label(CERTIFIER_TYPE_LABELS, option.type);
  const name = option.name_en ? `${option.name_he} · ${option.name_en}` : option.name_he;

  return option.is_active ? `${name} — ${type}` : `${name} — ${type} (לא פעיל)`;
}

interface CertificateDraft {
  certifier_id: string;
  certifierQuery: string;
  level: CertificationLevel;
  /** Starts empty: the moderator must choose a state, it is never defaulted. */
  state: CertificateState | "";
  valid_from: string;
  valid_until: string;
  attributes: Record<CertificateAttribute, TriState>;
  notes: string;
  note: string;
}

function emptyDraft(): CertificateDraft {
  return {
    certifier_id: "",
    certifierQuery: "",
    level: "unknown",
    state: "",
    valid_from: "",
    valid_until: "",
    attributes: emptyAttributes(),
    notes: "",
    note: "",
  };
}

/** Only the attributes the moderator affirmed. An untouched key stays unknown. */
function recordedAttributes(
  attributes: Record<CertificateAttribute, TriState>,
): Partial<Record<CertificateAttribute, boolean>> {
  const recorded: Partial<Record<CertificateAttribute, boolean>> = {};
  for (const key of CERTIFICATE_ATTRIBUTES) {
    if (attributes[key] === "yes") recorded[key] = true;
    else if (attributes[key] === "no") recorded[key] = false;
  }

  return recorded;
}

/**
 * The POST body. Empty optionals are omitted rather than sent as `null`, and the
 * provenance columns — `source`, `verified_by_label`, `verified_at`,
 * `corroboration_count` — are simply not expressible: the server stamps them, from
 * the authenticated moderator and the clock. `restaurant_id` is the path.
 */
function buildCreateBody(draft: CertificateDraft, state: CertificateState): CreateCertificateRequest {
  const body: CreateCertificateRequest = {
    certifier_id: draft.certifier_id,
    level: draft.level,
    state,
  };
  const optional = body as unknown as Record<string, unknown>;
  const recorded = recordedAttributes(draft.attributes);
  if (Object.keys(recorded).length > 0) optional.attributes = recorded;
  if (draft.valid_from !== "") optional.valid_from = draft.valid_from;
  if (draft.valid_until !== "") optional.valid_until = draft.valid_until;
  const notes = draft.notes.trim();
  if (notes !== "") optional.notes = notes;
  const note = draft.note.trim();
  if (note !== "") optional.note = note;

  return body;
}

/**
 * Hand-entry of a certificate on a restaurant that already exists.
 *
 * Mounted only after the moderator asks for it, so merely expanding a restaurant
 * row issues no certifier request.
 */
export function CreateCertificatePanel({
  restaurantId,
  onCreated,
  onCancel,
}: {
  restaurantId: string;
  onCreated: (created: CertificateOut) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CertificateDraft>(emptyDraft);
  const [validation, setValidation] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const certifiers = useCertifierOptions(draft.certifierQuery);

  const chosen = certifiers.options.find((option) => option.id === draft.certifier_id) ?? null;
  const recorded = Object.entries(recordedAttributes(draft.attributes)) as Array<
    [CertificateAttribute, boolean]
  >;

  /** Mirrors the server's rules. State is required; dates must not run backwards. */
  function validate(): boolean {
    if (draft.certifier_id === "") {
      setValidation("יש לבחור גוף כשרות.");
      return false;
    }
    if (draft.state === "") {
      setValidation("יש לבחור את מצב התעודה — אין ברירת מחדל.");
      return false;
    }
    if (draft.valid_from !== "" && draft.valid_until !== "" && draft.valid_until < draft.valid_from) {
      setValidation("תאריך סיום התוקף אינו יכול להקדים את תאריך תחילתו.");
      return false;
    }
    setValidation(null);

    return true;
  }

  async function submit() {
    if (draft.state === "") return;
    setActionError(null);
    setBusy(true);
    try {
      const created = await api<CertificateOut>(
        `/api/admin/restaurants/${restaurantId}/certificates`,
        { method: "POST", body: buildCreateBody(draft, draft.state) },
      );
      onCreated(created);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "היצירה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="cert-create">
      <h4>הוספת תעודה לרשומה הזו</h4>

      <fieldset className="tristate-editor">
        <legend>גוף הכשרות</legend>
        <div className="tristate-grid">
          <label className="tristate-row">
            חיפוש גוף כשרות
            <input
              type="search"
              dir="auto"
              value={draft.certifierQuery}
              disabled={busy}
              onChange={(e) => setDraft((prev) => ({ ...prev, certifierQuery: e.target.value }))}
            />
          </label>
          <label className="tristate-row">
            גוף כשרות
            <select
              dir="auto"
              value={draft.certifier_id}
              disabled={busy || certifiers.loading}
              onChange={(e) => setDraft((prev) => ({ ...prev, certifier_id: e.target.value }))}
            >
              <option value="">— יש לבחור גוף כשרות</option>
              {certifiers.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {certifiers.loading && <p className="muted">טוען גופי כשרות…</p>}
        {certifiers.error && <p className="field-error">{certifiers.error}</p>}
        <p className="muted">
          גוף כשרות שאינו פעיל מסומן ככזה ועדיין ניתן לבחירה — תעודה היסטורית אמיתית חייבת
          להיות ניתנת לרישום. הרשימה אינה מדרגת גופי כשרות.
        </p>
      </fieldset>

      <fieldset className="tristate-editor">
        <legend>התעודה</legend>
        <div className="tristate-grid">
          <label className="tristate-row">
            רמת הכשרות
            <select
              value={draft.level}
              disabled={busy}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, level: e.target.value as CertificationLevel }))
              }
            >
              {CERTIFICATION_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {label(CERTIFICATION_LEVEL_LABELS, value)}
                </option>
              ))}
            </select>
          </label>
          <label className="tristate-row">
            מצב התעודה
            <select
              value={draft.state}
              disabled={busy}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, state: e.target.value as CertificateState | "" }))
              }
            >
              <option value="">— יש לבחור מצב</option>
              {CERTIFICATE_STATES.map((value) => (
                <option key={value} value={value}>
                  {label(CERTIFICATE_STATE_LABELS, value)}
                </option>
              ))}
            </select>
          </label>
          <label className="tristate-row">
            בתוקף מתאריך
            <input
              type="date"
              className="ltr"
              value={draft.valid_from}
              disabled={busy}
              onChange={(e) => setDraft((prev) => ({ ...prev, valid_from: e.target.value }))}
            />
          </label>
          <label className="tristate-row">
            בתוקף עד תאריך
            <input
              type="date"
              className="ltr"
              value={draft.valid_until}
              disabled={busy}
              onChange={(e) => setDraft((prev) => ({ ...prev, valid_until: e.target.value }))}
            />
          </label>
        </div>
        {draft.state === "active" && <p className="muted">{noEvidenceLine()}</p>}
      </fieldset>

      <div className="tristate-editor">
        <h4>מאפייני התעודה</h4>
        <p className="muted">
          יש לסמן רק את מה שניתן לאשר מתוך התעודה עצמה — מאפיין שלא נגעת בו אינו נשלח ונשאר
          לא ידוע בתעודה.
        </p>
        <div className="tristate-grid">
          {CERTIFICATE_ATTRIBUTES.map((key) => (
            <label key={key} className="tristate-row">
              {attributeLabel(key)}
              {/* The raw key stays visible: it is what the audit log and the API speak. */}
              <code>{key}</code>
              <select
                value={draft.attributes[key]}
                disabled={busy}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    attributes: { ...prev.attributes, [key]: e.target.value as TriState },
                  }))
                }
              >
                <option value="unknown">לא ידוע (לא נשלח)</option>
                <option value="yes">כן</option>
                <option value="no">לא</option>
              </select>
            </label>
          ))}
        </div>
      </div>

      <label className="note-label">
        הערות על התעודה
        <textarea
          dir="auto"
          rows={2}
          value={draft.notes}
          disabled={busy}
          onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </label>

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
          {actionError}
        </p>
      )}

      <div className="action-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setActionError(null);
            if (validate()) setConfirming(true);
          }}
        >
          הוספת התעודה…
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          ביטול
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="להוסיף את התעודה הזו לרשומה?"
          confirmLabel="הוספת התעודה"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void submit()}
        >
          <p>התעודה תיווצר כך, והפעולה תתועד ביומן הביקורת:</p>
          <ul>
            <li>
              גוף כשרות: <Data value={chosen ? optionLabel(chosen) : "—"} />
            </li>
            <li>רמה: {label(CERTIFICATION_LEVEL_LABELS, draft.level)}</li>
            <li>
              מצב:{" "}
              {draft.state === ""
                ? "—"
                : label(CERTIFICATE_STATE_LABELS, draft.state)}
            </li>
            {draft.state === "active" && <li>{noEvidenceLine()}</li>}
            <li>
              תוקף: <Ltr value={draft.valid_from || "—"} /> עד{" "}
              <Ltr value={draft.valid_until || "—"} />
            </li>
            <li>
              {recorded.length > 0
                ? `${recorded.length} מאפיינים נרשמים: ` +
                  recorded.map(([k, v]) => `${attributeLabel(k)}: ${v ? "כן" : "לא"}`).join(", ")
                : "לא נרשמים מאפיינים — כולם יישארו לא ידועים"}
            </li>
            <li>
              המקור יירשם כ"{label(CERTIFICATE_SOURCE_LABELS, "moderator_verified")}", על שם
              המודרטור המחובר ובזמן הזה.
            </li>
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}
