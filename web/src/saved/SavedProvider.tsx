/**
 * Saved-list state. Device-local; every mutation writes straight back to
 * `localStorage` so a reload — or an offline launch from the home screen — sees
 * exactly what the user saved.
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
  type SavedList,
  type SavedPlace,
  type SavedState,
} from "./saved";

interface SavedValue {
  state: SavedState;
  isSaved: (restaurantId: string) => boolean;
  /** Saves into the named list, creating it on first use. */
  save: (place: SavedPlace, listName: string) => void;
  unsave: (restaurantId: string) => void;
  addList: (name: string) => SavedList;
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
      unsave: (restaurantId) => commit(removePlace(state, restaurantId)),
      addList: (name) => {
        const [next, list] = createList(state, name);
        commit(next);
        return list;
      },
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
