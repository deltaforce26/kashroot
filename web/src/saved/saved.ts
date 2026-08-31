/**
 * Saved lists — device-local, `localStorage` only. No API, no accounts (POC_PLAN C6).
 *
 * A saved place stores a *snapshot* of what the app said when it was saved: the
 * name, the certifier shown, and the verdict at that moment. The snapshot is never
 * used to answer "does this match me now" — only to notice that the current answer
 * differs from the saved one, which is what the degradation banner reports. The
 * current answer always comes from the API.
 */

import type { DietType, Verdict } from "../api/types";

export interface SavedPlace {
  restaurantId: string;
  nameHe: string;
  nameEn: string | null;
  cityHe: string | null;
  dietType: DietType | null;
  /** What the API said at the moment this was saved. */
  verdictAtSave: Verdict;
  certifierLabel: string | null;
  savedAt: string;
}

export interface SavedList {
  id: string;
  name: string;
  places: SavedPlace[];
}

export interface SavedState {
  lists: SavedList[];
}

export const EMPTY_SAVED: SavedState = { lists: [] };

const VERDICTS: readonly Verdict[] = ["match", "no_match", "unknown"];

export function newListId(): string {
  return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function findPlace(state: SavedState, restaurantId: string): SavedList | null {
  return (
    state.lists.find((list) => list.places.some((place) => place.restaurantId === restaurantId)) ??
    null
  );
}

export function isSaved(state: SavedState, restaurantId: string): boolean {
  return findPlace(state, restaurantId) !== null;
}

export function addPlace(state: SavedState, listId: string, place: SavedPlace): SavedState {
  return {
    lists: state.lists.map((list) =>
      list.id === listId && !list.places.some((p) => p.restaurantId === place.restaurantId)
        ? { ...list, places: [...list.places, place] }
        : list,
    ),
  };
}

export function removePlace(state: SavedState, restaurantId: string): SavedState {
  return {
    lists: state.lists.map((list) => ({
      ...list,
      places: list.places.filter((place) => place.restaurantId !== restaurantId),
    })),
  };
}

export function createList(
  state: SavedState,
  name: string,
  places: SavedPlace[] = [],
): [SavedState, SavedList] {
  // De-duplicated on the way in: the picker builds this array from taps, and a
  // double tap must not put the same restaurant in the list twice.
  const unique: SavedPlace[] = [];
  for (const place of places) {
    if (!unique.some((kept) => kept.restaurantId === place.restaurantId)) unique.push(place);
  }
  const list: SavedList = { id: newListId(), name, places: unique };
  return [{ lists: [...state.lists, list] }, list];
}

export function listById(state: SavedState, listId: string): SavedList | null {
  return state.lists.find((list) => list.id === listId) ?? null;
}

/**
 * Names are how a person tells two lists apart, so the picker refuses a name already
 * in use. Compared case-insensitively and trimmed, because "Shabbat" and "shabbat "
 * are the same name to everyone but a string comparison.
 */
export function hasListNamed(state: SavedState, name: string): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  return state.lists.some((list) => list.name.trim().toLocaleLowerCase() === wanted);
}

/**
 * Removes a place from one list only. `removePlace` drops it everywhere, which is
 * what the heart on a restaurant means; removing it from a list someone built is a
 * narrower action and must not quietly empty their other lists.
 */
export function removePlaceFromList(
  state: SavedState,
  listId: string,
  restaurantId: string,
): SavedState {
  return {
    lists: state.lists.map((list) =>
      list.id === listId
        ? { ...list, places: list.places.filter((place) => place.restaurantId !== restaurantId) }
        : list,
    ),
  };
}

/**
 * Did the answer get worse since this place was saved?
 *
 * Two API answers are compared — the one recorded in the snapshot and the one the
 * API gives now. Nothing here evaluates a kashrut rule; that is why the verdict
 * values may be named in this file at all.
 */
export function hasDegraded(place: SavedPlace, current: Verdict): boolean {
  return place.verdictAtSave === "match" && current !== "match";
}

export type VerdictCounts = Record<Verdict, number>;

/** Tallies verdicts the API returned. A place still loading counts to nothing. */
export function countVerdicts(verdicts: (Verdict | undefined)[]): VerdictCounts {
  const counts: VerdictCounts = { match: 0, no_match: 0, unknown: 0 };
  for (const verdict of verdicts) {
    if (verdict) counts[verdict] += 1;
  }
  return counts;
}

export function removeList(state: SavedState, listId: string): SavedState {
  return { lists: state.lists.filter((list) => list.id !== listId) };
}

/* ── Persistence ─────────────────────────────────────────────────────────── */

const KEY = "kashroot.saved.v1";

function parsePlace(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = record["restaurantId"];
  const nameHe = record["nameHe"];
  const verdict = record["verdictAtSave"];
  if (typeof id !== "string" || typeof nameHe !== "string") return null;
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict as Verdict)) return null;
  const str = (key: string): string | null => {
    const value = record[key];
    return typeof value === "string" ? value : null;
  };
  return {
    restaurantId: id,
    nameHe,
    nameEn: str("nameEn"),
    cityHe: str("cityHe"),
    dietType: (str("dietType") as DietType | null) ?? null,
    verdictAtSave: verdict as Verdict,
    certifierLabel: str("certifierLabel"),
    savedAt: str("savedAt") ?? new Date(0).toISOString(),
  };
}

export function parseSaved(raw: string | null): SavedState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const listsRaw = (parsed as Record<string, unknown>)["lists"];
  if (!Array.isArray(listsRaw)) return null;

  const lists: SavedList[] = [];
  for (const listRaw of listsRaw) {
    if (!listRaw || typeof listRaw !== "object") continue;
    const record = listRaw as Record<string, unknown>;
    const id = record["id"];
    const name = record["name"];
    const places = record["places"];
    if (typeof id !== "string" || typeof name !== "string" || !Array.isArray(places)) continue;
    lists.push({
      id,
      name,
      places: places.map(parsePlace).filter((place): place is SavedPlace => place !== null),
    });
  }
  return { lists };
}

export function loadSaved(): SavedState {
  try {
    return parseSaved(localStorage.getItem(KEY)) ?? EMPTY_SAVED;
  } catch {
    return EMPTY_SAVED;
  }
}

export function persistSaved(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked — the list still works for this session.
  }
}
