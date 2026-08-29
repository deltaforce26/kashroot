/**
 * The new-list sheet — name a list, and optionally put a few places in it before it
 * exists.
 *
 * Opened from the plus on the saved screen. A list with nothing in it is a dead end
 * the user then has to go and fill from somewhere else, so the search lives here:
 * type, tap the places, create. Picking is optional — the name alone is enough, and
 * places can be added later from any card's heart.
 *
 * The rows show each place's current verdict pill for one reason: someone building a
 * list should be picking with today's answer in front of them. Nothing here filters
 * or reorders by that verdict; it is rendered, not acted on.
 */

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { MAX_QUERY_LENGTH, type SearchRequest } from "../api/types";
import type { ResultView } from "../api/viewmodel";
import { isNetworkError, useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { useCity } from "../location/useCity";
import { toPayload } from "../profile/profile";
import { useProfile } from "../profile/ProfileProvider";
import { hasListNamed, type SavedList, type SavedPlace } from "../saved/saved";
import { useSaved } from "../saved/SavedProvider";
import { toSavedPlace } from "../saved/snapshot";
import { CheckIcon, CloseIcon, SearchIcon } from "./icons";
import { OfflineBanner } from "./states";
import { VerdictPill } from "./VerdictPill";

const PICKER_PAGE_SIZE = 20;
/** Below this the query is not a search, it is the first keystroke of one. */
const MIN_QUERY = 2;

export function NewListSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (list: SavedList) => void;
}) {
  const { t, lang } = useI18n();
  const { profile } = useProfile();
  const { slug: city } = useCity();
  const { state, addList } = useSaved();

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  // Keyed by restaurant id so a double tap cannot add the same place twice, and so a
  // place stays selected after it drops out of the current search results.
  const [picked, setPicked] = useState<Record<string, SavedPlace>>({});

  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const trimmedName = name.trim();
  const taken = trimmedName.length > 0 && hasListNamed(state, trimmedName);
  const pickedPlaces = Object.values(picked);
  const canSubmit = trimmedName.length > 0 && !taken;

  function togglePick(item: ResultView) {
    setPicked((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: toSavedPlace(item, lang) };
    });
  }

  function submit() {
    if (!canSubmit) return;
    onCreated(addList(trimmedName, pickedPlaces));
  }

  return (
    <>
      <button
        type="button"
        className="sheet__scrim"
        aria-label={t.saved.create.close}
        onClick={onClose}
      />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t.saved.create.title}>
        <div className="sheet__head">
          <h2 className="sheet__title">{t.saved.create.title}</h2>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={t.saved.create.close}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {/* A form, so Enter in the name field creates the list rather than doing
            nothing — the fastest path is name, Enter, done. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="filter-group__title" htmlFor="new-list-name">
            {t.saved.create.nameLabel}
          </label>
          <div className="searchbar glass" style={{ marginTop: 6 }}>
            <input
              id="new-list-name"
              type="text"
              className="searchbar__input"
              value={name}
              autoFocus
              maxLength={60}
              placeholder={t.saved.create.namePlaceholder}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </form>
        {taken && (
          <p className="hint sheet__note" role="status">
            {t.saved.create.nameTaken}
          </p>
        )}

        <div>
          <span className="filter-group__title">{t.saved.create.addPlaces}</span>
          <p className="hint sheet__note" style={{ marginTop: 2 }}>
            {t.saved.create.addPlacesLead}
          </p>
        </div>

        <label className="searchbar glass">
          <span className="searchbar__icon" aria-hidden="true">
            <SearchIcon size={17} />
          </span>
          <input
            type="search"
            className="searchbar__input"
            value={query}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t.saved.create.searchPlaceholder}
            aria-label={t.saved.create.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {error && isNetworkError(error) && <OfflineBanner />}

        <div aria-live="polite">
          {request && loading && <p className="hint sheet__note">{t.states.loadingShort}</p>}
          {request && !loading && results.length === 0 && (
            <p className="hint sheet__note">{t.saved.create.noResults}</p>
          )}
          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {results.map((item) => {
                const on = Boolean(picked[item.id]);
                const label = lang === "en" && item.nameEn ? item.nameEn : item.nameHe;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="select-row"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => togglePick(item)}
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

        {pickedPlaces.length > 0 && (
          <p className="hint sheet__note" role="status">
            {t.saved.create.selected(pickedPlaces.length)}
          </p>
        )}

        <button type="button" className="cta" disabled={!canSubmit} onClick={submit}>
          {t.saved.create.submit}
        </button>
      </section>
    </>
  );
}
