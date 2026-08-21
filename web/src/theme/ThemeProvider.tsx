/**
 * Light / dark. The design ships a full dark token set and 3h has the toggle, so
 * both are real modes rather than an afterthought.
 *
 * "system" is the default and leaves `data-theme` unset so the OS preference wins
 * through the media query; an explicit choice stamps the attribute and pins it.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "kashroot.theme";

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // storage blocked — fall through
  }
  return "system";
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

interface ThemeValue {
  choice: ThemeChoice;
  isDark: boolean;
  setChoice: (choice: ThemeChoice) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const isDark = choice === "system" ? systemDark : choice === "dark";

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      choice,
      isDark,
      setChoice,
      toggle: () => setChoice(isDark ? "light" : "dark"),
    }),
    [choice, isDark, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
