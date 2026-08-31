/**
 * Adding places to a list that already exists, from the list's own page.
 *
 * Every tap commits: the list is real, so a staged selection with a submit button
 * would only invent a state where the screen behind the sheet disagrees with the
 * sheet. A tick means "in this list" and an untick takes it back out — the same
 * meaning it has on the list page and in the heart's picker, so the gesture reads
 * the same everywhere.
 */

import { useEffect } from "react";
import type { ResultView } from "../api/viewmodel";
import { useI18n } from "../i18n/I18nProvider";
import type { SavedList } from "../saved/saved";
import { useSaved } from "../saved/SavedProvider";
import { toSavedPlace } from "../saved/snapshot";
import { CloseIcon } from "./icons";
import { PlacePicker } from "./PlacePicker";

export function AddPlacesSheet({ list, onClose }: { list: SavedList; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { addToList, removeFromList } = useSaved();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inList = (restaurantId: string) =>
    list.places.some((place) => place.restaurantId === restaurantId);

  function toggle(item: ResultView) {
    if (inList(item.id)) removeFromList(list.id, item.id);
    else addToList(list.id, toSavedPlace(item, lang));
  }

  return (
    <>
      <button
        type="button"
        className="sheet__scrim"
        aria-label={t.saved.create.close}
        onClick={onClose}
      />
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.saved.add.title(list.name)}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">{t.saved.add.title(list.name)}</h2>
          <button
            type="button"
            className="circle circle--sm glass"
            aria-label={t.saved.create.close}
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <p className="hint sheet__note">{t.saved.add.lead}</p>

        <PlacePicker isPicked={inList} onToggle={toggle} />

        <button type="button" className="cta" onClick={onClose}>
          {t.saved.add.done}
        </button>
      </section>
    </>
  );
}
