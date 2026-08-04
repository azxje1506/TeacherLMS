/* English Tutor LMS — presentation-only formatters.
 * Ported from design-reference/lib/etlms-format.js. Parametrized by a
 * RegionalConfig + Lang (instead of reading a global) so formatted values react
 * to the Settings context and are safe to call during SSR. */

import type { Lang, RegionalConfig } from "./types";
import { fromMinutes, toMinutes } from "./calc";
import { months as i18nMonths } from "./i18n";
import { RATE_VND_PER_USD } from "./i18n";

const EM = "—"; // em dash — the shared "no value" placeholder

/* timeFormat is 12h so every rendered time reads the way the browser's native
 * <input type="time"> does for these teachers (06:00 PM) — that control follows
 * the OS locale and cannot be forced to a format, so the app matches it rather
 * than the other way round. */
export const DEFAULT_REGIONAL: RegionalConfig = {
  dateFormat: "DD/MM/YYYY", timeFormat: "12h", currency: "VND", numberFormat: "comma",
};

/** Group an integer/decimal string per the chosen number format. */
function groupNumber(numStr: string, style: RegionalConfig["numberFormat"]): string {
  let s = numStr;
  const neg = s.charAt(0) === "-";
  if (neg) s = s.slice(1);
  const parts = s.split("."), intp0 = parts[0], frac = parts[1] || "";
  const gsep = style === "dot" ? "." : ",";
  const dsep = style === "dot" ? "," : ".";
  const intp = intp0.replace(/\B(?=(\d{3})+(?!\d))/g, gsep);
  const out = frac ? intp + dsep + frac : intp;
  return (neg ? "-" : "") + out;
}

/** A bound set of formatters for a given regional config + language. */
export function createFormat(regional: RegionalConfig = DEFAULT_REGIONAL, lang: Lang = "vi") {
  const monthsShort = () => i18nMonths(lang, "short");
  const monthsFull = () => i18nMonths(lang, "full");

  /** Format a 24h "HH:MM" per the time-format preference.
   *
   * Declared here rather than only on the returned object so `clockParts` below
   * can reuse it: a second copy of this logic is exactly what this sprint is
   * removing. Exposed unchanged as `fmt.time12`. */
  function time12(hhmm: string): string {
    if (!hhmm) return EM;
    const p = String(hhmm).split(":").map(Number), h = p[0], m = p[1];
    if (!isFinite(h) || !isFinite(m)) return EM;
    if (regional.timeFormat === "24h") {
      return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }
    const ap = h < 12 ? "AM" : "PM";
    let hh = h % 12;
    if (hh === 0) hh = 12;
    // Zero-padded so a rendered time lines up with what the browser's native
    // <input type="time"> shows in a 12h locale ("05:00 PM", not "5:00 PM").
    return String(hh).padStart(2, "0") + ":" + String(m).padStart(2, "0") + " " + ap;
  }

  return {
    /** Format a VND amount honouring currency + number format. VND -> "1,500,000đ"; USD -> "$60.00". */
    vnd(n: number): string {
      const amt = Number(n) || 0;
      if (regional.currency === "USD") {
        const usd = (amt / RATE_VND_PER_USD).toFixed(2);
        return "$" + groupNumber(usd, regional.numberFormat);
      }
      return groupNumber(String(Math.round(amt)), regional.numberFormat) + "đ";
    },

    /** Grouped integer/decimal per the number-format preference (no currency). */
    number(n: number, decimals?: number): string {
      const v = decimals != null ? Number(n).toFixed(decimals) : String(Math.round(Number(n) || 0));
      return groupNumber(v, regional.numberFormat);
    },

    time12,

    /** One formatted time, split into the two pieces the Dashboard's stacked
     * "Today's classes" tile renders on separate lines: the clock face, and its
     * meridiem beneath it.
     *
     * It exists so that tile stops deriving those pieces itself — it used to
     * strip the meridiem with a regex and then recompute it from
     * `start.split(":")`, which is a second, independent implementation of
     * `time12`. That copy was also wrong under the 24h preference: `time12`
     * returns "17:00" with no meridiem, while the hand-rolled half still
     * printed "PM" under it. Here `meridiem` is simply empty in 24h mode and
     * the tile renders nothing in its place. */
    clockParts(hhmm: string): { clock: string; meridiem: string } {
      const s = time12(hhmm);
      const m = / (AM|PM)$/.exec(s);
      return m ? { clock: s.slice(0, -3), meridiem: m[1] } : { clock: s, meridiem: "" };
    },

    /** THE composition of a time range: "06:00 PM – 07:30 PM".
     *
     * The one place the en dash and its spacing are written. It lives on the
     * formatter rather than in a component module so the server can reach it
     * too — `lib/classes.ts` used to hand-build the same string for its schedule
     * conflict sentence, which was a second copy nothing would have kept in step.
     *
     * Either end may be "" (or otherwise unreadable); `time12` renders that as
     * the shared em-dash placeholder, so a half-known range says so. */
    range(start: string, end: string): string {
      return `${time12(start)} – ${time12(end)}`;
    },

    addMinutes(hhmm: string, min: number): string {
      const base = toMinutes(hhmm);
      if (!isFinite(base)) return hhmm;
      return fromMinutes(base + Number(min || 0));
    },

    /** Local "YYYY-MM-DD" (avoids the UTC shift of toISOString). */
    iso(d: Date): string {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    },

    /** Month key -> localized short label, e.g. "2026-07" -> "Jul" / "Th7". */
    monthShort(mo: string): string {
      if (!mo) return EM;
      return monthsShort()[Number(mo.split("-")[1]) - 1] || EM;
    },

    /** Month key -> localized full label, e.g. "2026-07" -> "July 2026". */
    monthLabel(mo: string): string {
      if (!mo) return EM;
      const a = mo.split("-").map(Number);
      return (monthsFull()[a[1] - 1] || EM) + " " + a[0];
    },

    /** ISO date -> numeric label per the date-format preference. */
    dateLabel(iso: string): string {
      if (!iso) return EM;
      const d = new Date(iso + "T00:00:00");
      if (isNaN(d.getTime())) return EM;
      const DD = String(d.getDate()).padStart(2, "0");
      const MM = String(d.getMonth() + 1).padStart(2, "0");
      const YYYY = d.getFullYear();
      switch (regional.dateFormat) {
        case "MM/DD/YYYY": return MM + "/" + DD + "/" + YYYY;
        case "YYYY/MM/DD": return YYYY + "/" + MM + "/" + DD;
        case "DD/MM/YYYY":
        default: return DD + "/" + MM + "/" + YYYY;
      }
    },
  };
}

export type Formatter = ReturnType<typeof createFormat>;
