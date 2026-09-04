/* English Tutor LMS — pure calculation helpers.
 * Ported from design-reference/lib/etlms-calc.js. Dependency-free and shared by
 * scheduling and the performance views (server + client). Billing's own
 * calculations live in src/lib/billing.ts. */

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

/* `paidAmount(b)` USED TO LIVE HERE and has been DELETED, not moved.
 *
 * It returned `Math.round(b.fee / 2)` for every `Partially Paid` bill — an
 * invented constant that no business rule ever supported, in a helper nothing
 * called. Its replacement is `collectedFor` in src/lib/billing.ts, which returns
 * `null` for a partial whose amount was never recorded, because "nobody wrote
 * down how much" and "they paid half" are different facts and only one of them
 * is in the data (PROJECT_RULES, Billing).
 *
 * Recorded rather than silently removed so the 50% rule is not reintroduced by
 * somebody who remembers it existing. There is a test asserting no such
 * assumption remains anywhere in src/. */

/** Coaching label for an average skill score (1..5). */
export function perfLabel(avg: number): string {
  return avg >= 4.5 ? "Excellent" : avg >= 3.8 ? "Strong" : avg >= 3.0 ? "Good" : avg >= 2.2 ? "Developing" : "Needs support";
}

/** Themed colour band (CSS var reference) matching perfLabel(). */
export function perfColor(avg: number): string {
  return avg >= 3.8 ? "var(--green)" : avg >= 3.0 ? "var(--sky)" : avg >= 2.2 ? "var(--amber)" : "var(--accent)";
}
