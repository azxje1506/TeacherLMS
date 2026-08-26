/* Revenue engine — implements the CLAUDE.md tuition/revenue rules.
 *
 * Per-lesson value = monthly fee ÷ number of REGULAR lessons scheduled that month
 * (a fixed baseline that does NOT shrink when lessons are cancelled). A student's
 * contribution for a completed lesson is added unless they were Absent. Cancelled
 * lessons are excluded unless flagged chargeable. Extra lessons add on top.
 * Makeup and Extra count toward revenue; Upcoming lessons never do.
 *
 * Revenue never reads a class's CURRENT status — see the note in computeRevenue.
 * Ending or archiving a class changes what it will teach, not what it taught. */

import type { AllData, } from "./repo";
import type { RevenueResult, AttendanceStatus } from "./types";

type FinanceInput = Pick<AllData, "classes" | "students" | "lessons" | "attendance">;

const inMonth = (iso: string, month: string) => iso.startsWith(month);

/** Compute revenue for a given "YYYY-MM" month. */
export function computeRevenue(month: string, data: FinanceInput): RevenueResult {
  const { classes, students, lessons, attendance } = data;
  const attByLesson = new Map(attendance.map((a) => [a.lessonId, a.entries]));
  // NOTE: the same "current status hides past facts" shape as §9.1 survives here
  // on the STUDENT side — archiving a student removes their contribution from
  // every past month too. Left exactly as it was: it is a different entity with a
  // different status model (Trial / Paused as well as Archived) and its own
  // enrolment questions, and changing it was not part of the class-lifecycle work.
  // Recorded so it is not mistaken for something this change already covered.
  const activeStudentIds = new Set(students.filter((s) => s.status !== "Archived").map((s) => s.id));

  const byType = { regular: 0, makeup: 0, extra: 0 };
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
    const perLessonValue = c.fee / regularScheduled;

    let classAmount = 0;
    const enrolled = c.studentIds.filter((id) => activeStudentIds.has(id));

    for (const l of monthLessons) {
      const countable =
        l.status === "Completed" || (l.status === "Cancelled" && l.chargeable === true);
      if (!countable) continue;
      const entries = attByLesson.get(l.id) || {};

      if (l.type === "regular" || l.type === "makeup") {
        for (const sid of enrolled) {
          const st = (entries[sid]?.status as AttendanceStatus | undefined) ?? "Present";
          if (st === "Absent") continue; // Absent students don't count
          classAmount += perLessonValue;
          byType[l.type] += perLessonValue;
        }
      } else if (l.type === "extra") {
        // Extra sessions add on top; one-on-one, so a single enrolled student.
        for (const sid of enrolled) {
          const st = (entries[sid]?.status as AttendanceStatus | undefined) ?? "Present";
          if (st === "Absent") continue;
          classAmount += perLessonValue;
          byType.extra += perLessonValue;
        }
      }
    }

    if (classAmount > 0) perClass.push({ classId: c.id, name: c.name, amount: Math.round(classAmount) });
  }

  perClass.sort((a, b) => b.amount - a.amount);
  const total = perClass.reduce((s, r) => s + r.amount, 0);
  return {
    total,
    perClass,
    byType: { regular: Math.round(byType.regular), makeup: Math.round(byType.makeup), extra: Math.round(byType.extra) },
  };
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
