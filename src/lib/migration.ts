/* Migration verification — Sprint 5.6.3, RECURRENCE_DESIGN.md §6.
 *
 * PURE BY CONSTRUCTION, exactly like `src/lib/recurrence.ts`: no Mongoose, no
 * model import, no connection, no async function. Every export is a function over
 * values the caller has already read, so the whole verification runs in
 * `npm test` against fixtures rather than against a database — and a test
 * enforces that, the same way it does for the planner.
 *
 * WHAT THIS SPRINT IS, AND IS NOT
 * 5.6.3 PREPARES the Phase 0 back-fill and VERIFIES the migration. It does not
 * enable the retire verb (`RETIRE_ENABLED` stays false in src/lib/reconciler.ts)
 * and it executes no destructive cleanup. Nothing in this module writes anything
 * anywhere; it produces the evidence a person needs before authorising a write.
 *
 * THE FOUR QUESTIONS IT ANSWERS
 *
 *   1. Is every legacy reschedule a genuine move, and is the triple the back-fill
 *      would stamp EXACTLY the right target?                  — `verifyPhase0`
 *   2. Does stamping it change the reconciler's mind about anything? It must not:
 *      the point of Phase 0 is to make `legacyOriginFallback` removable, not to
 *      change one decision (§6 Phase 0).                    — `phase0Equivalence`
 *   3. Is every planned retirement independently provable as a future orphan,
 *      WITHOUT trusting the planner that produced it?    — `verifyFutureOrphans`
 *   4. Does any write verb touch a lesson the design protects? — `verifyProtected`
 *
 * Every answer is re-derived from RECURRENCE_DESIGN rather than from the planner,
 * for the same reason `auditPlan` is (src/lib/reconciler.ts): a check derived from
 * the thing it checks agrees with it even when both are wrong.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A NICETY. Every list this module returns is
 * sorted by a stable key and carries no wall-clock value, so two runs over
 * unchanged data produce byte-identical output and a reviewer can diff them. That
 * is what makes "the report was signed off" mean something.
 */

import { createHash } from "node:crypto";

import {
  effectiveOrigin, findArchivedClassLessons, findLegacyReschedules, findOrphanedLessons,
  freezeReasons, isManuallyEdited, monthOf, planReconciliation, summarizePlan, weekdayOf,
  type PlanAction, type PlanSummary, type PlanVerb, type ReconcileContext, type RetireAction,
} from "./recurrence";
import type { Klass, Lesson, LessonStatus, RevenueResult } from "./types";

/* ============================================================================
 * Canonical keys — the basis of every comparison in this file
 * ==========================================================================*/

/** A slot, as a comparable string. `start` and `duration` are the only two
 * fields reconciliation compares (ADR-001 decision 2), so they are the key. */
const slotKey = (start: string, duration: number) => `${start}|${duration}`;

/** A plan action reduced to the facts that decide what happens to a lesson.
 *
 * `rescheduled-legacy` is normalised to `rescheduled` on purpose: converting the
 * inferred signal into a stored one is the WHOLE of Phase 0, so it is the one
 * difference the equivalence check must not report. Everything else — every verb,
 * every target, every time — must be identical across the back-fill. */
export function actionKey(a: PlanAction): string {
  const head = `${a.verb}|${a.classId}|${a.date}|${a.lessonId}`;
  switch (a.verb) {
    case "update":
      return `${head}|${slotKey(a.from.start, a.from.duration)}>${slotKey(a.to.start, a.to.duration)}`;
    case "insert":
      return `${head}|${slotKey(a.start, a.duration)}|${a.status}`;
    case "skip":
      return `${head}|${slotKey(a.start, a.duration)}|` +
        a.frozen.map((f) => (f === "rescheduled-legacy" ? "rescheduled" : f)).join("+");
    default:
      return `${head}|${slotKey(a.start, a.duration)}`;
  }
}

/** Every field of a lesson EXCEPT the three Phase 0 writes.
 *
 * Comparing this before and after an apply is what proves the back-fill was
 * additive: if one character of it moves, something other than the origin triple
 * was written, and the run is a failure whatever else it reports. */
export function lessonFingerprint(l: Lesson): string {
  return JSON.stringify([
    l.id, l.classId, l.type, l.date, l.start, l.duration, l.classroom, l.status,
    l.chargeable ?? null, l.fromId ?? null, l.notes ?? "", l.rescheduledAt ?? null,
  ]);
}

export function fingerprintAll(lessons: readonly Lesson[]): Map<string, string> {
  return new Map(lessons.map((l) => [l.id, lessonFingerprint(l)]));
}

/** The whole lesson, origin fields included — a snapshot's unit of identity. */
export function lessonSnapshotFingerprint(l: Lesson): string {
  return JSON.stringify([
    lessonFingerprint(l), l.originalDate ?? null, l.originalStart ?? null, l.originalDuration ?? null,
  ]);
}

/** One value standing for the entire lessons collection.
 *
 * Order-independent (the fingerprints are sorted) so it does not depend on how
 * Mongo happened to return the documents. Its job is to answer one question at
 * apply time: does the §6 Phase 1 snapshot still describe the database about to
 * be written to? A snapshot of a different state is not a rollback. */
export function digestLessons(lessons: readonly Lesson[]): { count: number; digest: string } {
  const body = lessons.map(lessonSnapshotFingerprint).sort().join("\n");
  return { count: lessons.length, digest: createHash("sha256").update(body).digest("hex") };
}

/* ============================================================================
 * §6 Phase 0 — verify the legacy reschedule back-fill BEFORE it is applied
 * ==========================================================================*/

/** One lesson the back-fill would stamp, with the evidence for and against it. */
export interface Phase0Item {
  lessonId: string;
  classId: string;
  className: string;
  /** Where the lesson sits now. The back-fill never touches any of this. */
  date: string;
  start: string;
  duration: number;
  status: LessonStatus;
  /** Exactly what would be written, and nothing else. */
  target: { originalDate: string; originalStart: string; originalDuration: number };
  /** Blocking. The back-fill must not be applied while any of these stand. */
  problems: string[];
  /** Not blocking — recorded so the report states what it could NOT prove. */
  notes: string[];
  /** True when this lesson would become a retire candidate if the fallback were
   * removed before the back-fill ran. §6 Phase 0 measured 3 of the 11. */
  loadBearing: boolean;
}

/** Apply an item's target to a lesson, in memory. */
function stamp(l: Lesson, target: Phase0Item["target"]): Lesson {
  return { ...l, ...target };
}

/** §6 Phase 0's work list, with every lesson on it checked.
 *
 * The list itself comes from `findLegacyReschedules` — a lesson whose id-encoded
 * date disagrees with its stored `date`, which is the only surviving evidence of
 * a move made before the origin fields existed. What this adds is the proof that
 * each one is what it appears to be, and that the triple about to be written is
 * the right one.
 *
 * The duration deserves its own warning and gets one. The id never encoded a
 * duration (§6 Phase 0), so the inferred `originalDuration` is the lesson's
 * CURRENT duration. That is right whenever the move did not also change the
 * length — which the class's schedule can corroborate but not prove. Where it
 * cannot be corroborated the item says so rather than presenting a guess as a
 * fact. */
export function verifyPhase0(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  ctx: ReconcileContext
): Phase0Item[] {
  const byClass = new Map(classes.map((c) => [c.id, c]));
  const months = new Set(ctx.months);

  const items = findLegacyReschedules(lessons).map(({ lesson: l, inferred }): Phase0Item => {
    const problems: string[] = [];
    const notes: string[] = [];
    const klass = byClass.get(l.classId) ?? null;
    const target = {
      originalDate: inferred.date,
      originalStart: inferred.start,
      originalDuration: inferred.duration,
    };

    // ---- the write must be strictly additive (§6 Phase 0) ----
    if (l.type !== "regular") problems.push(`type is "${l.type}" — only Regular lessons are generated (§2)`);
    if (l.originalDate != null) problems.push("already carries originalDate — the back-fill is additive only");
    if (l.originalStart != null) problems.push("already carries originalStart — the back-fill is additive only");
    if (l.originalDuration != null) problems.push("already carries originalDuration — the back-fill is additive only");

    // ---- it must be a move, and the id must be the reason we believe that ----
    if (inferred.source !== "legacy-id") problems.push(`origin source is "${inferred.source}", expected "legacy-id"`);
    if (inferred.date === l.date) problems.push("the inferred origin is this lesson's own date — that is not a move");

    // ---- corroborate the origin against the class's CURRENT schedule ----
    if (!klass) {
      notes.push("class no longer exists — the origin cannot be corroborated against a schedule");
    } else {
      if (klass.status !== "Active") notes.push(`class is ${klass.status} — outside reconciliation (§5.8)`);
      const day = weekdayOf(target.originalDate);
      const slots = (klass.schedule ?? []).filter((s) => s.day === day && s.start === target.originalStart);
      if (slots.length === 0) {
        notes.push(
          `no slot in the class's current schedule starts at ${target.originalStart} on that weekday` +
          " — the schedule has been edited since the move, so the origin rests on the id alone"
        );
      } else if (!slots.some((s) => s.duration === target.originalDuration)) {
        notes.push(
          `originalDuration ${target.originalDuration} is the lesson's own — the id never encoded one` +
          ` — and the corroborating slot is ${[...new Set(slots.map((s) => s.duration))].sort((a, b) => a - b).join("/")} min`
        );
      }
    }

    // ---- the reconciler must see a reschedule BOTH before and after ----
    // This is the behavioural contract of the whole phase: the back-fill replaces
    // HOW the reconciler knows, never WHAT it concludes.
    const before = freezeReasons(l, { ...ctx, legacyOriginFallback: true });
    if (!before.includes("rescheduled-legacy")) {
      problems.push("the planner does not classify this as a legacy reschedule");
    }
    const after = freezeReasons(stamp(l, target), { ...ctx, legacyOriginFallback: false });
    if (!after.includes("rescheduled")) {
      problems.push("after the back-fill the planner would no longer see a reschedule");
    }

    // ---- how much this lesson depends on Phase 0 (§6, "only 3 are load-bearing") ----
    const bare = freezeReasons(l, { ...ctx, legacyOriginFallback: false });
    const loadBearing =
      bare.length === 0 && l.date >= ctx.appClock && months.has(monthOf(l.date)) &&
      klass !== null && klass.status === "Active";
    if (loadBearing) {
      notes.push("load-bearing: with the fallback off and no back-fill, this lesson becomes a retire candidate");
    }

    return {
      lessonId: l.id, classId: l.classId, className: klass?.name ?? "—",
      date: l.date, start: l.start, duration: l.duration, status: l.status,
      target, problems, notes, loadBearing,
    };
  });

  return items.sort((a, b) => a.lessonId.localeCompare(b.lessonId));
}

/** The back-fill, applied in memory. Used to answer "what would change?" without
 * changing anything — and, in `tests/migration.test.ts`, to assert it changes
 * nothing that matters. */
export function applyPhase0(lessons: readonly Lesson[], items: readonly Phase0Item[]): Lesson[] {
  const targets = new Map(items.map((i) => [i.lessonId, i.target]));
  return lessons.map((l) => {
    const t = targets.get(l.id);
    return t ? stamp(l, t) : l;
  });
}

/** Does the back-fill change a single decision? (§6 Phase 0)
 *
 * `before` is the plan as it stands: origins inferred from ids, fallback ON.
 * `after` is the plan with the origins STORED and the fallback OFF — the state
 * Phase 0 exists to reach. The two must be identical, because the only thing
 * Phase 0 changes is where the reconciler reads a fact it already knew.
 *
 * A difference is a blocker, not a curiosity: it means removing the fallback
 * would alter what happens to a real lesson. */
export interface Phase0Equivalence {
  before: PlanSummary;
  after: PlanSummary;
  identical: boolean;
  /** Actions the current plan has and the post-back-fill plan does not. */
  onlyBefore: string[];
  /** …and the reverse. */
  onlyAfter: string[];
}

export function phase0Equivalence(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  items: readonly Phase0Item[],
  ctx: ReconcileContext
): Phase0Equivalence {
  const before = planReconciliation(classes, lessons, { ...ctx, legacyOriginFallback: true }).actions;
  const after = planReconciliation(
    classes, applyPhase0(lessons, items), { ...ctx, legacyOriginFallback: false }
  ).actions;

  const b = before.map(actionKey);
  const a = after.map(actionKey);
  const bs = new Set(b);
  const as = new Set(a);
  const onlyBefore = b.filter((k) => !as.has(k)).sort();
  const onlyAfter = a.filter((k) => !bs.has(k)).sort();

  return {
    before: summarizePlan(before),
    after: summarizePlan(after),
    identical: onlyBefore.length === 0 && onlyAfter.length === 0,
    onlyBefore,
    onlyAfter,
  };
}

/* ============================================================================
 * Post-apply verification — what actually landed
 * ==========================================================================*/

/** The answer to "did the apply write exactly what it promised, and nothing
 * else?" Computed from a full read of the lessons collection taken before the
 * write and another taken after it. */
export interface Phase0Verification {
  ok: boolean;
  /** How many lessons the plan targeted. */
  expected: number;
  /** …and how many now carry exactly that target. */
  stamped: number;
  /** Targeted, but the stored origin is not the expected one. */
  wrongTarget: string[];
  /** Targeted, but nothing was written. */
  missing: string[];
  /** Not targeted, yet gained an origin field. */
  unexpected: string[];
  /** Any lesson, targeted or not, whose OTHER fields moved (§6 Phase 4). */
  collateral: string[];
  /** A lesson that vanished or appeared between the two reads. */
  countChanged: boolean;
}

export function verifyPhase0Applied(
  before: readonly Lesson[],
  after: readonly Lesson[],
  items: readonly Phase0Item[]
): Phase0Verification {
  const targets = new Map(items.map((i) => [i.lessonId, i.target]));
  const beforeById = new Map(before.map((l) => [l.id, l]));
  const afterById = new Map(after.map((l) => [l.id, l]));

  const wrongTarget: string[] = [];
  const missing: string[] = [];
  const unexpected: string[] = [];
  const collateral: string[] = [];
  let stamped = 0;

  for (const [id, t] of targets) {
    const l = afterById.get(id);
    if (!l) {
      missing.push(id);
      continue;
    }
    if (l.originalDate === t.originalDate && l.originalStart === t.originalStart &&
        l.originalDuration === t.originalDuration) {
      stamped++;
    } else if (l.originalDate == null && l.originalStart == null && l.originalDuration == null) {
      missing.push(id);
    } else {
      wrongTarget.push(id);
    }
  }

  for (const l of after) {
    const was = beforeById.get(l.id);
    if (!was) continue; // covered by countChanged
    if (lessonFingerprint(was) !== lessonFingerprint(l)) collateral.push(l.id);
    if (targets.has(l.id)) continue;
    // An untargeted lesson must not have gained an origin either.
    if (was.originalDate !== l.originalDate || was.originalStart !== l.originalStart ||
        was.originalDuration !== l.originalDuration) {
      unexpected.push(l.id);
    }
  }

  const countChanged = before.length !== after.length;
  return {
    ok: wrongTarget.length === 0 && missing.length === 0 && unexpected.length === 0 &&
      collateral.length === 0 && !countChanged && stamped === targets.size,
    expected: targets.size,
    stamped,
    wrongTarget: wrongTarget.sort(),
    missing: missing.sort(),
    unexpected: unexpected.sort(),
    collateral: collateral.sort(),
    countChanged,
  };
}

/* ============================================================================
 * Future orphans — every planned retirement, proved independently
 * ==========================================================================*/

/** One planned RETIRE, re-derived from the design rather than believed. */
export interface OrphanItem {
  lessonId: string;
  classId: string;
  className: string;
  date: string;
  start: string;
  duration: number;
  reason: string;
  /** How many Regular lessons share this class+date. */
  lessonsOnDate: number;
  /** Alone on its date, and therefore invisible to `npm run lessons:duplicates`
   * (§6 Phase 3). Not a problem — a thing the report must name. */
  aloneOnDate: boolean;
  problems: string[];
}

/** Check every retirement in a plan against §6 Phase 4, and re-derive its
 * orphan-ness arithmetically.
 *
 * The independent check is a surplus count, not a lookup: for each class+date,
 * a slot the schedule asks for once and the database holds twice has a surplus
 * of one, and at most one lesson at that time may be retired. That catches both
 * failure directions — retiring a lesson the schedule still wants, and retiring
 * more lessons than the date can spare — without consulting the planner's
 * pairing at all. */
export function verifyFutureOrphans(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  actions: readonly PlanAction[],
  ctx: ReconcileContext
): OrphanItem[] {
  const byClass = new Map(classes.map((c) => [c.id, c]));
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const months = new Set(ctx.months);

  // Regular lessons per class+date — the raw material for both the surplus
  // arithmetic and the "alone on its date" flag.
  const onDate = new Map<string, Lesson[]>();
  for (const l of lessons) {
    if (l.type !== "regular") continue;
    const k = `${l.classId}|${l.date}`;
    const arr = onDate.get(k);
    if (arr) arr.push(l);
    else onDate.set(k, [l]);
  }

  // Surplus per class+date per slot: stored lessons minus slots the schedule asks
  // for. A retirement spends one unit of surplus; spending more than exists is a
  // plan that deletes a lesson its class still teaches.
  const surplus = new Map<string, Map<string, number>>();
  for (const [k, ls] of onDate) {
    const classId = k.slice(0, k.indexOf("|"));
    const date = k.slice(k.indexOf("|") + 1);
    const klass = byClass.get(classId);
    const counts = new Map<string, number>();
    for (const l of ls) {
      const sk = slotKey(l.start, l.duration);
      counts.set(sk, (counts.get(sk) ?? 0) + 1);
    }
    if (klass) {
      const day = weekdayOf(date);
      for (const s of klass.schedule ?? []) {
        if (s.day !== day) continue;
        const sk = slotKey(s.start, s.duration);
        counts.set(sk, (counts.get(sk) ?? 0) - 1);
      }
    }
    surplus.set(k, counts);
  }

  const retires = actions.filter((a): a is RetireAction => a.verb === "retire");
  const sorted = [...retires].sort((x, y) =>
    x.classId.localeCompare(y.classId) || x.date.localeCompare(y.date) ||
    x.start.localeCompare(y.start) || x.lessonId.localeCompare(y.lessonId));

  return sorted.map((a): OrphanItem => {
    const problems: string[] = [];
    const l = byId.get(a.lessonId);
    const klass = byClass.get(a.classId) ?? null;
    const k = `${a.classId}|${a.date}`;
    const group = onDate.get(k) ?? [];

    if (!l) {
      problems.push("the lesson is not stored");
    } else {
      if (l.type !== "regular") problems.push(`type is "${l.type}" — never reconciled (§2)`);
      if (l.date !== a.date) problems.push(`stored date is ${l.date}, the action says ${a.date}`);
      if (l.date < ctx.appClock) problems.push(`dated before the app clock ${ctx.appClock} — the past is a fact (§4)`);
      if (!months.has(monthOf(l.date))) problems.push("outside the generation window");
      if (l.status !== "Upcoming") problems.push(`status is ${l.status} — not a prediction (§5.5)`);
      if (isManuallyEdited(l)) problems.push("carries teacher's notes — never retired (§5.9)");
      const frozen = freezeReasons(l, ctx);
      if (frozen.length > 0) problems.push(`protected: ${frozen.join(", ")}`);
    }

    if (!klass) problems.push("class no longer exists — never reconciled (§5.8)");
    else if (klass.status !== "Active") problems.push(`class is ${klass.status} — outside reconciliation (ADR-002)`);

    const sk = slotKey(a.start, a.duration);
    const left = surplus.get(k)?.get(sk) ?? 0;
    if (left <= 0) {
      problems.push(
        `the class's schedule still wants a lesson at ${a.start} (${a.duration} min) on ${a.date}` +
        " — this date has no surplus at that slot"
      );
    } else {
      surplus.get(k)!.set(sk, left - 1);
    }

    return {
      lessonId: a.lessonId, classId: a.classId, className: klass?.name ?? "—",
      date: a.date, start: a.start, duration: a.duration, reason: a.reason,
      lessonsOnDate: group.length, aloneOnDate: group.length < 2,
      problems,
    };
  });
}

/* ============================================================================
 * Protected lessons — the set no write verb may touch
 * ==========================================================================*/

export type ProtectedReason =
  | "past-date" | "not-upcoming" | "rescheduled" | "attendance" | "homework"
  | "not-regular" | "class-archived" | "class-missing";

export const PROTECTED_LABEL: Record<ProtectedReason, string> = {
  "past-date": "dated before the app clock (§4)",
  "not-upcoming": "Completed or Cancelled (§5.5)",
  rescheduled: "deliberately rescheduled (§5.4)",
  attendance: "has an attendance record (§6 Phase 4)",
  homework: "referenced by a homework item (§6 Phase 4)",
  "not-regular": "Makeup or Extra — never reconciled (§2)",
  "class-archived": "its class is Archived (§5.8, ADR-002)",
  "class-missing": "its class no longer exists (§5.8)",
};

export interface ProtectedViolation {
  lessonId: string;
  verb: PlanVerb;
  detail: string;
}

export interface ProtectedReport {
  /** How many lessons hold each reason. A lesson may hold several. */
  counts: Record<ProtectedReason, number>;
  /** Distinct protected lessons. */
  total: number;
  /** Lessons protected from the RETIRE verb alone, by their notes (§5.9). They
   * stay reconcilable, and in-place update is how the note survives. */
  noteProtected: number;
  violations: ProtectedViolation[];
}

/** Build the protected set from the design's own filters, then assert the plan
 * stays off it.
 *
 * §6 Phase 4's list is a set of filters on the candidate set, so the check is
 * the same shape: enumerate every lesson that fails to prove it is safe to touch,
 * then look for a write verb naming one. `notes` is handled separately because
 * it is a filter on one verb rather than on the candidate set — retiring a noted
 * lesson is forbidden, correcting it in place is the point. */
export function verifyProtected(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  actions: readonly PlanAction[],
  ctx: ReconcileContext
): ProtectedReport {
  const byClass = new Map(classes.map((c) => [c.id, c]));
  const byId = new Map(lessons.map((l) => [l.id, l]));

  const reasons = new Map<string, ProtectedReason[]>();
  const counts: Record<ProtectedReason, number> = {
    "past-date": 0, "not-upcoming": 0, rescheduled: 0, attendance: 0, homework: 0,
    "not-regular": 0, "class-archived": 0, "class-missing": 0,
  };
  let noteProtected = 0;

  for (const l of lessons) {
    const why: ProtectedReason[] = [];
    if (l.type !== "regular") why.push("not-regular");
    if (l.date < ctx.appClock) why.push("past-date");
    if (l.status !== "Upcoming") why.push("not-upcoming");
    if (effectiveOrigin(l, ctx.legacyOriginFallback)) why.push("rescheduled");
    if (ctx.attended.has(l.id)) why.push("attendance");
    if (ctx.homeworked.has(l.id)) why.push("homework");
    const klass = byClass.get(l.classId);
    if (!klass) why.push("class-missing");
    else if (klass.status === "Archived") why.push("class-archived");

    if (l.type === "regular" && isManuallyEdited(l)) noteProtected++;
    if (why.length === 0) continue;
    reasons.set(l.id, why);
    for (const r of why) counts[r]++;
  }

  const violations: ProtectedViolation[] = [];
  for (const a of actions) {
    if (a.verb !== "update" && a.verb !== "insert" && a.verb !== "retire") continue;

    if (a.verb === "insert") {
      // An insert mints a NEW id. Colliding with any stored lesson — protected or
      // not — would write over it, so the whole collection is the check.
      if (byId.has(a.lessonId)) {
        violations.push({ lessonId: a.lessonId, verb: a.verb, detail: "the id this insert would mint already exists" });
      }
      continue;
    }

    const why = reasons.get(a.lessonId);
    if (why) {
      violations.push({
        lessonId: a.lessonId, verb: a.verb,
        detail: why.map((r) => PROTECTED_LABEL[r]).join("; "),
      });
    }
    const l = byId.get(a.lessonId);
    if (a.verb === "retire" && l && isManuallyEdited(l)) {
      violations.push({ lessonId: a.lessonId, verb: a.verb, detail: "carries teacher's notes (§5.9)" });
    }
  }

  violations.sort((x, y) => x.lessonId.localeCompare(y.lessonId) || x.verb.localeCompare(y.verb));
  return { counts, total: reasons.size, noteProtected, violations };
}

/* ============================================================================
 * §6 Phases 1 & 2 — the snapshot and the baseline it carries
 * ==========================================================================*/

/** One month's reported figures, recorded before anything is written (§6 Phase 2).
 *
 * Phase 5 recomputes these and requires every PAST month to be bit-identical.
 * The three are kept together because they disagree in an informative way: they
 * are derived from the same lessons by different routes, so a difference between
 * them localises what moved (§9.1 is exactly such a disagreement). */
export interface MonthBaseline {
  month: string;
  /** True when the whole month is behind the app clock — the months that may
   * never move. */
  past: boolean;
  revenue: RevenueResult;
  teachingHours: number;
  attendanceRate: number;
  /** Lessons dated in this month, by type — the per-lesson revenue denominator
   * and the reason a deletion moves a closed month's figures (§4). */
  lessonCounts: { regular: number; makeup: number; extra: number };
}

/** What a `npm run lessons:snapshot` directory carries, as `manifest.json`.
 *
 * The digest is the load-bearing field: `--apply` refuses to write unless it
 * still matches the live collection, so a stale snapshot cannot be mistaken for
 * a rollback path. */
export interface SnapshotManifest {
  appClock: string;
  window: string[];
  retireEnabled: boolean;
  /** Document counts per exported collection. */
  collections: Record<string, number>;
  lessons: { count: number; digest: string };
  /** The exact ids a Phase 0 apply would stamp — what ROLLBACK.md un-stamps. */
  phase0Targets: string[];
  baseline: MonthBaseline[];
}

/* ============================================================================
 * The report
 * ==========================================================================*/

export interface MigrationReport {
  appClock: string;
  window: string[];
  /** Mirrors `RETIRE_ENABLED`. Passed in rather than imported so this module
   * stays free of the reconciler's database dependencies. */
  retireEnabled: boolean;
  totals: {
    classes: number;
    activeClasses: number;
    lessons: number;
    regularLessons: number;
    attendanceRecords: number;
    homeworkLinks: number;
  };
  plan: PlanSummary;
  phase0: { items: Phase0Item[]; ok: boolean; loadBearing: number };
  equivalence: Phase0Equivalence;
  orphans: { items: OrphanItem[]; ok: boolean; aloneOnDate: number };
  protectedSet: ProtectedReport;
  outOfScope: {
    archivedClasses: Array<{ classId: string; name: string; lessons: number; from: string; to: string }>;
    classlessLessons: Array<{ lessonId: string; classId: string; date: string; start: string; status: LessonStatus }>;
  };
  /** What still stands between here and enabling RETIRE (5.6.4). */
  verdict: { ok: boolean; blockers: string[] };
}

export function buildMigrationReport(input: {
  classes: readonly Klass[];
  lessons: readonly Lesson[];
  ctx: ReconcileContext;
  retireEnabled: boolean;
}): MigrationReport {
  const { classes, lessons, ctx, retireEnabled } = input;

  const plan = planReconciliation(classes, lessons, ctx);
  const phase0Items = verifyPhase0(classes, lessons, ctx);
  const equivalence = phase0Equivalence(classes, lessons, phase0Items, ctx);
  const orphanItems = verifyFutureOrphans(classes, lessons, plan.actions, ctx);
  const protectedSet = verifyProtected(classes, lessons, plan.actions, ctx);

  const archived = findArchivedClassLessons(classes, lessons, ctx.appClock)
    .map(({ klass, lessons: lingering }) => {
      const dates = lingering.map((l) => l.date).sort();
      return {
        classId: klass.id, name: klass.name, lessons: lingering.length,
        from: dates[0], to: dates[dates.length - 1],
      };
    })
    .sort((a, b) => a.classId.localeCompare(b.classId));

  const classless = findOrphanedLessons(classes, lessons)
    .map((l) => ({ lessonId: l.id, classId: l.classId, date: l.date, start: l.start, status: l.status }))
    .sort((a, b) => a.lessonId.localeCompare(b.lessonId));

  const phase0Ok = phase0Items.every((i) => i.problems.length === 0);
  const orphansOk = orphanItems.every((i) => i.problems.length === 0);

  const blockers: string[] = [];
  if (!phase0Ok) {
    blockers.push(`${phase0Items.filter((i) => i.problems.length > 0).length} legacy reschedule(s) failed verification`);
  }
  if (!equivalence.identical) {
    blockers.push(
      `the back-fill would change the plan: ${equivalence.onlyBefore.length} action(s) lost,` +
      ` ${equivalence.onlyAfter.length} gained`
    );
  }
  if (!orphansOk) {
    blockers.push(`${orphanItems.filter((i) => i.problems.length > 0).length} planned retirement(s) failed verification`);
  }
  if (protectedSet.violations.length > 0) {
    blockers.push(`${protectedSet.violations.length} write action(s) target a protected lesson`);
  }
  // Always listed while the work is outstanding: these are the two states 5.6.4
  // needs, not defects in this report.
  if (phase0Items.length > 0) {
    blockers.push(`the Phase 0 back-fill has not been applied — ${phase0Items.length} lesson(s) still carry no stored origin`);
  }
  if (ctx.legacyOriginFallback) {
    blockers.push("legacyOriginFallback is still on — it may only be removed after Phase 0 is applied and verified");
  }

  return {
    appClock: ctx.appClock,
    window: ctx.months,
    retireEnabled,
    totals: {
      classes: classes.length,
      activeClasses: classes.filter((c) => c.status === "Active").length,
      lessons: lessons.length,
      regularLessons: lessons.filter((l) => l.type === "regular").length,
      attendanceRecords: ctx.attended.size,
      homeworkLinks: ctx.homeworked.size,
    },
    plan: summarizePlan(plan.actions),
    phase0: { items: phase0Items, ok: phase0Ok, loadBearing: phase0Items.filter((i) => i.loadBearing).length },
    equivalence,
    orphans: { items: orphanItems, ok: orphansOk, aloneOnDate: orphanItems.filter((i) => i.aloneOnDate).length },
    protectedSet,
    outOfScope: { archivedClasses: archived, classlessLessons: classless },
    verdict: {
      ok: phase0Ok && orphansOk && equivalence.identical && protectedSet.violations.length === 0,
      blockers,
    },
  };
}

/* --------------------------------------------------------------- rendering */

const RULE = "=".repeat(76);
const THIN = "-".repeat(76);

const pad = (label: string, value: string | number) =>
  `  ${`${label} `.padEnd(53, ".")} ${value}`;

/** The report as text. Deterministic: no wall clock, every list pre-sorted, so
 * two runs over unchanged data are byte-identical and can be diffed. */
export function formatMigrationReport(r: MigrationReport): string {
  const out: string[] = [];
  const say = (...lines: string[]) => out.push(...lines);

  say(RULE);
  say("MIGRATION REPORT — Sprint 5.6.3 (RECURRENCE_DESIGN.md §6)");
  say(RULE);
  say(`  app clock ......... ${r.appClock}`);
  say(`  window ............ ${r.window[0]} .. ${r.window[r.window.length - 1]}`);
  say(`  mode .............. READ-ONLY. Nothing has been created, updated or deleted.`);
  say(`  RETIRE_ENABLED .... ${r.retireEnabled} ${r.retireEnabled ? "" : "(the hard delete is off — §8, 5.6.4 flips it)"}`);
  say("");
  say(pad("Classes", `${r.totals.classes} (${r.totals.activeClasses} Active)`));
  say(pad("Lessons", r.totals.lessons));
  say(pad("…of which Regular", r.totals.regularLessons));
  say(pad("Attendance records", r.totals.attendanceRecords));
  say(pad("Homework lesson links", r.totals.homeworkLinks));

  // ---- 1. Phase 0 ----
  say("", RULE);
  say("1 — PHASE 0: legacy reschedule origins (§6 Phase 0, mandatory & blocking)");
  say(RULE);
  say("Each lesson below was moved before the origin fields existed. The only");
  say("evidence is that its id-encoded date disagrees with its stored date. The");
  say("back-fill stamps that origin as data; it changes nothing else, ever.");
  say("");
  if (r.phase0.items.length === 0) {
    say("  None. Every moved lesson already carries a stored origin —");
    say("  `legacyOriginFallback` can be retired (§5.4).");
  }
  for (const i of r.phase0.items) {
    say(`  ${i.lessonId}`);
    say(`    class ......... ${i.className} (${i.classId})`);
    say(`    sits at ....... ${i.date} ${i.start} (${i.duration} min) ${i.status}   [unchanged]`);
    say(`    would stamp ... originalDate=${i.target.originalDate}` +
      ` originalStart=${i.target.originalStart} originalDuration=${i.target.originalDuration}`);
    say(`    verified ...... ${i.problems.length === 0 ? "PASS" : "FAIL"}`);
    for (const p of i.problems) say(`      ! ${p}`);
    for (const n of i.notes) say(`      - ${n}`);
  }
  say("");
  say(pad("Lessons needing an origin", r.phase0.items.length));
  say(pad("…verified as genuine moves", r.phase0.items.filter((i) => i.problems.length === 0).length));
  say(pad("…load-bearing without the fallback", r.phase0.loadBearing));

  // ---- 2. Equivalence ----
  say("", RULE);
  say("2 — PHASE 0 EQUIVALENCE: does the back-fill change any decision?");
  say(RULE);
  say("Left: the plan today, origins inferred from ids, fallback ON.");
  say("Right: the plan with origins STORED and the fallback OFF — the state Phase 0");
  say("exists to reach. They must be identical: Phase 0 changes where the reconciler");
  say("reads a fact, never what it concludes.");
  say("");
  const verbs = ["keep", "update", "insert", "retire", "strand", "skip"] as const;
  say(`    verb        before    after`);
  for (const v of verbs) {
    say(`    ${v.padEnd(10)}  ${String(r.equivalence.before[v]).padStart(6)}   ${String(r.equivalence.after[v]).padStart(6)}`);
  }
  say("");
  say(`  RESULT: ${r.equivalence.identical ? "IDENTICAL — the fallback is safe to remove once applied" : "DIFFERENT — BLOCKING"}`);
  for (const k of r.equivalence.onlyBefore) say(`    - lost:   ${k}`);
  for (const k of r.equivalence.onlyAfter) say(`    + gained: ${k}`);

  // ---- 3. Future orphans ----
  say("", RULE);
  say("3 — FUTURE ORPHANS: every planned RETIRE, proved independently");
  say(RULE);
  say("Re-derived from the class schedules rather than believed: a retirement is");
  say("corroborated only when its date holds MORE lessons at that slot than the");
  say("schedule asks for. Nothing here is executed — RETIRE is off.");
  say("");
  let currentClass = "";
  for (const i of r.orphans.items) {
    if (i.classId !== currentClass) {
      currentClass = i.classId;
      say(THIN);
      say(`  ${i.className} (${i.classId})`);
      say(THIN);
    }
    const flags = [
      i.problems.length === 0 ? "PASS" : "FAIL",
      i.aloneOnDate ? "alone on its date — invisible to lessons:duplicates" : `${i.lessonsOnDate} lessons on this date`,
    ].join("  |  ");
    say(`  ${i.date} ${i.start} (${i.duration} min)  ${i.lessonId}`);
    say(`    ${flags}`);
    say(`    reason: ${i.reason}`);
    for (const p of i.problems) say(`      ! ${p}`);
  }
  say("");
  say(pad("Planned retirements", r.orphans.items.length));
  say(pad("…independently verified", r.orphans.items.filter((i) => i.problems.length === 0).length));
  say(pad("…alone on their date", r.orphans.aloneOnDate));
  say(pad("EXECUTED", `0 (RETIRE_ENABLED=${r.retireEnabled})`));

  // ---- 4. Protected ----
  say("", RULE);
  say("4 — PROTECTED LESSONS: the set no write verb may touch (§6 Phase 4)");
  say(RULE);
  for (const [reason, n] of Object.entries(r.protectedSet.counts) as Array<[ProtectedReason, number]>) {
    say(pad(PROTECTED_LABEL[reason], n));
  }
  say(pad("Distinct protected lessons", r.protectedSet.total));
  say(pad("Note-protected from RETIRE alone (§5.9)", r.protectedSet.noteProtected));
  say("");
  say(`  RESULT: ${r.protectedSet.violations.length === 0
    ? "no write action targets a protected lesson"
    : `${r.protectedSet.violations.length} VIOLATION(S) — BLOCKING`}`);
  for (const v of r.protectedSet.violations) say(`    ! ${v.verb} ${v.lessonId} — ${v.detail}`);

  // ---- 5. Out of scope ----
  say("", RULE);
  say("5 — OUT OF SCOPE, REPORTED ONLY (§5.8, ADR-002)");
  say(RULE);
  say("  Archived classes — no update, no insert, no retire. Their future lessons");
  say("  stay put until they age out of the rolling window.");
  if (r.outOfScope.archivedClasses.length === 0) say("    none");
  for (const a of r.outOfScope.archivedClasses) {
    say(`    ${a.name} (${a.classId}) — ${a.lessons} future lesson(s)  ${a.from} .. ${a.to}`);
  }
  say("");
  say("  Lessons whose class no longer exists — no schedule to compare against.");
  say("  These need a product decision of their own, not reconciler output.");
  if (r.outOfScope.classlessLessons.length === 0) say("    none");
  const byMissingClass = new Map<string, typeof r.outOfScope.classlessLessons>();
  for (const l of r.outOfScope.classlessLessons) {
    const arr = byMissingClass.get(l.classId);
    if (arr) arr.push(l);
    else byMissingClass.set(l.classId, [l]);
  }
  for (const [classId, ls] of [...byMissingClass].sort((a, b) => a[0].localeCompare(b[0]))) {
    const past = ls.filter((l) => l.status !== "Upcoming").length;
    say(`    classId ${classId} — ${ls.length} lesson(s), ${past} not Upcoming, ${ls.length - past} Upcoming`);
    say(`      ${ls[0].date} .. ${ls[ls.length - 1].date}`);
  }

  // ---- verdict ----
  say("", RULE);
  say("VERDICT");
  say(RULE);
  say(`  Verification: ${r.verdict.ok ? "PASS — every check the design states is satisfied" : "FAIL"}`);
  say("");
  say("  Remaining before RETIRE may be enabled (5.6.4):");
  if (r.verdict.blockers.length === 0) say("    none");
  for (const b of r.verdict.blockers) say(`    - ${b}`);
  say("");
  say("  This is a report. Nothing has been written.");
  say("");

  return out.join("\n");
}
