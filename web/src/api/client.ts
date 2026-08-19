/**
 * Single fetch wrapper for the consumer API — same shape as `admin/src/api/client.ts`,
 * minus the token handling: this surface has no auth and no accounts. The kashrut
 * profile travels in the request body instead (POC_PLAN B3).
 *
 * All paths are same-origin `/api/...`; the Vite dev proxy forwards them to :8000.
 * No CORS is involved anywhere, deliberately.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the request never reached the server (offline, server down). */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

interface ValidationErrorItem {
  loc?: Array<string | number>;
  msg?: string;
}

/** FastAPI `detail` may be a plain string or a 422 validation array. */
function normalizeDetail(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const parts = (detail as ValidationErrorItem[])
        .map((item) => {
          const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
          return loc && item.msg ? `${loc}: ${item.msg}` : (item.msg ?? "");
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join("; ");
    }
  }
  return `Request failed (HTTP ${status})`;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Network error — is the API server running?");
  }

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // non-JSON error body — fall through to the generic message
    }
    throw new ApiError(response.status, normalizeDetail(parsed, response.status));
  }

  return (await response.json()) as T;
}
