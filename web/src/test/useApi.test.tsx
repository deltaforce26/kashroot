/**
 * The fail-safe rule at the data layer.
 *
 * `useSearch` used to hold the previous query's results in state while the next
 * request was still in flight. Effects run after React commits, so switching city or
 * profile could paint one frame in which the *old* verdicts sat under the *new*
 * context — a MATCH earned by a profile the user has already left, rendered with no
 * indication that it answers a different question. It self-corrected on the next
 * frame, which does not make it acceptable: "doubt → UNKNOWN, never doubt → MATCH"
 * has no one-frame exemption, and a verdict shown for a frame is still a verdict
 * shown.
 *
 * These tests read `result.current` immediately after the change, before any request
 * can resolve, which is exactly the frame that used to be wrong.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProfileRequest, SearchRequest } from "../api/types";
import { useRestaurant, useSearch } from "../hooks/useApi";

const OPEN_PROFILE: ProfileRequest = {
  whitelist: [
    { certifier_id: "cert-eda", min_level: "regular" },
    { certifier_id: "cert-rubin", min_level: "regular" },
    { certifier_id: "cert-landa", min_level: "regular" },
    { certifier_id: "cert-rab-bb", min_level: "regular" },
    { certifier_id: "cert-rab-jlm", min_level: "regular" },
  ],
  required_attributes: [],
  preferred_diets: [],
  preferred_price_level: null,
  wanted_amenities: [],
};

/** A second profile: same shape, a narrower list — so the verdicts genuinely differ. */
const NARROW_PROFILE: ProfileRequest = {
  ...OPEN_PROFILE,
  whitelist: [{ certifier_id: "cert-eda", min_level: "regular" }],
};

const search = (profile: ProfileRequest, city = "jerusalem"): SearchRequest => ({
  profile,
  city,
  page_size: 100,
});

describe("useSearch never carries an answer across a change of question", () => {
  it("drops the previous results in the same frame the profile changes", async () => {
    const { result, rerender } = renderHook(({ request }) => useSearch(request), {
      initialProps: { request: search(OPEN_PROFILE) },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.items.length).toBeGreaterThan(0);

    rerender({ request: search(NARROW_PROFILE) });

    // No await: this is the frame React has just committed.
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.items.length).toBeGreaterThan(0);
  });

  it("drops them the same way when the city changes", async () => {
    const { result, rerender } = renderHook(({ request }) => useSearch(request), {
      initialProps: { request: search(OPEN_PROFILE, "jerusalem") },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).not.toBeNull();

    rerender({ request: search(OPEN_PROFILE, "bnei-brak") });
    expect(result.current.data).toBeNull();
  });

  it("keeps a structurally identical request from blanking the list", async () => {
    const { result, rerender } = renderHook(({ request }) => useSearch(request), {
      initialProps: { request: search(OPEN_PROFILE) },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.data;

    // A new object, same content — a re-render, not a new question.
    rerender({ request: search(OPEN_PROFILE) });
    expect(result.current.data).toBe(before);
  });

  it("clears a stale error alongside the stale data", async () => {
    const { result, rerender } = renderHook(({ id }) => useRestaurant(id, OPEN_PROFILE), {
      initialProps: { id: "does-not-exist" },
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ id: "r-nougatine" });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).not.toBeNull();
  });
});
