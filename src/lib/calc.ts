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

/** Do two [start, duration] ranges (24h "HH:MM" + minutes) intersect? */
export function overlaps(aStart: string, aDur: number, bStart: string, bDur: number): boolean {
  const m = (t: string) => { const p = String(t).split(":").map(Number); return p[0] * 60 + p[1]; };
  const as = m(aStart), ae = as + Number(aDur || 0), bs = m(bStart), be = bs + Number(bDur || 0);
  return as < be && bs < ae;
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
