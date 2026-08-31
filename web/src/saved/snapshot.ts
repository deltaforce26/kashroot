/**
 * One place that turns an API result into a saved snapshot.
 *
 * The snapshot records the verdict *as the API returned it at that moment* so the
 * saved screens can later notice that today's answer differs. It is never an answer
 * in its own right. Both save paths — the heart on a card and the list builder —
 * go through here, so the two can never record a place differently.
 */

import type { ResultView } from "../api/viewmodel";
import { certifierLabel } from "../api/viewmodel";
import type { Lang } from "../i18n/strings";
import type { SavedPlace } from "./saved";

export function toSavedPlace(item: ResultView, lang: Lang, savedAt = new Date()): SavedPlace {
  return {
    restaurantId: item.id,
    nameHe: item.nameHe,
    nameEn: item.nameEn,
    cityHe: item.cityHe,
    dietType: item.dietType,
    verdictAtSave: item.kashrut.verdict,
    certifierLabel: certifierLabel(item, lang),
    savedAt: savedAt.toISOString(),
  };
}
