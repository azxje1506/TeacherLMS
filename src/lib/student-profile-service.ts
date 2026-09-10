/* Student Profile — the DB-bound service for the Attendance and Homework tabs.
 *
 * Every database access these two tabs make lives in this file, and every
 * DECISION it acts on lives in src/lib/student-profile.ts or in the domain that
 * owns the figure. The split is the one reports-service.ts, reviews-service.ts
 * and finance-service.ts already draw.
 *
 * ============================================================================
 * WHY THESE READS ARE NOT IN attendance-service.ts AND homework-service.ts.
 * That was Gate 2's recommended shape and it is not available, because banked
 * guards seal both files — correctly, and this module exists to leave them
 * sealed rather than to argue with them:
 *
 *   - tests/homework-service.test.ts #40 pins that service's imports to exactly
 *     six modules; #22 forbids it from naming `submissions` ANYWHERE; #23
 *     forbids `status`; #26 forbids `studentId:`, `scope:`, `classId:` and
 *     `createdAt:`. Sprint 7 deliberately left the Homework service unable to
 *     address a submission at all, which is what makes the deferred submission
 *     writer absent BY CONSTRUCTION rather than by care. A read that must select
 *     `submissions` and `status` cannot live there without dismantling that.
 *   - tests/attendance.test.ts pins ATTENDANCE_ERROR's key set to exactly four
 *     reasons, so that module has no `student_not_found` to answer with.
 *
 * The precedent for a screen that composes other modules' data without editing
 * them is Reports (Sprint 10): a pure `reports.ts` beside a DB-bound
 * `reports-service.ts`, reading through the owning domains' helpers. This is
 * that pair, for the Student Profile. NO BANKED GUARD IS WEAKENED OR MOVED, and
 * the ENDPOINTS stay module-owned — /api/attendance/student/:studentId and
 * /api/homework/student/:studentId — which is what Data Ownership is about.
 *
 * ============================================================================
 * BOTH FUNCTIONS ARE READS. No Student, Parent, Class, Lesson, Attendance,
 * Homework, Review, Billing or Activity document is created, updated or deleted
 * here, and no index is created. Neither advances a lesson lifecycle — unlike
 * the Attendance register read, which legitimately does — because a profile view
 * must never mutate a lesson merely because somebody looked at a student. There
 * is no cache and no stored payload: it is built per request and thrown away.
 *
 * ONE QUERY PER COLLECTION, whatever the number of months or lessons. Never one
 * per lesson and never one per assignment.
 *
 * AN ARCHIVED STUDENT IS READABLE — their history is a record of things that
 * happened, and filing them away does not delete it, the rule
 * `getStudentReviews` already follows. A STUDENT WHO DOES NOT RESOLVE ANSWERS
 * `null`, which each route turns into the same "Student not found" 404 the
 * Students and Homework endpoints already return.
 */

import "server-only";
import { dbConnect } from "./db";
import { AttendanceModel, ClassModel, HomeworkModel, LessonModel, StudentModel } from "./models";
import { CURRENT_MONTH } from "./constants";
import {
  buildStudentAttendance, buildStudentHomework,
  type StudentAttendancePayload, type StudentHomeworkPayload,
} from "./student-profile";
import type { AttendanceRecord, Homework, Klass, Lesson, Student } from "./types";

/** The classes whose roster names this student, with the one field the read
 * models label a row with.
 *
 * MEMBERSHIP IS READ AS IT STANDS TODAY, and that is a real limitation stated
 * rather than papered over: a student moved out of a class after a month was
 * taught will see that month's coverage shrink, though their percentage is
 * unmoved. Neither Attendance nor Homework stores membership history, so no
 * other answer is available from this data — and inventing one would be
 * inventing history. This is the same narrowing `studentMonthMetrics` performs
 * for the Reviews learning journey, which is why the two tabs agree. */
async function classesForStudent(studentId: string): Promise<Array<Pick<Klass, "id" | "name">>> {
  return ClassModel.find({ studentIds: studentId })
    .select("id name -_id")
    .lean<Array<Pick<Klass, "id" | "name">>>();
}

/** Does this student exist? Ids only — this asks nothing else about them. */
async function resolveStudent(studentId: string): Promise<string | null> {
  const found = await StudentModel.findOne({ id: studentId })
    .select("id -_id")
    .lean<Pick<Student, "id">>();
  return found?.id ?? null;
}

/** One student's whole attendance record, for the Attendance tab.
 *
 * THE NARROWEST READ THAT CAN ANSWER THE QUESTION: the student, their classes,
 * those classes' COMPLETED lessons, and the registers of those lessons. Passing
 * the whole studio's lessons would make the coverage figures describe the school
 * rather than the student.
 *
 * The percentage is derived by `studentAttendanceRate` inside the pure builder —
 * the same helper the Reviews learning journey reads — so the two surfaces
 * cannot report the same month differently. */
export async function getStudentAttendance(
  studentId: string
): Promise<StudentAttendancePayload | null> {
  await dbConnect();

  const id = await resolveStudent(studentId);
  if (!id) return null;

  const classes = await classesForStudent(id);
  const classIds = classes.map((c) => c.id);

  const lessons = classIds.length === 0
    ? []
    : await LessonModel.find({ classId: { $in: classIds }, status: "Completed" })
        .select("id classId date status -_id")
        .lean<Lesson[]>();

  const lessonIds = lessons.map((l) => l.id);
  const attendance = lessonIds.length === 0
    ? []
    : await AttendanceModel.find({ lessonId: { $in: lessonIds } })
        .select("lessonId entries -_id")
        .lean<AttendanceRecord[]>();

  return buildStudentAttendance({ studentId: id, classes, lessons, attendance, appMonth: CURRENT_MONTH });
}

/** One student's whole homework record, for the Homework tab.
 *
 * THE QUERY NARROWS, THE RULES EXCLUDE. It fetches work that CAN concern this
 * student — set to one of their classes, or addressed to them by name — and the
 * pure builder then decides which of it actually is theirs
 * (`studentHomeworkOutcome`) and which of it counts towards a percentage
 * (`studentHomeworkCompletion`). Neither rule is restated here, and neither is
 * answered by the query.
 *
 * A CLASS-SCOPED ASSIGNMENT WITH NO KEY FOR THIS STUDENT IS FETCHED AND THEN
 * DROPPED, because the query cannot know. Nothing is invented, defaulted or
 * written back, and no other student's key is ever read — a deleted student's
 * preserved entries stay exactly where they are and reach no response. */
export async function getStudentHomework(
  studentId: string
): Promise<StudentHomeworkPayload | null> {
  await dbConnect();

  const id = await resolveStudent(studentId);
  if (!id) return null;

  const classes = await classesForStudent(id);
  const classIds = classes.map((c) => c.id);

  const fields = "id title classId scope studentId dueDate status submissions -_id";
  const homework = classIds.length === 0
    ? await HomeworkModel.find({ scope: "student", studentId: id }).select(fields).lean<Homework[]>()
    : await HomeworkModel.find({
        $or: [{ classId: { $in: classIds } }, { scope: "student", studentId: id }],
      }).select(fields).lean<Homework[]>();

  return buildStudentHomework({ studentId: id, classes, homework });
}
