/**
 * "Save to…" — the sheet the heart opens once there is more than one list.
 *
 * One row per list, ticked where this restaurant already is. A tap commits straight
 * away, in both directions, so the sheet is a live view of membership rather than a
 * form to fill in; closing it cannot lose anything, because nothing was pending.
 *
 * The last row makes a new list holding this place, with an inline name field. It is
 * deliberately not the full new-list sheet: a second sheet stacked over this one to
 * ask one question is a worse answer than a field.
 *
 * `<SaveToListHost />` is what screens render; it draws nothing until a heart asks.
 */

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { hasListNamed } from "../saved/saved";
import { useSaved } from "../saved/SavedProvider";
import { useSaveTarget } from "../saved/SaveTargetProvider";
import { toSavedPlace } from "../saved/snapshot";
import type { ResultView } from "../api/viewmodel";
import { CheckIcon, CloseIcon, PlusIcon } from "./icons";

function SaveToListSheet({ item, onClose }: { item: ResultView; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { state, addToList, removeFromList, addList } = useSaved();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmedName = name.trim();
  const taken = trimmedName.length > 0 && hasListNamed(state, trimmedName);
  const title = lang === "en" && item.nameEn ? item.nameEn : item.nameHe;

  function createWithPlace() {
    if (trimmedName.length === 0 || taken) return;
    addList(trimmedName, [toSavedPlace(item, lang)]);
    setName("");
    setNaming(false);
  }

  return (
    <>
      <button
        type="button"
        className="sheet__scrim"
        aria-label={t.saved.saveTo.close}
        onClick={onClose}
      />
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.saved.saveTo.title}
      >
        <div className="sheet__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="sheet__title">{t.saved.saveTo.title}</h2>
            <div className="select-row__sub">{title}</div>
          </div>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={t.saved.saveTo.close}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {state.lists.map((list) => {
            const on = list.places.some((place) => place.restaurantId === item.id);
            return (
              <button
                key={list.id}
                type="button"
                className="select-row"
                role="checkbox"
                aria-checked={on}
                onClick={() =>
                  on
                    ? removeFromList(list.id, item.id)
                    : addToList(list.id, toSavedPlace(item, lang))
                }
              >
                <span style={{ minWidth: 0 }}>
                  <span className="select-row__title">{list.name}</span>
                  <span className="select-row__sub" style={{ display: "block" }}>
                    {t.saved.placesCount(list.places.length)}
                  </span>
                </span>
                <span className="check check--sm" data-on={on} aria-hidden="true">
                  {on && <CheckIcon />}
                </span>
              </button>
            );
          })}
        </div>

        {naming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createWithPlace();
            }}
          >
            <label className="filter-group__title" htmlFor="save-to-new-list">
              {t.saved.create.nameLabel}
            </label>
            <div className="searchbar glass" style={{ marginTop: 6 }}>
              <input
                id="save-to-new-list"
                type="text"
                className="searchbar__input"
                value={name}
                autoFocus
                maxLength={60}
                placeholder={t.saved.create.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {taken && (
              <p className="hint sheet__note" role="status">
                {t.saved.create.nameTaken}
              </p>
            )}
            <button
              type="submit"
              className="cta"
              style={{ marginTop: 10 }}
              disabled={trimmedName.length === 0 || taken}
            >
              {t.saved.saveTo.createWith}
            </button>
          </form>
        ) : (
          <button type="button" className="cta cta--ghost" onClick={() => setNaming(true)}>
            <PlusIcon size={16} />
            {t.saved.newList}
          </button>
        )}

        <button type="button" className="cta" onClick={onClose}>
          {t.saved.add.done}
        </button>
      </section>
    </>
  );
}

/**
 * Mounted by every screen that draws hearts, inside its `.shell` — the sheet is
 * positioned against the phone shell, not the viewport, so it cannot be hoisted to
 * one global mount point at the root.
 */
export function SaveToListHost() {
  const { pending, dismiss } = useSaveTarget();
  if (!pending) return null;
  return <SaveToListSheet item={pending} onClose={dismiss} />;
}
