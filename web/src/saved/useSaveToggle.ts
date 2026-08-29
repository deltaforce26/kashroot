/**
 * One place that turns "the user tapped the heart" into a saved snapshot.
 *
 * The heart is the quick path: it drops the place into the default list, creating
 * that list on first use. Named lists are built on the saved screen instead. Un-
 * hearting removes the place from every list, because the heart states a fact about
 * the restaurant ("this is saved"), not about one list.
 */

import { useCallback } from "react";
import type { ResultView } from "../api/viewmodel";
import { useI18n } from "../i18n/I18nProvider";
import { useSaved } from "./SavedProvider";
import { toSavedPlace } from "./snapshot";

export function useSaveToggle() {
  const { t, lang } = useI18n();
  const saved = useSaved();

  const toggle = useCallback(
    (item: ResultView) => {
      if (saved.isSaved(item.id)) {
        saved.unsave(item.id);
        return;
      }
      saved.save(toSavedPlace(item, lang), t.saved.defaultList);
    },
    [saved, t.saved.defaultList, lang],
  );

  return { toggle, isSaved: saved.isSaved };
}
