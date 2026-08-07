import type { ReactNode } from "react";

import type { AuditChange, CertificateOut, RestaurantBrief } from "../api/types";

/**
 * Wrapper for any value that may contain Hebrew. dir="auto" lets the browser pick
 * RTL/LTR per value while the surrounding chrome stays English/LTR.
 */
export function Data({ value, fallback = "—" }: { value: ReactNode; fallback?: string }) {
  return <span dir="auto">{value ?? fallback}</span>;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatDate(value: string | null): string {
  return value ?? "—";
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

export function CertificateSummary({ certificate }: { certificate: CertificateOut }) {
  const attrs = Object.entries(certificate.attributes)
    .map(([key, val]) => `${key}=${val ? "yes" : "no"}`)
    .join(", ");
  return (
    <div className="cert-summary">
      <div>
        <strong>Certificate</strong> {shortId(certificate.id)} · certifier{" "}
        <Data value={certifierName(certificate)} /> · level {certificate.level} · state{" "}
        <span className={`badge badge-${certificate.state}`}>{certificate.state}</span>
      </div>
      <div>
        Valid {formatDate(certificate.valid_from)} → {formatDate(certificate.valid_until)} · source{" "}
        {certificate.source}
        {certificate.verified_by_label && (
          <>
            {" "}
            · verified by <Data value={certificate.verified_by_label} /> at{" "}
            {formatDateTime(certificate.verified_at)}
          </>
        )}
      </div>
      {attrs && <div>Attributes: {attrs}</div>}
      {certificate.notes && (
        <div>
          Notes: <Data value={certificate.notes} />
        </div>
      )}
    </div>
  );
}

/** Render an audit `changes` payload as a readable before → after list. */
export function ChangesDiff({ changes }: { changes: Record<string, AuditChange> }) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return <span className="muted">no field changes</span>;
  return (
    <table className="diff-table">
      <tbody>
        {entries.map(([field, change]) => (
          <tr key={field}>
            <td className="diff-field">{field}</td>
            <td className="diff-before">
              <Data value={renderValue(change.before)} />
            </td>
            <td className="diff-arrow">→</td>
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
