/**
 * One place that turns "the user tapped the heart" into a saved snapshot.
 *
 * The snapshot records the verdict *as the API returned it at that moment*, so the
 * saved screen can later notice that today's answer differs. It is never used as an
 * answer in its own right.
 */

import { useCallback } from "react";
import { certifierLabel, type ResultView } from "../api/viewmodel";
import { useI18n } from "../i18n/I18nProvider";
import { useSaved } from "./SavedProvider";

export function useSaveToggle() {
  const { t, lang } = useI18n();
  const saved = useSaved();

  const toggle = useCallback(
    (item: ResultView) => {
      if (saved.isSaved(item.id)) {
        saved.unsave(item.id);
        return;
      }
      saved.save(
        {
          restaurantId: item.id,
          nameHe: item.nameHe,
          nameEn: item.nameEn,
          cityHe: item.cityHe,
          dietType: item.dietType,
          verdictAtSave: item.kashrut.verdict,
          certifierLabel: certifierLabel(item, lang),
          savedAt: new Date().toISOString(),
        },
        t.saved.title,
      );
    },
    [saved, t.saved.title, lang],
  );

  return { toggle, isSaved: saved.isSaved };
}
