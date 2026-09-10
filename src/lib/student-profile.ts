/* Student Profile — the Attendance and Homework tabs' read models (Sprint 13).
 *
 * PURE. No database, no React, no fetch, no storage, no clock. Everything this
 * file needs arrives as an argument, exactly as `reports.ts` receives a month's
 * data, so every rule below is testable without a browser or an Atlas
 * connection. The two services hand it what they read; it decides nothing about
 * where that data came from.
 *
 * IT OWNS NO COUNTING RULE, AND THAT IS THE POINT. The attendance percentage is
 * `studentAttendanceRate` and the homework completion percentage is
 * `studentHomeworkCompletion` — the shipped helpers in src/lib/finance.ts that
 * Reports and the Reviews learning journey have both been reading since Sprint
 * 8. They are CALLED here, never re-expressed, because the Student Profile shows
 * these figures on one tab while the Reviews tab shows the monthly ones on
 * another, and the same fact must not appear as two different numbers. A second
 * copy of the formula is exactly how that happens.
 *
 * WHY A COMPOSING MODULE RATHER THAN AN ADDITION TO ANY OF THEM. Three banked
 * guards seal the files this could otherwise have lived in, and each is right:
 * `tests/homework.test.ts` #103 pins the pure Homework core to type-only imports
 * from "./types"; `tests/homework-service.test.ts` #42 pins finance's homework
 * exports at exactly two and forbids the Homework service from computing
 * reporting at all; `tests/review-analytics.test.ts` #32 pins finance's two
 * null-returning helpers at two. The precedent for a screen that composes other
 * modules' figures without editing them is `reports.ts` (Sprint 10), and this
 * file follows it. NO BANKED GUARD IS WEAKENED, MOVED OR TOUCHED.
 *
 * READS ONLY. Nothing here writes, repairs, back-fills, reconciles or reports.
 * Opening a student's profile must never mutate a lesson, advance a lifecycle,
 * create a register, record an outcome or normalise a stored value.
 */

import { studentAttendanceRate, studentHomeworkCompletion } from "./finance";
import { shiftMonth } from "./reviews";
import type {
  AttendanceRecord, AttendanceStatus, Homework, HomeworkStatus, Klass, Lesson,
} from "./types";

/* ------------------------------------------------------------------- limits */

/** How many items a timeline renders. PRESENTATION ONLY: the twenty-first item
 * is not mutated, not hidden from any count and not removed from any aggregate —
 * every percentage and every tile below still describes the whole record. */
export const PROFILE_TIMELINE_LIMIT = 20;

/** How many items a "Recent …" side card renders. Presentation only, for the
 * same reason, and the design's own word for those cards is what bounds them. */
export const PROFILE_LIST_LIMIT = 5;

/** Bars on the Monthly attendance chart — the design draws six. */
export const PROFILE_MONTH_WINDOW = 6;

/* --------------------------------------------------------------- attendance */

/** One lesson on the attendance timeline, or in one of the two side cards.
 *
 * `date` IS THE LESSON'S. `AttendanceRecord.date` is a legacy mirror that some
 * stored documents already carry in disagreement with their lesson, and it is
 * never read — a rescheduled lesson appears on the date it was actually taught
 * (PROJECT_RULES, Date ownership). */
export interface StudentAttendanceEntry {
  lessonId: string;
  classId: string;
  className: string;
  /** ISO "YYYY-MM-DD", from `Lesson.date`. */
  date: string;
  status: AttendanceStatus;
  /** Only when one was actually recorded — never invented, never defaulted. */
  note?: string;
}

/** One bar on the Monthly attendance chart. */
export interface StudentAttendanceMonthPoint {
  /** "YYYY-MM". */
  month: string;
  /** `null`, never 0, when this student has no stored entry that month. Those
   * are different facts — "they missed everything" and "nothing was recorded" —
   * and a bar rendered at 0% for the second states an assessment the data never
   * made. The UI draws the design's minimum-height stub and an em dash. */
  rate: number | null;
  attended: number;
  /** This month's stored entries for this student — the rate's denominator. */
  entries: number;
}

export interface StudentAttendancePayload {
  studentId: string;
  /** Present + Late + Excused over every stored entry, as a whole percent, or
   * `null` when nothing was ever recorded. */
  rate: number | null;
  attended: number;
  /** Every stored entry for this student — the rate's denominator. */
  entries: number;
  counts: {
    present: number;
    late: number;
    absent: number;
    excused: number;
  };
  /** Exactly `PROFILE_MONTH_WINDOW` points, OLDEST FIRST, ending at the
   * application's current month — the order the chart draws them. */
  monthly: StudentAttendanceMonthPoint[];
  /** Newest first, capped at `PROFILE_TIMELINE_LIMIT`. */
  timeline: StudentAttendanceEntry[];
  /** `Absent` ONLY, newest first, capped at `PROFILE_LIST_LIMIT`. `Excused` is
   * counted as attended everywhere else in this application, so filing it under
   * absences would contradict a figure a teacher can already see. */
  absences: StudentAttendanceEntry[];
  /** `Late` only, newest first, capped at `PROFILE_LIST_LIMIT`. */
  lates: StudentAttendanceEntry[];
  /** Whether there is a single stored entry at all — the tab's empty state.
   * Derived here so the UI re-derives no domain rule (it is `entries > 0`, but
   * which figure decides the empty state is this module's call, not a
   * component's). */
  hasRecords: boolean;
}

export interface StudentAttendanceInput {
  studentId: string;
  /** Only the classes whose roster names this student. */
  classes: readonly Pick<Klass, "id" | "name">[];
  /** Only lessons of those classes. Non-completed lessons may be present; the
   * shipped helper filters them and so does the tally. */
  lessons: readonly Lesson[];
  attendance: readonly AttendanceRecord[];
  /** The application's current month, "YYYY-MM". Passed in — this module has no
   * clock and Sprint 13 introduces none. */
  appMonth: string;
}

/** Newest first, with the source entity's own id as the final tie-breaker.
 *
 * NEVER THE DATABASE'S ORDER. Two lessons taught on the same day must not swap
 * places between two reads of the same data, so the id decides and the result is
 * the same every time. */
function byDateDescThenId<T extends { date: string; lessonId: string }>(a: T, b: T): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.lessonId < b.lessonId ? -1 : a.lessonId > b.lessonId ? 1 : 0;
}

export function buildStudentAttendance(input: StudentAttendanceInput): StudentAttendancePayload {
  const { studentId, classes, lessons, attendance, appMonth } = input;

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));

  /* Only completed lessons contribute, which is the lesson set the shipped
   * helper uses. A lesson whose class did not resolve is dropped rather than
   * rendered nameless. */
  const completed = new Map<string, Lesson>();
  for (const l of lessons) {
    if (l.status !== "Completed") continue;
    if (!classNameById.has(l.classId)) continue;
    completed.set(l.id, l);
  }

  /* Every stored entry for THIS student, on those lessons. Nothing is invented
   * where no register exists, and no other student's entry is ever read — a
   * deleted student's preserved entries live under their own id and are not
   * reachable from here. */
  const rows: StudentAttendanceEntry[] = [];
  let present = 0, late = 0, absent = 0, excused = 0;

  for (const rec of attendance) {
    const lesson = completed.get(rec.lessonId);
    if (!lesson) continue;
    const entry = rec.entries?.[studentId];
    if (!entry) continue;

    const status = entry.status;
    if (status === "Present") present++;
    else if (status === "Late") late++;
    else if (status === "Absent") absent++;
    else if (status === "Excused") excused++;

    rows.push({
      lessonId: lesson.id,
      classId: lesson.classId,
      className: classNameById.get(lesson.classId) ?? "",
      date: lesson.date, // the Lesson owns the date
      status,
      ...(entry.note ? { note: entry.note } : {}),
    });
  }

  rows.sort(byDateDescThenId);

  /* THE HEADLINE FIGURE IS THE SHIPPED RULE, SUMMED — not a second formula.
   * `studentAttendanceRate` is called once per month the student's lessons
   * actually span, and its numerators and denominators are added. Summing an
   * exact numerator and an exact denominator is exact, so this is the same
   * percentage the Reviews learning journey shows for those months, and the
   * tally above is asserted against it in tests/student-attendance rather than
   * assumed to agree. */
  const lessonMonths = new Set([...completed.values()].map((l) => l.date.slice(0, 7)));
  let attended = 0, entries = 0;
  for (const month of lessonMonths) {
    const r = studentAttendanceRate(studentId, month, { lessons: [...completed.values()], attendance: [...attendance] });
    attended += r.attended;
    entries += r.total;
  }

  /* Six months ending at the application's current month, oldest first. A month
   * the student has no entry in reports `null`, never 0. */
  const monthly: StudentAttendanceMonthPoint[] = [];
  for (let back = PROFILE_MONTH_WINDOW - 1; back >= 0; back--) {
    const month = shiftMonth(appMonth, -back);
    if (month == null) continue;
    const r = studentAttendanceRate(studentId, month, { lessons: [...completed.values()], attendance: [...attendance] });
    monthly.push({ month, rate: r.pct, attended: r.attended, entries: r.total });
  }

  return {
    studentId,
    rate: entries === 0 ? null : Math.round((attended / entries) * 100),
    attended,
    entries,
    counts: { present, late, absent, excused },
    monthly,
    timeline: rows.slice(0, PROFILE_TIMELINE_LIMIT),
    absences: rows.filter((r) => r.status === "Absent").slice(0, PROFILE_LIST_LIMIT),
    lates: rows.filter((r) => r.status === "Late").slice(0, PROFILE_LIST_LIMIT),
    hasRecords: entries > 0,
  };
}

/* ----------------------------------------------------------------- homework */

/** This student's OWN outcome for one assignment, or `null` when the assignment
 * is not addressed to them at all.
 *
 * A CLASS-SCOPED ASSIGNMENT IS READ THROUGH ITS SUBMISSIONS MAP, never through
 * its top-level `status` — that field describes the assignment, and the question
 * here is about a person. A STUDENT-SCOPED one carries its own status and is
 * theirs only when `studentId` names them.
 *
 * NO KEY MEANS NOT THEIRS. Membership is the snapshot taken when the work was
 * set, so a student enrolled afterwards has no key in that map and the
 * assignment is simply not part of their record. Nothing is invented, defaulted
 * to `Assigned`, repaired or written back — a missing key is evidence, not a gap
 * to fill.
 *
 * ASKING FOR ONE STUDENT NEVER SURFACES ANOTHER. Deleted students' preserved
 * submission keys sit under their own ids and are never read here.
 *
 * THIS IS NOT THE COMPLETION RULE. `studentHomeworkCompletion` decides what
 * counts towards a percentage and is stricter — an assignment still `Assigned`
 * at the top level has had no outcome recorded for anybody and is excluded from
 * the measure entirely. These are two different questions and this file asks
 * both, of the one function that owns each. */
export function studentHomeworkOutcome(hw: Homework, studentId: string): HomeworkStatus | null {
  if (hw.scope === "class") return hw.submissions?.[studentId] ?? null;
  return hw.studentId === studentId ? hw.status : null;
}

export interface StudentHomeworkEntry {
  homeworkId: string;
  title: string;
  classId: string;
  className: string;
  scope: "class" | "student";
  /** ISO "YYYY-MM-DD". */
  dueDate: string;
  /** THIS STUDENT'S outcome, never the assignment's own. */
  status: HomeworkStatus;
}

export interface StudentHomeworkPayload {
  studentId: string;
  /** Completed + Late over the assignments the completion measure counts, as a
   * whole percent, or `null` when none of this student's work carries an
   * outcome. Never 0 for "nothing recorded yet". */
  completionRate: number | null;
  done: number;
  /** The completion denominator — `Assigned` excluded entirely. */
  outcomeTotal: number;
  counts: {
    /** EVERY assignment addressed to this student, `Assigned` INCLUDED, because
     * that is the work they were given. It is therefore legitimately LARGER than
     * `completed + late + missing`, exactly as Finance's billed total
     * legitimately exceeds the rows a teacher can act on. That is correct and is
     * not a defect — the two answer different questions. */
    total: number;
    completed: number;
    late: number;
    missing: number;
  };
  /** Newest first by due date, capped at `PROFILE_TIMELINE_LIMIT`. */
  timeline: StudentHomeworkEntry[];
  /** `Missing` only, newest first, capped at `PROFILE_LIST_LIMIT`. */
  missing: StudentHomeworkEntry[];
  /** `Late` only, newest first, capped at `PROFILE_LIST_LIMIT`. */
  late: StudentHomeworkEntry[];
  /** Whether any work is addressed to this student at all — the tab's empty
   * state. A student with work but no outcomes is NOT empty: they see the tab
   * with a `null` ring, because a partial answer is never dressed as an empty
   * one. */
  hasRecords: boolean;
}

export interface StudentHomeworkInput {
  studentId: string;
  classes: readonly Pick<Klass, "id" | "name">[];
  /** Class-scoped work for those classes, plus student-scoped work addressed to
   * this student. Every exclusion below is applied here, not by the query. */
  homework: readonly Homework[];
}

function byDueDateDescThenId<T extends { dueDate: string; homeworkId: string }>(a: T, b: T): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? 1 : -1;
  return a.homeworkId < b.homeworkId ? -1 : a.homeworkId > b.homeworkId ? 1 : 0;
}

export function buildStudentHomework(input: StudentHomeworkInput): StudentHomeworkPayload {
  const { studentId, classes, homework } = input;

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));

  const rows: StudentHomeworkEntry[] = [];
  let total = 0, completed = 0, late = 0, missing = 0;

  for (const hw of homework) {
    const own = studentHomeworkOutcome(hw, studentId);
    if (own == null) continue; // not this student's work — nothing invented

    total++;
    if (own === "Completed") completed++;
    else if (own === "Late") late++;
    else if (own === "Missing") missing++;

    rows.push({
      homeworkId: hw.id,
      title: hw.title,
      classId: hw.classId,
      className: classNameById.get(hw.classId) ?? "",
      scope: hw.scope,
      dueDate: hw.dueDate,
      status: own,
    });
  }

  rows.sort(byDueDateDescThenId);

  /* THE RING IS THE SHIPPED COMPLETION RULE, SUMMED — not a second formula.
   * `studentHomeworkCompletion` owns which assignments count (`Assigned`
   * excluded, class-scoped read through the submissions map, student-scoped only
   * when addressed to this student) and it is called once per due-month, its
   * numerators and denominators added. That is the same measure Reports and the
   * Reviews learning journey read, so the ring cannot drift from them. */
  const dueMonths = new Set(rows.map((r) => r.dueDate.slice(0, 7)));
  let done = 0, outcomeTotal = 0;
  for (const month of dueMonths) {
    const r = studentHomeworkCompletion(studentId, month, { homework: [...homework] });
    done += r.done;
    outcomeTotal += r.total;
  }

  return {
    studentId,
    completionRate: outcomeTotal === 0 ? null : Math.round((done / outcomeTotal) * 100),
    done,
    outcomeTotal,
    counts: { total, completed, late, missing },
    timeline: rows.slice(0, PROFILE_TIMELINE_LIMIT),
    missing: rows.filter((r) => r.status === "Missing").slice(0, PROFILE_LIST_LIMIT),
    late: rows.filter((r) => r.status === "Late").slice(0, PROFILE_LIST_LIMIT),
    hasRecords: total > 0,
  };
}
