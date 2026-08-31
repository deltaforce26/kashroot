import { useState } from "react";

import type { AuditLogOut } from "../api/types";
import { ChangesDiff, Data, formatDateTime, Ltr, shortId } from "../components/data";
import { Pager } from "../components/QueueControls";
import { EmptyState, ErrorState, LoadingState } from "../components/states";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, label } from "../labels";

const ENTITY_TYPES = ["", "restaurant", "certificate", "flag"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const [entityIdInput, setEntityIdInput] = useState("");

  const entityId = entityIdInput.trim();
  const entityIdValid = entityId === "" || UUID_RE.test(entityId);

  const { items, total, loading, error, offset, reload, next, prev } =
    usePagedQuery<AuditLogOut>("/api/admin/audit", {
      entity_type: entityType || undefined,
      entity_id: entityIdValid && entityId ? entityId : undefined,
    });

  return (
    <section>
      <h2>יומן ביקורת</h2>
      <p className="muted">לקריאה בלבד. החדשות ראשונות. כל שינוי בסטטוס כשרות נרשם כאן.</p>
      <div className="controls">
        <label className="control">
          סוג ישות
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t ? label(AUDIT_ENTITY_LABELS, t) : "הכול"}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          מזהה ישות
          <input
            type="text"
            className="ltr"
            value={entityIdInput}
            placeholder="UUID"
            onChange={(e) => setEntityIdInput(e.target.value)}
          />
        </label>
      </div>
      {!entityIdValid && <p className="field-error">מזהה הישות חייב להיות UUID מלא.</p>}
      {loading && <LoadingState />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="אין רשומות ביקורת התואמות לסינון הנוכחי." />
      )}
      {!loading && !error && items.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>מתי (UTC)</th>
              <th>מבצע</th>
              <th>פעולה</th>
              <th>ישות</th>
              <th>שינויים</th>
              <th>ראיות</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.id}>
                <td className="nowrap">
                  <Ltr value={formatDateTime(entry.created_at)} />
                </td>
                <td>
                  <Data value={entry.actor} />
                </td>
                <td>{label(AUDIT_ACTION_LABELS, entry.action)}</td>
                <td className="nowrap">
                  {label(AUDIT_ENTITY_LABELS, entry.entity_type)}
                  {entry.entity_id && (
                    <>
                      {" "}
                      <Ltr value={shortId(entry.entity_id)} />
                    </>
                  )}
                </td>
                <td>
                  <ChangesDiff changes={entry.changes} />
                </td>
                <td>
                  <EvidenceList evidence={entry.evidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager total={total} offset={offset} shown={items.length} onPrev={prev} onNext={next} />
    </section>
  );
}

function EvidenceList({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <ul className="evidence-list">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="muted">{key}:</span>{" "}
          <Data value={typeof value === "string" ? value : JSON.stringify(value)} />
        </li>
      ))}
    </ul>
  );
}
