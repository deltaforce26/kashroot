/**
 * One place that turns "the user tapped the heart" into a saved snapshot.
 *
 * With at most one list there is nothing to decide: the tap saves into the default
 * list (creating it on first use) and a second tap takes the place back out of
 * every list, because the heart states a fact about the restaurant, not about a
 * list. That one-tap path is the whole point of a heart and is left alone.
 *
 * Once the user keeps more than one list the tap is ambiguous, and guessing is the
 * wrong answer: it would drop every save into "Saved" while three named lists sit
 * unused. So the heart hands over to the "save to..." sheet, which shows membership
 * across all lists and commits per row.
 */

import { useCallback } from "react";
import type { ResultView } from "../api/viewmodel";
import { useI18n } from "../i18n/I18nProvider";
import { useSaved } from "./SavedProvider";
import { useSaveTarget } from "./SaveTargetProvider";
import { toSavedPlace } from "./snapshot";

export function useSaveToggle() {
  const { t, lang } = useI18n();
  const saved = useSaved();
  const { ask } = useSaveTarget();
  const listCount = saved.state.lists.length;

  const toggle = useCallback(
    (item: ResultView) => {
      if (listCount > 1) {
        ask(item);
        return;
      }
      if (saved.isSaved(item.id)) {
        saved.unsave(item.id);
        return;
      }
      saved.save(toSavedPlace(item, lang), t.saved.defaultList);
    },
    [saved, ask, listCount, t.saved.defaultList, lang],
  );

  return { toggle, isSaved: saved.isSaved };
}
