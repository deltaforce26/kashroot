/**
 * Filters — the soft-filter screen behind the sliders button on home.
 *
 * Everything on it is Layer 2: city, kitchen, radius. There is deliberately no
 * control that touches the verdict — no "matches only" switch, no verdict sort, no
 * certifier picker. Hiding NO_MATCH and UNKNOWN results would answer a question the
 * user did not ask and would quietly turn "we have no evidence" into "there is
 * nothing here". The kashrut panel at the bottom says so and points at the profile,
 * which is the only place a verdict can actually be changed.
 *
 * The filters apply as they are tapped — the buttons that leave (the CTA at the
 * bottom and the sliders circle in the header) just return to the list — so no state
 * is stranded here if the user leaves by the tab bar instead.
 */

import { useNavigate } from "react-router-dom";
import type { DietType } from "../api/types";
import { ChevronIcon, SlidersIcon } from "../components/icons";
import { TabBar } from "../components/TabBar";
import { CITIES } from "../config";
import { RADIUS_OPTIONS, isDefault, useFilters } from "../filters/useFilters";
import { useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";

const DIET_OPTIONS: readonly DietType[] = ["meat", "dairy", "pareve", "fish"];

export function Filters() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { slug, setSlug } = useCity();
  const { filters, setFilters, reset } = useFilters();

  return (
    <div className="shell">
      <header className="shell__header">
        <div style={{ flex: 1 }}>
          <h1 style={{ font: "700 24px Assistant, sans-serif", margin: 0 }}>{t.filters.title}</h1>
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{t.filters.lead}</div>
        </div>
        {/* The sliders circle that opened this screen from home and search sits in the
            mirrored corner here, and a control that looks like a toggle has to behave
            like one: tapping it dismisses the screen the same way the CTA below does.
            Left as decoration it was a dead affordance in exactly the spot the user
            just tapped to get here — in Hebrew (RTL) that spot is the top left. */}
        <button
          type="button"
          className="circle glass"
          aria-label={t.filters.close}
          onClick={() => navigate("/")}
        >
          <SlidersIcon />
        </button>
      </header>

      <div className="shell__scroll" style={{ paddingTop: 14 }}>
        <section className="panel glass" aria-labelledby="filter-city">
          <h2 className="filter-group__title" id="filter-city">
            {t.filters.city}
          </h2>
          <div className="filter-group">
            {CITIES.map((city) => (
              <button
                key={city.slug}
                type="button"
                className="tag"
                aria-pressed={city.slug === slug}
                onClick={() => setSlug(city.slug)}
              >
                {lang === "en" ? city.en : city.he}
              </button>
            ))}
          </div>
        </section>

        <section className="panel glass" aria-labelledby="filter-diet">
          <h2 className="filter-group__title" id="filter-diet">
            {t.filters.diet}
          </h2>
          <div className="filter-group">
            <button
              type="button"
              className="tag"
              aria-pressed={filters.diet === null}
              onClick={() => setFilters({ diet: null })}
            >
              {t.filters.anyDiet}
            </button>
            {DIET_OPTIONS.map((diet) => (
              <button
                key={diet}
                type="button"
                className="tag"
                aria-pressed={filters.diet === diet}
                onClick={() => setFilters({ diet })}
              >
                {t.diet[diet]}
              </button>
            ))}
          </div>
        </section>

        <section className="panel glass" aria-labelledby="filter-radius">
          <h2 className="filter-group__title" id="filter-radius">
            {t.filters.radius}
          </h2>
          <div className="filter-group">
            {RADIUS_OPTIONS.map((km) => (
              <button
                key={km}
                type="button"
                className="tag"
                aria-pressed={filters.radiusKm === km}
                onClick={() => setFilters({ radiusKm: km })}
              >
                {t.filters.radiusValue(km)}
              </button>
            ))}
          </div>
          {/* Named, not silently omitted: the facets the API defines but the corpus
              cannot answer yet. A user who goes looking for a price filter deserves
              to know it is missing data, not a missing feature. */}
          <p className="hint" style={{ textAlign: "start", marginBottom: 0 }}>
            {t.filters.unavailable}
          </p>
        </section>

        <section className="panel glass" aria-labelledby="filter-kashrut">
          <h2 className="filter-group__title" id="filter-kashrut">
            {t.filters.kashrutTitle}
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--on-tint)", lineHeight: 1.5, margin: "0 0 10px" }}>
            {t.filters.kashrutBody}
          </p>
          <button
            type="button"
            style={{ fontSize: 12.5, fontWeight: 700 }}
            onClick={() => navigate("/profile")}
          >
            {t.filters.kashrutLink}
          </button>
        </section>

        <div className="actions" style={{ paddingBottom: 4 }}>
          <button
            type="button"
            className="cta cta--ghost"
            style={{ flex: "0 0 auto", padding: "14px 20px", fontSize: 14, width: "auto" }}
            disabled={isDefault(filters)}
            onClick={reset}
          >
            {t.filters.reset}
          </button>
          <button type="button" className="cta" onClick={() => navigate("/")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.filters.apply}
              <ChevronIcon size={15} />
            </span>
          </button>
        </div>
      </div>

      <TabBar />
    </div>
  );
}
