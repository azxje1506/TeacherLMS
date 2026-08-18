/* Duplicate-lesson judging — the PURE core behind `npm run lessons:duplicates`
 * (`scripts/find-duplicate-lessons.ts`).
 *
 * PURE BY CONSTRUCTION, like `src/lib/recurrence.ts`: no Mongoose, no model
 * import, no connection, no async. The script does the I/O and calls in here for
 * every verdict, so the decision is unit-testable without a database — the script
 * itself invokes `main()` at module load and cannot be imported by a test.
 *
 * INDEPENDENT OF THE PLANNER, DELIBERATELY. RECURRENCE_DESIGN §6 Phase 3 diffs
 * this detector against `src/lib/recurrence.ts` precisely so a bug in one is
 * caught by the other. Nothing here imports the planner: the rules are re-derived
 * from the design, and where the two agree it is because they were each written
 * from §5 rather than because one calls the other.
 *
 * WHAT CHANGED, AND WHY (the c2 defect)
 * The detector used to ask, per lesson, "does A slot exist that this lesson
 * matches?" — a set-membership test evaluated independently for every lesson:
 *
 *     const match = slots.find((s) => s.start === l.start && s.duration === l.duration);
 *
 * With one Sunday 10:00/60 slot and two lessons both stored at 10:00/60, BOTH
 * matched it and both were reported KEEP, so a real duplicate was reported as
 * healthy. The planner never had this bug: it pairs one-to-one, splicing the slot
 * out as it goes, so the surplus lesson falls through to retire.
 *
 * The fix is capacity: a slot is a thing that can be CONSUMED once, not a
 * predicate that can be satisfied repeatedly.
 */

import { TODAY_ISO } from "./constants";
import type { Klass, Lesson, ScheduleSlot } from "./types";

/** How a lesson sharing a class+date with another is classified.
 *
 * `ARCHIVED` and `ENDED` are separate verdicts because they mean opposite things
 * about the class's future, and collapsing them would make the report lie about
 * one of the two. See `judgeDate`. */
export type Verdict = "KEEP" | "CANDIDATE" | "RESCHEDULED" | "ARCHIVED" | "ENDED";

export interface Judged {
  lesson: Lesson;
  verdict: Verdict;
  reason: string;
  /** Reasons this lesson must not be touched by any future migration. A
   * CANDIDATE carrying any protection is never "safely removable". */
  protections: string[];
}

export interface JudgeInput {
  klass: Pick<Klass, "status" | "schedule">;
  date: string;
  /** Every lesson stored for this class on this date. Non-Regular ones are
   * ignored — Makeup and Extra are never generated and never reconciled (§2). */
  lessons: readonly Lesson[];
  attended?: ReadonlySet<string>;
  appClock?: string;
}

/** Weekday of an ISO date, in local time (matches how the app reads dates). */
export function weekdayOf(iso: string): number {
  return new Date(iso + "T00:00:00").getDay();
}

/** The date a generated Regular lesson's id was built for. Null when the id does
 * not follow the generated convention (Makeup `M-…`, Extra `X-…`, ad-hoc ids). */
export function dateFromId(id: string): string | null {
  return /^L-.+-(\d{4}-\d{2}-\d{2})-\d{4}$/.exec(id)?.[1] ?? null;
}

/** Has this lesson been deliberately moved? Two signals, because the stored
 * origin fields only exist for moves made after they were introduced: earlier
 * reschedules are only visible as an id whose encoded date no longer matches. */
export function wasMoved(l: Lesson): boolean {
  if (l.originalDate) return true;
  const encoded = dateFromId(l.id);
  return encoded !== null && encoded !== l.date;
}

/** Judge every Regular lesson a class holds on one date.
 *
 * The algorithm, in order:
 *
 *  1. **Archived class** → nothing here is a reconciliation candidate at all
 *     (§5.8, ADR-002). A fossil schedule is not intent, so it is not compared
 *     against.
 *  1a. **Ended class** → also not a candidate, for the opposite reason: it WAS
 *     reconciled, against an empty schedule, so anything still stored survived
 *     that pass because it was protected or past.
 *  2. **Build capacity** — one consumable entry per schedule slot the class
 *     teaches that weekday. Two identical slots therefore support two lessons.
 *  3. **Rescheduled lessons first**, and they CONSUME the slot they landed on.
 *     A teacher put that lesson there deliberately; it is protected whatever
 *     happens next, and the slot it occupies is no longer free for anyone else.
 *  4. **Ordinary lessons** pair against whatever capacity is left, at most one
 *     lesson per slot.
 *  5. **Anything unpaired is a CANDIDATE**, subject to its protections.
 *
 * Ordering is `start`, then lesson `id` — deterministic, and the same rule the
 * planner sorts by, so the two independently agree on WHICH of two identical
 * duplicates survives rather than merely on how many do.
 *
 * Matching is on the lesson's STORED `start` and `duration`. The id is never
 * consulted: the reconciler updates a lesson in place and keeps its id (ADR-001),
 * so an id can encode a start the lesson no longer has. */
export function judgeDate(input: JudgeInput): Judged[] {
  const { klass, date } = input;
  const attended = input.attended ?? new Set<string>();
  const appClock = input.appClock ?? TODAY_ISO;

  const protectionsOf = (l: Lesson): string[] => {
    const p: string[] = [];
    if (l.date < appClock) p.push("past lesson (drives revenue for its month)");
    if (attended.has(l.id)) p.push("has an attendance record");
    if (l.status === "Cancelled") p.push("cancelled (a makeup may reference it via fromId)");
    // §5.9 — the note exists nowhere else and retire is a hard delete, so a
    // lesson a teacher has written on is never safely removable.
    if ((l.notes ?? "").trim() !== "") p.push("carries teacher's notes — never deleted (§5.9)");
    return p;
  };

  // Makeup and Extra never participate: they are not generated from a schedule,
  // so they neither occupy a recurring slot nor compete for one (§2).
  const ordered = input.lessons
    .filter((l) => l.type === "regular")
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  // ---- 1a. ENDED: reconciled already, and reconciled to nothing ----
  // The opposite case to Archived, and the reason the two need separate verdicts.
  // An Ended class IS in scope for the reconciler, planned against an empty
  // schedule, so its future reconcilable lessons were retired when it ended.
  // Whatever is still stored is therefore either past (a fact that drives a closed
  // month's revenue) or protected — never a duplicate anyone should act on. Calling
  // these CANDIDATE would invite deleting exactly the lessons the engine kept on
  // purpose; calling them ARCHIVED would claim the class still holds a future it
  // does not.
  //
  // The status literals here duplicate `isReconcilableClass` in the planner, and
  // deliberately so: this detector is diffed AGAINST the planner (§6 Phase 3), so
  // it re-derives its rules from the design rather than importing them. A shared
  // helper would make the two agree by construction and the cross-check worthless.
  if (klass.status === "Ended") {
    return ordered.map((lesson) => ({
      lesson,
      verdict: "ENDED" as const,
      reason: "the class has Ended — its future lessons were retired when it ended",
      protections: [...protectionsOf(lesson), "its class has Ended — what remains was kept on purpose"],
    }));
  }

  if (klass.status === "Archived") {
    return ordered.map((lesson) => ({
      lesson,
      verdict: "ARCHIVED" as const,
      reason: "the class is Archived — outside reconciliation (§5.8, ADR-002)",
      protections: [...protectionsOf(lesson), "its class is Archived (§5.8, ADR-002)"],
    }));
  }

  // ---- capacity, not membership ----
  const slots: Array<ScheduleSlot & { taken: boolean }> = (klass.schedule ?? [])
    .filter((s) => s.day === weekdayOf(date))
    .map((s) => ({ ...s, taken: false }));

  /** Consume a free slot this lesson exactly fills. One slot, one lesson. */
  const take = (l: Lesson): boolean => {
    const slot = slots.find((s) => !s.taken && s.start === l.start && s.duration === l.duration);
    if (!slot) return false;
    slot.taken = true;
    return true;
  };

  const judged = new Map<string, Judged>();

  // ---- 3. reschedules claim their destination slot before anyone else ----
  for (const lesson of ordered) {
    if (!wasMoved(lesson)) continue;
    take(lesson);
    judged.set(lesson.id, {
      lesson,
      verdict: "RESCHEDULED",
      reason: lesson.originalDate
        ? `deliberately moved from ${lesson.originalDate}`
        : `deliberately moved from ${dateFromId(lesson.id)} (pre-dates the stored origin fields)`,
      protections: protectionsOf(lesson),
    });
  }

  // ---- 4/5. ordinary lessons take what is left ----
  for (const lesson of ordered) {
    if (wasMoved(lesson)) continue;
    const protections = protectionsOf(lesson);
    if (take(lesson)) {
      judged.set(lesson.id, {
        lesson, verdict: "KEEP", protections,
        reason: "matches the class's current schedule for this weekday",
      });
      continue;
    }
    judged.set(lesson.id, {
      lesson, verdict: "CANDIDATE", protections,
      reason: slots.length === 0
        ? "the class no longer teaches on this weekday"
        : slots.some((s) => s.start === lesson.start && s.duration === lesson.duration)
          ? "another lesson already occupies this slot on this date"
          : "no slot in the class's current schedule has this start/duration",
    });
  }

  // Presentation order: start, then id — the order they were judged in.
  return ordered.map((l) => judged.get(l.id)!).filter(Boolean);
}

/** True when nothing on this date occupies a slot the class still teaches — the
 * "review by hand" signal. A reschedule, an Archived class or an Ended one counts
 * as occupied: in none of the three is the date unexplained, and raising a manual
 * review for every date of every finished class would bury the ones that need it. */
export function noKeep(judged: readonly Judged[]): boolean {
  return !judged.some(
    (j) => j.verdict === "KEEP" || j.verdict === "RESCHEDULED" ||
      j.verdict === "ARCHIVED" || j.verdict === "ENDED"
  );
}
