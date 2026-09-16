/**
 * A chip's options, dropped under the bar.
 *
 * It hangs off the bar rather than the chip: the chips live in a sideways scroller,
 * which would clip anything positioned inside it, and a panel that followed its chip
 * would slide off-screen with it. Full width under the bar is also the widest target
 * a thumb can get. A transparent layer behind it closes it on any tap outside — no
 * hover, no precise target.
 *
 * Changes apply as they are tapped, like the chips. A single choice closes the
 * popover; a multi-select stays open until the user is done.
 */

import { RotateCcw } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { FilterState } from "../../filters/model";
import type { FilterContext, OptionFilter } from "../../filters/registry";
import { FilterOptions } from "./FilterOptions";
import { FILTER_ICON } from "./icon";

interface FilterPopoverProps {
  id: string;
  filter: OptionFilter;
  state: FilterState;
  context: FilterContext;
  onChange: (patch: Partial<FilterState>) => void;
  onClose: () => void;
}

export function FilterPopover({ id, filter, state, context, onChange, onClose }: FilterPopoverProps) {
  const { t } = context;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canClear = filter.kind === "multi" && filter.isActive(state);

  return (
    <>
      <button
        type="button"
        className="fpop__scrim"
        aria-label={t.filters.close}
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        id={id}
        ref={panelRef}
        className="fpop"
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="fpop__head">
          <span className="fpop__title" id={titleId}>
            {filter.label(t)}
          </span>
          {canClear && (
            <button type="button" className="fpop__clear" onClick={() => onChange(filter.clear())}>
              <RotateCcw {...FILTER_ICON} size={14} />
              {t.filters.clear}
            </button>
          )}
        </div>
        <FilterOptions
          filter={filter}
          state={state}
          context={context}
          labelledBy={titleId}
          onChange={(patch) => {
            onChange(patch);
            if (filter.kind === "single") onClose();
          }}
        />
      </div>
    </>
  );
}
