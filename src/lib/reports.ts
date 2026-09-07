/* Reports — the pure module: what a report IS, and what one contains.
 *
 * ---- WHAT THIS FILE OWNS ---------------------------------------------------
 *
 * The five authorised report types, the reporting window, scope validation, the
 * one generic document shape the design's sheet draws, and the five builders
 * that turn already-fetched documents into that shape. `reports-service.ts`
 * fetches; this module decides. The split is the one billing.ts / finance-service.ts
 * and reviews.ts / reviews-service.ts already draw, for the same reason: "what
 * does this report contain, and what does it disclose" is only provably correct
 * if a test can reach it without a database in the loop.
 *
 * ---- WHAT THIS FILE DOES NOT OWN -------------------------------------------
 *
 * ARITHMETIC. Not one figure below is computed here. Revenue is `computeRevenue`,
 * tuition is `buildBillingBranch`, attendance is `buildAttendanceIndex` and
 * `studentAttendanceRate`, homework is `homeworkCompletion` and
 * `studentHomeworkCompletion`. Reports composes; the owning domain answers. Where
 * a figure does not already exist, Reports does not invent it — which is why, for
 * instance, the attendance coverage pair appears only on the one scope whose
 * owning helper actually returns it (PROJECT_RULES, Reports).
 *
 * A MONTH. The selected period is handed to each owning domain's own month rule
 * unchanged: `Lesson.date` for revenue and attendance, `Billing.month` for
 * payments, the assignment's due date for homework. Reports is not a third
 * interpretation of a month, and no month rule is restated below.
 *
 * ---- NO CLOCK, NO SERVER-ONLY ----------------------------------------------
 *
 * The application month and day arrive as arguments, exactly as they do for
 * reviews.ts, so this module never becomes a second source of app time. There is
 * no `server-only` marker either, for the same reason that module has none: every
 * decision here is exercised by the test runner, which cannot resolve it.
 *
 * ---- BILLING IS NOT REVENUE ------------------------------------------------
 *
 * The separation is enforced by the builder signatures rather than by care. The
 * two revenue builders take `RevenueReportInput`, which has no bills and cannot
 * be given one; the payment builder takes bills and no lessons. Neither can
 * reach the other's numbers, so no single report body can contain both — and no
 * bill-derived field or helper in this file is named `revenue`.
 */

import {
  computeRevenue, teachingHours,
  studentAttendanceRate, homeworkCompletion, studentHomeworkCompletion,
} from "./finance";
import { buildAttendanceIndex, resolveRoster } from "./attendance";
import { buildBillingBranch, type BillingResolution } from "./billing";
import { shiftMonth } from "./reviews";
import type {
  AttendanceRecord, Billing, Homework, Klass, Lesson, Student,
} from "./types";

/* ============================================================ the five types */

/** The authorised report types, in the order the selector offers them.
 *
 * FIVE, AND NO OTHERS (PROJECT_RULES, Reports). `Performance Summary` is
 * deliberately absent: it would reproduce the Reviews-owned Monthly Progress
 * Report over the same ratings, the same average and the same month. The
 * dictionary carries a string for it; an unused string is not an authorisation.
 *
 * The keys are internal and stable. They are NOT the words on screen — those are
 * `REPORT_TITLE`, which are dictionary keys the client translates — so renaming
 * a label never changes an API contract, and a Vietnamese session and an English
 * one send the identical request. */
export const REPORT_TYPES = [
  "monthly-revenue",
  "class-revenue",
  "student-payment",
  "attendance-summary",
  "homework-summary",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/** The document's own title, as a dictionary key. Every one of these five
 * already exists in the shipped dictionary. */
export const REPORT_TITLE: Record<ReportType, string> = {
  "monthly-revenue": "Monthly Revenue Report",
  "class-revenue": "Class Revenue Report",
  "student-payment": "Student Payment Report",
  "attendance-summary": "Attendance Summary",
  "homework-summary": "Homework Summary",
};

/** Is this an authorised report type? Fails closed: anything that is not one of
 * the five — including `performance-summary` and any Reviews document — is not. */
export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

/* ================================================================== the scope
 *
 * WHICH FILTERS A REPORT USES IS PART OF WHAT THE REPORT IS, not a preference.
 * Monthly Revenue is studio-wide only because a class-scoped one would BE the
 * Class Revenue Report, and two types that collapse into each other under a
 * filter are one type (PROJECT_RULES, Reports). The screen still draws every
 * control — a scope a report does not use is disabled showing its sentinel,
 * never hidden — so this table describes what the SERVER accepts, and the UI
 * gate reads the same table rather than keeping a second copy of it. */

export interface ReportScopeSupport {
  /** May a `classId` narrow this report? */
  class: boolean;
  /** May a `studentId` narrow this report? */
  student: boolean;
}

export const REPORT_SCOPE: Record<ReportType, ReportScopeSupport> = {
  "monthly-revenue": { class: false, student: false },
  "class-revenue": { class: true, student: false },
  "student-payment": { class: true, student: true },
  "attendance-summary": { class: true, student: true },
  "homework-summary": { class: true, student: true },
};

export type ReportScopeKind = "studio" | "class" | "student" | "student-in-class";

/** The scope a request resolved to, with the names a masthead renders.
 *
 * NAMES, NOT IDENTITIES. Only a class or student that RESOLVED reaches this
 * shape, so there is no ghost name to render and no placeholder to invent. */
export interface ReportScope {
  kind: ReportScopeKind;
  classId: string | null;
  className: string | null;
  studentId: string | null;
  studentName: string | null;
}

export const STUDIO_SCOPE: ReportScope = {
  kind: "studio", classId: null, className: null, studentId: null, studentName: null,
};

/** Why a request was refused. */
export type ReportViolation =
  | "type-unknown"
  | "month-malformed"
  | "class-not-applicable"
  | "student-not-applicable"
  | "class-missing"
  | "student-missing"
  | "student-not-in-class";

/** The answer a route renders. A class or student that does not resolve gets the
 * SAME 404 a guessed id gets, because a distinct error would advertise the
 * existence of a record nobody may see (PROJECT_RULES, Reports). */
export const REPORT_ERROR: Record<ReportViolation, { status: number; message: string }> = {
  "type-unknown": { status: 422, message: "Pick a report" },
  "month-malformed": { status: 422, message: "Pick a month" },
  "class-not-applicable": { status: 422, message: "This report is not scoped to a class" },
  "student-not-applicable": { status: 422, message: "This report is not scoped to a student" },
  "class-missing": { status: 404, message: "Class not found" },
  "student-missing": { status: 404, message: "Student not found" },
  "student-not-in-class": { status: 422, message: "That student is not in this class" },
};

/** Does this report accept the filters it was given?
 *
 * SHAPE ONLY. Whether the ids RESOLVE is a database question and is settled in
 * the service, against documents it has already fetched — this decides whether
 * the combination is meaningful at all, which is a fact about the report type
 * and is testable without a database. An absent id is the sentinel ("all"), not
 * an omission to complain about. */
export function checkReportScope(
  type: ReportType,
  classId: string | null,
  studentId: string | null
): { ok: true } | { ok: false; violation: ReportViolation } {
  const support = REPORT_SCOPE[type];
  if (classId && !support.class) return { ok: false, violation: "class-not-applicable" };
  if (studentId && !support.student) return { ok: false, violation: "student-not-applicable" };
  return { ok: true };
}

/* ========================================================== the month window */

/** The application month plus the previous eleven — twelve months ending at the
 * present, newest first.
 *
 * THE SAME RULE BILLING AND REVIEWS ALREADY STATE, and deliberately its own
 * function rather than an import from `finance-service.ts`: that module carries
 * `server-only`, so importing it would make this one unloadable by the test
 * runner, and Reports must not depend on Finance's service layer to know what a
 * month is. The RULE is shared; the twelve is written down in both places
 * because both are stating the same contract, not because one derives from the
 * other.
 *
 * `appMonth` IS AN ARGUMENT. No clock is read here, and `FINANCE_MONTHS` — the
 * seed's billing window — is never consulted: it happens to match production
 * today, and treating a seed artefact as a runtime reporting contract would
 * freeze the app to its demo data (PROJECT_RULES, Reports). */
export const REPORT_MONTH_WINDOW = 12;

export function reportMonthOptions(appMonth: string): string[] {
  const months: string[] = [];
  for (let back = 0; back < REPORT_MONTH_WINDOW; back++) {
    const month = shiftMonth(appMonth, -back);
    if (month) months.push(month);
  }
  return months;
}

/* =================================================================== the DTO
 *
 * ONE SHAPE FOR ALL FIVE REPORTS, because the design draws one sheet: a masthead,
 * a row of summary tiles, one generic table, a footer. Per-type document shapes
 * would be inventing structure the design does not have.
 *
 * VALUES ARE TYPED, NOT FORMATTED. A cell carries an integer number of đồng and
 * says it is money; it does not carry "1,500,000đ". Currency, number and date
 * formatting are the client's — they follow the teacher's own Settings — and a
 * server that pre-rendered them would make presentation the source of truth and
 * leave a test asserting on a string instead of on the arithmetic. */

export type ReportValue =
  /** Integer VND, exactly as the owning domain reported it. */
  | { kind: "money"; amount: number }
  /** A whole count of things. */
  | { kind: "count"; value: number }
  /** A whole percent, 0-100. */
  | { kind: "percent"; value: number }
  /** Hours, to one decimal — `teachingHours`' own unit. */
  | { kind: "hours"; value: number }
  /** Text that is already final, such as a person's or class's name. */
  | { kind: "text"; value: string }
  /** A dictionary key the client translates — a status, a lesson type. */
  | { kind: "term"; key: string }
  /** NOT ZERO. The owning domain does not know this value: an unrecorded
   * partial payment, an empty attendance denominator. Renders as `No data`. */
  | { kind: "none" };

export const NO_DATA: ReportValue = { kind: "none" };
export const money = (amount: number): ReportValue => ({ kind: "money", amount });
export const count = (value: number): ReportValue => ({ kind: "count", value });
export const hours = (value: number): ReportValue => ({ kind: "hours", value });
export const text = (value: string): ReportValue => ({ kind: "text", value });
export const term = (key: string): ReportValue => ({ kind: "term", key });
/** A percentage the owning domain may not know. `null` is `No data`, never 0%. */
export const percent = (value: number | null): ReportValue =>
  value === null ? NO_DATA : { kind: "percent", value };

export interface ReportSummaryItem {
  /** Dictionary key. */
  label: string;
  value: ReportValue;
  /** The figure is a FLOOR rather than an exact value — the real one is this or
   * higher. True only where the owning domain says its inputs are incomplete.
   * A caller that prints a floor as an exact percentage is lying, which is why
   * the flag travels beside the number rather than in a comment. */
  floor?: boolean;
}

export interface ReportColumn {
  key: string;
  /** Dictionary key. */
  label: string;
  align: "left" | "right";
}

export interface ReportRow {
  /** Stable key for rendering. Never a ghost id: only resolvable entities
   * become rows. */
  key: string;
  /** One value per column, in the columns' own order. */
  cells: ReportValue[];
  /** Student Payment ONLY: does this student's `parentId` resolve to a real
   * Parent? Informational, never blocking, and carrying no name, phone, email or
   * address — "is there somebody to talk to about this bill" is a boolean
   * (PROJECT_RULES, Reports and Student & Parents). Absent on every other report,
   * where parent linkage has no bearing on the figure. */
  parentLinked?: boolean;
}

/** Bills counted in the totals but named in no row, because their student no
 * longer resolves — Billing's own `hiddenRecords`, passed through untouched.
 * Present only where the owning domain supplies such a count; Reports derives
 * none of its own. */
export interface ReportCompleteness {
  /** `unknownAmountBills === 0`. When false, money figures are floors. */
  amountsComplete: boolean;
  /** How many bills have no recorded amount. */
  unknownAmountBills: number;
}

/** Attendance's own coverage pair: how many of the completed lessons in scope
 * actually have a stored register. A percentage over two registers and one over
 * twenty are not the same claim. Supplied only by `studentAttendanceRate`, so it
 * appears only where that helper is the source. */
export interface ReportCoverage {
  registersTaken: number;
  lessonsCompleted: number;
}

/** Everything a report contains below the masthead. The envelope — type, title,
 * month, window, scope, generated-on — is the service's. */
export interface ReportBody {
  /** Nothing to show for this selection. The design has its own empty state and
   * an empty month is a legitimate answer, never an error. */
  empty: boolean;
  summary: ReportSummaryItem[];
  columns: ReportColumn[];
  rows: ReportRow[];
  hiddenRecords?: number;
  completeness?: ReportCompleteness;
  coverage?: ReportCoverage;
}

/** The whole document. NOT PERSISTED, and carrying nothing that would suggest it
 * could be: no id, no `generatedAt`, no status, no history, no file URL. */
export interface ReportPayload extends ReportBody {
  type: ReportType;
  /** Dictionary key — `REPORT_TITLE[type]`. */
  title: string;
  /** The canonical period, "YYYY-MM". */
  month: string;
  /** The server-owned window, newest first. The client computes no month. */
  months: string[];
  /** The application day. The document's `Generated on`, which is document
   * metadata and not a record of anything (PROJECT_RULES, Reports). */
  appClock: string;
  scope: ReportScope;
}

/* ======================================================= revenue: two reports
 *
 * NO BILL CAN REACH EITHER OF THESE. The input type is `computeRevenue`'s own
 * and has no room for one. */

export interface RevenueReportInput {
  classes: Klass[];
  students: Student[];
  lessons: Lesson[];
  attendance: AttendanceRecord[];
}

const REVENUE_COL: ReportColumn = { key: "amount", label: "Revenue", align: "right" };

/** Monthly Revenue — the month's teaching income, studio-wide.
 *
 * STUDIO-WIDE ONLY, by the scope table above. The table is the engine's own
 * `byType` split, which sums exactly to `total` by construction; the tiles are
 * the total and `teachingHours`, both canonical.
 *
 * `c6`'s stored fee is ten times its own historical bills and is summed exactly
 * as stored. Nothing here normalises, clamps or annotates it — correcting stored
 * data is a separate, explicitly authorised act and never a side effect of
 * displaying it. */
export function buildMonthlyRevenueBody(month: string, data: RevenueReportInput): ReportBody {
  const revenue = computeRevenue(month, data);
  const empty = revenue.perClass.length === 0;

  return {
    empty,
    summary: [
      { label: "Total revenue", value: money(revenue.total) },
      { label: "Teaching hours", value: hours(teachingHours(month, data)) },
    ],
    columns: [{ key: "type", label: "By lesson type", align: "left" }, REVENUE_COL],
    rows: empty ? [] : [
      { key: "regular", cells: [term("Regular"), money(revenue.byType.regular)] },
      { key: "makeup", cells: [term("Makeup"), money(revenue.byType.makeup)] },
      { key: "extra", cells: [term("Extra"), money(revenue.byType.extra)] },
    ],
  };
}

/** Class Revenue — the same engine, read per class.
 *
 * `perClass` IS `computeRevenue`'s OWN LIST: its rows, its amounts, its ordering
 * (highest first). Selecting one class's row is a filter, not a second
 * calculation — the amount shown is the engine's integer, unmodified. A class
 * the engine did not report earned nothing this month and is legitimately empty;
 * it is not shown as a zero row, for the reason `buildAttendanceIndex` does not
 * list a class with no register. */
export function buildClassRevenueBody(
  month: string,
  data: RevenueReportInput,
  classId: string | null
): ReportBody {
  const revenue = computeRevenue(month, data);
  const rows = classId ? revenue.perClass.filter((r) => r.classId === classId) : revenue.perClass;
  // The scope's total is the engine's own: the studio figure when every row is
  // shown, and the single row's own amount when one class is selected. Summing
  // a filtered list is selection, not arithmetic — there is nothing to round.
  const total = classId ? rows.reduce((s, r) => s + r.amount, 0) : revenue.total;

  return {
    empty: rows.length === 0,
    summary: [{ label: "Total revenue", value: money(total) }],
    columns: [{ key: "class", label: "Class", align: "left" }, REVENUE_COL],
    rows: rows.map((r) => ({ key: r.classId, cells: [text(r.name), money(r.amount)] })),
  };
}

/* ============================================================ student payment
 *
 * NO LESSON CAN REACH THIS. Bills in, tuition out; the word `revenue` appears
 * nowhere in this section, and cannot, because there is no revenue here to name.
 */

/** Student Payment — one scope's tuition, delegated whole to `buildBillingBranch`.
 *
 * THE SCOPE IS THE CALLER'S: the service passes the bills the scope selects, and
 * the branch totals every bill it is given — ghosts included, because a
 * deletion must not move a closed month's reported figures — while raising rows
 * only for the bills whose student resolves. The gap between the two is
 * `hiddenRecords`, which is Billing's own count and the only thing about a ghost
 * that ever reaches a client.
 *
 * NOTHING IS GUESSED. A `Partially Paid` bill with no recorded amount reaches the
 * row as `collected: null` and leaves it as `No data` — never zero, never half.
 * The scope's own totals report what is known (`knownCollected`,
 * `knownOutstanding`) and report the gap separately (`unknownAmount`), so
 * `knownCollected + knownOutstanding + unknownAmount === billed` holds on the
 * sheet exactly as it holds in the module.
 *
 * `Partially paid` IS A COUNT, NOT AN AMOUNT — the tile Finance already draws,
 * for the reason it draws it: for the legacy records that amount is exactly what
 * nobody wrote down.
 *
 * THE COLLECTION RATE IS HERE THOUGH FINANCE DROPPED IT. Sprint 9 removed it from
 * the Finance screen as "a report-card number rather than something a teacher
 * acts on" — which is a description of what belongs on a report and not on a
 * working list. It carries `floor` whenever the scope's amounts are incomplete,
 * so it can never be printed as an exact percentage of an incomplete scope. */
export function buildStudentPaymentBody(
  bills: readonly Billing[],
  resolution: BillingResolution
): ReportBody {
  const branch = buildBillingBranch(bills, resolution);

  const summary: ReportSummaryItem[] = [
    { label: "Total billable", value: money(branch.billed) },
    { label: "Collected", value: money(branch.knownCollected) },
    { label: "Outstanding", value: money(branch.knownOutstanding) },
    { label: "Partially paid", value: count(branch.counts.partiallyPaid) },
    {
      label: "Collection rate",
      value: percent(branch.collectionRate),
      floor: !branch.amountsComplete,
    },
  ];

  // The unrecorded slice is named only when there IS one. It is the FEE of every
  // bill whose split nobody wrote down — not a payment, not "money not
  // collected" — so it is never folded into either known bucket.
  if (!branch.amountsComplete) {
    summary.push({ label: "Not recorded", value: money(branch.unknownAmount) });
  }

  return {
    empty: bills.length === 0,
    summary,
    columns: [
      { key: "student", label: "Student", align: "left" },
      { key: "class", label: "Class", align: "left" },
      { key: "fee", label: "Monthly fee", align: "right" },
      { key: "collected", label: "Collected", align: "right" },
      { key: "outstanding", label: "Outstanding", align: "right" },
      { key: "status", label: "Status", align: "left" },
    ],
    rows: branch.rows.map((r) => ({
      key: r.billId,
      cells: [
        text(r.studentName),
        text(r.className),
        money(r.fee),
        r.collected === null ? NO_DATA : money(r.collected),
        r.outstanding === null ? NO_DATA : money(r.outstanding),
        term(r.status),
      ],
      parentLinked: r.parentLinked,
    })),
    hiddenRecords: branch.hiddenRecords,
    completeness: {
      amountsComplete: branch.amountsComplete,
      unknownAmountBills: branch.unknownAmountBills,
    },
  };
}

/* ================================================================ attendance */

export interface AttendanceReportInput {
  classes: Klass[];
  students: Student[];
  lessons: Lesson[];
  attendance: AttendanceRecord[];
}

const RATE_COL: ReportColumn = { key: "rate", label: "Attendance rate", align: "right" };

/** Attendance Summary — delegated to the Attendance index and, per student, to
 * `studentAttendanceRate`.
 *
 * THE LESSON OWNS THE DATE. `AttendanceRecord.date` is a legacy mirror and is
 * read nowhere below — a rescheduled lesson is counted in the month it was
 * actually taught, which is the rule Attendance already states.
 *
 * THE HEADLINE IS `No data`, NOT `0%`, WHEN NOTHING WAS RECORDED.
 * `attendanceRate` returns 0 for an empty denominator, which is the right answer
 * to "what is the rate" and the wrong thing to print — so the denominator is
 * taken from `AttendanceMonthSummary.entries`, which the index already publishes
 * for exactly this purpose ("0 means no data yet"). Nothing is recomputed; a
 * figure the domain supplies is simply not shown as a claim it did not make.
 *
 * ROWS ARE PER CLASS STUDIO-WIDE AND PER STUDENT WITHIN A CLASS, because that is
 * what the owning domain canonically supplies at each level: `byClass` is the
 * index's own list — and it already omits a class with no register rather than
 * showing it at 0% — and `studentAttendanceRate` is the per-person helper. No
 * per-class figure is assembled from per-student ones or the reverse. */
export function buildAttendanceSummaryBody(
  month: string,
  data: AttendanceReportInput,
  appClock: string,
  scope: ReportScope
): ReportBody {
  const index = buildAttendanceIndex(
    { classes: data.classes, students: data.students, lessons: data.lessons, attendance: data.attendance },
    month,
    appClock
  );

  /* ---- one student -------------------------------------------------------
   * The only branch whose helper returns coverage, which is why coverage
   * appears here and nowhere else. */
  if (scope.studentId) {
    const s = studentAttendanceRate(scope.studentId, month, data);
    return {
      empty: s.total === 0,
      summary: [
        { label: "Attendance rate", value: percent(s.pct) },
        { label: "Registers taken", value: count(s.registersTaken) },
      ],
      columns: [{ key: "student", label: "Student", align: "left" }, RATE_COL],
      rows: s.total === 0 ? [] : [{
        key: scope.studentId,
        cells: [text(scope.studentName ?? ""), percent(s.pct)],
      }],
      coverage: { registersTaken: s.registersTaken, lessonsCompleted: s.lessonsCompleted },
    };
  }

  /* ---- one class: the index's own rate for it, and its roster ------------ */
  if (scope.classId) {
    const klass = data.classes.find((c) => c.id === scope.classId);
    const entry = index.byClass.find((c) => c.classId === scope.classId);
    // A class absent from `byClass` has no stored register this month. That is
    // `No data`, and the index has already decided it — not a 0% here.
    const rate = entry ? entry.rate : null;
    const roster = resolveRoster(klass?.studentIds, data.students);
    const rows = roster
      .map((r) => ({ r, m: studentAttendanceRate(r.id, month, data) }))
      .filter((x) => x.m.total > 0)
      .map((x) => ({ key: x.r.id, cells: [text(x.r.name), percent(x.m.pct)] }));

    return {
      empty: rate === null,
      summary: [{ label: "Attendance rate", value: percent(rate) }],
      columns: [{ key: "student", label: "Student", align: "left" }, RATE_COL],
      rows,
    };
  }

  /* ---- studio-wide ------------------------------------------------------- */
  const hasData = index.summary.entries > 0;
  return {
    empty: !hasData,
    summary: [
      { label: "Attendance rate", value: percent(hasData ? index.summary.rate : null) },
      { label: "Registers taken", value: count(index.summary.entries) },
    ],
    columns: [{ key: "class", label: "Class", align: "left" }, RATE_COL],
    rows: index.byClass.map((c) => ({
      key: c.classId,
      cells: [text(c.name), percent(c.rate)],
    })),
  };
}

/* ================================================================== homework */

const DONE_COL: ReportColumn = { key: "completion", label: "Homework completion", align: "right" };

/** Homework Summary — delegated to `studentHomeworkCompletion`, per student.
 *
 * THE DUE DATE OWNS THE MONTH. An assignment's creation date and the day it was
 * marked are read nowhere: `studentHomeworkCompletion` selects on `dueDate`, and
 * a date passing settles nothing, so nothing here becomes Late or Missing on its
 * own.
 *
 * `Completed` AND `Late` ARE DONE; `Missing` IS NOT; `Assigned` IS EXCLUDED
 * ENTIRELY — the helper's rules, not restated here. A student with no eligible
 * outcome has `pct: null` and renders `No data` rather than 0%, which is the
 * domain saying it has nothing to measure rather than that nothing was done.
 *
 * PER STUDENT AT EVERY SCOPE, unlike Attendance. Homework's owning module
 * publishes a per-student helper and no per-class list, and Reports does not
 * assemble one: where the domain supplies no figure, Reports shows none. */
export function buildHomeworkSummaryBody(
  month: string,
  monthHomework: Homework[],
  students: readonly { id: string; name: string }[]
): ReportBody {
  // PRECONDITION, AND IT IS THE SERVICE'S: `monthHomework` is already the scope —
  // the query selects on `dueDate` within the month and on the class where the
  // report has one. So an empty array means the month genuinely holds no
  // assignment, which is a fact from the query rather than a month rule restated
  // here. The two helpers below filter by due-date month again on their own, so
  // a caller that passes a wider set still gets the right figures; only `empty`
  // depends on the scoping having been done.
  const homework = monthHomework;
  const empty = homework.length === 0;

  // The scope's own figure, from the aggregate helper, over the bills-equivalent
  // set the caller chose. It counts every stored outcome including those of
  // students who no longer exist, which is the Homework ghost rule and the
  // reason it can exceed what the rows below can attribute.
  //
  // AN ALL-`Assigned` MONTH REPORTS THE HELPER'S OWN 0. `Assigned` is excluded
  // from the measure entirely, so such a month has an empty denominator and the
  // helper's 0 is its fallback rather than a claim — but Homework publishes no
  // denominator on its aggregate, and manufacturing one here to convert that 0
  // into `No data` would be Reports inventing a figure the domain does not
  // supply. Correcting a domain on read is exactly what is forbidden. Per
  // student the domain DOES say `null`, and the rows carry it.
  const rate = empty ? null : homeworkCompletion(month, { homework });

  const rows = students
    .map((s) => ({ s, m: studentHomeworkCompletion(s.id, month, { homework }) }))
    .filter((x) => x.m.total > 0);

  return {
    empty,
    summary: [
      { label: "Homework completion", value: percent(rate) },
      { label: "Students", value: count(rows.length) },
    ],
    columns: [{ key: "student", label: "Student", align: "left" }, DONE_COL],
    rows: rows.map((x) => ({ key: x.s.id, cells: [text(x.s.name), percent(x.m.pct)] })),
  };
}
