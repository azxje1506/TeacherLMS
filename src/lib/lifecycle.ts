/* Lesson lifecycle — the stored `Upcoming` → `Completed` / `Cancelled` transition.
 *
 * WHAT THIS IS. RECURRENCE_DESIGN §9.2 recorded that `statusForDate()` is evaluated
 * once, at insert, and never again: nothing in the codebase moved a lesson from
 * `Upcoming` to `Completed` as its date passed. Against a real clock every lesson
 * would stay `Upcoming` for ever and revenue — which counts only `Completed` —
 * would stay at zero. This module is the missing transition, and nothing else.
 *
 * THE RULE (approved, Gates 1–5 — do not reinterpret it here):
 *
 *     regular + Upcoming + date < appClock
 *        ├─ class Active   → Completed
 *        ├─ class Archived → Cancelled, chargeable: false
 *        ├─ class Ended    → nothing
 *        └─ anything else  → nothing
 *
 * WHY IT IS A WRITE AND NOT A READ-TIME DERIVATION. A derivation would have to
 * consult the class's status at read time, and class status is a single mutable
 * field with no history. Archiving a class in October would then rewrite what July
 * reported — RECURRENCE_DESIGN §9.1 exactly, the defect `computeRevenue` was just
 * cleaned of (a test in tests/class-lifecycle.test.ts asserts it reads no class
 * status at all). Worse, a derivation cannot express the Archived rule: restoring
 * the class would re-derive every cancelled lesson as delivered, resurrecting the
 * phantom revenue the rule exists to prevent. Writing the decision freezes it while
 * it was true, which is the only way to keep a closed month closed.
 *
 * WHY `updateClass` CALLS IT BEFORE CHANGING STATUS. The resolution reads the
 * class's status when it runs, not when the date passed. Archive a class, let a
 * lesson date pass, open the app for the first time only after Restore, and that
 * lesson would resolve against an Active class and become `Completed`. Running the
 * transition immediately BEFORE every status change — while the old status is still
 * stored — closes that window without needing an `archivedAt` field: the only thing
 * that can change the answer is a status change, and every status change resolves
 * first. `updateClass` is the sole writer of `Class.status`, so one hook is total.
 *
 * FAILS CLOSED. A lesson is resolved only when it positively proves it is eligible
 * and its class positively names a resolution. An unrecognised class status, a
 * class that no longer exists, an `Ended` class, a Makeup, an Extra, a future date,
 * a lesson already `Completed` or `Cancelled` — all return null and are never
 * written. That is what keeps the fabricated historical lessons recorded in the
 * Gate 1.5 audit out of reach: they are `Completed`, so the filter cannot see them.
 *
 * NO `server-only`, for the same reason `src/lib/reconciler.ts` has none: the pure
 * decision is exercised by the test runner, which cannot resolve that module.
 * Nothing here is imported by a client component.
 */

import { dbConnect } from "./db";
import { ClassModel, LessonModel } from "./models";
import { TODAY_ISO } from "./constants";
import { isPastDate } from "./recurrence";
import type { ClassStatus, Klass, Lesson, LessonStatus } from "./types";

/* ------------------------------------------------------------ the pure rule */

/** What each class status says about a lesson of its whose date has passed.
 *
 * Written as an explicit table rather than derived from `TEACHING_CLASS_STATUSES`
 * because this is a THIRD question about class status, with a third answer, and
 * collapsing it into either of the existing two would be wrong: `Ended` is not
 * teaching (so it is absent from that list) yet must also not resolve here, and
 * `Archived` is not reconcilable (so it is absent from that list) yet must.
 *
 * `Ended` is deliberately absent. An Ended class has already had its future
 * retired on the transition (`planClass` plans it against an empty schedule), so
 * nothing of its should still be `Upcoming` and past. If something is, that is a
 * disagreement between this module and the reconciler, and the safe response to a
 * disagreement is to write nothing.
 *
 * `Partial` is load-bearing: a status added to `ClassStatus` later resolves to
 * `undefined` here and therefore to `null` below, so no future status can acquire
 * revenue semantics by accident. */
const RESOLUTION: Partial<Record<ClassStatus, LessonStatus>> = {
  Active: "Completed",
  Archived: "Cancelled",
};

/** The status this lesson should now carry, or `null` when it must not be touched.
 *
 * PURE — no database, no clock of its own. `appClock` defaults to the app clock
 * (`TODAY_ISO`) so callers cannot introduce a second time source, and `isPastDate`
 * is reused rather than restated so the boundary convention has one definition:
 * `date === appClock` is NOT past, matching `statusForDate` and `planDate`.
 *
 * `klass` is nullable on purpose. A lesson whose class no longer exists has no
 * status to consult, so it resolves to `null` and is left exactly where it is —
 * the same treatment §5.8 gives it in reconciliation. */
export function resolvedStatusFor(
  lesson: Pick<Lesson, "type" | "status" | "date">,
  klass: Pick<Klass, "status"> | null | undefined,
  appClock: string = TODAY_ISO
): LessonStatus | null {
  if (lesson.type !== "regular") return null;
  if (lesson.status !== "Upcoming") return null;
  if (!isPastDate(lesson.date, appClock)) return null;
  if (!klass) return null;
  return RESOLUTION[klass.status] ?? null;
}

/* -------------------------------------------------------------- the executor */

export interface LifecycleResult {
  /** Lessons moved `Upcoming` → `Completed` (their class was Active). */
  completed: number;
  /** Lessons moved `Upcoming` → `Cancelled`, `chargeable: false` (class Archived). */
  cancelled: number;
}

/** Resolve every eligible lesson, for one class or for all of them.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by care. A resolved lesson is no longer
 * `Upcoming`, so the very filter that selected it stops matching: a second pass
 * finds nothing and writes nothing. The per-document filter re-asserts
 * `status: "Upcoming"` at write time as well, so a cancellation or an attendance
 * edit that lands between the read and the write is never overwritten — the same
 * precaution the §6 Phase 0 back-fill takes.
 *
 * THE QUERY IS AN OPTIMISATION; `resolvedStatusFor` IS THE AUTHORITY. Every
 * candidate the query returns is put back through the pure rule before anything is
 * written, so the decision has exactly one definition and a query that drifted
 * could only ever select too much, never resolve too much.
 *
 * WRITES `status` AND `chargeable`, AND NOTHING ELSE. Not `date`, `start`,
 * `duration`, `notes`, `classroom`, `fromId`, nor any origin field — a lesson's
 * position and its human-authored content are not this module's business. Nothing
 * is ever deleted, so no month's Regular-lesson count moves and the per-lesson
 * revenue denominator is untouched by construction. */
export async function advanceLessonLifecycle(classId?: string): Promise<LifecycleResult> {
  await dbConnect();
  const appClock = TODAY_ISO;

  // Candidates only. The three eligibility clauses are mirrored from
  // `resolvedStatusFor` so the database does the coarse filtering, and every row
  // is re-judged by the pure rule below.
  const candidates = await LessonModel.find({
    type: "regular",
    status: "Upcoming",
    date: { $lt: appClock },
    ...(classId ? { classId } : {}),
  })
    .select("id classId type date status -_id")
    .lean<Array<Pick<Lesson, "id" | "classId" | "type" | "date" | "status">>>();

  if (candidates.length === 0) return { completed: 0, cancelled: 0 };

  const classIds = [...new Set(candidates.map((l) => l.classId))];
  const classes = await ClassModel.find({ id: { $in: classIds } })
    .select("id status -_id")
    .lean<Array<Pick<Klass, "id" | "status">>>();
  const byClass = new Map(classes.map((c) => [c.id, c]));

  const ops: Parameters<typeof LessonModel.bulkWrite>[0] = [];
  const tally: LifecycleResult = { completed: 0, cancelled: 0 };

  for (const l of candidates) {
    const next = resolvedStatusFor(l, byClass.get(l.classId), appClock);
    if (next === "Completed") {
      ops.push({
        updateOne: {
          filter: { id: l.id, status: "Upcoming" },
          update: { $set: { status: "Completed" } },
        },
      });
      tally.completed++;
    } else if (next === "Cancelled") {
      // `chargeable: false` is part of the rule, not a default: a lesson the class
      // was archived over did not happen, so it withholds revenue. A lesson the
      // teacher cancelled as chargeable is never reached here — it is not Upcoming.
      ops.push({
        updateOne: {
          filter: { id: l.id, status: "Upcoming" },
          update: { $set: { status: "Cancelled", chargeable: false } },
        },
      });
      tally.cancelled++;
    }
    // `null` — not eligible, or its class says nothing. Left exactly as it is.
  }

  if (ops.length > 0) await LessonModel.bulkWrite(ops, { ordered: false });
  return tally;
}
