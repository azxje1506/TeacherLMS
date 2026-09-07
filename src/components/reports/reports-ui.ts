/* Reports — pure presentation helpers.
 *
 * Formatting, option derivation and control state only. NOTHING HERE COMPUTES A
 * REPORT FIGURE: every number these functions touch arrived from the server,
 * already derived by the domain that owns it. A helper that quietly re-derived
 * one would be a second definition free to disagree with the first.
 *
 * NO CLOCK. Nothing here asks what year or month it is. The payload carries the
 * window and the application day, and every option below is derived from that
 * window — never from `new Date()`, never from `FINANCE_MONTHS`, and never from
 * a hardcoded year.
 *
 * THE TWO RULES THAT MATTER HERE:
 *
 *  1. `renderValue` is the ONE place a `none` becomes `No data`. Every value on
 *     a Reports sheet goes through it, so an unknown can never be printed as a
 *     zero by a component that forgot to branch.
 *  2. The period is ONE canonical `YYYY-MM`. The design draws two controls, and
 *     they are two views of that single value — neither holds state of its own,
 *     and `snapPeriod` is what keeps a year change from producing a month the
 *     server never offered.
 */

import type { Formatter } from "@/lib/format";
import type { ReportOption, ReportScopeSupport, ReportType, ReportValue } from "@/lib/reports";
import { REPORT_SCOPE } from "@/lib/reports";

/** The sentinel both scope selects use for "no narrowing". It is the empty
 * string because that is what the route already reads as absent — see the
 * `params.get("classId") || null` there — so a sentinel can never be mistaken
 * for an id that failed to resolve. */
export const ALL = "";

/* ------------------------------------------------------------------ values */

/** Render one DTO value.
 *
 * THE `none` BRANCH IS THE POINT. It is not zero, not an empty string and not a
 * dash: it is the app's own `No data`, the same words Finance and Reviews use
 * for an unknown. "Nobody wrote down how much was collected" and "they paid
 * nothing" are different facts, and this is the single place the distinction is
 * made for every Reports surface.
 *
 * NO ARITHMETIC. Amounts, counts and percentages arrive final; this chooses a
 * formatter and nothing else. `fmt` owns the currency symbol and the grouping,
 * so neither is written here. */
export function renderValue(
  value: ReportValue,
  fmt: Formatter,
  t: (key: string) => string
): string {
  switch (value.kind) {
    case "money": return fmt.vnd(value.amount);
    case "count": return fmt.number(value.value);
    case "percent": return `${value.value}%`;
    // The app's own unit for hours, as the Dashboard's own KPI card writes it.
    case "hours": return `${value.value}h`;
    case "text": return value.value;
    case "term": return t(value.key);
    case "none": return t("No data");
  }
}

/** A figure that is a FLOOR carries the app's `At least` qualifier in front of
 * it, so an incomplete scope can never be read as an exact percentage.
 *
 * The flag comes from the server (`ReportSummaryItem.floor`), which sets it only
 * where the owning domain says its inputs are incomplete. This function does not
 * decide when a figure is a floor; it decides how one looks. */
export function renderSummaryValue(
  value: ReportValue,
  floor: boolean | undefined,
  fmt: Formatter,
  t: (key: string) => string
): string {
  const rendered = renderValue(value, fmt, t);
  // A value the domain does not know is not a floor of anything.
  if (!floor || value.kind === "none") return rendered;
  return `${t("At least")} ${rendered}`;
}

/* ----------------------------------------------------------------- period */

/** "2026-07" -> "2026". */
export const yearOf = (month: string): string => month.slice(0, 4);
/** "2026-07" -> 7. */
export const monthNumberOf = (month: string): number => Number(month.slice(5, 7));

/** The years the server-owned window actually spans, newest first.
 *
 * DERIVED FROM `months`, NEVER FROM A CLOCK OR A RANGE. A twelve-month window
 * touches at most two years, so this list is at most two long — there is no
 * open-ended year selector anywhere, and no year is offered that holds no
 * selectable month. */
export function reportYears(months: readonly string[]): string[] {
  return [...new Set(months.map(yearOf))].sort().reverse();
}

export interface MonthChoice {
  /** The canonical period this choice resolves to, e.g. "2026-03". */
  value: string;
  /** 1-12, for the caller's own month-name lookup. */
  number: number;
  /** Offered but not choosable: this month is outside the server's window for
   * the selected year. The row STAYS in the list — a value a teacher expects to
   * see and cannot find is worse than one they can see is unavailable, which is
   * the reason the shared Select carries a per-option disabled state at all. */
  disabled: boolean;
}

/** All twelve months of the selected year, with the ones outside the window
 * disabled rather than removed. */
export function monthChoices(months: readonly string[], year: string): MonthChoice[] {
  const available = new Set(months.filter((m) => yearOf(m) === year));
  return Array.from({ length: 12 }, (_, i) => {
    const value = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { value, number: i + 1, disabled: !available.has(value) };
  });
}

/** The canonical period after a YEAR change — the approved snap rule.
 *
 * Changing the year while the selected month does not exist in the new year
 * resolves to the NEWEST valid month in that year. That is not a new behaviour
 * invented here: it is a consequence of the invariant Finance and Reviews
 * already hold, that the client only ever sends back a period the server
 * offered. Written down because the design does not specify it, and
 * PROJECT_RULES forbids inventing missing UI behaviour at implementation time.
 *
 * Keeps the month where it IS valid, so July 2026 -> July 2025 stays July. */
export function snapPeriod(
  months: readonly string[],
  current: string,
  nextYear: string
): string {
  const candidate = `${nextYear}-${String(monthNumberOf(current)).padStart(2, "0")}`;
  if (months.includes(candidate)) return candidate;
  const inYear = months.filter((m) => yearOf(m) === nextYear).sort().reverse();
  // A year with no month in the window cannot be offered by `reportYears`, so
  // this fallback is unreachable through the UI; it fails closed rather than
  // returning a period the server never named.
  return inYear[0] ?? current;
}

/* ------------------------------------------------------------------ scope */

/** Which scope controls this report type uses. Read straight from the domain's
 * own table — the UI keeps no second copy of the matrix. */
export function scopeSupport(type: ReportType): ReportScopeSupport {
  return REPORT_SCOPE[type];
}

/** The class value to hold after a report-type change.
 *
 * Only a value that has become INVALID is cleared. Switching from Student
 * Payment to Class Revenue keeps the class — it is still meaningful — and
 * switching to Monthly Revenue drops it, because that report has no class
 * scope at all. The period is never touched by a type change. */
export function nextClassValue(type: ReportType, classId: string): string {
  return scopeSupport(type).class ? classId : ALL;
}

/** The student value to hold after a report-type OR class change.
 *
 * Cleared when the type has no student scope, and cleared when the student is no
 * longer on the offered list — which is what happens when a class is selected
 * whose roster does not contain them. Returning to `All students` is the
 * non-destructive answer: it narrows nothing and asks for nothing. */
export function nextStudentValue(
  type: ReportType,
  studentId: string,
  options: readonly ReportOption[]
): string {
  if (!scopeSupport(type).student) return ALL;
  if (studentId === ALL) return ALL;
  return options.some((o) => o.id === studentId) ? studentId : ALL;
}

/* ------------------------------------------------------------------ query */

/** The query string for one selection.
 *
 * The sentinel is OMITTED rather than sent empty, so the request says "no
 * narrowing" by saying nothing — which is exactly how the route reads it. */
export function reportQuery(
  type: ReportType,
  month: string,
  classId: string,
  studentId: string
): string {
  const p = new URLSearchParams({ type, month });
  if (classId !== ALL) p.set("classId", classId);
  if (studentId !== ALL) p.set("studentId", studentId);
  return p.toString();
}
