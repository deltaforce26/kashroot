/**
 * The filter registry — every filter the bar and the sheet can show, as data.
 *
 * Both surfaces render from this one list, so a filter added here appears as a chip
 * and as a sheet section at once, edits the same `FilterState`, and needs no change
 * to either component. A filter is one of two shapes: a toggle (one yes/no fact) or
 * an option set (single or multi select over labelled keys).
 *
 * Option keys are strings whatever the value underneath, so one option list and one
 * summary rule serve certifier ids, kilometres and kitchens alike.
 */

import { BadgeCheck, Clock, MapPin, Star, Utensils, type LucideIcon } from "lucide-react";
import type { CertifierView } from "../api/viewmodel";
import type { Lang, Strings } from "../i18n/strings";
import { certifierName, sortCertifiersForDisplay } from "../profile/profile";
import {
  DEFAULT_RADIUS_KM,
  DIET_OPTIONS,
  RADIUS_OPTIONS,
  RATING_OPTIONS,
  type FilterState,
} from "./model";

export type FilterId = "kashrut" | "openNow" | "radius" | "diet" | "rating";

/** What a filter needs from the app to label its options. */
export interface FilterContext {
  t: Strings;
  lang: Lang;
  certifiers: CertifierView[];
}

export interface FilterOption {
  key: string;
  label: string;
}

interface FilterBase {
  id: FilterId;
  icon: LucideIcon;
  label: (t: Strings) => string;
  /** Off its default — drives the chip's filled state and the sliders count. */
  isActive: (state: FilterState) => boolean;
  /** The patch that puts this filter back to its default. */
  clear: () => Partial<FilterState>;
}

export interface ToggleFilter extends FilterBase {
  kind: "toggle";
  set: (on: boolean) => Partial<FilterState>;
}

export interface OptionFilter extends FilterBase {
  kind: "single" | "multi";
  /** Single-select only: picking the chosen option again clears the filter. */
  clearable?: boolean;
  options: (context: FilterContext) => FilterOption[];
  selected: (state: FilterState) => string[];
  select: (keys: string[]) => Partial<FilterState>;
  /** Shown in place of an option list that is empty. */
  emptyHint?: (t: Strings) => string;
}

export type FilterDefinition = ToggleFilter | OptionFilter;

/**
 * The filters that get a chip, in the order the bar draws them. Everything else is
 * reached through the sliders button.
 *
 * The row does not scroll: a chip that can be scrolled out of sight is a filter the
 * user cannot see is there, and a filter bar that hides filters is worse than one
 * that shows fewer. Three is what fits a phone at once, so three is what it holds —
 * the sliders button carries the count of whatever the sheet is holding.
 */
export const BAR_FILTERS: readonly FilterId[] = ["kashrut", "diet", "openNow"];

export const FILTERS: readonly FilterDefinition[] = [
  {
    id: "kashrut",
    kind: "multi",
    icon: BadgeCheck,
    label: (t) => t.filters.kashrut,
    // Alphabetical by the name shown — the same neutral order as the profile picker.
    options: ({ certifiers, lang }) =>
      sortCertifiersForDisplay(certifiers, lang).map((certifier) => ({
        key: certifier.id,
        label: certifierName(certifier, lang),
      })),
    selected: (state) => state.certifierIds,
    select: (keys) => ({ certifierIds: keys }),
    isActive: (state) => state.certifierIds.length > 0,
    clear: () => ({ certifierIds: [] }),
    emptyHint: (t) => t.filters.certifiersUnavailable,
  },
  {
    id: "openNow",
    kind: "toggle",
    icon: Clock,
    label: (t) => t.filters.openNow,
    set: (on) => ({ openNow: on }),
    isActive: (state) => state.openNow,
    clear: () => ({ openNow: false }),
  },
  {
    id: "radius",
    kind: "single",
    icon: MapPin,
    label: (t) => t.filters.radius,
    options: ({ t }) =>
      RADIUS_OPTIONS.map((km) => ({ key: String(km), label: t.filters.radiusValue(km) })),
    selected: (state) => [String(state.radiusKm)],
    select: ([key]) => ({ radiusKm: key === undefined ? DEFAULT_RADIUS_KM : Number(key) }),
    isActive: (state) => state.radiusKm !== DEFAULT_RADIUS_KM,
    clear: () => ({ radiusKm: DEFAULT_RADIUS_KM }),
  },
  {
    id: "diet",
    kind: "multi",
    icon: Utensils,
    label: (t) => t.filters.diet,
    options: ({ t }) => DIET_OPTIONS.map((diet) => ({ key: diet, label: t.diet[diet] })),
    selected: (state) => state.diets,
    select: (keys) => ({ diets: DIET_OPTIONS.filter((diet) => keys.includes(diet)) }),
    isActive: (state) => state.diets.length > 0,
    clear: () => ({ diets: [] }),
  },
  {
    id: "rating",
    kind: "single",
    clearable: true,
    icon: Star,
    label: (t) => t.filters.rating,
    options: ({ t }) =>
      RATING_OPTIONS.map((min) => ({ key: String(min), label: t.filters.ratingValue(min) })),
    selected: (state) => (state.minRating === null ? [] : [String(state.minRating)]),
    select: ([key]) => ({ minRating: key === undefined ? null : Number(key) }),
    isActive: (state) => state.minRating !== null,
    clear: () => ({ minRating: null }),
  },
];

/**
 * What a chip says: its name at the default, the chosen value when there is one,
 * and "name · n" when several are chosen.
 */
/** True when any filter is away from its default — i.e. the user narrowed the results. */
export function anyFilterActive(state: FilterState): boolean {
  return FILTERS.some((filter) => filter.isActive(state));
}

export function chipLabel(
  filter: FilterDefinition,
  state: FilterState,
  context: FilterContext,
): string {
  const label = filter.label(context.t);
  if (filter.kind === "toggle" || !filter.isActive(state)) return label;
  const selected = filter.selected(state);
  if (selected.length > 1) return context.t.filters.summary(label, selected.length);
  const only = filter.options(context).find((option) => option.key === selected[0]);
  return only?.label ?? context.t.filters.summary(label, selected.length);
}
