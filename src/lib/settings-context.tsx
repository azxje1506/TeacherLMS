"use client";

/* Settings context — the single source of truth for appearance (theme / accent /
 * surface / density), interface language and regional formats. Persists to the
 * same localStorage keys the imported design used (etlms.*) and mirrors the
 * appearance onto <html data-theme|data-accent|data-surface|data-spacing> so the
 * ported CSS variables resolve exactly as in the design comp.
 *
 * WHAT COMES OUT OF THE BROWSER IS VALIDATED, NOT TRUSTED (Sprint 11). Every
 * stored value is checked against the authorised list in lib/constants; an
 * unrecognised one is treated exactly as a missing one and the default is used.
 * See `pick` below for why a cast was not enough. */

import React, { createContext, useContext, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  ACCENTS, CURRENCIES, DATE_FORMATS, DENSITIES, NUMBER_FORMATS, SURFACES, THEMES, TIME_FORMATS,
  storageKeys,
} from "./constants";
import { createFormat, DEFAULT_REGIONAL } from "./format";
import { DEFAULT_LANG, LANGS, translate } from "./i18n";
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

/** The raw stored string, or null — absent key, no window, or storage that
 * throws (private mode, blocked site data) are all "nothing stored". */
function lsRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { window.localStorage.setItem(key, val); } catch { /* ignore */ }
}

/** One persisted preference, read and VALIDATED against the values it is
 * allowed to hold.
 *
 * WHY THIS IS NOT A CAST. Every one of these nine reads used to be
 * `localStorage.getItem(k) ?? default` followed by `as Appearance["accent"]`,
 * which is an assertion that the browser told the truth. It does not have to:
 * the key survives a release that renames a value, it survives being edited by
 * hand in devtools, and it survives being written by an older build. A value
 * that is not in the palette reaches `<html data-accent="…">`, matches no token
 * block, and the screen quietly keeps whichever accent it had — the failure has
 * no error and no floor.
 *
 * So an unrecognised value is treated exactly as a missing one: the default.
 * A value that IS recognised is returned unchanged, so nothing about a valid
 * stored preference behaves differently than it did before. */
function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** The languages the dictionary actually ships, as a plain list. `LANGS` is
 * `[code, endonym]` pairs because the UI needs the label; validation needs only
 * the code, and reading it from the same export is what stops a third list of
 * languages existing. */
const LANG_CODES: readonly Lang[] = LANGS.map(([code]) => code);

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
export interface Settings {
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

/** Resolve one complete settings snapshot from a raw key reader.
 *
 * PURE, AND EXPORTED FOR THAT REASON. It takes the reader rather than reaching
 * for `localStorage` itself, so the validation above can be exercised with a
 * plain object in a Node test — no browser, no DOM, no React render, no storage
 * shim. `readStored` below is the one caller that supplies the real browser. */
export function resolveSettings(read: (key: string) => string | null): Settings {
  return {
    appearance: {
      theme: pick(read(storageKeys.theme), THEMES, DEFAULT_APPEARANCE.theme),
      accent: pick(read(storageKeys.accent), ACCENTS, DEFAULT_APPEARANCE.accent),
      surface: pick(read(storageKeys.surface), SURFACES, DEFAULT_APPEARANCE.surface),
      spacing: pick(read(storageKeys.spacing), DENSITIES, DEFAULT_APPEARANCE.spacing),
    },
    lang: pick(read(storageKeys.lang), LANG_CODES, DEFAULT_LANG),
    regional: {
      dateFormat: pick(read(storageKeys.dateFormat), DATE_FORMATS, DEFAULT_REGIONAL.dateFormat),
      timeFormat: pick(read(storageKeys.timeFormat), TIME_FORMATS, DEFAULT_REGIONAL.timeFormat),
      currency: pick(read(storageKeys.currency), CURRENCIES, DEFAULT_REGIONAL.currency),
      numberFormat: pick(read(storageKeys.numberFormat), NUMBER_FORMATS, DEFAULT_REGIONAL.numberFormat),
    },
  };
}

/** The defaults a snapshot falls back to, published so the pre-paint
 * `ThemeScript` can be proven to agree with them rather than trusted to. */
export const SETTINGS_DEFAULTS: Settings = SERVER_SETTINGS;

/** The snapshot as the real browser reports it.
 *
 * Exported so the BROWSER path — not just the pure resolver above — can be
 * exercised: `lsRead`'s own try/catch is the thing that turns blocked site data
 * into the defaults, and a test that only ever calls `resolveSettings` with a
 * hand-made reader would never touch it. */
export function readStoredSettings(): Settings {
  return resolveSettings(lsRead);
}

function readStored(): Settings {
  return readStoredSettings();
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
