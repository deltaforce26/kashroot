/**
 * The filter bar — three chips over the results, plus the sliders button that opens
 * every filter at once in a bottom sheet.
 *
 * The row neither scrolls nor wraps. It carries the three filters worth a chip
 * (`BAR_FILTERS`: kashrut, food type, open now) and everything else lives behind the
 * sliders button, so no filter can sit off the edge of the row where nobody will
 * find it. Chips shrink and ellipsize rather than overflow — a long certifier name
 * cannot push the page sideways. `chips` overrides the set for a screen that wants a
 * different one.
 *
 * Chips apply as they are tapped; the sheet stages its changes until "החל" (see
 * FilterSheet). Both edit the one store in `filters/useFilters.ts`, so each always
 * shows what the other did — including the filters only the sheet draws, whose count
 * the sliders button carries. Without that count a radius set in the sheet would
 * narrow the list with nothing on screen to say so.
 *
 * The bar knows nothing about requests. Screens turn the stored state into one with
 * `toSearchFilters`, and a changed request is what re-runs the search — no reload,
 * no navigation.
 *
 * The sheet renders beside the bar, not inside it: it has to position against the
 * shell, and the bar is its own positioning context for the popover.
 */

import { SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  BAR_FILTERS,
  FILTERS,
  chipLabel,
  type FilterContext,
  type FilterDefinition,
  type FilterId,
} from "../../filters/registry";
import { useFilters } from "../../filters/useFilters";
import { useI18n } from "../../i18n/I18nProvider";
import { useProfile } from "../../profile/ProfileProvider";
import { FilterChip } from "./FilterChip";
import { FilterPopover } from "./FilterPopover";
import { FilterSheet } from "./FilterSheet";
import { FILTER_ICON } from "./icon";

const NONE: readonly FilterId[] = [];

interface FilterBarProps {
  /** Filters this screen cannot answer at all — gone from the chips and the sheet. */
  exclude?: readonly FilterId[] | undefined;
  /** Which filters get a chip, in order. The rest are sheet-only. */
  chips?: readonly FilterId[] | undefined;
}

export function FilterBar({ exclude = NONE, chips = BAR_FILTERS }: FilterBarProps) {
  const { t, lang } = useI18n();
  const { certifiers, certifiersLoading } = useProfile();
  const { filters: state, setFilters } = useFilters();
  const [openId, setOpenId] = useState<FilterId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const popoverId = useId();

  const context = useMemo<FilterContext>(() => ({ t, lang, certifiers }), [t, lang, certifiers]);
  const visible = FILTERS.filter((filter) => !exclude.includes(filter.id));
  // Chip order follows `chips`, not the registry's own order.
  const onBar = chips
    .map((id) => visible.find((filter) => filter.id === id))
    .filter((filter): filter is FilterDefinition => filter !== undefined);
  const activeCount = visible.filter((filter) => filter.isActive(state)).length;
  const open = onBar.find((filter) => filter.id === openId);

  const closePopover = useCallback(() => setOpenId(null), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // A stored certifier id the server no longer knows (a reseeded database) would
  // narrow the list to nothing, silently. Drop those once the list has loaded — the
  // same reconciliation ProfileProvider runs over the whitelist.
  useEffect(() => {
    if (certifiersLoading || certifiers.length === 0 || state.certifierIds.length === 0) return;
    const known = new Set(certifiers.map((certifier) => certifier.id));
    const kept = state.certifierIds.filter((id) => known.has(id));
    if (kept.length !== state.certifierIds.length) setFilters({ certifierIds: kept });
  }, [certifiers, certifiersLoading, state.certifierIds, setFilters]);

  return (
    <>
      <div className="fbar">
        <button
          type="button"
          className="fbar__all"
          aria-label={activeCount > 0 ? t.home.filtersActive : t.home.openFilters}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => {
            setOpenId(null);
            setSheetOpen(true);
          }}
        >
          <SlidersHorizontal {...FILTER_ICON} />
          {activeCount > 0 && (
            <span className="fbar__count" aria-hidden="true">
              {activeCount}
            </span>
          )}
        </button>

        <div className="fbar__chips" role="group" aria-label={t.filters.title}>
          {onBar.map((filter) =>
            filter.kind === "toggle" ? (
              <FilterChip
                key={filter.id}
                variant="toggle"
                icon={filter.icon}
                label={chipLabel(filter, state, context)}
                active={filter.isActive(state)}
                onClick={() => {
                  setOpenId(null);
                  setFilters(filter.set(!filter.isActive(state)));
                }}
              />
            ) : (
              <FilterChip
                key={filter.id}
                variant="dropdown"
                icon={filter.icon}
                label={chipLabel(filter, state, context)}
                active={filter.isActive(state)}
                expanded={openId === filter.id}
                controls={openId === filter.id ? popoverId : undefined}
                onClick={() => setOpenId((current) => (current === filter.id ? null : filter.id))}
              />
            ),
          )}
        </div>

        {open && open.kind !== "toggle" && (
          <FilterPopover
            id={popoverId}
            filter={open}
            state={state}
            context={context}
            onChange={setFilters}
            onClose={closePopover}
          />
        )}
      </div>

      {sheetOpen && (
        <FilterSheet
          filters={visible}
          initial={state}
          context={context}
          onApply={(next) => {
            setFilters(next);
            setSheetOpen(false);
          }}
          onClose={closeSheet}
        />
      )}
    </>
  );
}
