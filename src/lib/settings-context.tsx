"use client";

/* Settings context — the single source of truth for appearance (theme / accent /
 * surface / density), interface language and regional formats. Persists to the
 * same localStorage keys the imported design used (etlms.*) and mirrors the
 * appearance onto <html data-theme|data-accent|data-surface|data-spacing> so the
 * ported CSS variables resolve exactly as in the design comp. */

import React, { createContext, useContext, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { storageKeys } from "./constants";
import { createFormat, DEFAULT_REGIONAL } from "./format";
import { translate } from "./i18n";
import type { Appearance, Lang, RegionalConfig } from "./types";

const DEFAULT_APPEARANCE: Appearance = { theme: "light", accent: "crimson", surface: "soft", spacing: "cozy" };
const DEFAULT_LANG: Lang = "vi";

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

/* These preferences are owned by the browser, not by React, so they are read
 * through useSyncExternalStore rather than assigned inside an effect.
 *
 * The server — and the client while it hydrates — both see SERVER_SETTINGS, so
 * the two renders always produce identical markup; React then re-reads the store
 * immediately after hydration and re-renders with whatever was stored. Reading
 * localStorage in a useState initialiser would be simpler but renders the stored
 * value DURING hydration, mismatching the server HTML wherever a preference
 * reaches the markup (the header's theme icon is exactly that case). The inline
 * ThemeScript still applies the stored theme's CSS variables before first paint,
 * so this costs no flash of the wrong colours. */
interface Settings {
  appearance: Appearance;
  lang: Lang;
  regional: RegionalConfig;
}

const SERVER_SETTINGS: Settings = {
  appearance: DEFAULT_APPEARANCE,
  lang: DEFAULT_LANG,
  regional: DEFAULT_REGIONAL,
};

const listeners = new Set<() => void>();
/** Client-only cache. useSyncExternalStore compares snapshots by reference, so
 * the same object must come back until a setter replaces it. */
let cached: Settings | null = null;

function readStored(): Settings {
  return {
    appearance: {
      theme: lsGet(storageKeys.theme, DEFAULT_APPEARANCE.theme) as Appearance["theme"],
      accent: lsGet(storageKeys.accent, DEFAULT_APPEARANCE.accent) as Appearance["accent"],
      surface: lsGet(storageKeys.surface, DEFAULT_APPEARANCE.surface) as Appearance["surface"],
      spacing: lsGet(storageKeys.spacing, DEFAULT_APPEARANCE.spacing) as Appearance["spacing"],
    },
    lang: lsGet(storageKeys.lang, DEFAULT_LANG) as Lang,
    regional: {
      dateFormat: lsGet(storageKeys.dateFormat, DEFAULT_REGIONAL.dateFormat) as RegionalConfig["dateFormat"],
      timeFormat: lsGet(storageKeys.timeFormat, DEFAULT_REGIONAL.timeFormat) as RegionalConfig["timeFormat"],
      currency: lsGet(storageKeys.currency, DEFAULT_REGIONAL.currency) as RegionalConfig["currency"],
      numberFormat: lsGet(storageKeys.numberFormat, DEFAULT_REGIONAL.numberFormat) as RegionalConfig["numberFormat"],
    },
  };
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => { listeners.delete(onStoreChange); };
}

function getSnapshot(): Settings {
  if (!cached) cached = readStored();
  return cached;
}

function getServerSnapshot(): Settings {
  return SERVER_SETTINGS;
}

/** Publish a new snapshot (localStorage is written by the caller first). */
function commit(next: Settings): void {
  cached = next;
  for (const notify of listeners) notify();
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { appearance, lang, regional } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Mirror appearance to the document element.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = appearance.theme;
    el.dataset.accent = appearance.accent;
    el.dataset.surface = appearance.surface;
    el.dataset.spacing = appearance.spacing;
  }, [appearance]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    const current = getSnapshot();
    const next = { ...current.appearance, ...patch };
    if (patch.theme) lsSet(storageKeys.theme, next.theme);
    if (patch.accent) lsSet(storageKeys.accent, next.accent);
    if (patch.surface) lsSet(storageKeys.surface, next.surface);
    if (patch.spacing) lsSet(storageKeys.spacing, next.spacing);
    commit({ ...current, appearance: next });
  }, []);

  const setLang = useCallback((l: Lang) => {
    lsSet(storageKeys.lang, l);
    commit({ ...getSnapshot(), lang: l });
  }, []);

  const setRegional = useCallback((key: keyof RegionalConfig, val: string) => {
    const current = getSnapshot();
    const mapKey = ({ dateFormat: storageKeys.dateFormat, timeFormat: storageKeys.timeFormat, currency: storageKeys.currency, numberFormat: storageKeys.numberFormat } as const)[key];
    lsSet(mapKey, val);
    commit({ ...current, regional: { ...current.regional, [key]: val } });
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
