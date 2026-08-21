/** Shared city filter + limit/offset pager for all queue views. */

const KNOWN_CITIES = ["tel-aviv", "jerusalem", "bnei-brak", "haifa", "beer-sheva"];

interface CityFilterProps {
  value: string;
  onChange: (city: string) => void;
}

export function CityFilter({ value, onChange }: CityFilterProps) {
  return (
    <label className="control">
      City
      <input
        type="text"
        list="city-slugs"
        placeholder="all cities"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="city-slugs">
        {KNOWN_CITIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  );
}

interface PagerProps {
  total: number;
  offset: number;
  /** Rows currently on screen (already net of optimistic removals). */
  shown: number;
  onPrev: () => void;
  onNext: () => void;
}

export function Pager({ total, offset, shown, onPrev, onNext }: PagerProps) {
  if (total === 0) return null;
  return (
    <div className="pager">
      <button type="button" disabled={offset === 0} onClick={onPrev}>
        Previous
      </button>
      <span>
        {offset + 1}–{offset + shown} of {total}
      </span>
      <button type="button" disabled={offset + shown >= total} onClick={onNext}>
        Next
      </button>
    </div>
  );
}
