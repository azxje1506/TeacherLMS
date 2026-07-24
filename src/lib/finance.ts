/* Revenue engine — implements the CLAUDE.md tuition/revenue rules.
 *
 * Per-lesson value = monthly fee ÷ number of REGULAR lessons scheduled that month
 * (a fixed baseline that does NOT shrink when lessons are cancelled). A student's
 * contribution for a completed lesson is added unless they were Absent. Cancelled
 * lessons are excluded unless flagged chargeable. Extra lessons add on top.
 * Makeup and Extra count toward revenue; Upcoming lessons never do. */

import type { AllData, } from "./repo";
import type { RevenueResult, AttendanceStatus } from "./types";

type FinanceInput = Pick<AllData, "classes" | "students" | "lessons" | "attendance">;

const inMonth = (iso: string, month: string) => iso.startsWith(month);

/** Compute revenue for a given "YYYY-MM" month. */
export function computeRevenue(month: string, data: FinanceInput): RevenueResult {
  const { classes, students, lessons, attendance } = data;
  const attByLesson = new Map(attendance.map((a) => [a.lessonId, a.entries]));
  const activeStudentIds = new Set(students.filter((s) => s.status !== "Archived").map((s) => s.id));

  const byType = { regular: 0, makeup: 0, extra: 0 };
  const perClass: { classId: string; name: string; amount: number }[] = [];

  for (const c of classes) {
    if (c.status === "Archived") continue;
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

/** Homework completion (%) for a month, over class-scoped submissions + student-scoped items. */
export function homeworkCompletion(month: string, data: Pick<AllData, "homework">): number {
  let done = 0, total = 0;
  for (const hw of data.homework) {
    if (!inMonth(hw.dueDate, month)) continue;
    if (hw.status === "Assigned") continue; // future/not yet due
    if (hw.scope === "class") {
      for (const sid of Object.keys(hw.submissions)) {
        const s = hw.submissions[sid];
        if (s === "Assigned") continue;
        total++;
        if (s === "Completed") done++;
      }
    } else {
      total++;
      if (hw.status === "Completed") done++;
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
