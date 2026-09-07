/* Reports — the DB-bound service.
 *
 * Every database access Reports makes lives in this file, and every DECISION it
 * acts on lives in src/lib/reports.ts or in the domain that owns the figure. The
 * split is the one finance-service.ts and reviews-service.ts already draw.
 *
 * ============================================================================
 * A REPORT IS A READ. `buildReport` performs ZERO writes — no Student, Parent,
 * Class, Lesson, Attendance, Homework, Review, Billing or Activity document is
 * created, updated or deleted by it, and it creates no index. It advances no
 * lesson lifecycle, reconciles nothing, generates no lesson and generates no
 * bill. There is no cache, no stored report and no generated file: the payload
 * is built per request and thrown away.
 *
 * THIS IS DELIBERATELY UNLIKE `/api/dashboard`, which calls
 * `advanceLessonLifecycle()` before computing and is therefore a GET that
 * performs a `bulkWrite`. That call is correct where it is — without it a lesson
 * whose date has passed would never resolve — but it must not be copied here.
 * Reports reports on what the owning domains have already settled; it is not the
 * thing that settles them. `/api/finance` and `/api/reviews/composer` state the
 * same invariant, and there are tests asserting the absence of every write verb
 * and every lifecycle import from this module.
 * ============================================================================
 *
 * NO `repo.getAll()`. That helper pulls every document in nine collections to
 * answer one screen. Every query below is scoped to the report being built: a
 * revenue report reads no bill, a payment report reads no lesson, and a homework
 * report reads neither.
 *
 * THE APPLICATION MONTH IS `CURRENT_MONTH`, read here and passed DOWN into the
 * pure module as an argument, exactly as finance-service.ts does. `new Date()`
 * appears nowhere, so no second source of time can disagree with the app clock,
 * and `FINANCE_MONTHS` — the seed's billing window — is never consulted.
 */

import "server-only";
import { dbConnect } from "./db";
import {
  AttendanceModel, BillingModel, ClassModel, HomeworkModel, LessonModel,
  ParentModel, StudentModel,
} from "./models";
import {
  REPORT_TITLE, STUDIO_SCOPE, checkReportScope, reportMonthOptions,
  buildAttendanceSummaryBody, buildClassRevenueBody, buildHomeworkSummaryBody,
  buildMonthlyRevenueBody, buildStudentPaymentBody,
  type ReportBody, type ReportOptions, type ReportPayload, type ReportScope,
  type ReportType, type ReportViolation,
} from "./reports";
import { resolveRoster } from "./attendance";
import { shiftMonth } from "./reviews";
import { CURRENT_MONTH, TODAY_ISO } from "./constants";
import type {
  AttendanceRecord, Billing, Homework, Klass, Lesson, Parent, Student,
} from "./types";

const clean = "-_id -__v";

/** Half-open date range covering one month, for a `Lesson.date` or `dueDate`
 * query. The same shape finance-service.ts uses. */
function monthRange(month: string): { gte: string; lt: string } {
  const after = shiftMonth(month, 1) ?? month;
  return { gte: `${month}-01`, lt: `${after}-01` };
}

export interface ReportRequest {
  type: ReportType;
  month: string;
  classId: string | null;
  studentId: string | null;
}

export type ReportResult =
  | { ok: true; payload: ReportPayload }
  | { ok: false; violation: ReportViolation };

/* ====================================================== scope resolution */

/** Turn the requested ids into a scope, or refuse.
 *
 * A CLASS OR STUDENT THAT DOES NOT RESOLVE IS A 404, and it is the SAME 404 a
 * guessed id gets — no distinct reason, because a distinct error would advertise
 * the existence of a record nobody may see (PROJECT_RULES, Reports).
 *
 * WHERE BOTH ARE GIVEN, the student must be on that class's CURRENTLY RESOLVABLE
 * roster, resolved through `resolveRoster` — the one roster interpretation this
 * codebase has. A roster id with no Student document is simply absent from it;
 * it is not repaired, not reported and not written back, so an unresolvable id
 * can never become a scope and can never reach a payload.
 *
 * STUDENT STATUS IS NOT CONSULTED. Archived students are still on rosters, still
 * owe February and were still in the room; the owning domains decide what to do
 * with them, and Reports adds no status filter of its own. */
async function resolveScope(
  classId: string | null,
  studentId: string | null
): Promise<{ ok: true; scope: ReportScope } | { ok: false; violation: ReportViolation }> {
  if (!classId && !studentId) return { ok: true, scope: STUDIO_SCOPE };

  const klass = classId
    ? await ClassModel.findOne({ id: classId }).select("id name studentIds -_id")
      .lean<Pick<Klass, "id" | "name" | "studentIds">>()
    : null;
  if (classId && !klass) return { ok: false, violation: "class-missing" };

  const student = studentId
    ? await StudentModel.findOne({ id: studentId }).select("id name -_id")
      .lean<Pick<Student, "id" | "name">>()
    : null;
  if (studentId && !student) return { ok: false, violation: "student-missing" };

  if (klass && student) {
    // The class's own roster, resolved. `resolveRoster` wants whole Students; the
    // membership question needs only the ids, so the selected student is the
    // only document it is given — a roster id that is not theirs resolves to
    // nothing and the check fails, which is the answer either way.
    const roster = resolveRoster(klass.studentIds, [student as Student]);
    if (!roster.some((r) => r.id === student.id)) {
      return { ok: false, violation: "student-not-in-class" };
    }
    return {
      ok: true,
      scope: {
        kind: "student-in-class",
        classId: klass.id, className: klass.name,
        studentId: student.id, studentName: student.name,
      },
    };
  }

  if (klass) {
    return {
      ok: true,
      scope: {
        kind: "class",
        classId: klass.id, className: klass.name, studentId: null, studentName: null,
      },
    };
  }

  return {
    ok: true,
    scope: {
      kind: "student",
      classId: null, className: null,
      studentId: student!.id, studentName: student!.name,
    },
  };
}

/* =========================================================== the read model */

/** One report, in one read.
 *
 * WRITES NOTHING. See the invariant at the head of this file.
 *
 * A well-formed month with no data returns a well-formed EMPTY payload rather
 * than an error or a 404: the route validates the SHAPE of the month, and a
 * month holding nothing is a legitimate empty state, not a fault. */
export async function buildReport(
  req: ReportRequest,
  appMonth: string = CURRENT_MONTH
): Promise<ReportResult> {
  const shape = checkReportScope(req.type, req.classId, req.studentId);
  if (!shape.ok) return shape;

  await dbConnect();

  const resolved = await resolveScope(req.classId, req.studentId);
  if (!resolved.ok) return resolved;
  const scope = resolved.scope;

  const body = await buildBody(req.type, req.month, scope);
  const options = await selectorOptions(scope);

  return {
    ok: true,
    payload: {
      ...body,
      type: req.type,
      title: REPORT_TITLE[req.type],
      month: req.month,
      months: reportMonthOptions(appMonth),
      appClock: TODAY_ISO,
      scope,
      options,
    },
  };
}

/** What the class and student selectors may offer for this scope.
 *
 * THE ROSTER FILTER IS THE SERVER'S. A class's student options are that class's
 * `studentIds` put through `resolveRoster` — the one roster interpretation this
 * codebase has — so an id with no Student document is simply absent, in the
 * class's own order. The client is handed a list; it never resolves a roster,
 * because it cannot, and approximating one from ids it happens to hold would be
 * a second interpretation.
 *
 * NO STATUS FILTER. Trial, Paused and Archived students are on rosters and are
 * offered; the owning domains decide what their figures mean. */
async function selectorOptions(scope: ReportScope): Promise<ReportOptions> {
  const classes = await ClassModel.find({}).select("id name studentIds -_id")
    .lean<Pick<Klass, "id" | "name" | "studentIds">[]>();

  const rosterIds = scope.classId
    ? (classes.find((c) => c.id === scope.classId)?.studentIds ?? [])
    : classes.flatMap((c) => c.studentIds ?? []);
  const wanted = [...new Set(rosterIds.filter(Boolean))];

  const docs = wanted.length === 0
    ? []
    : await StudentModel.find({ id: { $in: wanted } }).select(clean).lean<Student[]>();

  return {
    classes: classes.map((c) => ({ id: c.id, name: c.name })),
    students: resolveRoster(rosterIds, docs).map((s) => ({ id: s.id, name: s.name })),
  };
}

/** The dispatcher. One branch per report type, each loading only what its own
 * owning domain needs — so a revenue report never touches `billings` and a
 * payment report never touches `lessons`. That is not an optimisation: it is
 * what makes it impossible for one report body to mix Billing and Revenue. */
async function buildBody(type: ReportType, month: string, scope: ReportScope): Promise<ReportBody> {
  switch (type) {
    case "monthly-revenue":
      return buildMonthlyRevenueBody(month, await revenueInput(month));
    case "class-revenue":
      return buildClassRevenueBody(month, await revenueInput(month), scope.classId);
    case "student-payment":
      return buildStudentPaymentBody(...(await billingInput(month, scope)));
    case "attendance-summary":
      return buildAttendanceSummaryBody(month, await revenueInput(month), TODAY_ISO, scope);
    case "homework-summary":
      return buildHomeworkSummaryBody(month, ...(await homeworkInput(month, scope)));
  }
}

/* ------------------------------------------------------- per-domain reads */

/** Classes, students, the month's lessons and their registers.
 *
 * NO BILL IS READ HERE, and the returned shape has no room for one — the same
 * guarantee `computeRevenue`'s signature gives. Attendance uses this input too:
 * both are lesson-derived and both are owned by `Lesson.date`.
 *
 * Students are everyone the rosters name. `computeRevenue` resolves membership
 * against exactly the roster ids that exist, so passing those gives the identical
 * result to passing the whole collection. */
async function revenueInput(month: string): Promise<{
  classes: Klass[]; students: Student[]; lessons: Lesson[]; attendance: AttendanceRecord[];
}> {
  const span = monthRange(month);
  const lessons = await LessonModel.find({ date: { $gte: span.gte, $lt: span.lt } })
    .select("id classId type date start status chargeable duration classroom -_id")
    .lean<Lesson[]>();

  const classes = await ClassModel.find({}).select(clean).lean<Klass[]>();

  const rosterIds = [...new Set(classes.flatMap((c) => c.studentIds ?? []).filter(Boolean))];
  const students = rosterIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: rosterIds } }).select(clean).lean<Student[]>();

  const lessonIds = lessons.map((l) => l.id);
  const attendance = lessonIds.length === 0
    ? []
    : await AttendanceModel.find({ lessonId: { $in: lessonIds } })
      .select("lessonId entries -_id").lean<AttendanceRecord[]>();

  return { classes, students, lessons, attendance };
}

/** The scope's bills, and just enough of the people and classes they name.
 *
 * NO LESSON IS READ HERE. Tuition is owned by `Billing.month` and has no join to
 * teaching; a bill carries no `lessonId` and this query carries no lesson.
 *
 * `Billing.month` IS THE FILTER, never `paidDate`. A payment received in August
 * against July's tuition belongs to July's report, because the bill has a month
 * rather than a deadline.
 *
 * PARENTS: EXISTENCE ONLY. Only ids come back. A parent's name, phone and email
 * are not a report's business and never reach a client — "is there somebody to
 * talk to about this bill" is a boolean. */
async function billingInput(
  month: string,
  scope: ReportScope
): Promise<[Billing[], { students: Student[]; classes: Klass[]; livingParentIds: Set<string> }]> {
  const query: Record<string, unknown> = { month };
  if (scope.classId) query.classId = scope.classId;
  if (scope.studentId) query.studentId = scope.studentId;

  const bills = await BillingModel.find(query).select(clean).lean<Billing[]>();

  const studentIds = [...new Set(bills.map((b) => b.studentId).filter(Boolean))];
  const classIds = [...new Set(bills.map((b) => b.classId).filter(Boolean))];

  const students = studentIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: studentIds } }).select(clean).lean<Student[]>();
  const classes = classIds.length === 0
    ? []
    : await ClassModel.find({ id: { $in: classIds } }).select(clean).lean<Klass[]>();

  const parentIds = [...new Set(students.map((s) => s.parentId).filter(Boolean))];
  const livingParentIds = new Set(
    parentIds.length === 0
      ? []
      : (await ParentModel.find({ id: { $in: parentIds } }).select("id -_id")
        .lean<Pick<Parent, "id">[]>()).map((p) => p.id)
  );

  return [bills, { students, classes, livingParentIds }];
}

/** The month's assignments and the students a row may name.
 *
 * THE DUE DATE IS THE FILTER. `createdAt` is neither queried nor selected, and
 * nothing here consults today's date: a date passing settles nothing, and an
 * assignment belongs to the month of its due date whether or not that month has
 * arrived.
 *
 * The assignments are scoped by class where the report is; the STUDENT scope is
 * applied by the per-student helper rather than by the query, because a
 * class-scoped assignment addressed to a roster including that student is
 * relevant to them and is not a document about them. */
async function homeworkInput(
  month: string,
  scope: ReportScope
): Promise<[Homework[], { id: string; name: string }[]]> {
  const span = monthRange(month);
  const query: Record<string, unknown> = { dueDate: { $gte: span.gte, $lt: span.lt } };
  if (scope.classId) query.classId = scope.classId;

  const homework = await HomeworkModel.find(query)
    .select("id classId scope studentId dueDate status submissions -_id").lean<Homework[]>();

  // One named student, or the resolvable roster of the classes in scope. Never a
  // roster id that resolves to nothing: `resolveRoster` omits it, and an omitted
  // id cannot become a row.
  if (scope.studentId) {
    const s = await StudentModel.findOne({ id: scope.studentId }).select("id name -_id")
      .lean<Pick<Student, "id" | "name">>();
    return [homework, s ? [{ id: s.id, name: s.name }] : []];
  }

  const classQuery = scope.classId ? { id: scope.classId } : {};
  const classes = await ClassModel.find(classQuery).select("id studentIds -_id")
    .lean<Pick<Klass, "id" | "studentIds">[]>();
  const rosterIds = [...new Set(classes.flatMap((c) => c.studentIds ?? []).filter(Boolean))];
  const students = rosterIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: rosterIds } }).select(clean).lean<Student[]>();

  return [homework, resolveRoster(rosterIds, students).map((r) => ({ id: r.id, name: r.name }))];
}
