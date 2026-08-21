/**
 * Language + direction. One component tree, `dir` flipped at the document root.
 *
 * The choice is persisted so a reload keeps it, and it drives `<html lang>` and
 * `<html dir>` directly — every layout in the app uses logical CSS properties, so
 * flipping the root attribute is the whole of the RTL/LTR story.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DIR, STRINGS, type Lang, type Strings } from "./strings";

const LANG_KEY = "kashroot.lang";

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "he" || stored === "en") return stored;
  } catch {
    // private mode / storage disabled — fall through to the Hebrew default
  }
  return "he";
}

interface I18nValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: Strings;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = DIR[lang];
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // non-fatal: the language simply won't survive a reload
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, dir: DIR[lang], t: STRINGS[lang], setLang }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}

/** Restaurant / city / address names are bilingual on the wire; Hebrew always exists. */
export function pickName(lang: Lang, he: string, en: string | null | undefined): string {
  return lang === "en" && en ? en : he;
}

/** dd/MM/yy, as the design writes dates. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

/** "400 מ׳" under a kilometre, "1.2 ק״מ" above it — as the design cards read. */
export function formatDistance(km: number | null, t: Strings): string | null {
  if (km === null) return null;
  if (km < 1) return `${Math.round(km * 1000)} ${t.units.m}`;
  return `${km.toFixed(1)} ${t.units.km}`;
}
