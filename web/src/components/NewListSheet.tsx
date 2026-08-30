/**
 * The new-list sheet — name a list, and optionally put a few places in it before it
 * exists.
 *
 * Opened from the plus on the saved screen. A list with nothing in it is a dead end
 * the user then has to go and fill from somewhere else, so the picker lives here:
 * type, tap the places, create.
 *
 * Selection is *staged*, unlike every other sheet that picks places: there is no
 * list to commit to until the name is submitted, so the picks are held here and go
 * in with the list in a single write.
 */

import { useEffect, useState } from "react";
import type { ResultView } from "../api/viewmodel";
import { useI18n } from "../i18n/I18nProvider";
import { hasListNamed, type SavedList, type SavedPlace } from "../saved/saved";
import { useSaved } from "../saved/SavedProvider";
import { toSavedPlace } from "../saved/snapshot";
import { CloseIcon } from "./icons";
import { PlacePicker } from "./PlacePicker";

export function NewListSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (list: SavedList) => void;
}) {
  const { t, lang } = useI18n();
  const { state, addList } = useSaved();

  const [name, setName] = useState("");
  // Keyed by restaurant id so a double tap cannot add the same place twice, and so a
  // place stays picked after it drops out of the current search results.
  const [picked, setPicked] = useState<Record<string, SavedPlace>>({});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

        <PlacePicker isPicked={(id) => Boolean(picked[id])} onToggle={togglePick} />

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
