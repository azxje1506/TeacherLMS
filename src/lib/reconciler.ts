/* Reconciler — the WRITE side of the recurrence engine (Sprint 5.6.2).
 *
 * This is the only module in the app allowed to UPDATE or DELETE a Regular
 * lesson on the strength of a class's schedule. It owns three things, all from
 * RECURRENCE_DESIGN.md:
 *
 *   1. §6 Phase 0 — the legacy reschedule origin back-fill (mandatory, blocking).
 *   2. §5.7      — write-side reconciliation, triggered by `updateClass` and by
 *                  nothing else (ADR-002 decision 5).
 *   3. §2        — the delete guard: a class that has taught anything may only be
 *                  Archived, never deleted.
 *
 * WHAT IT MAY WRITE, AND WHEN
 * The decision of WHAT to do is not made here. It is made by the pure planner in
 * `src/lib/recurrence.ts`, which this module calls and then EXECUTES. Between the
 * two sits `auditPlan`: every action is re-checked against the design's own
 * safety filters using freshly read data, and a single violation aborts the whole
 * run before one byte is written (§6 Phase 4 — "a lesson is excluded unless it
 * positively proves it is safe to touch"). Aborting writes nothing at all: the
 * plan is a set, not a sequence of independent decisions, and half of one is not
 * a smaller version of it.
 *
 * RETIRE IS STILL REPORT-ONLY in this sprint (§8, 5.6.2). Update and insert are
 * applied; retirements are planned, audited, reported and NOT executed, because
 * retire is a hard delete with no undo and the §6 Phase 1 snapshot belongs to
 * 5.6.3. `RETIRE_ENABLED` is the one line 5.6.4 flips.
 *
 * NO `server-only`. Every other service in `src/lib` declares it; this one cannot,
 * because the maintenance scripts (`npm run lessons:backfill-origins`) run outside
 * the Next runtime where that module does not resolve. Nothing here is imported
 * by a client component, and the Route Handlers reach it only through
 * `src/lib/classes.ts`, which does declare it.
 */

import { dbConnect, isDupKey } from "./db";
import { AttendanceModel, BillingModel, ClassModel, HomeworkModel, LessonModel } from "./models";
import { TODAY_ISO } from "./constants";
import {
  phase0Equivalence, verifyPhase0, verifyPhase0Applied,
  type Phase0Equivalence, type Phase0Item, type Phase0Verification,
} from "./migration";
import {
  freezeReasons, isManuallyEdited, planClass, reconcileContext,
  statusForDate, summarizePlan, windowMonths,
  type PlanAction, type PlanSummary, type ReconcileContext,
} from "./recurrence";
import type { Klass, Lesson } from "./types";

const clean = "-_id -__v";

/** Sprint 5.6.2 applies every verb but one. §8: "Still report-only for the retire
 * verb." Retire is a hard delete with no undo (§5.3), so a retirement is planned,
 * audited and reported, and the lesson stays where it is.
 *
 * STILL FALSE AFTER 5.6.3. That sprint built the §6 Phase 1 snapshot and verified
 * the migration; it deliberately did not enable the delete. Flipping this is
 * 5.6.4's single act, and MIGRATION_PHASE0.md lists what must be true first.
 *
 * Typed `boolean` rather than inferred as `false` deliberately: the executor's
 * retire branch must stay live code, type-checked and lintable, not something the
 * compiler folds away and nobody notices when the flag turns over. */
export const RETIRE_ENABLED: boolean = false;

/* ============================================================================
 * §6 Phase 0 — back-fill legacy reschedule origins
 * ==========================================================================*/

export interface OriginBackfillResult {
  /** Every legacy reschedule, each carrying its own verification (§6 Phase 0).
   * `item.target` is the triple that would be — or was — written. */
  items: Phase0Item[];
  /** Would stamping them change any reconciliation decision? It must not: Phase 0
   * changes where the reconciler reads a fact, never what it concludes. */
  equivalence: Phase0Equivalence;
  /** Everything that must be resolved before an apply is permitted. Non-empty
   * means NOTHING was written, whatever `apply` asked for. */
  blockers: string[];
  /** How many were actually written. Zero unless `apply` was requested. */
  written: number;
  applied: boolean;
  /** The read-back proof: what actually landed, and what else moved. Present
   * only after an apply. */
  verification: Phase0Verification | null;
}

/** §6 Phase 0, "mandatory, blocking".
 *
 * Eleven live lessons were rescheduled before the origin fields existed. The only
 * surviving evidence of the move is that the date embedded in their id disagrees
 * with their stored `date` — which the planner still reads, through
 * `legacyOriginFallback`, to avoid retiring them.
 *
 * This converts that inferred signal into stored data. What it buys is not safety
 * (the fallback already provides that, confirmed by the 5.6.1 dry run) but the
 * ability to REMOVE the fallback: until the origins are stored, the reconciler
 * parses a lesson id to make a safety decision — the exact coupling ADR-001
 * exists to eliminate — and can only recover `date` and `start` that way, never
 * `duration`.
 *
 * Strictly additive, exactly as documented: three fields written onto lessons
 * that have none of them. No id changes, no status changes, no date changes, and
 * `rescheduledAt` is NOT stamped — that field records when a move happened, and
 * this back-fill does not know when these moves happened.
 *
 * VERIFIED ON BOTH SIDES OF THE WRITE (Sprint 5.6.3). Before: every item is
 * checked against the design by `verifyPhase0`, and the whole plan is checked for
 * equivalence — stamping the origins must not change one reconciliation decision.
 * A single blocker means nothing is written at all, `apply` or not, for the same
 * reason `auditPlan` aborts whole: the back-fill is a set, and half of one is not
 * a smaller version of it. After: the collection is re-read and diffed field by
 * field, so "every updated lesson is exactly the expected target, and no other
 * lesson moved" is a measurement rather than a claim.
 *
 * Reports by default; writes only when asked. Running it is a migration step
 * (§6), sequenced behind the Phase 1 snapshot — see MIGRATION_PHASE0.md. */
export async function backfillLegacyOrigins(
  { apply = false }: { apply?: boolean } = {}
): Promise<OriginBackfillResult> {
  await dbConnect();

  // The verification needs the same inputs the planner does: a lesson's freeze
  // classification depends on attendance and homework, and its corroboration on
  // the class's current schedule.
  const [classes, before, attendance, homework] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select("lessonId -_id").lean<Array<{ lessonId: string }>>(),
    HomeworkModel.find().select("lessonId -_id").lean<Array<{ lessonId: string | null }>>(),
  ]);

  const ctx = reconcileContext({
    months: windowMonths(),
    attended: new Set(attendance.map((a) => a.lessonId)),
    homeworked: new Set(homework.map((h) => h.lessonId).filter((id): id is string => !!id)),
    legacyOriginFallback: true,
  });

  const items = verifyPhase0(classes, before, ctx);
  const equivalence = phase0Equivalence(classes, before, items, ctx);

  const blockers: string[] = [];
  for (const i of items) for (const p of i.problems) blockers.push(`${i.lessonId} — ${p}`);
  if (!equivalence.identical) {
    blockers.push(
      "the back-fill would change the reconciliation plan" +
      ` (${equivalence.onlyBefore.length} action(s) lost, ${equivalence.onlyAfter.length} gained)`
    );
  }

  if (!apply || items.length === 0 || blockers.length > 0) {
    return { items, equivalence, blockers, written: 0, applied: false, verification: null };
  }

  const res = await LessonModel.bulkWrite(
    items.map((it) => ({
      updateOne: {
        // The filter re-asserts the precondition at write time: only a lesson
        // that STILL has no stored origin is stamped, so a concurrent reschedule
        // can never be overwritten by this back-fill.
        filter: { id: it.lessonId, originalDate: { $exists: false } },
        update: { $set: { ...it.target } },
      },
    })),
    { ordered: false }
  );

  const after = await LessonModel.find().select(clean).lean<Lesson[]>();
  return {
    items, equivalence, blockers,
    written: res.modifiedCount ?? 0,
    applied: true,
    verification: verifyPhase0Applied(before, after, items),
  };
}

/* ============================================================================
 * §2 — the delete guard
 * ==========================================================================*/

/** Why a class may not be hard-deleted. Empty = it has never taught anything. */
export interface TeachingHistory {
  /** Lessons that are not purely a prediction: dated before the app clock, or
   * Completed / Cancelled whatever their date (§4 — "a lesson that is Completed
   * or Cancelled is past in the sense that matters"). */
  pastLessons: number;
  attendanceRecords: number;
  billingRecords: number;
}

export function hasTeachingHistory(h: TeachingHistory): boolean {
  return h.pastLessons > 0 || h.attendanceRecords > 0 || h.billingRecords > 0;
}

/** The pure half of the guard: given a class's lessons and its record counts,
 * does it hold teaching history? (§2, "Delete entire class")
 *
 * Hard delete survives only for a class that has never taught — no lessons at
 * all, or future Upcoming ones only. Lesson TYPE is deliberately not consulted:
 * a Makeup or an Extra that has been taught is teaching history exactly as a
 * Regular is. */
export function teachingHistoryOf(
  lessons: readonly Pick<Lesson, "date" | "status">[],
  counts: { attendanceRecords: number; billingRecords: number },
  appClock: string = TODAY_ISO
): TeachingHistory {
  return {
    pastLessons: lessons.filter((l) => l.date < appClock || l.status !== "Upcoming").length,
    attendanceRecords: counts.attendanceRecords,
    billingRecords: counts.billingRecords,
  };
}

/** Read what a class has taught. Attendance is keyed by `lessonId` and has no
 * cascade, so it is resolved through the class's own lessons. */
export async function readTeachingHistory(
  classId: string,
  appClock: string = TODAY_ISO
): Promise<TeachingHistory> {
  await dbConnect();
  const lessons = await LessonModel.find({ classId }).select("id date status -_id")
    .lean<Array<Pick<Lesson, "id" | "date" | "status">>>();
  const [attendanceRecords, billingRecords] = await Promise.all([
    lessons.length === 0
      ? 0
      : AttendanceModel.countDocuments({ lessonId: { $in: lessons.map((l) => l.id) } }),
    BillingModel.countDocuments({ classId }),
  ]);
  return teachingHistoryOf(lessons, { attendanceRecords, billingRecords }, appClock);
}

/* ============================================================================
 * §5 — write-side reconciliation
 * ==========================================================================*/

/** Why the plan was refused. Each code names the design rule it protects; a
 * violation means the plan and the database disagree about what is safe, which
 * can only be a bug or a concurrent write — never something to write through. */
export type ViolationCode =
  | "past-date"
  | "class-mismatch"
  | "class-not-reconcilable"
  | "lesson-missing"
  | "lesson-not-regular"
  | "lesson-frozen"
  | "retire-would-destroy-notes"
  | "insert-collides-with-existing-lesson"
  | "duplicate-action";

export const VIOLATION_LABEL: Record<ViolationCode, string> = {
  "past-date": "action dated before the app clock — the past is a fact (§4)",
  "class-mismatch": "action belongs to a different class than the one being reconciled",
  "class-not-reconcilable": "the class is Archived or missing and has no live intent (§5.8)",
  "lesson-missing": "the target lesson no longer exists",
  "lesson-not-regular": "the target lesson is not a Regular lesson (§2)",
  "lesson-frozen": "the target lesson is protected by a §6 Phase 4 filter",
  "retire-would-destroy-notes": "retiring this lesson would destroy teacher's notes (§5.9)",
  "insert-collides-with-existing-lesson": "the id this insert would mint already exists",
  "duplicate-action": "two actions target the same lesson",
};

export interface PlanViolation {
  code: ViolationCode;
  lessonId: string;
  date: string;
  detail: string;
}

/** Re-check a plan against the database it is about to be written to (§6 Phase 4).
 *
 * The planner is pure and correct over the values it was given; this asks the
 * different question of whether those values still describe the stored lessons,
 * and whether every action honours the filters the design states. It duplicates
 * the planner's own reasoning ON PURPOSE — it is the check that catches the case
 * where the planner and the design have drifted apart, so it must be derived from
 * the design rather than from the planner.
 *
 * Pure: the caller supplies the lessons and the context it read. */
export function auditPlan(
  actions: readonly PlanAction[],
  input: { klass: Klass | null; lessons: readonly Lesson[]; ctx: ReconcileContext }
): PlanViolation[] {
  const { klass, ctx } = input;
  const out: PlanViolation[] = [];
  const add = (code: ViolationCode, lessonId: string, date: string, detail: string) =>
    out.push({ code, lessonId, date, detail });

  const writes = actions.filter((a) => a.verb === "update" || a.verb === "insert" || a.verb === "retire");
  if (writes.length === 0) return out;

  if (!klass || klass.status !== "Active") {
    const a = writes[0];
    add("class-not-reconcilable", a.lessonId, a.date,
      klass ? `class ${klass.id} is ${klass.status}` : "class no longer exists");
    return out; // nothing below can be meaningful without a live schedule
  }

  const byId = new Map(input.lessons.map((l) => [l.id, l]));
  const seen = new Set<string>();

  for (const a of writes) {
    if (seen.has(a.lessonId)) add("duplicate-action", a.lessonId, a.date, `${a.verb} repeats a lesson id`);
    seen.add(a.lessonId);

    if (a.date < ctx.appClock) add("past-date", a.lessonId, a.date, `${a.verb} on ${a.date} < ${ctx.appClock}`);
    if (a.classId !== klass.id) add("class-mismatch", a.lessonId, a.date, `${a.classId} != ${klass.id}`);

    if (a.verb === "insert") {
      if (byId.has(a.lessonId)) {
        add("insert-collides-with-existing-lesson", a.lessonId, a.date, "a lesson already holds this id");
      }
      continue;
    }

    const l = byId.get(a.lessonId);
    if (!l) {
      add("lesson-missing", a.lessonId, a.date, `${a.verb} targets a lesson that is not stored`);
      continue;
    }
    if (l.type !== "regular") add("lesson-not-regular", a.lessonId, a.date, `type is ${l.type}`);
    if (l.classId !== klass.id) add("class-mismatch", a.lessonId, a.date, `lesson belongs to ${l.classId}`);
    if (l.date !== a.date) add("lesson-missing", a.lessonId, a.date, `stored date is ${l.date}`);

    const frozen = freezeReasons(l, ctx);
    if (frozen.length > 0) add("lesson-frozen", a.lessonId, a.date, frozen.join(", "));

    if (a.verb === "retire" && isManuallyEdited(l)) {
      add("retire-would-destroy-notes", a.lessonId, a.date, "the lesson carries notes");
    }
  }

  return out;
}

/** What one reconciliation run decided and did. Produced BEFORE anything is
 * written (the plan and the audit), then completed with what was applied. */
export interface ReconcileReport {
  classId: string;
  className: string;
  appClock: string;
  months: string[];
  /** "not-reconciled" = the class has no live intent (§5.8) or does not exist. */
  outcome: "applied" | "aborted" | "not-reconciled";
  summary: PlanSummary;
  actions: PlanAction[];
  violations: PlanViolation[];
  applied: { updated: number; inserted: number; retired: number };
  /** Planned, reported, and deliberately not executed. */
  deferred: { retire: number; strand: number };
}

function emptyReport(classId: string, className: string, ctx: ReconcileContext): ReconcileReport {
  return {
    classId, className, appClock: ctx.appClock, months: ctx.months,
    outcome: "not-reconciled",
    summary: summarizePlan([]), actions: [], violations: [],
    applied: { updated: 0, inserted: 0, retired: 0 },
    deferred: { retire: 0, strand: 0 },
  };
}

/** One line per run, for the server log. The full report is the return value. */
export function formatReconcileReport(r: ReconcileReport): string {
  const s = r.summary;
  const head =
    `[reconcile] ${r.className} (${r.classId}) ${r.outcome} — ` +
    `keep=${s.keep} update=${s.update} insert=${s.insert} retire=${s.retire} strand=${s.strand} skip=${s.skip}`;
  if (r.outcome !== "aborted") return head;
  return [
    head,
    "  ABORTED — nothing was written. The plan disagreed with the stored lessons:",
    ...r.violations.map(
      (v) => `    ! ${v.lessonId} ${v.date} — ${VIOLATION_LABEL[v.code]} [${v.detail}]`
    ),
  ].join("\n");
}

interface ReconcileState {
  klass: Klass | null;
  lessons: Lesson[];
  ctx: ReconcileContext;
}

/** Everything one class's reconciliation depends on, read in one place so the
 * plan and the audit cannot be looking at different questions. */
async function readReconcileState(classId: string): Promise<ReconcileState> {
  await dbConnect();
  const [klass, lessons] = await Promise.all([
    ClassModel.findOne({ id: classId }).select(clean).lean<Klass>(),
    LessonModel.find({ classId, type: "regular" }).select(clean).lean<Lesson[]>(),
  ]);

  const ids = lessons.map((l) => l.id);
  const [attendance, homework] = await Promise.all([
    ids.length === 0
      ? []
      : AttendanceModel.find({ lessonId: { $in: ids } }).select("lessonId -_id")
          .lean<Array<{ lessonId: string }>>(),
    ids.length === 0
      ? []
      : HomeworkModel.find({ lessonId: { $in: ids } }).select("lessonId -_id")
          .lean<Array<{ lessonId: string | null }>>(),
  ]);

  return {
    klass: klass ?? null,
    lessons,
    ctx: reconcileContext({
      months: windowMonths(),
      attended: new Set(attendance.map((a) => a.lessonId)),
      homeworked: new Set(homework.map((h) => h.lessonId).filter((id): id is string => !!id)),
      // Stays true until the §6 Phase 0 back-fill has been deployed AND verified.
      // Turning it off first would retire eleven deliberately moved lessons.
      legacyOriginFallback: true,
    }),
  };
}

/** Reconcile ONE class's future Regular lessons against its current schedule.
 *
 * The whole pipeline, in the order §6 puts it: read → plan → report → audit →
 * (abort | apply). An Archived class, a missing class, a Makeup and an Extra are
 * excluded before the algorithm begins (§5.8, §2) rather than filtered out
 * inside it.
 *
 * Applies UPDATE and INSERT. Retirements are reported only (see RETIRE_ENABLED),
 * and a stranded lesson is by definition untouched (§5.9). */
export async function reconcileClass(classId: string): Promise<ReconcileReport> {
  const planned = await readReconcileState(classId);
  const { klass, ctx } = planned;

  if (!klass || klass.status === "Archived") return emptyReport(classId, klass?.name ?? "—", ctx);

  // ---- plan, then REPORT, then audit — all before any write ----
  const actions = planClass(klass, planned.lessons, ctx);

  // The audit re-reads. Auditing the plan against the very snapshot it was
  // planned from would only prove the planner agrees with itself; reading again
  // is what makes this a check on the DATABASE the write is about to land in. A
  // cancellation, an attendance record or a reschedule arriving in between now
  // aborts the run instead of being written over. One extra read on a rare write
  // path, and it fails closed, which is the trade the whole design makes.
  const verified = await readReconcileState(classId);
  const report: ReconcileReport = {
    classId, className: klass.name, appClock: ctx.appClock, months: ctx.months,
    outcome: "applied",
    summary: summarizePlan(actions),
    actions,
    violations: auditPlan(actions, {
      klass: verified.klass, lessons: verified.lessons, ctx: verified.ctx,
    }),
    applied: { updated: 0, inserted: 0, retired: 0 },
    deferred: {
      retire: RETIRE_ENABLED ? 0 : actions.filter((a) => a.verb === "retire").length,
      strand: actions.filter((a) => a.verb === "strand").length,
    },
  };

  if (report.violations.length > 0) {
    report.outcome = "aborted";
    return report; // nothing is written — not even the actions that passed
  }

  // ---- apply ----
  const ops: Parameters<typeof LessonModel.bulkWrite>[0] = [];
  const tally = { updated: 0, inserted: 0, retired: 0 };
  for (const a of actions) {
    if (a.verb === "update") {
      // ONLY the two fields the schedule owns. The id is never recomputed and
      // never rewritten (ADR-001), and `notes`, `classroom`, `status`,
      // `chargeable`, `fromId` and the origin fields are not in this `$set` —
      // which is the whole reason update exists rather than delete-and-recreate.
      ops.push({
        updateOne: {
          filter: { id: a.lessonId },
          update: { $set: { start: a.to.start, duration: a.to.duration } },
        },
      });
      tally.updated++;
    } else if (a.verb === "insert") {
      // Upsert with `$setOnInsert`, exactly as the read-side generator does, so a
      // concurrent top-up and this insert cannot produce two lessons or overwrite
      // one that arrived first.
      ops.push({
        updateOne: {
          filter: { id: a.lessonId },
          update: {
            $setOnInsert: {
              id: a.lessonId,
              classId: klass.id,
              type: "regular",
              date: a.date,
              start: a.start,
              duration: a.duration,
              classroom: klass.classroom ?? "",
              status: statusForDate(a.date, ctx.appClock),
              chargeable: false,
              fromId: null,
              notes: "",
            } satisfies Lesson,
          },
          upsert: true,
        },
      });
      tally.inserted++;
    } else if (a.verb === "retire" && RETIRE_ENABLED) {
      // Hard delete (§5.3). Reached only once 5.6.4 flips the flag, and only for
      // a lesson the plan and the audit have both proved is future, Upcoming,
      // unattended, unmoved, un-homeworked and un-noted.
      ops.push({ deleteOne: { filter: { id: a.lessonId } } });
      tally.retired++;
    }
  }

  if (ops.length > 0) {
    try {
      await LessonModel.bulkWrite(ops, { ordered: false });
    } catch (e) {
      // Only duplicate-key noise is tolerable: it means a concurrent writer
      // inserted the identical document first.
      if (!isDupKey(e)) throw e;
    }
    report.applied = tally;
  }

  return report;
}
