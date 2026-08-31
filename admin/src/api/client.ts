/**
 * Single fetch wrapper for the moderation API.
 *
 * - Adds `Authorization: Bearer <token>` from sessionStorage on every request.
 * - Normalizes FastAPI errors (string or validation-array `detail`) into ApiError.
 * - On any 401: clears the stored token and notifies the registered handler so the
 *   app can bounce back to the login screen. The token itself is never logged.
 */

const TOKEN_KEY = "kashroot.admin.token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Register the app-level reaction to a 401 (redirect to login). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
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
  return `הבקשה נכשלה (HTTP ${status})`;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: QueryParams;
  /** JSON-serializable body, or a FormData for multipart uploads. */
  body?: unknown;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body } = options;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // A FormData body must NOT get a manual Content-Type: the browser sets
  // multipart/form-data together with the boundary it generated.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body === undefined ? null : isFormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "שגיאת רשת — האם שרת ה־API פועל?");
  }

  if (response.status === 401) {
    clearToken();
    unauthorizedHandler?.();
    throw new ApiError(401, "החיבור פג או שהטוקן אינו תקין. יש להתחבר מחדש.");
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
