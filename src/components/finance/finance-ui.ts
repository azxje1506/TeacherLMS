/* Finance — pure presentation helpers.
 *
 * Formatting, geometry and ordering only. NOTHING HERE COMPUTES A FINANCE
 * FIGURE: every number these functions touch arrived from the server, already
 * derived by `billing.ts` (tuition) or `finance.ts` (revenue). A helper that
 * quietly re-derived one would be a second definition free to disagree with the
 * first, which is the whole reason those two modules exist.
 *
 * THE ONE RULE THAT MATTERS HERE is `money`. A `null` amount is `No data` and is
 * never rendered as `0đ`. "Nobody wrote down how much was collected" and "they
 * paid nothing" are different facts, and a screen that prints the second when
 * the data says the first is stating an assessment nobody made. Every Finance
 * amount that can be unknown goes through this one function, so there is exactly
 * one place the distinction is made.
 *
 * NO CLOCK. Nothing here asks what day or month it is; the payload carries both.
 */

import type { Formatter } from "@/lib/format";
import type { BillingStatus } from "@/lib/types";

/** Render a possibly-unknown VND amount.
 *
 * `null` means the amount is not knowable — a `Partially Paid` bill whose
 * `paidAmount` was never recorded, or any total containing one. It renders the
 * app's own `No data`, translated by the caller, and NEVER `0đ`. */
export function money(amount: number | null | undefined, fmt: Formatter, noData: string): string {
  return typeof amount === "number" ? fmt.vnd(amount) : noData;
}

/** Render a possibly-unknown whole percent, e.g. a collection rate. */
export function percent(value: number | null | undefined, noData: string): string {
  return typeof value === "number" ? `${value}%` : noData;
}

/** A CSS width for one segment of a proportion bar, or `null` when the
 * proportion is not knowable.
 *
 * RETURNS `null` RATHER THAN `0%` FOR AN UNKNOWN. A bar drawn at zero is a claim
 * that nothing was collected, and the caller must render its own neutral state
 * instead of a misleading proportion (PROJECT_RULES, Billing — a total over a
 * scope containing an unknown is itself unknown, and is never completed with a
 * guess). A zero DENOMINATOR is also `null`: nothing was billed, so no share of
 * it exists. */
export function barWidth(part: number | null | undefined, whole: number): string | null {
  if (typeof part !== "number" || whole <= 0) return null;
  const pct = Math.max(0, Math.min(100, (part / whole) * 100));
  return `${pct}%`;
}

/** The design's colour role per stored status. Keyed by the STORED value; the
 * words on screen are the design's and are translated separately. */
export function statusColor(status: BillingStatus | string): { fg: string; bg: string } {
  switch (status) {
    case "Paid": return { fg: "var(--green)", bg: "var(--green-soft)" };
    case "Partially Paid": return { fg: "var(--amber)", bg: "var(--amber-soft)" };
    case "Unpaid": return { fg: "var(--accent)", bg: "var(--accent-soft)" };
    default: return { fg: "var(--muted)", bg: "var(--card-2)" };
  }
}

/** The badge a status row draws. */
export function statusBadgeStyle(status: BillingStatus | string): React.CSSProperties {
  const { fg, bg } = statusColor(status);
  return {
    display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 99,
    background: bg, color: fg, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
  };
}

/** The comp's own label for a stored status. `Partially Paid` is stored with a
 * capital P and shown with a lower-case one, which is the design's casing and
 * not a mistake; the stored enum is never renamed. */
export const STATUS_LABEL: Record<string, string> = {
  Paid: "Paid",
  "Partially Paid": "Partially paid",
  Unpaid: "Unpaid",
};

/** What a bill's collected amount is, for the per-student grid's "Paid" column.
 * A pass-through of the server's value — stated as a named helper so the grid
 * cannot be tempted to compute one. */
export interface ClassStudentAmounts {
  paid: number | null;
  remaining: number | null;
}
export function amountsFor(row: { collected: number | null; outstanding: number | null }): ClassStudentAmounts {
  return { paid: row.collected, remaining: row.outstanding };
}

/* --------------------------------------------------------------- ordering */

export interface RankableClass {
  classId: string;
  className: string;
  billed: number;
  collected: number | null;
  outstanding: number | null;
}

/** "Top performing classes — highest-value classes by collected revenue",
 * split into the classes that can be ranked and the ones that cannot.
 *
 * A CLASS WHOSE COLLECTED VALUE IS UNKNOWN IS NOT RANKED, and is not given a
 * zero either. It holds a `Partially Paid` bill whose amount was never recorded,
 * so its collected total is genuinely unknowable; sorting it as 0 would put a
 * class that has collected almost everything at the bottom of a list titled
 * "highest-value", which is worse than not placing it at all. The unrankable
 * ones are returned separately so the screen can show them with `No data`
 * rather than silently dropping them — being unplaceable is not being absent.
 *
 * DETERMINISTIC. Ties break on class name, then id, so the same payload always
 * produces the same order. */
export function rankByCollected<T extends RankableClass>(
  classes: readonly T[]
): { ranked: T[]; unknown: T[] } {
  const ranked = classes.filter((c) => typeof c.collected === "number");
  const unknown = classes.filter((c) => typeof c.collected !== "number");
  ranked.sort(
    (a, b) =>
      (b.collected as number) - (a.collected as number) ||
      a.className.localeCompare(b.className) ||
      a.classId.localeCompare(b.classId)
  );
  unknown.sort((a, b) => a.className.localeCompare(b.className) || a.classId.localeCompare(b.classId));
  return { ranked, unknown };
}

/** "Revenue by class — sorted by outstanding balance, classes that still owe
 * appear first."
 *
 * Same treatment for the same reason: a class whose outstanding is unknown
 * cannot be placed on a scale of how much it owes, so it sorts after every class
 * that can be, rather than being read as owing nothing. Deterministic ties. */
export function sortByOutstanding<T extends RankableClass>(classes: readonly T[]): T[] {
  return [...classes].sort((a, b) => {
    const ao = a.outstanding, bo = b.outstanding;
    if (typeof ao === "number" && typeof bo === "number") {
      if (bo !== ao) return bo - ao;
    } else if (typeof ao === "number") {
      return -1;
    } else if (typeof bo === "number") {
      return 1;
    }
    return a.className.localeCompare(b.className) || a.classId.localeCompare(b.classId);
  });
}

/* ----------------------------------------------------------- chart geometry */

/** Points for the trend polyline, in the comp's own 0-100 viewBox.
 *
 * GEOMETRY ONLY. The monthly totals arrive from `revenue.trend`; this decides
 * where to draw them and nothing else. A flat series (every month equal,
 * including all-zero) is drawn along the middle rather than dividing by a zero
 * range. */
export interface TrendPoint { month: string; total: number; x: number; y: number }

export function trendGeometry(trend: readonly { month: string; total: number }[]): {
  points: TrendPoint[];
  line: string;
  area: string;
  peak: number;
} {
  const n = trend.length;
  if (n === 0) return { points: [], line: "", area: "", peak: 0 };

  const peak = Math.max(...trend.map((p) => p.total), 0);
  const points: TrendPoint[] = trend.map((p, i) => ({
    month: p.month,
    total: p.total,
    x: n === 1 ? 50 : (i / (n - 1)) * 100,
    // 8..92 keeps the stroke and the hover dots inside the box.
    y: peak <= 0 ? 50 : 92 - (p.total / peak) * 84,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = points.length === 0 ? "" : `${points[0].x},100 ${line} ${points[points.length - 1].x},100`;
  return { points, line, area, peak };
}

/** Dash/offset pairs for the comp's donut, over a 42px-radius circle.
 *
 * Shares are the caller's numbers; this converts them to arc lengths. A total of
 * zero produces no arcs at all rather than a full ring of nothing. */
export interface DonutArc { key: string; label: string; color: string; value: number; dash: string; offset: number; share: number }

export function donutArcs(
  slices: readonly { key: string; label: string; color: string; value: number }[]
): { arcs: DonutArc[]; total: number } {
  const CIRCUMFERENCE = 2 * Math.PI * 42;
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return { arcs: [], total: 0 };

  let consumed = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const share = s.value / total;
      const length = share * CIRCUMFERENCE;
      const arc: DonutArc = {
        key: s.key, label: s.label, color: s.color, value: s.value, share,
        dash: `${length} ${CIRCUMFERENCE - length}`,
        offset: -consumed,
      };
      consumed += length;
      return arc;
    });
  return { arcs, total };
}
