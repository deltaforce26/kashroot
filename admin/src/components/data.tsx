import type { ReactNode } from "react";

import type {
  AuditChange,
  CertificateAttribute,
  CertificateOut,
  RestaurantBrief,
} from "../api/types";
import {
  CERTIFICATE_SOURCE_LABELS,
  CERTIFICATE_STATE_LABELS,
  CERTIFICATION_LEVEL_LABELS,
  ATTRIBUTE_LABELS,
  label,
} from "../labels";

/**
 * Wrapper for any value that may contain Hebrew. dir="auto" lets the browser pick
 * RTL/LTR per value while the surrounding chrome is Hebrew/RTL — so a Latin-script
 * name inside a Hebrew sentence still reads left-to-right.
 */
export function Data({ value, fallback = "—" }: { value: ReactNode; fallback?: string }) {
  return <span dir="auto">{value ?? fallback}</span>;
}

/**
 * A Latin-script technical value (UUID, slug, MIME type, timestamp) inside Hebrew
 * prose. Unlike `Data` this never guesses: bidi isolation is forced, because these
 * values start with digits or punctuation that `dir="auto"` would resolve as RTL.
 */
export function Ltr({ value }: { value: ReactNode }) {
  return <span className="ltr">{value}</span>;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatDate(value: string | null): string {
  return value ?? "—";
}

/**
 * Today as a civil date in Israel (YYYY-MM-DD) — mirrors the server's ISRAEL_TZ
 * rule for "strictly future" date checks. en-CA formatting yields ISO order.
 * The server remains authoritative; this only makes the client pre-check agree.
 */
export function todayInIsrael(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function restaurantName(r: RestaurantBrief): ReactNode {
  return (
    <>
      <Data value={r.name_he} />
      {r.name_en && (
        <>
          {" · "}
          <Data value={r.name_en} />
        </>
      )}
      {r.branch_label && (
        <>
          {" "}
          (<Data value={r.branch_label} />)
        </>
      )}
    </>
  );
}

/** Certifier display name: Hebrew name, else English, else a truncated UUID. */
export function certifierName(certificate: CertificateOut): string {
  return (
    certificate.certifier?.name_he ??
    certificate.certifier?.name_en ??
    shortId(certificate.certifier_id)
  );
}

/** Hebrew name for a certificate attribute key, falling back to the raw key. */
export function attributeLabel(key: string): string {
  return label(ATTRIBUTE_LABELS, key as CertificateAttribute);
}

/** `{glatt: true}` → `גלאט: כן`, for the human-readable attribute summaries. */
export function attributeSummary(attributes: Record<string, boolean>): string {
  return Object.entries(attributes)
    .map(([key, val]) => `${attributeLabel(key)}: ${val ? "כן" : "לא"}`)
    .join(", ");
}

export function CertificateSummary({ certificate }: { certificate: CertificateOut }) {
  const attrs = attributeSummary(certificate.attributes);
  return (
    <div className="cert-summary">
      <div>
        <strong>תעודה</strong> <Ltr value={shortId(certificate.id)} /> · גוף כשרות{" "}
        <Data value={certifierName(certificate)} /> · רמה{" "}
        {label(CERTIFICATION_LEVEL_LABELS, certificate.level)} · מצב{" "}
        <span className={`badge badge-${certificate.state}`}>
          {label(CERTIFICATE_STATE_LABELS, certificate.state)}
        </span>
      </div>
      <div>
        בתוקף מ־<Ltr value={formatDate(certificate.valid_from)} /> עד{" "}
        <Ltr value={formatDate(certificate.valid_until)} /> · מקור{" "}
        {label(CERTIFICATE_SOURCE_LABELS, certificate.source)}
        {certificate.verified_by_label && (
          <>
            {" "}
            · אומת בידי <Data value={certificate.verified_by_label} /> בתאריך{" "}
            <Ltr value={formatDateTime(certificate.verified_at)} />
          </>
        )}
      </div>
      {attrs && <div>מאפיינים: {attrs}</div>}
      {certificate.notes && (
        <div>
          הערות: <Data value={certificate.notes} />
        </div>
      )}
    </div>
  );
}

/** Render an audit `changes` payload as a readable before ← after list (RTL reading order). */
export function ChangesDiff({ changes }: { changes: Record<string, AuditChange> }) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return <span className="muted">אין שינויי שדות</span>;
  return (
    <table className="diff-table">
      <tbody>
        {entries.map(([field, change]) => (
          <tr key={field}>
            <td className="diff-field">{field}</td>
            <td className="diff-before">
              <Data value={renderValue(change.before)} />
            </td>
            <td className="diff-arrow">←</td>
            <td className="diff-after">
              <Data value={renderValue(change.after)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
