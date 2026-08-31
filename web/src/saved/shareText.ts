/**
 * Turning a saved list into the text a person actually sends someone.
 *
 * A list has no page on the public web, so what travels is the list itself: its
 * name, one deep link per place, and a note about how to read them. No verdict
 * travels with it — the recipient's own profile decides that when they open a link,
 * which is the whole point of the product, so a verdict copied out of someone
 * else's screen would be a lie.
 *
 * Kept pure and separate from the screen so the exact wire format is unit-tested.
 */

import { pickName } from "../i18n/I18nProvider";
import type { Lang, Strings } from "../i18n/strings";
import type { SavedList, SavedPlace } from "./saved";

/**
 * One place, over two lines: a readable name (with its city when we have one) and
 * the bare link under it. Two lines rather than "name — url" because the ids are
 * long enough that a single line wraps into noise in every chat app.
 */
function placeLines(place: SavedPlace, lang: Lang, origin: string): string {
  const name = pickName(lang, place.nameHe, place.nameEn);
  const title = place.cityHe ? `${name} · ${place.cityHe}` : name;
  return `• ${title}\n  ${origin}/r/${place.restaurantId}`;
}

/**
 * The shared message. Returns "" for an empty list, so callers can treat empty as
 * "nothing to share" without a second check.
 */
export function savedListAsText(
  list: SavedList,
  lang: Lang,
  t: Strings,
  origin: string,
): string {
  if (list.places.length === 0) return "";
  const body = list.places.map((place) => placeLines(place, lang, origin)).join("\n");
  return [t.saved.shareHeading(list.name, list.places.length), body, t.saved.shareNote].join("\n\n");
}
