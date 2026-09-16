/**
 * The full filter panel — a bottom sheet with every filter the bar shows.
 *
 * Unlike the chips, the sheet stages its changes: it opens on a copy of the current
 * filters, and nothing reaches the results until "החל". "נקה הכל" resets that copy,
 * and closing by the X, the scrim or Escape throws it away. That is what makes the
 * sheet safe to explore in, and why it needs an explicit apply at all.
 *
 * It is laid out head / scrolling body / fixed foot, so however long the option
 * lists grow, the two actions stay on screen above the home indicator.
 */

import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FilterState } from "../../filters/model";
import type { FilterContext, FilterDefinition } from "../../filters/registry";
import { FilterOptions } from "./FilterOptions";
import { FILTER_ICON } from "./icon";

interface FilterSheetProps {
  filters: readonly FilterDefinition[];
  initial: FilterState;
  context: FilterContext;
  onApply: (next: FilterState) => void;
  onClose: () => void;
}

export function FilterSheet({ filters, initial, context, onApply, onClose }: FilterSheetProps) {
  const { t } = context;
  const idBase = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(initial);

  const edit = (patch: Partial<FilterState>) => setDraft((current) => ({ ...current, ...patch }));
  const clearAll = () =>
    setDraft((current) => filters.reduce((next, filter) => ({ ...next, ...filter.clear() }), current));
  const anyActive = filters.some((filter) => filter.isActive(draft));

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="sheet__scrim" aria-label={t.filters.close} onClick={onClose} />
      <section
        className="sheet fsheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idBase}-title`}
      >
        <div className="sheet__head fsheet__head">
          <h2 className="sheet__title" id={`${idBase}-title`}>
            {t.filters.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="circle circle--sm glass"
            aria-label={t.filters.close}
            onClick={onClose}
          >
            <X {...FILTER_ICON} size={15} />
          </button>
        </div>

        <div className="fsheet__body">
          {filters.map((filter) => {
            const Icon = filter.icon;
            if (filter.kind === "toggle") {
              const on = filter.isActive(draft);
              return (
                <button
                  key={filter.id}
                  type="button"
                  className="fsheet__switch"
                  role="switch"
                  aria-checked={on}
                  onClick={() => edit(filter.set(!on))}
                >
                  <span className="fsheet__label">
                    <Icon {...FILTER_ICON} />
                    {filter.label(t)}
                  </span>
                  <span className="toggle" aria-checked={on} aria-hidden="true">
                    <span className="toggle__knob" />
                  </span>
                </button>
              );
            }
            const titleId = `${idBase}-${filter.id}`;
            return (
              <section key={filter.id}>
                <h3 className="fsheet__label" id={titleId}>
                  <Icon {...FILTER_ICON} />
                  {filter.label(t)}
                </h3>
                <FilterOptions
                  filter={filter}
                  state={draft}
                  context={context}
                  labelledBy={titleId}
                  onChange={edit}
                />
              </section>
            );
          })}
        </div>

        <div className="fsheet__foot">
          <button
            type="button"
            className="cta cta--ghost fsheet__clear"
            disabled={!anyActive}
            onClick={clearAll}
          >
            <RotateCcw {...FILTER_ICON} />
            {t.filters.clearAll}
          </button>
          <button type="button" className="cta fsheet__apply" onClick={() => onApply(draft)}>
            <Check {...FILTER_ICON} />
            {t.filters.apply}
          </button>
        </div>
      </section>
    </>
  );
}
