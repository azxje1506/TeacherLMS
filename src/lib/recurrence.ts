/* Recurrence — the PURE reconciliation core (Sprint 5.6.0 … 5.6.2).
 *
 * PURE BY CONSTRUCTION. Nothing in this file reads or writes the database: no
 * Mongoose import, no model import, no connection, no async function. Every
 * export is a pure function over values the caller has already loaded. It
 * produces a PLAN — a list of the updates, inserts and retirements a reconciler
 * WOULD perform — and executes none of them. Sprint 5.6.2 added an executor that
 * acts on that plan (src/lib/reconciler.ts); this module still never writes, and
 * a test in tests/recurrence.test.ts enforces that by scanning it for database
 * access.
 *
 * WHY IT EXISTS (see RECURRENCE_DESIGN.md §1, §5 and ADR-001)
 * `ensureRegularLessons` walks schedule -> lessons and has exactly one verb:
 * create. A Regular lesson's id embeds its start time, so editing a class's slot
 * mints a parallel series and the old one becomes unreachable — never updated,
 * never retired. The design's answer is to stop using the id as the
 * reconciliation key: reconcile on `(classId, date)` and compare `start` /
 * `duration` as FIELDS. This module is that comparison, and nothing else.
 *
 * WHAT IT GUARANTEES
 *  - The past is never in the plan. Any date before the app clock returns no
 *    actions at all, so historical revenue, teaching hours and attendance rates
 *    cannot move (§4).
 *  - A lesson is excluded unless it positively proves it is safe to touch:
 *    status must be `Upcoming`, and it must carry no reschedule origin, no
 *    attendance record and no homework reference (§6 Phase 4). Every protection
 *    is a filter on the candidate set, not a rule someone has to remember.
 *  - A frozen lesson still CONSUMES its slot (§5.6), so a cancellation is never
 *    silently undone by an insert on the next pass.
 *  - A lesson a teacher has written on is never RETIRED (§5.9). It stays
 *    reconcilable — in-place update is how its notes survive a slot move — and
 *    is reported as `strand` when no slot survives for it at all.
 *  - A class with no live intent is never presented to the algorithm (§5.8,
 *    ADR-002): an Archived class produces no actions of any verb, and so does any
 *    status the engine does not recognise.
 *  - An Ended class is planned against an EMPTY schedule, so it can only retire,
 *    strand or skip — never insert, never update. Ending a class clears its future
 *    through the same protections every other plan passes, not through a separate
 *    delete path. Its scope starts at NEXT month: the current calendar month is
 *    excluded so retirement cannot shrink the denominator `computeRevenue` bills
 *    that month against (see `planClass`).
 *
 * The window/id/status helpers at the top were lifted verbatim out of
 * `src/lib/lessons.ts` so the planner and the live generator cannot drift apart.
 * `lessons.ts` now imports them from here; their behaviour is unchanged. */

import { toMinutes } from "./calc";
import {
  CURRENT_MONTH, LESSON_WINDOW_NEXT_MONTHS, LESSON_WINDOW_PREVIOUS_MONTHS, TODAY_ISO,
} from "./constants";
import type { ClassStatus, Klass, Lesson, LessonStatus, ScheduleSlot } from "./types";

/* ----------------------------------------------------- class lifecycle rules */

/* The two questions every guard in the app is really asking about a class's
 * status, answered once, here, rather than re-derived as an inline comparison in
 * a dozen modules. They are separate questions with separate answers, which is
 * exactly why `status === "Archived"` was never a safe thing to search-and-replace
 * once a third status existed. */

/** Classes that are TEACHING RIGHT NOW.
 *
 * Only these generate Regular lessons (`ensureRegularLessons`), and only these
 * occupy a weekly slot for the single-teacher overlap rule
 * (`assertNoScheduleConflict` / `scheduleAvailability`).
 *
 * Ended and Archived are both absent, for the same reason and with the same
 * effect: neither will teach in its current state, so neither may hold the
 * teacher's time against a class that will. What separates them is what happens
 * to the lessons already generated — see RECONCILABLE_CLASS_STATUSES. */
export const TEACHING_CLASS_STATUSES = ["Active"] as const satisfies readonly ClassStatus[];

/** Classes the reconciler may act on, and what each is reconciled TOWARD:
 *
 *  - `Active` — toward its own schedule. Insert what is missing, correct what
 *    moved, retire what no slot supports.
 *  - `Ended`  — toward NOTHING. Its desired set is empty by construction (see
 *    `planClass`), so the only verbs it can produce are retire, strand and skip:
 *    no insert and no update is representable for an Ended class. That is what
 *    lets "ending a class clears its future" reuse the ordinary reconciliation
 *    machinery — every §6 Phase 4 protection, the audit, the strand rule for
 *    teacher's notes — instead of adding a second, unguarded delete path.
 *
 * `Archived` is deliberately absent (§5.8, ADR-002). An archived class has
 * withdrawn its intent without saying its teaching is over, so comparing its
 * fossil schedule against its lessons would turn one reversible list decision
 * into hundreds of irreversible hard deletes. Archive is not a quiet Ended. */
export const RECONCILABLE_CLASS_STATUSES = ["Active", "Ended"] as const satisfies readonly ClassStatus[];

/* Both predicates take a plain `string` and test for MEMBERSHIP of an allow-list
 * rather than for the statuses they exclude. An unrecognised value — a
 * hand-edited document, a status a later sprint adds and forgets to wire up — is
 * therefore neither teaching nor reconcilable: it generates nothing, occupies
 * nothing, and is never written to. That is §6 Phase 4's "excluded unless it
 * positively proves it is safe" applied to class status, and it is the reason
 * these are not written as `!== "Archived"`. */

export function isTeachingClass(status: string): boolean {
  return (TEACHING_CLASS_STATUSES as readonly string[]).includes(status);
}

export function isReconcilableClass(status: string): boolean {
  return (RECONCILABLE_CLASS_STATUSES as readonly string[]).includes(status);
}

/* ------------------------------------------------------- rolling-window utils */

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** All ISO dates in `YYYY-MM` whose weekday === `dow`. */
export function datesForWeekday(month: string, dow: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  const dim = daysInMonth(y, m);
  for (let d = 1; d <= dim; d++) {
    if (new Date(y, m - 1, d).getDay() === dow) {
      out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }
  return out;
}

/** The window months (previous / current / next N) as `YYYY-MM`, derived from
 * the app clock and the configurable constants — no hardcoded months. */
export function windowMonths(): string[] {
  const [y, m] = CURRENT_MONTH.split("-").map(Number);
  const out: string[] = [];
  for (let i = -LESSON_WINDOW_PREVIOUS_MONTHS; i <= LESSON_WINDOW_NEXT_MONTHS; i++) {
    const d = new Date(y, m - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Stable Regular-lesson id — the one thing shared with the seed generator.
 *
 * ADR-001: this id is now an OPAQUE primary key. It is still minted in this
 * format so every existing reference survives (`AttendanceRecord.lessonId`,
 * `Homework.lessonId`, `Lesson.fromId`), but reconciliation never keys on it and
 * never recomputes it for a lesson that already exists. */
export function regularId(classId: string, date: string, start: string): string {
  return `L-${classId}-${date}-${start.replace(":", "")}`;
}

/** A generated/created lesson is Completed if its date is before the app clock,
 * otherwise Upcoming. Cancellation is only ever a user action. */
export function statusForDate(date: string, appClock: string = TODAY_ISO): LessonStatus {
  return date < appClock ? "Completed" : "Upcoming";
}

/** Is this date behind the app clock?
 *
 * `date === appClock` is NOT past. Today's lesson is still to be taught, which is
 * the convention `statusForDate` above encodes (today generates as `Upcoming`) and
 * the one `planDate` applies (it returns no actions for `date < ctx.appClock`, so
 * today is in scope). Stated once, here, so a third caller cannot invent a
 * different edge — the reason this module holds the window helpers at all. */
export function isPastDate(date: string, appClock: string = TODAY_ISO): boolean {
  return date < appClock;
}

/** Weekday of an ISO date, in local time (matches how the app reads dates). */
export function weekdayOf(iso: string): number {
  return new Date(iso + "T00:00:00").getDay();
}

/** The `YYYY-MM` an ISO date belongs to. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/* ------------------------------------------------------------ legacy origins */

/** The slot a generated Regular lesson's id was built for, or null when the id
 * does not follow the generated convention (Makeup `M-…`, Extra `X-…`, ObjectId).
 *
 * The id is opaque to reconciliation (ADR-001) and this is the ONE exception:
 * RECURRENCE_DESIGN §5.4 / §6 Phase 0. Eleven live lessons were rescheduled
 * before the origin fields existed, and the disagreement between their id and
 * their `date` is the only surviving evidence of the move. Until the Phase 0
 * back-fill has run, dropping this signal would let the reconciler retire eleven
 * deliberately moved lessons — the highest risk in the plan. */
export function originFromId(id: string): { date: string; start: string } | null {
  const m = /^L-.+-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/.exec(id);
  return m ? { date: m[1], start: `${m[2]}:${m[3]}` } : null;
}

export interface LessonOrigin {
  date: string;
  start: string;
  duration: number;
  /** `stored` = the lesson's own origin fields; `legacy-id` = inferred from the
   * id because the move pre-dates those fields (§6 Phase 0). */
  source: "stored" | "legacy-id";
}

/** Where this lesson came from, or null when it has never been moved.
 *
 * `legacyFallback` is what makes the reconciler safe BEFORE the Phase 0 back-fill
 * has been deployed. Once every legacy move carries stored origin fields it
 * becomes redundant, never wrong. */
export function effectiveOrigin(l: Lesson, legacyFallback = true): LessonOrigin | null {
  if (l.originalDate) {
    return {
      date: l.originalDate,
      start: l.originalStart ?? l.start,
      duration: l.originalDuration ?? l.duration,
      source: "stored",
    };
  }
  if (!legacyFallback) return null;
  const encoded = originFromId(l.id);
  if (!encoded || encoded.date === l.date) return null;
  // Duration was never encoded in the id, so the lesson's own is the best the
  // data supports. It is used only to describe a vacated slot, never written.
  return { date: encoded.date, start: encoded.start, duration: l.duration, source: "legacy-id" };
}

/** The §6 Phase 0 work list: Regular lessons that were moved before the origin
 * fields existed and therefore carry no `originalDate`. Read-only — this reports
 * what a back-fill WOULD stamp; it stamps nothing. */
export function findLegacyReschedules(
  lessons: readonly Lesson[]
): Array<{ lesson: Lesson; inferred: LessonOrigin }> {
  const out: Array<{ lesson: Lesson; inferred: LessonOrigin }> = [];
  for (const l of lessons) {
    if (l.type !== "regular" || l.originalDate) continue;
    const inferred = effectiveOrigin(l, true);
    if (inferred) out.push({ lesson: l, inferred });
  }
  return out;
}

/** Lessons whose class no longer exists. `deleteClass` removes only the Class
 * row (§2), so these render `className: "—"` and drop out of revenue silently.
 * Reported, never reconciled: with no schedule there is nothing to compare. */
export function findOrphanedLessons(
  classes: readonly Klass[],
  lessons: readonly Lesson[]
): Lesson[] {
  const known = new Set(classes.map((c) => c.id));
  return lessons.filter((l) => !known.has(l.classId));
}

/** What an Archived class still holds, split by whether it is still recoverable.
 *
 * ADR-002 removes these from reconciliation, and §5.8 requires them to stay
 * VISIBLE: generation already stopped at archive, so the set never grows, but the
 * lessons keep appearing on the Calendar and Lesson List until they age out of
 * the rolling window. Being visible is not the same as being in scope — nothing
 * here is ever planned.
 *
 * TWO SETS, BECAUSE THE LIFECYCLE GIVES THEM DIFFERENT MEANINGS. Once a lesson's
 * date passes under an Archived class it is settled as `Cancelled`
 * (src/lib/lifecycle.ts), which is precisely when a single `Upcoming`-only filter
 * would have dropped it — the report would have emptied itself at the exact moment
 * archiving started having an effect. So:
 *
 *  - `remaining` — still in the future and still `Upcoming`. What a Restore would
 *    recover: these resume as scheduled and are never regenerated on top of.
 *  - `cancelledWhileArchived` — already settled. What the archive has cost so far,
 *    and the audit trail behind a reduced month.
 *
 * `cancelledWhileArchived` IS APPROXIMATE, and deliberately so. The lifecycle and
 * `cancelLesson` write the same document, so a lesson the teacher cancelled before
 * the archive appears here too; the data model has no historical attribution and
 * this gate does not add one. The one discriminator the data does support:
 * `chargeable === true` can only be a teacher's cancellation, since the lifecycle
 * always writes `false`. Nothing depends on telling them apart — revenue, restore
 * and reconciliation all treat `Cancelled` as `Cancelled` — so the imprecision is
 * confined to this report.
 *
 * ARCHIVED ONLY, and that is the whole point of the function. An Ended class has
 * no lingering set to report: ending is reconciled (`planClass` plans it toward an
 * empty schedule), so its future reconcilable lessons are retired on the
 * transition rather than left behind. What survives an Ended transition survives
 * because it is PROTECTED — cancelled, attended, homeworked, deliberately
 * rescheduled or carrying teacher's notes — and a protected lesson is not
 * lingering, it is being kept on purpose. Reporting those here would read as a
 * backlog when it is the correct outcome.
 *
 * Not window-filtered: a lingering lesson is lingering whether or not the current
 * window reaches it. A class is reported when EITHER set is non-empty. */
export function findArchivedClassLessons(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  appClock: string = TODAY_ISO
): Array<{ klass: Klass; remaining: Lesson[]; cancelledWhileArchived: Lesson[] }> {
  const out: Array<{ klass: Klass; remaining: Lesson[]; cancelledWhileArchived: Lesson[] }> = [];
  for (const c of classes) {
    if (c.status !== "Archived") continue;
    const mine = lessons.filter((l) => l.classId === c.id && l.type === "regular");
    const remaining = mine.filter((l) => l.date >= appClock && l.status === "Upcoming");
    const cancelledWhileArchived = mine.filter((l) => l.date < appClock && l.status === "Cancelled");
    if (remaining.length > 0 || cancelledWhileArchived.length > 0) {
      out.push({ klass: c, remaining, cancelledWhileArchived });
    }
  }
  return out;
}

/** Which `(classId, date, start)` slots the read-side top-up must NOT generate
 * into, keyed `classId|date|start` (§5.7).
 *
 * `ensureRegularLessons` used to decide this by computing the canonical id
 * `L-<classId>-<date>-<HHMM>` and inserting when no document held it. That is an
 * ID-keyed test, and ADR-001 made the id opaque precisely because it stops being
 * a reliable answer: the reconciler UPDATES a lesson's `start` in place and
 * deliberately keeps its id, so a lesson minted at 22:00 and corrected to 10:00
 * still carries `…-2200`. The top-up then computed `…-1000`, found nothing, and
 * inserted a SECOND lesson into a slot that was already occupied — re-forking the
 * series the update had just repaired.
 *
 * A slot is satisfied when either:
 *
 *  - **a Regular lesson stands in it** — same class, same date, same start. Its id
 *    plays no part in this, which is the whole point. Status is not consulted
 *    either: a Cancelled lesson occupies its slot exactly as §5.6 requires, and a
 *    lesson rescheduled ONTO this date occupies the slot it landed in.
 *  - **a reschedule vacated it** — the lesson moved away, and §5.6 says the slot
 *    it left stays spoken for so the move does not silently undo itself. Which
 *    slot that is comes from `originClaim`, where the stored origin fields are
 *    authoritative and the id survives only as a defensive fallback for legacy
 *    data that carries none.
 *
 * `duration` is deliberately NOT part of the key. Two lessons may never share a
 * start time on one date whatever their lengths, and a duration-only difference is
 * something the reconciler corrects IN PLACE (§2, "change duration"); generating a
 * second lesson beside the first would be the very defect this guard exists to
 * prevent. Matching on start alone mirrors `planDate`'s own slot claims.
 *
 * Pure, so the decision is unit-testable without a database — `src/lib/lessons.ts`
 * declares `server-only` and cannot be imported by the test runner. */
export function satisfiedRegularSlots(lessons: readonly OccupancyLesson[]): Set<string> {
  const out = new Set<string>();
  for (const l of lessons) {
    if (l.type !== "regular") continue;
    out.add(slotKey(l.classId, l.date, l.start));
    const origin = originClaim(l);
    if (origin) out.add(slotKey(l.classId, origin.date, origin.start));
  }
  return out;
}

/** The narrow view of a Regular lesson the occupancy scan reads. `id` is carried
 * for ONE purpose — the defensive legacy fallback in `originClaim` — and is never
 * used to identify the slot a lesson currently stands in (ADR-001). */
export type OccupancyLesson = Pick<
  Lesson, "id" | "classId" | "type" | "date" | "start" | "originalDate" | "originalStart"
>;

/** The slot this lesson VACATED, or null when it still sits where it was minted.
 *
 * **Stored origin fields are authoritative.** When `originalDate` is present the
 * move was recorded properly and the id is never consulted. `originalStart ?? start`
 * mirrors `effectiveOrigin` exactly, so a half-written origin — a date with no
 * start, which `rescheduleLesson` cannot produce but pre-Phase-0 data could —
 * claims the lesson's current start instead of claiming nothing at all.
 *
 * **The id is a defensive legacy fallback only**, reached solely when no stored
 * origin exists. Before this module existed, `ensureRegularLessons` keyed its
 * upsert on the canonical id, which meant a moved lesson's id-encoded slot was
 * protected as a side effect of the filter matching. Keying on stored values
 * instead is the fix (§5.7) but it dropped that accident, leaving the vacated slot
 * of a legacy move with no stored origin open to a fresh insert. Phase 0
 * back-filled all 11 such lessons and `rescheduleLesson` always writes the origin
 * triple, so this branch should now be unreachable — it exists so that the guard
 * fails CLOSED on data that predates or violates that precondition rather than
 * silently re-forking a series.
 *
 * A canonical id is not evidence of a move: the fallback fires only when the
 * id-encoded slot disagrees with where the lesson actually sits. Note that unlike
 * `effectiveOrigin` — which describes cross-date moves for the planner's `vacated`
 * map and so compares the date alone — a disagreement in EITHER the date or the
 * start counts here, because an in-place start correction (ADR-001 keeps the id)
 * leaves exactly that footprint and is the shape this guard exists to survive. */
export function originClaim(l: OccupancyLesson): { date: string; start: string } | null {
  if (l.originalDate) return { date: l.originalDate, start: l.originalStart ?? l.start };
  const encoded = originFromId(l.id);
  if (!encoded || (encoded.date === l.date && encoded.start === l.start)) return null;
  return encoded;
}

/** The key `satisfiedRegularSlots` builds, so callers cannot format it differently. */
export function slotKey(classId: string, date: string, start: string): string {
  return `${classId}|${date}|${start}`;
}

/* ------------------------------------------------------------------ context */

/** Everything the planner needs that is not a Class or a Lesson. Assembled by
 * the caller from its own reads so this module stays free of I/O. */
export interface ReconcileContext {
  /** Nothing on or before this date is ever in the plan (§4). */
  appClock: string;
  /** The generation window, as `YYYY-MM`. */
  months: string[];
  /** `AttendanceRecord.lessonId` — a lesson with a register is frozen. */
  attended: ReadonlySet<string>;
  /** `Homework.lessonId` — currently vacuous in the live data, must still exist (§7). */
  homeworked: ReadonlySet<string>;
  /** Treat an id/date disagreement as a reschedule (§5.4).
   *
   * OFF SINCE PHASE 0 WAS APPLIED (2026-08-07). The back-fill stored the origin
   * triple on all 11 legacy moves, so the reconciler no longer parses a lesson id
   * to make a safety decision — the coupling ADR-001 exists to eliminate. It
   * survives as an explicit opt-in for one caller only: the Phase 0 verification
   * in `src/lib/migration.ts`, which plans BOTH ways to prove the two agree.
   * Nothing on the live write path may turn it on again. */
  legacyOriginFallback: boolean;
}

export function reconcileContext(overrides: Partial<ReconcileContext> = {}): ReconcileContext {
  return {
    appClock: TODAY_ISO,
    months: windowMonths(),
    attended: new Set<string>(),
    homeworked: new Set<string>(),
    legacyOriginFallback: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------ freeze filters */

/** Why a lesson may not be touched. Empty array = reconcilable. */
export type FreezeReason =
  | "not-upcoming"
  | "rescheduled"
  | "rescheduled-legacy"
  | "attendance"
  | "homework";

export const FREEZE_LABEL: Record<FreezeReason, string> = {
  "not-upcoming": "not Upcoming (Completed or Cancelled is a fact, not a prediction)",
  rescheduled: "deliberately rescheduled (carries a stored origin)",
  "rescheduled-legacy": "deliberately rescheduled before the origin fields existed (inferred from its id)",
  attendance: "has an attendance record",
  homework: "referenced by a homework item",
};

/** Every reason this lesson is frozen, in the order the design states them.
 * A lesson is reconcilable only when this returns an empty array — it fails
 * closed, so a new protection is added here and nowhere else. */
export function freezeReasons(l: Lesson, ctx: ReconcileContext): FreezeReason[] {
  const out: FreezeReason[] = [];
  if (l.status !== "Upcoming") out.push("not-upcoming");
  if (l.originalDate) out.push("rescheduled");
  else if (ctx.legacyOriginFallback && effectiveOrigin(l, true)) out.push("rescheduled-legacy");
  if (ctx.attended.has(l.id)) out.push("attendance");
  if (ctx.homeworked.has(l.id)) out.push("homework");
  return out;
}

/** Has a human written on this lesson? (§5.9)
 *
 * `notes` is the ONE signal, and it is unambiguous: `ensureRegularLessons`
 * inserts `notes: ""`, and the only path that writes anything else onto an
 * existing Regular lesson is `updateLesson` — a human action. Nothing else in
 * the system stores a lesson's notes and retire is a hard delete, so the text is
 * gone for good if the lesson goes.
 *
 * `classroom` is deliberately NOT consulted: generation stamps the class's room
 * onto every lesson at insert, so the stored value cannot tell a human override
 * apart from generated data — and `classroomFor()` discards it at read time
 * anyway, so no screen shows it.
 *
 * This is NOT a freeze reason. A manually edited lesson stays in the reconcilable
 * set and is corrected in place like any other; the protection is a filter on the
 * RETIRE verb alone (§5.2 step 7), because in-place update is what preserves the
 * note rather than what threatens it. */
export function isManuallyEdited(l: Lesson): boolean {
  return (l.notes ?? "").trim() !== "";
}

/* --------------------------------------------------------------- plan shapes */

/** A `{start, duration}` pair — a schedule slot with its weekday already applied. */
export interface DesiredSlot {
  start: string;
  duration: number;
}

export type PlanVerb = "keep" | "update" | "insert" | "retire" | "strand" | "skip";

interface PlanBase {
  classId: string;
  date: string;
}

/** Already correct: a reconcilable lesson matching a desired slot exactly. */
export interface KeepAction extends PlanBase {
  verb: "keep";
  lessonId: string;
  start: string;
  duration: number;
}

/** The slot moved. The lesson keeps its id — and with it its notes, its
 * classroom override and any homework link (ADR-001 decision 3). */
export interface UpdateAction extends PlanBase {
  verb: "update";
  lessonId: string;
  from: DesiredSlot;
  to: DesiredSlot;
}

/** A desired slot with no lesson behind it. `lessonId` is the id 5.6.1+ WOULD
 * mint; it is informational here. */
export interface InsertAction extends PlanBase {
  verb: "insert";
  lessonId: string;
  start: string;
  duration: number;
  status: LessonStatus;
}

/** A reconcilable lesson with no slot behind it. Retire = hard delete (§5.3),
 * which is why this stays report-only until the §6 snapshot exists. */
export interface RetireAction extends PlanBase {
  verb: "retire";
  lessonId: string;
  start: string;
  duration: number;
  reason: string;
}

/** A manually edited lesson with no slot behind it (§5.9). It can be neither
 * corrected (no slot survives) nor deleted (the note is the teacher's), so it
 * stays exactly where it is and is REPORTED for a person to decide: move it,
 * cancel it, or clear the note and let it retire. The one case where the design
 * knowingly leaves a lesson out of step with its class's schedule — visible,
 * undeleted, awaiting a human. */
export interface StrandAction extends PlanBase {
  verb: "strand";
  lessonId: string;
  start: string;
  duration: number;
  notes: string;
  reason: string;
}

/** Frozen — listed so the report can show WHAT was protected and why, rather
 * than silently omitting it. */
export interface SkipAction extends PlanBase {
  verb: "skip";
  lessonId: string;
  start: string;
  duration: number;
  frozen: FreezeReason[];
}

export type PlanAction =
  | KeepAction | UpdateAction | InsertAction | RetireAction | StrandAction | SkipAction;

export interface ReconcilePlan {
  appClock: string;
  months: string[];
  actions: PlanAction[];
}

export type PlanSummary = Record<PlanVerb, number>;

export function summarizePlan(actions: readonly PlanAction[]): PlanSummary {
  const out: PlanSummary = { keep: 0, update: 0, insert: 0, retire: 0, strand: 0, skip: 0 };
  for (const a of actions) out[a.verb]++;
  return out;
}

/** The verbs that would write. `true` means a run in enforcing mode would change
 * data — the single check a caller needs to answer "is this a no-op?". `strand`
 * is deliberately absent: it reports a lesson left untouched. */
export function planWouldWrite(actions: readonly PlanAction[]): boolean {
  return actions.some((a) => a.verb === "update" || a.verb === "insert" || a.verb === "retire");
}

/* ------------------------------------------------------------ the algorithm */

export interface DateReconcileInput {
  classId: string;
  date: string;
  /** Slots from `Class.schedule` matching this date's weekday. Empty when the
   * class no longer teaches that weekday, or when it has Ended (an Ended class is
   * planned against an empty schedule — see `planClass`). An Archived class never
   * reaches this function at all. */
  desired: readonly DesiredSlot[];
  /** The Regular lessons stored for this `(classId, date)`. */
  actual: readonly Lesson[];
  /** Slots this date lost to reschedules — the origin of a lesson that has been
   * moved to ANOTHER date. They are still occupied (§5.6). */
  vacated?: readonly DesiredSlot[];
  /** Overrides the sentence a retire/strand action explains itself with. The
   * default is derived from `desired`, which reads correctly for a schedule edit
   * ("no slot has this start") but not for an Ended class, whose empty desired set
   * means something else entirely. Presentation only — it changes no decision. */
  retireReason?: string;
}

const byStart = (a: DesiredSlot, b: DesiredSlot) => a.start.localeCompare(b.start);
const byLesson = (a: Lesson, b: Lesson) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id);

/** Index of the slot starting closest to `start`; ties go to the earlier slot. */
function nearestSlotIndex(slots: readonly DesiredSlot[], start: string): number {
  const at = toMinutes(start);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i++) {
    const d = Math.abs(toMinutes(slots[i].start) - at);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

/** RECURRENCE_DESIGN §5.2, for ONE `(classId, date)`.
 *
 * The whole algorithm in one place: partition, consume, match, pair, insert,
 * retire. A past date returns no actions — that guard is the structural reason
 * reported history cannot move, so it is the first line rather than a caller's
 * responsibility. */
export function planDate(input: DateReconcileInput, ctx: ReconcileContext): PlanAction[] {
  const { classId, date } = input;
  const out: PlanAction[] = [];
  if (date < ctx.appClock) return out; // the past is a fact, not a prediction (§4)

  // ---- 3. partition into frozen and reconcilable ----
  const reconcilable: Lesson[] = [];
  const claims: string[] = []; // start times a frozen lesson has spoken for on this date
  const occupied: string[] = []; // …and the slots a moved lesson physically stands in
  for (const l of [...input.actual].sort(byLesson)) {
    const frozen = freezeReasons(l, ctx);
    if (frozen.length === 0) {
      reconcilable.push(l);
      continue;
    }
    out.push({ verb: "skip", classId, date, lessonId: l.id, start: l.start, duration: l.duration, frozen });
    // The slot it VACATED. For a lesson moved onto this date from another one that
    // slot lives on the origin date, and arrives there through `vacated`.
    const origin = effectiveOrigin(l, ctx.legacyOriginFallback);
    if (!origin || origin.date === date) claims.push(origin?.start ?? l.start);
    // …and the slot it now OCCUPIES (§5.6). A moved lesson is physically standing
    // on this date at this time, so the schedule asking for a session there is
    // already satisfied — generating one would put a second lesson on top of a
    // lesson nobody may touch. Tracked apart from `claims` because it must consume
    // ONLY an exact match: unlike a vacated slot it never falls through to
    // `unclaimed`, so it can never take a slot at a different time away from a
    // genuinely new session on the same day.
    if (origin) occupied.push(l.start);
  }
  for (const v of input.vacated ?? []) claims.push(v.start);

  // A frozen lesson whose start still matches a slot satisfies it outright (§5.6).
  // Done first, before anything else may take that slot.
  const remaining = [...input.desired].sort(byStart);
  const unclaimed: string[] = [];
  for (const start of claims) {
    const i = remaining.findIndex((s) => s.start === start);
    if (i >= 0) remaining.splice(i, 1);
    else unclaimed.push(start);
  }
  // Then the slots moved lessons are standing in. Exact start match, and NO
  // `unclaimed` fallthrough on purpose: a lesson sitting at 14:00 must not absorb
  // a 10:00 slot the class genuinely still teaches that day. Matching on start
  // alone mirrors the claims loop above — two lessons may not share a start time,
  // whatever their durations, and a frozen lesson cannot be corrected anyway.
  for (const start of occupied) {
    const i = remaining.findIndex((s) => s.start === start);
    if (i >= 0) remaining.splice(i, 1);
  }

  // ---- 4. exact matches: already correct, nobody needs work ----
  const unmatched = [...reconcilable].sort(byLesson);
  const unsatisfied: DesiredSlot[] = [];
  for (const slot of remaining) {
    const i = unmatched.findIndex((l) => l.start === slot.start && l.duration === slot.duration);
    if (i < 0) {
      unsatisfied.push(slot);
      continue;
    }
    const [l] = unmatched.splice(i, 1);
    out.push({ verb: "keep", classId, date, lessonId: l.id, start: l.start, duration: l.duration });
  }

  // ---- 5. pair the leftovers by start order and update in place ----
  // A heuristic, and deliberately so (ADR-001 consequences): it decides only WHICH
  // surviving id carries which time when a day's slots change. The resulting set
  // of lessons is identical either way. `slotKey` (§10.2) is the exact answer, and
  // is out of scope for the same reason it always was — the schedule editor has no
  // stable slot identity to key on.
  //
  // §5.9 — when leftover lessons outnumber the surviving slots, the ones that go
  // without are chosen FIRST, and a manually edited lesson is never among them:
  // it is the one step 7 may not delete, so giving it a slot corrects it instead
  // of stranding it. Which slot each survivor then takes is still decided by
  // start order, so the preference changes only WHO is left over.
  const capacity = unsatisfied.length;
  const noted = unmatched.filter(isManuallyEdited);
  const plain = unmatched.filter((l) => !isManuallyEdited(l));
  const paired = [
    ...noted.slice(0, capacity),
    ...plain.slice(0, Math.max(0, capacity - noted.length)),
  ].sort(byLesson);
  const pairedIds = new Set(paired.map((l) => l.id));
  const dropped = unmatched.filter((l) => !pairedIds.has(l.id));

  while (unsatisfied.length > 0 && paired.length > 0) {
    const slot = unsatisfied.shift()!;
    const l = paired.shift()!;
    out.push({
      verb: "update", classId, date, lessonId: l.id,
      from: { start: l.start, duration: l.duration },
      to: { start: slot.start, duration: slot.duration },
    });
  }

  // ---- 5b. a frozen lesson whose slot MOVED still claims one ----
  // The commonest shape of the whole defect: the day already has a lesson, and
  // the schedule's time for that day was edited afterwards. Without this, the
  // edit inserts a second lesson beside a lesson nobody may touch — which is the
  // fork this sprint exists to stop, and for a cancellation it would silently
  // undo the cancellation (§5.6).
  //
  // Reconcilable lessons claim first (above): they can be corrected in place,
  // which is always the better outcome. A frozen lesson takes the NEAREST
  // surviving slot rather than the earliest, because unlike step 5 this choice is
  // not cosmetic — it decides which slot gets a brand-new lesson.
  for (const start of unclaimed) {
    if (unsatisfied.length === 0) break;
    unsatisfied.splice(nearestSlotIndex(unsatisfied, start), 1);
  }

  // ---- 6. insert what is still unsatisfied ----
  for (const slot of unsatisfied) {
    out.push({
      verb: "insert", classId, date,
      lessonId: regularId(classId, date, slot.start),
      start: slot.start, duration: slot.duration,
      status: statusForDate(date, ctx.appClock),
    });
  }

  // ---- 7. retire what has no slot behind it (the reverse pass, §5.3) ----
  // ...unless a teacher has written on it, which is never deleted (§5.9). The
  // note exists nowhere else and retire is a hard delete, so the lesson is left
  // exactly where it is and reported as stranded for a human to resolve.
  const reason = input.retireReason ?? (input.desired.length === 0
    ? "the class no longer teaches on this weekday"
    : "no slot in the class's current schedule has this start/duration");
  for (const l of dropped) {
    out.push(
      isManuallyEdited(l)
        ? {
            verb: "strand", classId, date, lessonId: l.id, start: l.start, duration: l.duration,
            notes: l.notes ?? "",
            reason: `${reason} — kept because it carries teacher's notes`,
          }
        : { verb: "retire", classId, date, lessonId: l.id, start: l.start, duration: l.duration, reason }
    );
  }

  return out;
}

/** Plan one class across the whole window.
 *
 * The set of dates considered is the union of both directions, which is the
 * point: schedule -> lessons alone is what made orphans unreachable (§5.3).
 *  - every window date matching a desired weekday (finds what is missing);
 *  - every window date that already holds a Regular lesson (finds what is stale);
 *  - every window date a reschedule vacated (keeps that slot occupied).
 *
 * An ARCHIVED class returns immediately with no actions (§5.8, ADR-002). It is
 * excluded before the algorithm begins rather than filtered inside it: a fossil
 * schedule is not intent, so comparing against it would make every future lesson
 * an orphan BY DEFINITION rather than by evidence — one class-level decision
 * re-expressed as hundreds of independent hard deletes. Class status is not a
 * second, hidden input capable of mass deletion. Those lessons are reported
 * instead, by `findArchivedClassLessons`. Anything that is not a recognised
 * reconcilable status returns the same way, so an unknown value fails closed.
 *
 * AN ENDED CLASS IS PLANNED AGAINST AN EMPTY SCHEDULE, and that single line is
 * the entire "retire the future on Ended" feature. It is not the same move ADR-002
 * rejected for Archived, and the difference is evidence: a teacher setting a class
 * to Ended has SAID the teaching is over, so `desired = []` is that statement
 * expressed in the planner's own vocabulary, not an accident of reading a fossil.
 * Everything else follows from machinery that already exists and is already
 * proven — a frozen lesson is still skipped, a noted lesson is still stranded
 * rather than deleted, the past is still untouchable, and `auditPlan` still
 * re-checks every action against freshly read data before a byte is written.
 * Because the desired set is empty, no insert and no update is even representable
 * here: the only verbs an Ended class can produce are skip, strand and retire.
 *
 * An Ended class's scope starts at NEXT month, never this one — see the comment on
 * `inWindow` below for why, and for what that leaves behind.
 *
 * The stored `schedule` is deliberately left alone on the record — it is what a
 * restore to Active reconciles from, and what Class Detail still displays. */
export function planClass(klass: Klass, lessons: readonly Lesson[], ctx: ReconcileContext): PlanAction[] {
  if (!isReconcilableClass(klass.status)) return [];
  const ended = klass.status === "Ended";

  const months = new Set(ctx.months);

  // THE CURRENT CALENDAR MONTH IS OUT OF SCOPE FOR AN ENDED CLASS (stopgap).
  //
  // Retiring a lesson DELETES the document (§5.3), and `computeRevenue`
  // (src/lib/finance.ts) derives its per-lesson value from `c.fee ÷ the Regular
  // lessons still STORED for that month`. Deleting this month's remaining lessons
  // therefore shrinks that denominator and inflates what the month reports for the
  // lessons already taught: a class ended halfway through a month would bill the
  // FULL monthly fee for half a month's teaching, because the surviving lessons
  // are exactly the completed ones.
  //
  // The month containing the app clock is the only month where that can happen —
  // revenue counts `Completed` lessons, retirement only reaches dates on or after
  // the clock, and `statusForDate` makes a lesson Completed only when its date is
  // already behind the clock. So excluding this one month closes the whole
  // exposure without touching the finance engine.
  //
  // This is a STOPGAP for a defect that is really in the denominator, not in
  // retirement. It is applied here because this is the only place that can close
  // it without changing how revenue is calculated, and the alternatives all
  // require deciding what "scheduled at the time" means — a business question that
  // is deliberately still open. Accepted cost: an Ended class's remaining lessons
  // for THIS month stay stored and stay Upcoming, so they keep appearing on the
  // Calendar and the Lesson List until the month passes and they age out of the
  // window. They are never added to (generation excludes Ended) and never grow.
  //
  // ENDED ONLY, deliberately. An Active class's schedule edit still reconciles the
  // current month exactly as it always has: moving or dropping a slot changes when
  // lessons happen, and the month's billed lesson count moves with it by design.
  // Archived is untouched — it is not reconciled at all.
  const currentMonth = monthOf(ctx.appClock);
  const inWindow = (date: string) =>
    months.has(monthOf(date)) &&
    date >= ctx.appClock &&
    (!ended || monthOf(date) > currentMonth);

  const regulars = lessons.filter((l) => l.classId === klass.id && l.type === "regular");
  // Ended: no desired slots on any weekday, so every reconcilable future lesson
  // IN SCOPE falls through to step 7 and is retired (or stranded, if it has notes).
  const schedule: ScheduleSlot[] = ended ? [] : (klass.schedule ?? []);

  const byDate = new Map<string, Lesson[]>();
  const vacatedByDate = new Map<string, DesiredSlot[]>();
  for (const l of regulars) {
    if (inWindow(l.date)) {
      const arr = byDate.get(l.date);
      if (arr) arr.push(l);
      else byDate.set(l.date, [l]);
    }
    const origin = effectiveOrigin(l, ctx.legacyOriginFallback);
    if (origin && origin.date !== l.date && inWindow(origin.date)) {
      const arr = vacatedByDate.get(origin.date);
      const slot = { start: origin.start, duration: origin.duration };
      if (arr) arr.push(slot);
      else vacatedByDate.set(origin.date, [slot]);
    }
  }

  const dates = new Set<string>([...byDate.keys(), ...vacatedByDate.keys()]);
  for (const month of ctx.months) {
    for (const slot of schedule) {
      for (const date of datesForWeekday(month, slot.day)) {
        if (inWindow(date)) dates.add(date);
      }
    }
  }

  const out: PlanAction[] = [];
  for (const date of [...dates].sort()) {
    const weekday = weekdayOf(date);
    out.push(
      ...planDate(
        {
          classId: klass.id,
          date,
          desired: schedule.filter((s) => s.day === weekday).map((s) => ({ start: s.start, duration: s.duration })),
          actual: byDate.get(date) ?? [],
          vacated: vacatedByDate.get(date) ?? [],
          retireReason: ended
            ? "the class has Ended — it teaches no further lessons"
            : undefined,
        },
        ctx
      )
    );
  }
  return out;
}

/** Plan every class. Makeup and Extra lessons are excluded entirely — they are
 * never generated, never reconciled and never retired (§2). */
export function planReconciliation(
  classes: readonly Klass[],
  lessons: readonly Lesson[],
  ctx: ReconcileContext = reconcileContext()
): ReconcilePlan {
  const actions: PlanAction[] = [];
  for (const c of classes) actions.push(...planClass(c, lessons, ctx));
  return { appClock: ctx.appClock, months: ctx.months, actions };
}
