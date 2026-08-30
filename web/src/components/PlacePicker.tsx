/**
 * Search-and-tick, shared by every sheet that puts restaurants into a list.
 *
 * Owns the query and the request; the sheet around it owns what a tick *means* —
 * staged selection while a list is being created, an immediate commit once the list
 * exists. That split is why this component holds no selection state of its own.
 *
 * Each row shows the place's current verdict pill, because someone building a list
 * should be picking with today's answer in front of them. Nothing here filters or
 * reorders by that verdict; it is rendered, not acted on.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { MAX_QUERY_LENGTH, type SearchRequest } from "../api/types";
import type { ResultView } from "../api/viewmodel";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { CheckIcon, SearchIcon } from "./icons";
import { OfflineBanner } from "./states";
import { VerdictPill } from "./VerdictPill";

const PICKER_PAGE_SIZE = 20;
/** Below this the query is not a search, it is the first keystroke of one. */
const MIN_QUERY = 2;

export function PlacePicker({
  isPicked,
  onToggle,
}: {
  isPicked: (restaurantId: string) => boolean;
  onToggle: (item: ResultView) => void;
}) {
  const { t, lang } = useI18n();
  const { profile } = useProfile();
  const { slug: city } = useCity();
  const [query, setQuery] = useState("");

  const trimmedQuery = useDeferredValue(query).trim();

  const request = useMemo<SearchRequest | null>(
    () =>
      trimmedQuery.length < MIN_QUERY
        ? null
        : {
            profile: toPayload(profile),
            city,
            page_size: PICKER_PAGE_SIZE,
            query: trimmedQuery.slice(0, MAX_QUERY_LENGTH),
          },
    [profile, city, trimmedQuery],
  );

  const { data, loading, error } = useSearch(request);
  const results = request ? (data?.items ?? []) : [];

  return (
    <>
      <label className="searchbar glass">
        <span className="searchbar__icon" aria-hidden="true">
          <SearchIcon size={17} />
        </span>
        <input
          type="search"
          className="searchbar__input"
          value={query}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={t.saved.picker.searchPlaceholder}
          aria-label={t.saved.picker.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error && isNetworkError(error) && <OfflineBanner />}

      <div aria-live="polite">
        {request && loading && <p className="hint sheet__note">{t.states.loadingShort}</p>}
        {request && !loading && results.length === 0 && (
          <p className="hint sheet__note">{t.saved.picker.noResults}</p>
        )}
        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((item) => {
              const on = isPicked(item.id);
              const label = lang === "en" && item.nameEn ? item.nameEn : item.nameHe;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="select-row"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => onToggle(item)}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="select-row__title">{label}</span>
                    <span className="select-row__sub" style={{ display: "block" }}>
                      {item.cityHe ?? ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                    <VerdictPill verdict={item.kashrut.verdict} />
                    <span className="check check--sm" data-on={on} aria-hidden="true">
                      {on && <CheckIcon />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
