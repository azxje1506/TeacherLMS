"use client";

/* Settings context — the single source of truth for appearance (theme / accent /
 * surface / density), interface language and regional formats. Persists to the
 * same localStorage keys the imported design used (etlms.*) and mirrors the
 * appearance onto <html data-theme|data-accent|data-surface|data-spacing> so the
 * ported CSS variables resolve exactly as in the design comp. */

import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import { storageKeys } from "./constants";
import { createFormat, DEFAULT_REGIONAL } from "./format";
import { translate } from "./i18n";
import type { Appearance, Lang, RegionalConfig } from "./types";

const DEFAULT_APPEARANCE: Appearance = { theme: "light", accent: "crimson", surface: "soft", spacing: "cozy" };

interface SettingsValue {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  regional: RegionalConfig;
  setRegional: (key: keyof RegionalConfig, val: string) => void;
  t: (s: string) => string;
  fmt: ReturnType<typeof createFormat>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function lsGet(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, val: string) {
  try { window.localStorage.setItem(key, val); } catch { /* ignore */ }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // Initialise from localStorage on the client (server renders defaults; the
  // inline theme script prevents a flash before hydration).
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [lang, setLangState] = useState<Lang>("vi");
  const [regional, setRegionalState] = useState<RegionalConfig>(DEFAULT_REGIONAL);

  useEffect(() => {
    setAppearanceState({
      theme: lsGet(storageKeys.theme, "light") as Appearance["theme"],
      accent: lsGet(storageKeys.accent, "crimson") as Appearance["accent"],
      surface: lsGet(storageKeys.surface, "soft") as Appearance["surface"],
      spacing: lsGet(storageKeys.spacing, "cozy") as Appearance["spacing"],
    });
    setLangState(lsGet(storageKeys.lang, "vi") as Lang);
    setRegionalState({
      dateFormat: lsGet(storageKeys.dateFormat, "DD/MM/YYYY") as RegionalConfig["dateFormat"],
      timeFormat: lsGet(storageKeys.timeFormat, "24h") as RegionalConfig["timeFormat"],
      currency: lsGet(storageKeys.currency, "VND") as RegionalConfig["currency"],
      numberFormat: lsGet(storageKeys.numberFormat, "comma") as RegionalConfig["numberFormat"],
    });
  }, []);

  // Mirror appearance to the document element.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = appearance.theme;
    el.dataset.accent = appearance.accent;
    el.dataset.surface = appearance.surface;
    el.dataset.spacing = appearance.spacing;
  }, [appearance]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((prev) => {
      const next = { ...prev, ...patch };
      if (patch.theme) lsSet(storageKeys.theme, next.theme);
      if (patch.accent) lsSet(storageKeys.accent, next.accent);
      if (patch.surface) lsSet(storageKeys.surface, next.surface);
      if (patch.spacing) lsSet(storageKeys.spacing, next.spacing);
      return next;
    });
  }, []);

  const setLang = useCallback((l: Lang) => { setLangState(l); lsSet(storageKeys.lang, l); }, []);

  const setRegional = useCallback((key: keyof RegionalConfig, val: string) => {
    setRegionalState((prev) => ({ ...prev, [key]: val }));
    const mapKey = ({ dateFormat: storageKeys.dateFormat, timeFormat: storageKeys.timeFormat, currency: storageKeys.currency, numberFormat: storageKeys.numberFormat } as const)[key];
    lsSet(mapKey, val);
  }, []);

  const t = useCallback((s: string) => translate(s, lang), [lang]);
  const fmt = useMemo(() => createFormat(regional, lang), [regional, lang]);

  const value = useMemo<SettingsValue>(
    () => ({ appearance, setAppearance, lang, setLang, regional, setRegional, t, fmt }),
    [appearance, setAppearance, lang, setLang, regional, setRegional, t, fmt]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}

/** Convenience hooks. */
export const useT = () => useSettings().t;
export const useFmt = () => useSettings().fmt;
