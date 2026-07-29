/* English Tutor LMS — pure calculation helpers.
 * Ported from design-reference/lib/etlms-calc.js. Dependency-free and shared by
 * scheduling, billing and the performance views (server + client). */

import type { Billing } from "./types";

/** Deterministic 32-bit string hash (×31 rolling). Seeds all reproducible mock variation. */
export function hash(s: string | null | undefined): number {
  let h = 0;
  const str = String(s == null ? "" : s);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Minutes since midnight for a 24h "HH:MM". NaN when unparseable. */
export function toMinutes(hhmm: string): number {
  const p = String(hhmm).split(":").map(Number);
  return p[0] * 60 + p[1];
}

/** 24h "HH:MM" for a minutes-since-midnight value (wraps within the day). */
export function fromMinutes(mins: number): string {
  const tot = (((Number(mins) || 0) % 1440) + 1440) % 1440;
  return String(Math.floor(tot / 60)).padStart(2, "0") + ":" + String(tot % 60).padStart(2, "0");
}

/** Minutes from `start` to `end` (both 24h "HH:MM"); negative when end precedes
 * start. The drawer schedules with From / To and stores start + duration. */
export function minutesBetween(start: string, end: string): number {
  return toMinutes(end) - toMinutes(start);
}

/** Do two [start, duration] ranges (24h "HH:MM" + minutes) intersect? */
export function overlaps(aStart: string, aDur: number, bStart: string, bDur: number): boolean {
  const as = toMinutes(aStart), ae = as + Number(aDur || 0);
  const bs = toMinutes(bStart), be = bs + Number(bDur || 0);
  return as < be && bs < ae;
}

/** Indexes of the slots that clash with an EARLIER slot on the same weekday.
 *
 * A class may run several lessons on one weekday, but two of them may never
 * overlap — an exact duplicate overlaps itself, while back-to-back (one ends as
 * the next starts) does not, and different weekdays never clash. Reuses
 * `overlaps`, the same interval test the cross-class rule applies. */
export function overlappingSlotIndexes(
  slots: Array<{ day: number; start: string; duration: number }>
): number[] {
  const hits: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    for (let j = 0; j < i; j++) {
      const b = slots[j];
      if (a.day === b.day && overlaps(a.start, a.duration, b.start, b.duration)) {
        hits.push(i);
        break;
      }
    }
  }
  return hits;
}

/** Amount actually collected for a billing record. Partially Paid counts as half the fee. */
export function paidAmount(b: Pick<Billing, "status" | "fee"> | null | undefined): number {
  if (!b) return 0;
  return b.status === "Paid" ? b.fee : b.status === "Partially Paid" ? Math.round(b.fee / 2) : 0;
}

/** Coaching label for an average skill score (1..5). */
export function perfLabel(avg: number): string {
  return avg >= 4.5 ? "Excellent" : avg >= 3.8 ? "Strong" : avg >= 3.0 ? "Good" : avg >= 2.2 ? "Developing" : "Needs support";
}

/** Themed colour band (CSS var reference) matching perfLabel(). */
export function perfColor(avg: number): string {
  return avg >= 3.8 ? "var(--green)" : avg >= 3.0 ? "var(--sky)" : avg >= 2.2 ? "var(--amber)" : "var(--accent)";
}
