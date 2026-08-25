import type { ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/** Modal confirmation used for irreversible, audited actions (degrades). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            ביטול
          </button>
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "מבצע…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
