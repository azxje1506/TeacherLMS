/* English Tutor LMS — localization engine.
 * Ported from design-reference/lib/etlms-i18n.js. Gettext-style: the English
 * source string is the key, so any untranslated string falls back to English.
 * Only UI chrome is translated — user content is never a dictionary key.
 *
 * Unlike the original (which read a global), this exposes a `translate(s, lang)`
 * so it is SSR-safe and reacts to the Settings context on the client. */

import type { Lang } from "./types";
import viDict from "./i18n-vi.json";

export const LANGS: [Lang, string][] = [["vi", "Tiếng Việt"], ["en", "English"]];
export const DEFAULT_LANG: Lang = "vi";
export const RATE_VND_PER_USD = 25000; // fixed demo conversion rate

const DICT: Record<Lang, Record<string, string>> = {
  vi: viDict as Record<string, string>,
  en: {},
};

const MONTHS: Record<Lang, { short: string[]; full: string[] }> = {
  en: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    full: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
  vi: {
    short: ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"],
    full: ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"],
  },
};

const DOW: Record<Lang, { short: string[]; full: string[] }> = {
  en: { short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], full: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
  vi: { short: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"], full: ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] },
};

/** Translate a UI source string for the given language. Falls back to the source. */
export function translate(s: string | null | undefined, lang: Lang): string {
  if (s == null) return s as unknown as string;
  if (lang === "en") return s;
  const d = DICT[lang] || {};
  const hit = d[s];
  if (hit != null) return hit;
  const key = String(s).replace(/\s+/g, " ").trim();
  return d[key] != null ? d[key] : s;
}

export function months(lang: Lang, kind: "short" | "full"): string[] {
  const m = MONTHS[lang] || MONTHS.en;
  return m[kind] || m.short;
}

export function dow(lang: Lang, kind: "short" | "full"): string[] {
  const d = DOW[lang] || DOW.en;
  return d[kind] || d.short;
}
