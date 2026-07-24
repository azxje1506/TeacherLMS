/* Derive Lessons, Attendance and Billing from the seed's classes + students,
 * following the CLAUDE.md rules. Deterministic (seeded by calc.hash) so the demo
 * is identical on every re-seed.
 *
 * - Regular lessons are generated from each class's recurring weekly schedule
 *   across the finance window (FINANCE_MONTHS … current month).
 * - Lessons dated before the app clock (TODAY_ISO) are Completed; a deterministic
 *   few are Cancelled. On/after the clock they are Upcoming.
 * - Attendance is recorded for Completed lessons (everyone Present, minus a
 *   deterministic set of exceptions calibrated to each student's attendance %).
 * - Billing is one record per student per class per month (fee = monthly fee),
 *   with Paid / Partially Paid / Unpaid derived deterministically; the current
 *   month leans unpaid so the Finance "Outstanding" view has data.
 */

import type { Klass, Student, Lesson, AttendanceRecord, Billing, AttendanceStatus } from "./types";
import { hash } from "./calc";
import { TODAY_ISO, FINANCE_MONTHS, CURRENT_MONTH } from "./constants";

const MONTHS = [...FINANCE_MONTHS.filter((m) => m < CURRENT_MONTH), CURRENT_MONTH];

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** All ISO dates in `YYYY-MM` whose weekday === `dow`. */
function datesForWeekday(month: string, dow: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  const dim = daysInMonth(y, m);
  for (let d = 1; d <= dim; d++) {
    const date = new Date(y, m - 1, d);
    if (date.getDay() === dow) {
      out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }
  return out;
}

export interface DerivedData {
  lessons: Lesson[];
  attendance: AttendanceRecord[];
  billing: Billing[];
}

export function deriveData(classes: Klass[], students: Student[]): DerivedData {
  const lessons: Lesson[] = [];
  const attendance: AttendanceRecord[] = [];
  const billing: Billing[] = [];
  const studentById = new Map(students.map((s) => [s.id, s]));

  for (const c of classes) {
    if (c.status === "Archived") continue;

    for (const month of MONTHS) {
      // ---- Regular lessons for the month ----
      let regularCount = 0;
      const monthLessons: Lesson[] = [];
      c.schedule.forEach((slot, si) => {
        for (const date of datesForWeekday(month, slot.day)) {
          regularCount++;
          const seed = hash(`${c.id}|${date}|${slot.start}|${si}`);
          const past = date < TODAY_ISO;
          // Deterministically cancel ~1 in 12 past lessons.
          const cancelled = past && seed % 12 === 0;
          const lesson: Lesson = {
            id: `L-${c.id}-${date}-${slot.start.replace(":", "")}`,
            classId: c.id,
            type: "regular",
            date,
            start: slot.start,
            duration: slot.duration,
            classroom: c.classroom,
            status: cancelled ? "Cancelled" : past ? "Completed" : "Upcoming",
            chargeable: cancelled ? seed % 24 === 0 : undefined, // a rare cancelled lesson is still billed
            fromId: null,
            notes: cancelled ? "Cancelled — teacher unavailable." : "",
          };
          monthLessons.push(lesson);
          lessons.push(lesson);

          // ---- Makeup for a cancelled group lesson (rescheduled a few days later) ----
          if (cancelled && c.type === "group") {
            const md = new Date(date + "T00:00:00");
            md.setDate(md.getDate() + 3);
            const mIso = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, "0")}-${String(md.getDate()).padStart(2, "0")}`;
            const mPast = mIso < TODAY_ISO;
            lessons.push({
              id: `M-${lesson.id}`,
              classId: c.id,
              type: "makeup",
              date: mIso,
              start: slot.start,
              duration: slot.duration,
              classroom: c.classroom,
              status: mPast ? "Completed" : "Upcoming",
              fromId: lesson.id,
              notes: "Makeup for cancelled lesson.",
            });
          }
        }
      });

      // ---- Extra lessons for one-on-one classes (one per month, deterministic) ----
      if (c.type === "one-on-one" && hash(`${c.id}|extra|${month}`) % 3 === 0) {
        const dates = datesForWeekday(month, (c.schedule[0]?.day ?? 1));
        const pick = dates[Math.floor(dates.length / 2)] || dates[0];
        if (pick) {
          const past = pick < TODAY_ISO;
          lessons.push({
            id: `X-${c.id}-${pick}`,
            classId: c.id,
            type: "extra",
            date: pick,
            start: "18:00",
            duration: c.schedule[0]?.duration ?? 45,
            classroom: c.classroom,
            status: past ? "Completed" : "Upcoming",
            fromId: null,
            notes: "Extra session.",
          });
        }
      }

      // ---- Attendance for completed lessons in this month ----
      for (const lesson of lessons.filter((l) => l.classId === c.id && l.date.startsWith(month) && l.status === "Completed")) {
        const entries: Record<string, { status: AttendanceStatus; note?: string }> = {};
        for (const sid of c.studentIds) {
          const st = studentById.get(sid);
          const rate = st?.attendance ?? 95;
          const roll = hash(`${lesson.id}|${sid}`) % 100;
          let status: AttendanceStatus = "Present";
          if (roll >= rate) {
            const kind = hash(`${lesson.id}|${sid}|k`) % 3;
            status = kind === 0 ? "Absent" : kind === 1 ? "Late" : "Excused";
          }
          entries[sid] = { status };
        }
        attendance.push({ lessonId: lesson.id, date: lesson.date, entries });
      }

      // ---- Billing: one record per enrolled student per month ----
      const currentMonth = month === CURRENT_MONTH;
      for (const sid of c.studentIds) {
        const st = studentById.get(sid);
        if (!st || st.status === "Archived") continue;
        const seed = hash(`${c.id}|${sid}|${month}|bill`);
        let status: Billing["status"];
        if (currentMonth) {
          // Current month leans unpaid so Finance has outstanding balances.
          status = st.balance > 0 ? (seed % 2 === 0 ? "Unpaid" : "Partially Paid") : seed % 5 === 0 ? "Unpaid" : "Paid";
        } else {
          status = seed % 9 === 0 ? "Partially Paid" : "Paid";
        }
        const paidDate = status === "Paid" || status === "Partially Paid"
          ? `${month}-${String((seed % 20) + 3).padStart(2, "0")}`
          : null;
        billing.push({
          id: `B-${c.id}-${sid}-${month}`,
          studentId: sid,
          classId: c.id,
          month,
          fee: c.fee,
          status,
          paidDate,
          notes: "",
        });
      }
      void regularCount;
    }
  }

  return { lessons, attendance, billing };
}
