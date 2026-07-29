/* Dashboard aggregation — builds the payload for the Dashboard screen from the
 * full dataset. Returns raw values (numbers / ISO strings); the client formats
 * them through its Settings (currency, date/time, language) so the widgets react
 * to preference changes exactly as the design intends. */

import "server-only";
import type { AllData } from "./repo";
import { computeRevenue, teachingHours, attendanceRate, homeworkCompletion } from "./finance";
import { TODAY_ISO, CURRENT_MONTH } from "./constants";
import type { RevenueResult } from "./types";

export interface DashClassRow { name: string; color: string; amount: number; meta: { students: number; lessons: number } }
export interface DashTodayClass { lessonId: string; classId: string; name: string; start: string; status: string; color: string; meta: string }
/** `duration` is carried so the card can show the lesson's full time range; the
 * end time is derived for display, never stored. */
export interface DashUpcoming { lessonId: string; name: string; date: string; start: string; duration: number }
export interface DashActivity { id: string; type: string; pre: string; strong: string; post: string; ago: string }

export interface DashboardPayload {
  todayIso: string;
  month: string;
  todayCount: number;
  revenue: RevenueResult;
  revClassRows: DashClassRow[];
  teachingHours: number;
  activeStudents: number;
  activeClasses: number;
  newStudentsThisMonth: number;
  attendanceRate: number;
  homeworkCompletion: number;
  lessonsToday: number;
  homeworkDueToday: number;
  reviewsToWrite: number;
  todayClasses: DashTodayClass[];
  upcoming: DashUpcoming[];
  activity: DashActivity[];
}

export function buildDashboard(data: AllData): DashboardPayload {
  const { classes, students, lessons, homework, reviews, activity } = data;
  const classById = new Map(classes.map((c) => [c.id, c]));
  const activeStudents = students.filter((s) => s.status !== "Archived");
  const activeClasses = classes.filter((c) => c.status === "Active");

  const revenue = computeRevenue(CURRENT_MONTH, data);

  const revClassRows: DashClassRow[] = revenue.perClass.map((r) => {
    const c = classById.get(r.classId);
    const completed = lessons.filter((l) => l.classId === r.classId && l.date.startsWith(CURRENT_MONTH) && l.status === "Completed").length;
    return { name: r.name, color: c?.color || "var(--accent)", amount: r.amount, meta: { students: c?.studentIds.length ?? 0, lessons: completed } };
  });

  const todayLessons = lessons.filter((l) => l.date === TODAY_ISO && l.status !== "Cancelled");
  const todayClasses: DashTodayClass[] = todayLessons
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((l) => {
      const c = classById.get(l.classId);
      return {
        lessonId: l.id, classId: l.classId, name: c?.name || l.classId, start: l.start,
        status: l.status, color: c?.color || "var(--accent)",
        meta: [c?.level, l.classroom].filter(Boolean).join(" · "),
      };
    });

  const upcoming: DashUpcoming[] = lessons
    .filter((l) => l.date >= TODAY_ISO && l.status === "Upcoming")
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 5)
    .map((l) => ({ lessonId: l.id, name: classById.get(l.classId)?.name || l.classId, date: l.date, start: l.start, duration: l.duration }));

  const reviewsThisMonth = new Set(reviews.filter((r) => r.month === CURRENT_MONTH).map((r) => r.studentId));

  return {
    todayIso: TODAY_ISO,
    month: CURRENT_MONTH,
    todayCount: todayLessons.length,
    revenue,
    revClassRows,
    teachingHours: teachingHours(CURRENT_MONTH, data),
    activeStudents: activeStudents.length,
    activeClasses: activeClasses.length,
    newStudentsThisMonth: students.filter((s) => s.joined.startsWith(CURRENT_MONTH)).length,
    attendanceRate: attendanceRate(CURRENT_MONTH, data),
    homeworkCompletion: homeworkCompletion(CURRENT_MONTH, data),
    lessonsToday: todayLessons.length,
    homeworkDueToday: homework.filter((h) => h.dueDate === TODAY_ISO).length,
    reviewsToWrite: activeStudents.filter((s) => !reviewsThisMonth.has(s.id)).length,
    todayClasses,
    upcoming,
    activity: activity.slice(0, 6).map((a) => ({ id: a.id, type: a.type, pre: a.pre, strong: a.strong, post: a.post, ago: a.ago })),
  };
}
