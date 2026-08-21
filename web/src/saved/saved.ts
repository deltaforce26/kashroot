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

export function createList(state: SavedState, name: string): [SavedState, SavedList] {
  const list: SavedList = { id: newListId(), name, places: [] };
  return [{ lists: [...state.lists, list] }, list];
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
