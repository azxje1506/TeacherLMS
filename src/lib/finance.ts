/* Revenue engine — implements the PROJECT_RULES tuition/revenue rules.
 *
 * Per-lesson value = monthly fee ÷ number of REGULAR lessons scheduled that month
 * (a fixed baseline that does NOT shrink when lessons are cancelled). A student's
 * contribution for a completed lesson is added unless they were Absent. Cancelled
 * lessons are excluded unless flagged chargeable. Extra lessons add on top.
 * Makeup and Extra count toward revenue; Upcoming lessons never do.
 *
 * Revenue never reads a class's CURRENT status, and since Sprint 9 never reads a
 * STUDENT's either — see the notes in computeRevenue. Ending or archiving a class
 * changes what it will teach, not what it taught, and filing a person away
 * changes nothing about the months they were taught in.
 *
 * REVENUE IS NOT BILLING, and nothing in this file reads a bill. Revenue is money
 * earned by teaching, derived from lessons and attendance and owned by
 * `Lesson.date`. What was invoiced and collected is Billing, owned by
 * `Billing.month`, and it lives in src/lib/billing.ts. The two are allowed to
 * disagree and neither is computed from the other (PROJECT_RULES, Billing).
 *
 * EXACT INTEGER VND. Shares are counted and money is derived from them once, so
 * `total`, `perClass` and `byType` reconcile exactly instead of each rounding
 * independently — see `roundDiv` and `allocate` at the foot of this file. */

import type { AllData, } from "./repo";
import type { RevenueResult, AttendanceStatus } from "./types";

type FinanceInput = Pick<AllData, "classes" | "students" | "lessons" | "attendance">;

const inMonth = (iso: string, month: string) => iso.startsWith(month);

/** Compute revenue for a given "YYYY-MM" month. */
export function computeRevenue(month: string, data: FinanceInput): RevenueResult {
  const { classes, students, lessons, attendance } = data;
  const attByLesson = new Map(attendance.map((a) => [a.lessonId, a.entries]));

  // STUDENT STATUS IS NOT CONSULTED. Membership is "the roster id resolves to a
  // Student document", full stop.
  //
  // This line used to read `students.filter((s) => s.status !== "Archived")`,
  // which was §9.1's "current status hides past facts" shape surviving on the
  // STUDENT side: archiving somebody in October erased their contribution from
  // every month they had already been taught in, including closed ones. Revenue
  // is a fact about lessons that were delivered, and a person's filing status
  // today says nothing about whether they were in the room in June.
  //
  // It also disagreed with the rest of the app. Attendance does not consult
  // student status ("an enrolled student is in the room, whatever their status")
  // and neither does Homework; only Reviews does, deliberately, because a review
  // is an assessment authored ABOUT somebody. Revenue is not.
  //
  // WHAT THIS DOES NOT FIX, deliberately: a DELETED student is still excluded,
  // because their id no longer resolves, so deletion still erases their history
  // from every month. That defect is real and is explicitly deferred, not
  // forgotten — the only membership record is `Klass.studentIds`, which is a
  // single mutable current-value field with no history, so counting it would
  // repair deletion while leaving the identical erasure caused by merely
  // un-enrolling somebody. A correct fix needs enrolment history that does not
  // exist, and inventing one here would be inventing history (Sprint 9 Gate 2).
  const enrolledStudentIds = new Set(students.map((s) => s.id));

  // Exact integer-VND accumulation. See `allocate` below: every share is summed
  // as a rational with a common denominator instead of as a float, so nothing
  // rounds until a whole class's figure is allocated, once.
  const byTypeExact = { regular: 0, makeup: 0, extra: 0 };
  const perClass: { classId: string; name: string; amount: number }[] = [];

  // EVERY class is visited, whatever its current status.
  //
  // This loop used to open with `if (c.status === "Archived") continue;`, which
  // meant archiving a class erased its revenue from every month — including months
  // already closed, already reported and already shown to a parent (the defect
  // recorded as RECURRENCE_DESIGN §9.1). It also made the three headline figures
  // disagree with one another, because `teachingHours` and `attendanceRate` below
  // iterate lessons and never saw the filter.
  //
  // Revenue is a fact about lessons that were taught, so it is derived from
  // lessons and never from the class's status TODAY. A class that taught through
  // June and Ended in July keeps its June revenue, and keeps it again when it is
  // Archived in August; nothing about a status change in one month can reach back
  // into another. That also removes the need to know "was this class Active at the
  // time?" — a question the data cannot answer, since status is a single mutable
  // field with no history (§9.1's stated obstacle).
  //
  // Nothing leaks forward, either: the only lessons that count are Completed ones
  // (plus chargeable Cancelled), and neither Ending nor Archiving a class can turn
  // a future lesson into a Completed one.
  for (const c of classes) {
    const monthLessons = lessons.filter((l) => l.classId === c.id && inMonth(l.date, month));
    const regularScheduled = monthLessons.filter((l) => l.type === "regular").length;
    if (regularScheduled === 0) continue;

    // SHARES, NOT MONEY. Every countable (lesson × present-enough student) pair is
    // worth exactly `fee / regularScheduled`, the same rational for the whole
    // class-month, so counting the pairs and multiplying once at the end is the
    // same arithmetic without the float. `750,000 / 9` repeats for ever in binary;
    // `750,000 × 27 / 9` does not, because it is never a fraction at all.
    const shares = { regular: 0, makeup: 0, extra: 0 };
    const enrolled = c.studentIds.filter((id) => enrolledStudentIds.has(id));

    for (const l of monthLessons) {
      const countable =
        l.status === "Completed" || (l.status === "Cancelled" && l.chargeable === true);
      if (!countable) continue;
      const entries = attByLesson.get(l.id) || {};

      // Extra sessions add on top; one-on-one, so a single enrolled student. The
      // per-share value is the same for all three types — an Extra is an extra
      // LESSON, not an extra rate — so the branches differ only in which bucket
      // the share lands in.
      const bucket = l.type === "regular" || l.type === "makeup" ? l.type : l.type === "extra" ? "extra" : null;
      if (!bucket) continue;

      for (const sid of enrolled) {
        const st = (entries[sid]?.status as AttendanceStatus | undefined) ?? "Present";
        if (st === "Absent") continue; // Absent students don't count
        shares[bucket]++;
      }
    }

    const totalShares = shares.regular + shares.makeup + shares.extra;
    if (totalShares === 0) continue;

    // ONE ROUNDING, HERE. The class's whole month is `fee × shares ÷ regular`,
    // rounded to a whole đồng exactly once.
    const classAmount = roundDiv(c.fee * totalShares, regularScheduled);
    if (classAmount === 0) continue;

    // …and the class's three type buckets are that same integer split by share
    // count, so they sum to it EXACTLY rather than each rounding independently.
    const [r, m, e] = allocate(classAmount, [shares.regular, shares.makeup, shares.extra]);
    byTypeExact.regular += r;
    byTypeExact.makeup += m;
    byTypeExact.extra += e;

    perClass.push({ classId: c.id, name: c.name, amount: classAmount });
  }

  perClass.sort((a, b) => b.amount - a.amount);
  const total = perClass.reduce((s, r) => s + r.amount, 0);
  // Both invariants hold by construction, not by luck: `total` IS the sum of
  // `perClass`, and each class's buckets sum to that class's amount, so the three
  // buckets sum to `total` too. There is a test asserting both, including on a
  // fixture whose per-lesson value repeats.
  return { total, perClass, byType: { ...byTypeExact } };
}

/* ------------------------------------------------- exact integer VND helpers */

/** `Math.round(n / d)` for non-negative integers, without trusting a float.
 *
 * `Math.floor(n / d)` is exact for the magnitudes here (a fee times a share count
 * stays far below 2^53), and the remainder is then integer arithmetic, so the
 * half-up decision is made on integers rather than on a value that may already
 * have drifted. Ties round up, matching `Math.round`. */
function roundDiv(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  return r * 2 >= d ? q + 1 : q;
}

/** Split `total` across `weights` so the parts are integers summing EXACTLY to
 * `total` — the largest-remainder method.
 *
 * Each part gets its floor, and the đồng left over by flooring go one each to the
 * parts with the largest fractional remainders. That is the allocation with the
 * smallest total deviation, and it is deterministic: ties are broken by position,
 * so the same input always produces the same split and a test can assert the
 * exact numbers rather than their sum alone.
 *
 * A zero weight never receives anything, including in the leftover pass — a
 * lesson type with no shares earned nothing, and handing it a đồng to make the
 * arithmetic tidy would be inventing revenue. */
function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return weights.map(() => 0);

  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - parts.reduce((s, p) => s + p, 0);

  const order = weights
    .map((w, i) => ({ i, remainder: total * w - Math.floor((total * w) / sum) * sum, w }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  for (let k = 0; left > 0 && order.length > 0; k++, left--) {
    parts[order[k % order.length].i]++;
  }
  return parts;
}

/** Teaching hours from completed lessons in a month. */
export function teachingHours(month: string, data: Pick<AllData, "lessons">): number {
  const mins = data.lessons
    .filter((l) => inMonth(l.date, month) && l.status === "Completed")
    .reduce((s, l) => s + (l.duration || 0), 0);
  return Math.round((mins / 60) * 10) / 10;
}

/** Attendance rate (%) across completed lessons in a month. */
export function attendanceRate(month: string, data: Pick<AllData, "lessons" | "attendance">): number {
  const monthLessonIds = new Set(
    data.lessons.filter((l) => inMonth(l.date, month) && l.status === "Completed").map((l) => l.id)
  );
  let present = 0, total = 0;
  for (const rec of data.attendance) {
    if (!monthLessonIds.has(rec.lessonId)) continue;
    for (const sid of Object.keys(rec.entries)) {
      total++;
      const st = rec.entries[sid]?.status;
      if (st === "Present" || st === "Late" || st === "Excused") present++;
    }
  }
  return total === 0 ? 0 : Math.round((present / total) * 100);
}

/** One student's attendance for one month, with the coverage behind it.
 *
 * `pct` is `null`, never 0, when nothing was recorded. Those are different
 * facts — "this student missed everything" and "nobody took a register" — and a
 * screen that renders 0% for the second is stating an assessment the data never
 * made. Every caller must branch on `null`. */
export interface StudentAttendanceRate {
  /** Present + Late + Excused, over this student's stored entries. */
  attended: number;
  /** This student's stored entries in the month — the rate's denominator. */
  total: number;
  /** `attended / total` as a whole percent, or `null` when `total` is 0. */
  pct: number | null;
  /** Completed lessons in scope that have a stored register at all. */
  registersTaken: number;
  /** Completed lessons in scope, register or not. */
  lessonsCompleted: number;
}

/** Attendance rate (%) for ONE student in a month, plus its coverage.
 *
 * A FILTER OF `attendanceRate`, NOT A SECOND FORMULA. The lesson set is the same
 * (`Completed`, in month, every type), the attended statuses are the same
 * (Present / Late / Excused, with Absent the only one that withholds), and the
 * rounding is the same. The single difference is that this reads one key out of
 * each register instead of every key. Summing this over the students a month's
 * registers name reproduces the aggregate's numerator and denominator exactly,
 * which is asserted rather than asserted-about (see tests/review-analytics).
 *
 * SCOPE IS THE CALLER'S, exactly as it already is for `attendanceRate` — which
 * `buildAttendanceIndex` calls once with the month's lessons for the studio
 * figure and again with one class's lessons for a per-class figure. Pass the
 * lessons the report is about; this function does not decide what "relevant"
 * means and does not read a roster.
 *
 * STORED ENTRIES ONLY. Where no register exists, nothing is invented for this
 * metric — not even the "everyone present" default that revenue assumes and that
 * PROJECT_RULES describes for OPENING a register. That default answers "what
 * does the teacher see before they touch anything"; this answers "what was
 * actually recorded", which is the question every other attendance figure in the
 * app already answers. A metric that quietly filled the gap would disagree with
 * the Attendance index for the same month. `registersTaken` / `lessonsCompleted`
 * are returned so the gap is visible instead of disguised.
 *
 * THE LESSON OWNS THE DATE. `AttendanceRecord.date` is a legacy mirror and is
 * never read here, so a rescheduled lesson is counted in the month it was
 * actually taught (PROJECT_RULES, Date ownership).
 *
 * Reads only. Nothing is repaired, written back or reported. */
export function studentAttendanceRate(
  studentId: string,
  month: string,
  data: Pick<AllData, "lessons" | "attendance">
): StudentAttendanceRate {
  const monthLessonIds = new Set(
    data.lessons.filter((l) => inMonth(l.date, month) && l.status === "Completed").map((l) => l.id)
  );

  let attended = 0, total = 0;
  /* Counted as DISTINCT lessons, not as records. `AttendanceRecord.lessonId` is
   * unique in the schema, so the two agree today; a set means a stray duplicate
   * could never inflate a coverage figure into claiming more registers than
   * there are lessons. */
  const registered = new Set<string>();
  for (const rec of data.attendance) {
    if (!monthLessonIds.has(rec.lessonId)) continue;
    registered.add(rec.lessonId);
    const entry = rec.entries?.[studentId];
    if (!entry) continue; // no entry for this student — not invented
    total++;
    const st = entry.status;
    if (st === "Present" || st === "Late" || st === "Excused") attended++;
  }

  return {
    attended,
    total,
    pct: total === 0 ? null : Math.round((attended / total) * 100),
    registersTaken: registered.size,
    lessonsCompleted: monthLessonIds.size,
  };
}

/** Homework completion (%) for a month, over class-scoped submissions + student-scoped items.
 *
 * DONE MEANS COMPLETED **OR LATE**. Work submitted late was submitted; `Missing`
 * — never done — is the opposite of done. Late stays separately labelled
 * everywhere it is shown, so nothing is lost by counting it here. (Attendance's
 * unrelated use of the word is not the reason: this is what "completion" means.)
 *
 * `Assigned` counts as NEITHER. It means no outcome has been recorded, which is
 * not a failure, and it stays true whether or not the due date has passed —
 * Homework has no lifecycle and a date passing settles nothing.
 *
 * Reads `homework` and nothing else, deliberately: a student's later deletion,
 * or a class becoming Ended or Archived, must never restate a closed month. So
 * stored entries for students who no longer exist are still counted, and a
 * class's current status is not consulted — it cannot be, from this signature. */
export function homeworkCompletion(month: string, data: Pick<AllData, "homework">): number {
  let done = 0, total = 0;
  for (const hw of data.homework) {
    if (!inMonth(hw.dueDate, month)) continue;
    if (hw.status === "Assigned") continue; // no outcome recorded
    if (hw.scope === "class") {
      for (const sid of Object.keys(hw.submissions)) {
        const s = hw.submissions[sid];
        if (s === "Assigned") continue;
        total++;
        if (s === "Completed" || s === "Late") done++;
      }
    } else {
      total++;
      if (hw.status === "Completed" || hw.status === "Late") done++;
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** One student's homework completion for one month.
 *
 * `pct` is `null`, never 0, when no eligible outcome exists — the same
 * distinction `StudentAttendanceRate` draws, for the same reason. "Nothing was
 * done" and "nothing was set, or nothing has been marked yet" are different
 * facts. */
export interface StudentHomeworkCompletion {
  /** Completed + Late, over this student's eligible outcomes. */
  done: number;
  /** This student's eligible outcomes in the month — the denominator. */
  total: number;
  /** `done / total` as a whole percent, or `null` when `total` is 0. */
  pct: number | null;
}

/** Homework completion (%) for ONE student in a month.
 *
 * A FILTER OF `homeworkCompletion`, NOT A SECOND FORMULA. Same month rule (the
 * assignment's DUE DATE), same three exclusions, same numerator, same rounding.
 * The only difference is which outcomes are selected: this student's submission
 * on a class-scoped assignment, and only the student-scoped assignments
 * addressed to them. Summing this over the students a month's homework names
 * reproduces the aggregate exactly.
 *
 * THE TOP-LEVEL `Assigned` SKIP IS DELIBERATELY REPRODUCED, including for
 * class-scoped work. It is surprising — an assignment still marked `Assigned`
 * is skipped whole, so a submission recorded under it is not counted — but it
 * is the rule the aggregate has enforced since Sprint 7, and a per-student
 * figure that disagreed with the monthly figure would be the second formula
 * this function exists to avoid. Sprint 8 changes no Homework rule.
 *
 * `Assigned` COUNTS AS NEITHER, at both levels: it means no outcome has been
 * recorded, which is not a failure, and it stays true whether or not the due
 * date has passed — a date passing settles nothing (PROJECT_RULES, Homework).
 *
 * OTHER STUDENTS' GHOST SUBMISSIONS CANNOT REACH THIS FIGURE, because only one
 * key is read. That does not restate the aggregate, which still counts every
 * stored outcome including those of students who no longer exist — a student's
 * later deletion must not move a closed month's reported completion.
 *
 * NOT THE REVIEW'S `homework` SKILL RATING, which is a different thing that
 * happens to share a word: the rating is the teacher's 1-5 judgement of a
 * student's homework habits, this is a count of recorded submissions. They will
 * often disagree, and that is not a fault in either.
 *
 * Reads only. */
export function studentHomeworkCompletion(
  studentId: string,
  month: string,
  data: Pick<AllData, "homework">
): StudentHomeworkCompletion {
  let done = 0, total = 0;
  for (const hw of data.homework) {
    if (!inMonth(hw.dueDate, month)) continue;
    if (hw.status === "Assigned") continue; // no outcome recorded
    if (hw.scope === "class") {
      const s = hw.submissions?.[studentId];
      if (!s || s === "Assigned") continue;
      total++;
      if (s === "Completed" || s === "Late") done++;
    } else {
      if (hw.studentId !== studentId) continue;
      total++;
      if (hw.status === "Completed" || hw.status === "Late") done++;
    }
  }
  return { done, total, pct: total === 0 ? null : Math.round((done / total) * 100) };
}
