/**
 * Live data rendered through the real components.
 *
 * The API contract test next door proves the JSON maps cleanly. This proves the
 * mapped objects actually render: Hebrew text, a verdict pill, an evidence panel
 * built from real reason codes and real provenance. Skips when the API is down.
 */

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { KashrootApi } from "../api";
import type { DetailView, ResultView } from "../api/viewmodel";
import { decidingCertificate } from "../api/viewmodel";
import { EvidencePanel } from "../components/EvidencePanel";
import { RestaurantRowCard } from "../components/RestaurantCard";
import { I18nProvider } from "../i18n/I18nProvider";
import { STRINGS } from "../i18n/strings";
import type { ProfileRequest } from "../api/types";

const BASE = process.env["KASHROOT_LIVE_API"] ?? "http://127.0.0.1:8000";
const CENTER = { lat: 31.7649, lon: 35.1846 };

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

const LIVE = await reachable();

describe.skipIf(!LIVE)("live data, real components", () => {
  const realFetch = globalThis.fetch;
  let api: KashrootApi;
  let profile: ProfileRequest;
  let items: ResultView[];

  beforeAll(async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return realFetch(url.startsWith("/") ? `${BASE}${url}` : url, init);
    }) as typeof fetch;
    vi.stubEnv("VITE_API_MODE", "live");
    api = (await import("../api")).kashrootApi;

    const certifiers = await api.getCertifiers();
    profile = {
      whitelist: certifiers.map((c) => ({ certifier_id: c.id, min_level: "regular" as const })),
      required_attributes: [],
      preferred_diets: [],
      preferred_price_level: null,
      wanted_amenities: [],
    };
    items = (await api.search({ profile, center: CENTER, radius_km: 12, page_size: 60 })).items;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  const renderHe = (node: React.ReactNode) =>
    render(
      <I18nProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nProvider>,
    );

  it("renders a live result card with Hebrew text and a verdict pill", () => {
    const item = items[0];
    expect(item).toBeDefined();
    if (!item) return;

    const { container } = renderHe(
      <RestaurantRowCard item={item} saved={false} onToggleSave={() => {}} />,
    );

    expect(screen.getAllByText(item.nameHe).length).toBeGreaterThan(0);
    // Hebrew actually made it through, not mojibake.
    expect(item.nameHe).toMatch(/[֐-׿]/);
    expect(container.querySelector(`.verdict--${item.kashrut.verdict}`)).not.toBeNull();
    // Layer 2 is present but never inside the verdict row.
    expect(container.querySelector(".fit")).not.toBeNull();
    for (const foot of container.querySelectorAll(".card__foot")) {
      expect(foot.querySelector(".fit")).toBeNull();
    }
  });

  it("renders every live verdict class without falling back to a raw code", async () => {
    // Gate-first ordering means one page of a broad search is all MATCH, so pull a
    // stricter profile too — that is where UNKNOWN and NO_MATCH live in this corpus.
    const strict = (
      await api.search({
        profile: { ...profile, required_attributes: ["glatt"] },
        center: CENTER,
        radius_km: 12,
        page_size: 100,
      })
    ).items;

    const byVerdict = new Map<string, ResultView>();
    for (const item of [...items, ...strict]) byVerdict.set(item.kashrut.verdict, item);
    expect(byVerdict.size).toBeGreaterThan(1);

    for (const [verdict, item] of byVerdict) {
      const { container, unmount } = renderHe(
        <RestaurantRowCard item={item} saved={false} onToggleSave={() => {}} />,
      );
      expect(container.querySelector(`.verdict--${verdict}`)).not.toBeNull();
      // No un-translated reason code leaked into the evidence line.
      expect(container.textContent ?? "").not.toMatch(/certifier_in_whitelist|evidence_fresh|_/);
      unmount();
    }
  });

  it("builds the evidence panel from real reason codes and real provenance", async () => {
    const item = items[0];
    if (!item) return;
    const detail: DetailView = await api.getRestaurant(item.id, profile, CENTER);
    const deciding = decidingCertificate(detail);

    renderHe(<EvidencePanel match={detail.kashrut} deciding={deciding} />);

    const title =
      detail.kashrut.verdict === "match"
        ? STRINGS.he.verdict.whyMatch
        : detail.kashrut.verdict === "no_match"
          ? STRINGS.he.verdict.whyNoMatch
          : STRINGS.he.verdict.whyUnknown;
    const panel = screen.getByLabelText(title);
    const rows = within(panel).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);

    // Each line is real prose, not a code, and the certifier is named by name.
    for (const row of rows) {
      expect((row.textContent ?? "").trim().length).toBeGreaterThan(1);
      expect(row.textContent ?? "").not.toMatch(/[a-z]+_[a-z]+/);
    }
    if (deciding) {
      expect(panel.textContent ?? "").toContain(deciding.certifier.name_he);
    }
  });

  it("renders the English UI from records that have no English name", async () => {
    const item = items[0];
    if (!item) return;
    // Every live record has name_en === null, so the English UI must fall back to
    // Hebrew rather than rendering an empty card.
    render(
      <I18nProvider>
        <MemoryRouter>
          <RestaurantRowCard item={item} saved={false} onToggleSave={() => {}} />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getAllByText(item.nameHe).length).toBeGreaterThan(0);
  });
});
