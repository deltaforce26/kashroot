/**
 * Two branches of one chain must not read as a duplicate on the home grid.
 *
 * The seed corpus holds chains as one Restaurant per address (dedupe key is
 * name + city + address), so a Bnei Brak search legitimately returns "טייסטי מיט"
 * twice. The grid tile is the only card shape that used to omit the address; these
 * tests pin the street (or city) onto it so the two tiles stay distinguishable.
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ResultView } from "../api/viewmodel";
import { RestaurantGridCard } from "../components/RestaurantCard";
import { I18nProvider } from "../i18n/I18nProvider";

function renderHe(node: ReactNode) {
  return render(
    <I18nProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );
}

function view(overrides: Partial<ResultView>): ResultView {
  return {
    id: "r1",
    nameHe: "טייסטי מיט",
    nameEn: "Tasty Meat",
    cityHe: "בני ברק",
    addressHe: "הרב קוק 4",
    geo: null,
    distanceKm: 2.6,
    kashrut: {
      verdict: "match",
      reasons: [],
      confidence: "high",
      freshness: null,
      deciding_certificate_id: null,
    },
    fit: { score: 0, components: [] },
    certifiers: [],
    decidingCertifier: null,
    dietType: "meat",
    priceLevel: null,
    isOpenNow: null,
    closesAt: null,
    ...overrides,
  };
}

const noop = () => {};

describe("RestaurantGridCard branches", () => {
  it("shows each branch's street so same-name tiles are distinguishable", () => {
    renderHe(
      <>
        <RestaurantGridCard item={view({ id: "a" })} saved={false} onToggleSave={noop} />
        <RestaurantGridCard
          item={view({ id: "b", cityHe: "רמת גן", addressHe: "חיבת ציון 45", distanceKm: 3.5 })}
          saved={false}
          onToggleSave={noop}
        />
      </>,
    );
    expect(screen.getAllByText("טייסטי מיט")).toHaveLength(2);
    expect(screen.getByText("הרב קוק 4")).toBeInTheDocument();
    expect(screen.getByText("חיבת ציון 45")).toBeInTheDocument();
  });

  it("falls back to the city when the record has no street", () => {
    renderHe(
      <RestaurantGridCard
        item={view({ addressHe: null, cityHe: "רמת גן" })}
        saved={false}
        onToggleSave={noop}
      />,
    );
    expect(screen.getByText("רמת גן")).toBeInTheDocument();
  });

  it("renders no empty line when neither street nor city is known", () => {
    const { container } = renderHe(
      <RestaurantGridCard
        item={view({ addressHe: null, cityHe: null })}
        saved={false}
        onToggleSave={noop}
      />,
    );
    expect(container.querySelector(".card__where")).toBeNull();
  });

  it("keeps the diet and distance on their own line, ahead of the address", () => {
    const { container } = renderHe(
      <RestaurantGridCard item={view({})} saved={false} onToggleSave={noop} />,
    );
    const metas = Array.from(container.querySelectorAll(".card__meta")).map(
      (el) => el.textContent ?? "",
    );
    expect(metas).toHaveLength(2);
    expect(metas[0]).toContain("2.6");
    expect(metas[0]).not.toContain("הרב קוק");
    expect(metas[1]).toBe("הרב קוק 4");
  });
});
