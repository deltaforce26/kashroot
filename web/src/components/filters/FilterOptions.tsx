/**
 * The option pills for one filter — the same component inside a chip's popover and
 * inside the sheet, so the two cannot drift into different controls for one filter.
 */

import { Check } from "lucide-react";
import type { FilterState } from "../../filters/model";
import type { FilterContext, OptionFilter } from "../../filters/registry";
import { FILTER_ICON } from "./icon";

interface FilterOptionsProps {
  filter: OptionFilter;
  state: FilterState;
  context: FilterContext;
  labelledBy: string;
  onChange: (patch: Partial<FilterState>) => void;
}

export function FilterOptions({ filter, state, context, labelledBy, onChange }: FilterOptionsProps) {
  const options = filter.options(context);
  const selected = filter.selected(state);

  if (options.length === 0) {
    return <p className="hint fopts__empty">{filter.emptyHint?.(context.t)}</p>;
  }

  function pick(key: string) {
    const on = selected.includes(key);
    if (filter.kind === "multi") {
      onChange(filter.select(on ? selected.filter((value) => value !== key) : [...selected, key]));
    } else {
      onChange(filter.select(on && filter.clearable ? [] : [key]));
    }
  }

  return (
    <div className="fopts" role="group" aria-labelledby={labelledBy}>
      {options.map((option) => {
        const on = selected.includes(option.key);
        return (
          <button
            key={option.key}
            type="button"
            className="fopt"
            aria-pressed={on}
            onClick={() => pick(option.key)}
          >
            {/* The check marks a multi-select: more than one of these can be on. */}
            {filter.kind === "multi" && on && <Check {...FILTER_ICON} size={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
