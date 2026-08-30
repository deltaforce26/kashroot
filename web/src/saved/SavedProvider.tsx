/**
 * Saved-list state. Device-local; every mutation writes straight back to
 * `localStorage` so a reload — or an offline launch from the home screen — sees
 * exactly what the user saved.
 *
 * Every mutation is one commit over the pure functions in `./saved`. A screen that
 * creates a list with places in it calls `addList` once rather than a create
 * followed by n saves: each call reads the `state` captured in this render, so a
 * burst of calls would each write over the last one's result.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  addPlace,
  createList,
  isSaved,
  loadSaved,
  persistSaved,
  removeList,
  removePlace,
  removePlaceFromList,
  type SavedList,
  type SavedPlace,
  type SavedState,
} from "./saved";

interface SavedValue {
  state: SavedState;
  isSaved: (restaurantId: string) => boolean;
  /** Saves into the named list, creating it on first use. The heart's quick path. */
  save: (place: SavedPlace, listName: string) => void;
  /** Saves into one existing list, by id — what every list picker commits through. */
  addToList: (listId: string, place: SavedPlace) => void;
  /** Removes the place from every list — what un-hearting a restaurant means. */
  unsave: (restaurantId: string) => void;
  /** Creates a list, optionally already holding places. One commit. */
  addList: (name: string, places?: SavedPlace[]) => SavedList;
  /** Removes one place from one list, leaving any other list holding it alone. */
  removeFromList: (listId: string, restaurantId: string) => void;
  deleteList: (listId: string) => void;
}

const SavedContext = createContext<SavedValue | null>(null);

export function SavedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SavedState>(loadSaved);

  const commit = useCallback((next: SavedState) => {
    setState(next);
    persistSaved(next);
  }, []);

  const value = useMemo<SavedValue>(
    () => ({
      state,
      isSaved: (restaurantId) => isSaved(state, restaurantId),
      save: (place, listName) => {
        let next = state;
        let list = next.lists.find((candidate) => candidate.name === listName);
        if (!list) {
          const [created, madeList] = createList(next, listName);
          next = created;
          list = madeList;
        }
        commit(addPlace(next, list.id, place));
      },
      addToList: (listId, place) => commit(addPlace(state, listId, place)),
      unsave: (restaurantId) => commit(removePlace(state, restaurantId)),
      addList: (name, places = []) => {
        const [next, list] = createList(state, name, places);
        commit(next);
        return list;
      },
      removeFromList: (listId, restaurantId) =>
        commit(removePlaceFromList(state, listId, restaurantId)),
      deleteList: (listId) => commit(removeList(state, listId)),
    }),
    [state, commit],
  );

  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSaved(): SavedValue {
  const value = useContext(SavedContext);
  if (!value) throw new Error("useSaved must be used inside <SavedProvider>");
  return value;
}
