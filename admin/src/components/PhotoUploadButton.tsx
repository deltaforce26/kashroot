import { useRef, useState } from "react";

import { api, ApiError } from "../api/client";
import type { EvidencePhotoOut } from "../api/types";
import { ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "../api/types";
import { useToast } from "./Toast";

interface PhotoUploadButtonProps {
  certificateId: string;
  /** Called with the created (PENDING_REVIEW) photo after a successful upload. */
  onUploaded?: (photo: EvidencePhotoOut) => void;
}

/**
 * "העלאת תמונת תעודה" — multipart POST /api/admin/certificates/{id}/photos.
 *
 * Client-side mirrors of the server gates (which remain authoritative):
 * jpeg/png/webp/pdf only and ≤ 15 MB. The upload lands PENDING_REVIEW and
 * changes nothing on the certificate until a moderator accepts it in the
 * Photos queue.
 */
export function PhotoUploadButton({ certificateId, onUploaded }: PhotoUploadButtonProps) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("סוג קובץ לא נתמך — יש להשתמש ב־JPEG, PNG, WebP או PDF.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("הקובץ חורג ממגבלת 15 MB.");
      return;
    }
    setBusy(true);
    // No manual Content-Type here: the browser sets multipart/form-data + boundary.
    const form = new FormData();
    form.append("file", file);
    try {
      const photo = await api<EvidencePhotoOut>(
        `/api/admin/certificates/${certificateId}/photos`,
        { method: "POST", body: form },
      );
      showToast(
        "התמונה הועלתה — ממתינה לבדיקה בתור התמונות. דבר לא משתנה בתעודה עד שהיא מאושרת.",
      );
      onUploaded?.(photo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ההעלאה נכשלה באופן בלתי צפוי");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="photo-upload">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        aria-label="קובץ תמונת תעודה"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "מעלה…" : "העלאת תמונת תעודה"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
