/**
 * One place that turns "the user tapped the heart" into a saved snapshot.
 *
 * The heart is a toggle and has to keep behaving like one. Tapping a filled heart
 * always un-saves, in one tap, whatever the user's lists look like: filled means
 * "this is saved", so clearing it is not a question and must never open a sheet to
 * ask one. Un-saving drops the place from every list, because the heart states a
 * fact about the restaurant rather than about any one list.
 *
 * Only *adding* can be ambiguous, and only once there is more than one list. With
 * none or one there is nothing to choose and the tap saves straight into the default
 * list, creating it on first use. With several, guessing would drop every save into
 * a list called "Saved" while the named ones sit empty — so the heart hands over to
 * the "save to..." sheet, which shows membership across all lists and commits per
 * row. Per-list removal lives there too, for a place kept in more than one.
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
      if (saved.isSaved(item.id)) {
        saved.unsave(item.id);
        return;
      }
      if (listCount > 1) {
        ask(item);
        return;
      }
      saved.save(toSavedPlace(item, lang), t.saved.defaultList);
    },
    [saved, ask, listCount, t.saved.defaultList, lang],
  );

  return { toggle, isSaved: saved.isSaved };
}
