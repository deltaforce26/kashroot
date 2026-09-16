/**
 * One pill in the filter bar: icon, then its name or current value, then a chevron
 * when it opens options. A toggle chip reports `aria-pressed` and a dropdown chip
 * `aria-expanded` — a screen reader announces the two differently, because they are.
 */

import { ChevronDown, type LucideIcon } from "lucide-react";
import { FILTER_ICON } from "./icon";

interface FilterChipProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  variant: "toggle" | "dropdown";
  expanded?: boolean;
  /** The id of the open popover — only while it is open. */
  controls?: string | undefined;
  onClick: () => void;
}

export function FilterChip({
  icon: Icon,
  label,
  active,
  variant,
  expanded = false,
  controls,
  onClick,
}: FilterChipProps) {
  const state =
    variant === "toggle"
      ? { "aria-pressed": active }
      : { "aria-expanded": expanded, "aria-haspopup": "dialog" as const, "aria-controls": controls };

  return (
    <button type="button" className="fchip" data-active={active} onClick={onClick} {...state}>
      <Icon {...FILTER_ICON} />
      <span className="fchip__label">{label}</span>
      {variant === "dropdown" && <ChevronDown {...FILTER_ICON} size={14} className="fchip__chevron" />}
    </button>
  );
}
