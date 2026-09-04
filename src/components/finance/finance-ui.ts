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
  knownCollected: number;
  knownOutstanding: number;
  amountsComplete: boolean;
}

/** "Top performing classes — highest-value classes by collected revenue."
 *
 * RANKED BY `knownCollected`, WHICH EVERY CLASS NOW HAS. The old version split
 * the list in two: a class holding one unrecorded partial had no collected
 * total at all, so it could not be placed and was listed after the ranking with
 * `No data` beside it. That was true of the old contract and useless under it —
 * a class that had demonstrably collected 700,000đ was shown as having no
 * figure, purely because one of its three bills was incomplete.
 *
 * NOW EVERY CLASS IS PLACED, on the money it can actually prove. The number is
 * a FLOOR for a class whose amounts are incomplete — its real collected total
 * is that or higher — so the ranking may understate such a class, and the
 * screen marks it rather than silently presenting a floor as a total.
 * `amountsComplete` travels with each class for exactly that reason.
 *
 * STILL NO ZERO SUBSTITUTED. A class with an unrecorded partial is ranked on
 * what it did collect, never on an assumed 0 and never on an assumed half.
 *
 * DETERMINISTIC. Ties break on class name, then id, so the same payload always
 * produces the same order. */
export function rankByCollected<T extends RankableClass>(classes: readonly T[]): T[] {
  return [...classes].sort(
    (a, b) =>
      b.knownCollected - a.knownCollected ||
      a.className.localeCompare(b.className) ||
      a.classId.localeCompare(b.classId)
  );
}

/** "Revenue by class — sorted by outstanding balance, classes that still owe
 * appear first."
 *
 * Same change for the same reason: `knownOutstanding` is a number for every
 * class, so no class is exiled to the end of the list because one of its bills
 * is incomplete. A class whose amounts are incomplete sorts on the debt it can
 * prove, which is a floor, and the row says so. Deterministic ties. */
export function sortByOutstanding<T extends RankableClass>(classes: readonly T[]): T[] {
  return [...classes].sort(
    (a, b) =>
      b.knownOutstanding - a.knownOutstanding ||
      a.className.localeCompare(b.className) ||
      a.classId.localeCompare(b.classId)
  );
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

/* ------------------------------------------------ historical billing copy */

/** The two forms of the one sentence that explains an AGGREGATE the visible
 * rows cannot add up to.
 *
 * WHY THIS REPLACED "+N more". The screen used to disclose the gap with the
 * comp's `+N more`, which reads as a disclosure control: something to press that
 * reveals more of a list. There is nothing to reveal — the records it counts
 * belong to students who no longer exist, so no row for them can ever be shown —
 * and putting that text inside an ACTIONABLE list of people to chase for money
 * promised the teacher four more names they could act on. The fact itself is
 * true and still has to be told, so it is told as a sentence, in the one place
 * it explains something: beside a total that is bigger than the rows beneath it.
 *
 * IT IS A FINANCE FACT, NOT A DATA-MODEL FACT. The copy says "historical payment
 * records no longer have student information" — never ghost, hidden, deleted or
 * database, which describe our storage rather than the teacher's books.
 *
 * The English source string is the dictionary key, as everywhere else in this
 * app; `{N}` is filled after translation so both languages can put the number
 * where their own grammar wants it. */
export const HISTORICAL_NOTE_ONE = "{N} historical payment record no longer has student information.";
export const HISTORICAL_NOTE_MANY = "{N} historical payment records no longer have student information.";

/** The sentence for `count` records. Pluralised the way `class-ui` already
 * pluralises "student", and never rendered for a count of zero — the caller
 * guards, because a note explaining nothing is the clutter this replaced. */
export function historicalNote(count: number, t: (s: string) => string): string {
  return t(count === 1 ? HISTORICAL_NOTE_ONE : HISTORICAL_NOTE_MANY).replace("{N}", String(count));
}

/** How EVERY neutral Finance caption is drawn: muted, small, and INERT.
 *
 * No cursor, no underline, no colour that reads as a link — and callers attach
 * no handler. It is a caption on a number, not a control, and the whole reason
 * the old affordance was wrong was that it looked like one.
 *
 * Shared by the historical-record note above and by the unrecorded-partial note
 * below: both are the same thing — one muted sentence explaining why an
 * aggregate is not what the rows under it suggest — so they are one style
 * rather than two that can drift apart. */
export const financeNoteStyle: React.CSSProperties = {
  fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.45,
};

/* ------------------------------------- the three states a figure can be in
 *
 * PRODUCTION SHOWED WHY THIS SECTION EXISTS. Switching to a historical month
 * filled the screen with `No data`, and the words could mean two unrelated
 * things: "this month was never billed" or "this month WAS billed, but one old
 * Partially Paid record never had its amount written down". A teacher cannot
 * act on the first and can act on the second, so one label for both is a label
 * that answers nothing.
 *
 * There are three states, and Finance now draws three different things:
 *
 *   KNOWN ZERO         `0đ`  — the figure is computable and it is zero.
 *   INSUFFICIENT DATA        — bills exist; a legacy partial has no recorded
 *                              amount, so this total is genuinely unknowable.
 *                              Said with the count of records responsible.
 *   NO BILLING RECORDS       — the month holds no bills at all. An empty state,
 *                              not a figure, because there is no figure to give.
 *
 * `null` AND "UNKNOWN" ARE THE SAME THING HERE, and provably so: `totalsFor`
 * sets `collected = unknownAmountBills > 0 ? null : collectedKnown`, so a null
 * amount always has exactly one cause and `Insufficient data` always has a
 * count behind it. (`collectionRate` is the one figure that is also null for a
 * zero denominator — unreachable while fees are positive, and the empty-month
 * branch catches the case that would produce it.)
 *
 * NOTHING HERE INFERS AN AMOUNT. No half, no proportion, no substitute zero:
 * an amount nobody recorded stays unrecorded, and the screen says so. */

/** THE AGGREGATE LABEL IS GONE. There was an `Insufficient data` constant
 * here, shown in place of a month's collected and outstanding totals whenever a
 * single legacy partial lacked an amount. It is deleted rather than deprecated:
 * no aggregate on this screen is unshowable any more, so a label meaning "this
 * total cannot be given" has nothing left to label, and leaving it exported
 * would invite exactly the substitution the fix removed.
 *
 * The two places a FIGURE is genuinely missing are single cells of a single
 * bill, and they get their own words, because "nothing was written down" and
 * "so this cannot be worked out" are different facts about the same row. */
export const NOT_RECORDED = "Not recorded";
export const NOT_DETERMINED = "Not determined";

/** The proportion bar's third segment, and its legend. Not a payment: the slice
 * of the billed total whose split between collected and outstanding is unknown. */
export const UNKNOWN_SEGMENT = "Unknown";

/** THE COLLECTION RATE IS NOT RENDERED ANY MORE, and the copy that qualified
 * it went with it — `At least {X}%` and `Based on recorded payment amounts.`
 * are deleted rather than left exported for a caller to rediscover.
 *
 * The metric was the Money Summary's fourth, and it earned its place least: a
 * percentage of expected revenue tells a teacher nothing they can act on, and
 * under this month's data it could not even be stated plainly — one unrecorded
 * partial forced it to be shown as a floor with a sentence explaining the
 * arithmetic underneath. Two lines of qualification for a number nobody uses,
 * beside three they do.
 *
 * `collectionRate` REMAINS ON THE PAYLOAD deliberately (see `BillingTotals`).
 * It is a correct, cheap, well-tested figure; removing it from the domain to
 * chase one UI decision this late would be churn in the service contract for no
 * gain, and any future surface that wants it can have it without re-deriving a
 * second definition. */

/** How many bills, as a phrase. Pluralised the way `class-ui` pluralises
 * "student"; Vietnamese has no plural inflection, so both forms translate to
 * the same words and the number carries the difference. */
export const BILL_ONE = "bill";
export const BILL_MANY = "bills";

export function billsLabel(count: number, t: (s: string) => string): string {
  return `${count} ${t(count === 1 ? BILL_ONE : BILL_MANY)}`;
}

/** Why a bill-derived total is incomplete, in the teacher's terms. Count-aware,
 * as PROJECT_RULES' own preferred copy allows, because the count is what tells
 * a teacher how much of the month is affected. */
export const PARTIAL_NOTE_ONE = "{N} partial payment does not have a recorded amount.";
export const PARTIAL_NOTE_MANY = "{N} partial payments do not have a recorded amount.";

/** The same fact about records whose student no longer resolves.
 *
 * A DIFFERENT SENTENCE BECAUSE IT IS A DIFFERENT SITUATION, not because it is a
 * different kind of record. An unrecorded partial belonging to a student who
 * still exists is something a teacher can go and settle; the same gap on a
 * record whose student is gone is closed history they cannot act on.
 *
 * IT SAYS NOTHING ABOUT WHY THE STUDENT IS MISSING. Deleted, stopped studying,
 * cleaned up, waived — the data model proves none of them, so the copy claims
 * none of them. "Historical" is a statement about the record's age and nothing
 * else, and no id or name travels with it. */
export const HISTORICAL_PARTIAL_ONE = "{N} historical payment does not have a recorded amount.";
export const HISTORICAL_PARTIAL_MANY = "{N} historical payments do not have a recorded amount.";

/** The month held no bills. A title and a description, not a value. */
export const NO_BILLING_TITLE = "No tuition data for this month";
export const NO_BILLING_BODY = "There are no billing records for this month yet.";

/** The sentence for `count` unrecorded partials belonging to live students.
 * Pluralised like `historicalNote`, and never rendered at zero — the caller
 * guards, because a note explaining nothing is clutter. */
export function partialNote(count: number, t: (s: string) => string): string {
  return t(count === 1 ? PARTIAL_NOTE_ONE : PARTIAL_NOTE_MANY).replace("{N}", String(count));
}

/** The same, for records whose student no longer resolves. */
export function historicalPartialNote(count: number, t: (s: string) => string): string {
  return t(count === 1 ? HISTORICAL_PARTIAL_ONE : HISTORICAL_PARTIAL_MANY).replace("{N}", String(count));
}



/** Which of the three states a bill-derived scope is in.
 *
 * Order matters: a month with no bills is EMPTY even though every total in it
 * is a legitimate zero, because "0đ collected out of 0đ billed" is a true
 * sentence that tells a teacher nothing about why the screen is bare. */
export type BillingState = "empty" | "insufficient" | "known";

export function billingState(scope: {
  counts: { total: number };
  unknownAmountBills: number;
}): BillingState {
  if (scope.counts.total === 0) return "empty";
  return scope.unknownAmountBills > 0 ? "insufficient" : "known";
}
