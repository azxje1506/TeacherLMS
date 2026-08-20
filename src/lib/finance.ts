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
