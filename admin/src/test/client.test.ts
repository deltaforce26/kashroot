import { afterEach, describe, expect, it, vi } from "vitest";

import {
  api,
  ApiError,
  clearToken,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "../api/client";

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () =>
      body instanceof Error ? Promise.reject(body) : Promise.resolve(body),
  } as unknown as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  clearToken();
});

describe("api client auth", () => {
  it("sends Authorization: Bearer <token> when a token is stored", async () => {
    setToken("secret-token");
    const fetchMock = mockFetch(200, { ok: true });
    await api("/api/admin/queues/review");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-token",
    );
  });

  it("omits the Authorization header when no token is stored", async () => {
    const fetchMock = mockFetch(200, {});
    await api("/api/admin/audit");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty("Authorization");
  });

  it("on 401 clears the token, notifies the handler, and throws ApiError(401)", async () => {
    setToken("stale-token");
    mockFetch(401, { detail: "Not authenticated" }, false);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    const err = await api("/api/admin/queues/flags").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
  });
});

describe("api client error normalization", () => {
  it("surfaces a string FastAPI detail as the error message", async () => {
    mockFetch(409, { detail: "flag is already resolved" }, false);
    const err = await api("/api/admin/flags/x/resolve", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("flag is already resolved");
    expect((err as ApiError).status).toBe(409);
  });

  it("joins a 422 validation-array detail into a readable message", async () => {
    mockFetch(
      422,
      {
        detail: [
          { loc: ["body", "reason"], msg: "String should have at least 1 character" },
          { loc: ["body", "outcome"], msg: "Input should be 'dismissed', …" },
        ],
      },
      false,
    );
    const err = await api("/api/admin/certificates/x/degrade", {
      method: "POST",
      body: {},
    }).catch((e: unknown) => e);
    expect((err as ApiError).message).toContain("body.reason: String should have at least");
    expect((err as ApiError).message).toContain("body.outcome:");
  });

  it("falls back to a generic HTTP message for non-JSON error bodies", async () => {
    mockFetch(500, new Error("not json"), false);
    const err = await api("/api/admin/audit").catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("Request failed (HTTP 500)");
  });

  it("wraps network failures in ApiError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api("/api/admin/audit").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});

describe("api client requests", () => {
  it("serializes query params and omits undefined/empty values", async () => {
    const fetchMock = mockFetch(200, {});
    await api("/api/admin/queues/expiry", {
      query: { days: 14, city: undefined, limit: 50, offset: 0, blank: "" },
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/admin/queues/expiry?days=14&limit=50&offset=0");
  });

  it("POSTs a JSON body with Content-Type set and returns the parsed response", async () => {
    setToken("t");
    const fetchMock = mockFetch(200, { id: "abc", state: "rejected" });
    const result = await api<{ id: string }>("/api/admin/flags/abc/resolve", {
      method: "POST",
      body: { outcome: "dismissed", note: "checked" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ outcome: "dismissed", note: "checked" });
    expect(result.id).toBe("abc");
  });
});
