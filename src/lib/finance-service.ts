/* Finance — the DB-bound service.
 *
 * Every Billing database access in the application lives in this file, and every
 * DECISION it acts on lives in src/lib/billing.ts (tuition) or src/lib/finance.ts
 * (revenue). The split is the one Attendance, Homework and Reviews already draw,
 * for the same reason: "what does this total, and which keys does this write?" is
 * only provably correct if it is computed somewhere a test can reach without a
 * database in the loop.
 *
 * ============================================================================
 * A FINANCE READ IS A READ. `buildFinanceMonth` performs ZERO writes — no
 * Billing, Student, Parent, Class, Lesson, Attendance, Homework, Review or
 * Activity document is created, updated or deleted by it, and it creates no
 * index. It advances no lesson lifecycle, reconciles nothing, generates no
 * lesson and generates no bill.
 *
 * THIS IS DELIBERATELY UNLIKE `/api/dashboard`, which calls
 * `advanceLessonLifecycle()` before computing and is therefore a GET that
 * writes. That call is correct where it is — without it a lesson whose date has
 * passed would never resolve and revenue would sit at zero — but it must not be
 * copied here. Finance reports on what the lesson domain has already settled; it
 * is not the thing that settles it. `/api/reviews/composer` states the same
 * invariant for the same reason, and there are tests asserting the absence of
 * every write verb and every lifecycle import from this module.
 * ============================================================================
 *
 * WHAT THIS MODULE MAY WRITE: `BillingModel`, on `recordPayment`, and nothing
 * else, ever. ONE WRITE VERB, USED ONCE: a single `updateOne` with a `$set` of
 * at most four planned keys and a `$unset` of at most one. No `create`, no
 * `insertMany`, no `deleteOne`, no `deleteMany`, no `updateMany`, no
 * `replaceOne`, no `bulkWrite`, no upsert. Sprint 9 raises no bill and removes
 * none: there is no generation rule yet, and deleting a bill destroys financial
 * history.
 *
 * NO `repo.getAll()`. That helper pulls every document in nine collections to
 * answer one screen — for Finance it would fetch 312 lessons and 152 registers
 * to report on one month. Every query below is scoped to the month, or to the
 * ids the month actually referenced.
 *
 * THE APPLICATION MONTH IS `CURRENT_MONTH`, read here and passed DOWN into the
 * pure helpers as an argument, exactly as `reviews-service.ts` does. `new Date()`
 * appears nowhere, so no second source of time can disagree with the app clock.
 *
 * GHOSTS ARE COUNTED AND NOT NAMED. Every aggregate totals every bill the month
 * holds, including bills whose student no longer exists, because a deletion must
 * not move a closed month's reported figures. No ghost id, name or former parent
 * ever reaches the client; only `hiddenRecords` does, which is the number the
 * design's "+N more" affordance renders.
 *
 * NOTHING IS NORMALISED. A bill's fee is a historical snapshot and is summed
 * exactly as stored, even where it disagrees with its class's fee today.
 */

import "server-only";
import { dbConnect } from "./db";
import {
  BillingModel, ClassModel, LessonModel, AttendanceModel, ParentModel, StudentModel,
} from "./models";
import {
  buildBillingBranch, checkPaymentWrite, collectedFor, outstandingFor,
  type BillingRow, type FinanceBillingBranch, type PaymentViolation,
} from "./billing";
import { computeRevenue } from "./finance";
import { shiftMonth } from "./reviews";
import { CURRENT_MONTH, TODAY_ISO } from "./constants";
import type { BillingPaymentBody } from "./schemas";
import type {
  AttendanceRecord, Billing, Klass, Lesson, Parent, RevenueResult, Student,
} from "./types";

const clean = "-_id -__v";

/** Months the reporting window spans, and months the trend chart spans. The
 * first is the Reviews rule reused verbatim (see `financeMonthOptions`); the
 * second is the design comp's own "Last 6 months". */
export const FINANCE_MONTH_WINDOW = 12;
export const FINANCE_TREND_MONTHS = 6;

/* =========================================================== the month window */

/** The reportable months: the application month plus the previous eleven,
 * newest first.
 *
 * THE SERVER OWNS THIS. The client computes no month — it renders the list it is
 * given and sends one back, exactly as the Reviews composer does. A window
 * computed in a browser would be computed against the browser's clock, which is
 * not this application's clock.
 *
 * `FINANCE_MONTHS` in constants.ts is NOT used. That constant is the seed's
 * billing window; it happens to match production today, and treating a seed
 * artefact as a runtime reporting contract would freeze the app to the demo data.
 *
 * A month in the window with no bills is EMPTY, not absent — the design has its
 * own empty state and a missing month would be a different, wrong claim. */
export function financeMonthOptions(appMonth: string = CURRENT_MONTH): string[] {
  const months: string[] = [];
  for (let back = 0; back < FINANCE_MONTH_WINDOW; back++) {
    const month = shiftMonth(appMonth, -back);
    if (month) months.push(month);
  }
  return months;
}

/** The six months ending at `month`, oldest first — the trend's x-axis. */
function trendMonths(month: string): string[] {
  const months: string[] = [];
  for (let back = FINANCE_TREND_MONTHS - 1; back >= 0; back--) {
    const m = shiftMonth(month, -back);
    if (m) months.push(m);
  }
  return months;
}

/** First day of `month`, and first day of the month after it — the half-open
 * range an ISO date string compares against. String comparison is total on
 * "YYYY-MM-DD" and needs no Date object, which is also why no timezone can move
 * a lesson between months here. */
function dateRange(fromMonth: string, toMonth: string): { gte: string; lt: string } {
  const after = shiftMonth(toMonth, 1) ?? toMonth;
  return { gte: `${fromMonth}-01`, lt: `${after}-01` };
}

/* ================================================================= the DTO
 *
 * The tuition branch's shape and shaping both live in src/lib/billing.ts, so a
 * test can assert the ghost rule without a database. This module fetches. */

export interface FinanceRevenueBranch extends Omit<RevenueResult, "perClass"> {
  /** `computeRevenue`'s own rows plus the class's display colour.
   *
   * THE COLOUR IS A JOIN, NOT A CALCULATION. `computeRevenue` returns
   * `{ classId, name, amount }` and is left exactly as it is — a revenue engine
   * has no business knowing what colour a chart draws a class in. The class
   * documents are already in hand for the computation, so the swatch is attached
   * here rather than by widening the engine's return type. */
  perClass: (RevenueResult["perClass"][number] & { color: string })[];
  /** Lesson-derived revenue per month, six months ending at the selected one. */
  trend: { month: string; total: number }[];
}

export interface FinanceMonthPayload {
  month: string;
  /** The application day, so the client renders no clock of its own. */
  appClock: string;
  /** The reportable window, newest first. Server-owned. */
  months: string[];
  /** Tuition asked for and received. Never called revenue. */
  billing: FinanceBillingBranch;
  /** Money earned by teaching. The only branch that uses the word. */
  revenue: FinanceRevenueBranch;
}

/* ========================================================== the read model */

/** Everything one month of the Finance screen needs, in one read.
 *
 * WRITES NOTHING. See the invariant at the head of this file.
 *
 * A month outside the reportable window still returns a well-formed empty
 * payload rather than an error: the route validates the SHAPE of the month, and
 * a month with no bills is a legitimate empty state, not a fault. */
export async function buildFinanceMonth(
  month: string,
  appMonth: string = CURRENT_MONTH
): Promise<FinanceMonthPayload> {
  await dbConnect();

  /* ---- 1. the month's bills, and the ids they reference ------------------ */
  const bills = await BillingModel.find({ month }).select(clean).lean<Billing[]>();

  const billStudentIds = [...new Set(bills.map((b) => b.studentId).filter(Boolean))];
  const billClassIds = [...new Set(bills.map((b) => b.classId).filter(Boolean))];

  /* ---- 2. the lesson window the revenue trend spans ----------------------
   * Six months ending at the selected one, so the trend and the selected
   * month's own figure come from ONE query rather than six. */
  const window = trendMonths(month);
  const span = dateRange(window[0] ?? month, month);
  const lessons = await LessonModel.find({ date: { $gte: span.gte, $lt: span.lt } })
    .select("id classId type date status chargeable duration -_id")
    .lean<Lesson[]>();

  const lessonClassIds = [...new Set(lessons.map((l) => l.classId).filter(Boolean))];
  const classIds = [...new Set([...billClassIds, ...lessonClassIds])];

  const classes = classIds.length === 0
    ? []
    : await ClassModel.find({ id: { $in: classIds } }).select(clean).lean<Klass[]>();

  /* Students: everyone a roster names, plus everyone a bill names. The first set
   * is what `computeRevenue` resolves membership against; passing exactly the
   * roster ids that exist gives the identical result to passing the whole
   * collection, because that is the filter it applies itself. */
  const rosterIds = classes.flatMap((c) => c.studentIds ?? []);
  const studentIds = [...new Set([...rosterIds, ...billStudentIds].filter(Boolean))];
  const students = studentIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: studentIds } }).select(clean).lean<Student[]>();

  const lessonIds = lessons.map((l) => l.id);
  const attendance = lessonIds.length === 0
    ? []
    : await AttendanceModel.find({ lessonId: { $in: lessonIds } })
      .select("lessonId entries -_id")
      .lean<AttendanceRecord[]>();

  /* ---- 3. parents: EXISTENCE ONLY ---------------------------------------
   * Only the ids come back. A parent's name, phone and email are not Finance's
   * business and never reach the client — the screen answers "is there a parent
   * to talk to about this bill", which is a boolean. */
  const parentIds = [...new Set(students.map((s) => s.parentId).filter(Boolean))];
  const livingParentIds = new Set(
    parentIds.length === 0
      ? []
      : (await ParentModel.find({ id: { $in: parentIds } }).select("id -_id")
        .lean<Pick<Parent, "id">[]>()).map((p) => p.id)
  );

  /* ---- 4. tuition, shaped by the pure module -----------------------------
   * The totals see every bill including ghosts; the lists see only the bills
   * whose student resolves; the gap is `hiddenRecords`. All of that is
   * `buildBillingBranch`'s decision, not this module's. */
  const billing = buildBillingBranch(bills, { students, classes, livingParentIds });

  /* ---- 5. revenue, lesson-derived and independent ------------------------
   * `computeRevenue` is called once per month in the window. It reads classes,
   * students, lessons and attendance — and no bill; its signature cannot carry
   * one. */
  const revenueInput = { classes, students, lessons, attendance };
  const selected = computeRevenue(month, revenueInput);
  const trend = window.map((m) => ({ month: m, total: computeRevenue(m, revenueInput).total }));

  const classColorById = new Map(classes.map((c) => [c.id, c.color]));

  return {
    month,
    appClock: TODAY_ISO,
    months: financeMonthOptions(appMonth),
    billing,
    revenue: {
      ...selected,
      // A display join over the engine's own rows. Amount, name and order are
      // `computeRevenue`'s and are passed through untouched.
      perClass: selected.perClass.map((r) => ({
        ...r,
        color: classColorById.get(r.classId) || "var(--accent)",
      })),
      trend,
    },
  };
}

/* ====================================================== the payment write */

/** Success, or the refusal a route renders through `PAYMENT_ERROR`.
 *
 * A missing bill and a ghost bill both surface as `bill-missing`, which is the
 * one 404 in the map; every other violation is a 422 about the payload. */
export type PaymentOpResult =
  | { ok: true; row: BillingRow }
  | { ok: false; violation: PaymentViolation };

/** Record a payment against one existing bill.
 *
 * THE ONLY WRITE IN FINANCE. One `updateOne` on `BillingModel`, touching at most
 * `status`, `paidAmount`, `paidDate` and `notes`. No Student, Parent, Class,
 * Lesson, Attendance, Homework, Review or Activity document is written, no
 * lifecycle is advanced, nothing is reconciled or generated, and `Student.balance`
 * is neither read nor written — outstanding tuition is derived on demand and a
 * stored copy would be a second answer free to drift from the first.
 *
 * NO CREATE AND NO DELETE. This function updates a bill that exists; there is no
 * sibling that raises one or removes one, because Sprint 9 has no generation rule
 * and a bill is a financial record.
 *
 * A GHOST BILL IS REFUSED WITH THE SAME ANSWER A MISSING ONE GETS. What the
 * index omits, the system refuses to edit — and a distinct error would advertise
 * that a hidden record exists (PROJECT_RULES, Billing). The two branches below
 * return the identical `not_found`, and there is a test asserting the responses
 * are indistinguishable.
 *
 * STUDENT STATUS DOES NOT GATE THIS, and neither does class status. A Trial,
 * Paused or Archived student's tuition is still owed and still settleable;
 * archiving a person does not forgive their February. What is refused is a
 * student who does not resolve AT ALL, which is the ghost rule above and not a
 * statement about status.
 *
 * OWNERSHIP IS UNREACHABLE. `id`, `studentId`, `classId`, `month` and `fee` are
 * absent from the schema's accepted keys and from `checkPaymentWrite`'s output,
 * so no code path exists that could change one. The update's filter names the
 * bill by `id` and the `$set` is built from the planned write alone. */
export async function recordPayment(
  billId: string,
  input: BillingPaymentBody,
  appClock: string = TODAY_ISO
): Promise<PaymentOpResult> {
  await dbConnect();

  const bill = await BillingModel.findOne({ id: billId }).select(clean).lean<Billing>();
  if (!bill) return { ok: false, violation: "bill-missing" };

  // A bill whose student no longer resolves is unreachable, and says so with the
  // IDENTICAL answer a missing bill gets — same violation, same status, same
  // sentence. A distinct one would advertise that the record is there.
  const student = await StudentModel.findOne({ id: bill.studentId }).select(clean).lean<Student>();
  if (!student) return { ok: false, violation: "bill-missing" };

  const checked = checkPaymentWrite(input, bill, appClock);
  if (!checked.ok) return { ok: false, violation: checked.violation };

  const { write } = checked;
  const set: Partial<Billing> = {
    status: write.status,
    paidDate: write.paidDate,
    notes: write.notes ?? "",
  };
  // `paidAmount` is stored ONLY on a partial. Every other status removes it
  // rather than writing a zero, because absent and zero mean different things.
  const update = write.paidAmount === undefined
    ? { $set: set, $unset: { paidAmount: "" } }
    : { $set: { ...set, paidAmount: write.paidAmount } };

  await BillingModel.updateOne({ id: billId }, update);

  const after = await BillingModel.findOne({ id: billId }).select(clean).lean<Billing>();
  if (!after) return { ok: false, violation: "bill-missing" };

  const klass = await ClassModel.findOne({ id: after.classId })
    .select("id name color -_id").lean<Pick<Klass, "id" | "name" | "color">>();
  const parentLinked = !!student.parentId &&
    (await ParentModel.countDocuments({ id: student.parentId })) > 0;

  return {
    ok: true,
    row: {
      billId: after.id,
      studentId: after.studentId,
      studentName: student.name,
      initials: student.initials,
      avatarColor: student.avatarColor,
      classId: after.classId,
      className: klass?.name ?? after.classId,
      classColor: klass?.color ?? "var(--accent)",
      fee: after.fee,
      status: after.status,
      paidAmount: typeof after.paidAmount === "number" ? after.paidAmount : null,
      collected: collectedFor(after),
      outstanding: outstandingFor(after),
      paidDate: after.paidDate ?? null,
      notes: after.notes ?? "",
      parentLinked,
    },
  };
}
