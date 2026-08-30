/**
 * Which list is the heart aiming at?
 *
 * Only when *adding*, and only with several lists. Clearing a filled heart is never
 * a question — it un-saves in one tap — but choosing where a new save lands cannot
 * be guessed: dropping every tap into a list called "Saved" while the user keeps
 * three named ones is the app quietly ignoring what they built.
 *
 * The state lives here rather than in each screen because three screens draw hearts
 * and one sheet answers for all of them. The sheet itself is rendered by
 * `<SaveToListHost />` *inside* a screen's `.shell`, which is what the bottom-sheet
 * layout is positioned against.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ResultView } from "../api/viewmodel";

interface SaveTargetValue {
  /** The item whose list membership is being edited, or null when the sheet is shut. */
  pending: ResultView | null;
  /** Opens the sheet for this item. */
  ask: (item: ResultView) => void;
  dismiss: () => void;
}

const SaveTargetContext = createContext<SaveTargetValue | null>(null);

export function SaveTargetProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ResultView | null>(null);
  const ask = useCallback((item: ResultView) => setPending(item), []);
  const dismiss = useCallback(() => setPending(null), []);
  const value = useMemo<SaveTargetValue>(
    () => ({ pending, ask, dismiss }),
    [pending, ask, dismiss],
  );
  return <SaveTargetContext.Provider value={value}>{children}</SaveTargetContext.Provider>;
}

export function useSaveTarget(): SaveTargetValue {
  const value = useContext(SaveTargetContext);
  if (!value) throw new Error("useSaveTarget must be used inside <SaveTargetProvider>");
  return value;
}
