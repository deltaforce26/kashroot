/**
 * Seven rows, Sunday-first, one per day the way the app's week always reads. Today
 * gets `aria-current="date"` so a screen reader and a sighted user both find it the
 * same way. A closed day says so in words; a 24-hour day says "Open 24 hours"
 * rather than printing an empty range.
 *
 * Deliberately no "Hours from Google" or "unverified" text anywhere in this
 * section — that label lives once, at the foot of the page, alongside the report
 * link, covering photos and hours together (see `restaurant.googleAttribution`).
 * Hours are never kashrut evidence and this component has no opinion on kashrut at
 * all — it only prints the rows it was handed.
 */

import type { PlaceHoursRow, PlacesHoursView } from "../../api/viewmodel";
import { useI18n } from "../../i18n/I18nProvider";

interface OpeningHoursProps {
  hours: PlacesHoursView;
}

function rowLabel(
  day: PlaceHoursRow,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (day.alwaysOpen) return t.restaurant.hours.open24;
  if (day.closed) return t.restaurant.hours.closedDay;
  return day.ranges.map((range) => `${range.open}–${range.close}`).join(", ");
}

export function OpeningHours({ hours }: OpeningHoursProps) {
  const { t } = useI18n();
  const rows = [...hours.days].sort((a, b) => a.day - b.day);

  return (
    <section className="hours" aria-label={t.restaurant.hours.title}>
      <div className="hours__head">
        <span className="hours__eyebrow">{t.restaurant.hours.title}</span>
      </div>
      <ol className="hours__list">
        {rows.map((day) => {
          const isToday = day.day === hours.today;
          return (
            <li
              key={day.day}
              className="hours__row"
              {...(isToday ? { "aria-current": "date" as const } : {})}
            >
              <span className="hours__day">{t.weekdays[day.day]}</span>
              <span className="hours__value">{rowLabel(day, t)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
