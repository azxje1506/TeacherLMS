/* Attendance — the DB-bound service.
 *
 * Every Attendance database access in the application lives in this file, and
 * every DECISION it acts on lives in src/lib/attendance.ts. The split is not
 * decoration: the register write has to preserve stored entries for students who
 * no longer exist, and "which keys does this update touch?" is only answerable as
 * a test if the answer is computed somewhere a test can reach. So the pure core
 * plans the update and this module hands the plan to Mongo, unmodified.
 *
 * WHAT THIS MODULE MAY WRITE: `AttendanceModel`, and nothing else. Not Lesson,
 * not Class, not Student, not Billing. The one apparent exception is the ordinary
 * lesson lifecycle — `advanceLessonLifecycle` — which this module CALLS but does
 * not implement; that is the existing Sprint 5 transition, it writes only
 * Lesson.status/chargeable, and it runs here for the same reason the dashboard
 * route runs it: a status-derived answer computed over unresolved lessons is
 * wrong. Attendance never changes a lesson's status itself.
 */

import "server-only";
import { dbConnect, isDupKey } from "./db";
import { AttendanceModel, ClassModel, LessonModel, StudentModel } from "./models";
import { advanceLessonLifecycle } from "./lifecycle";
import { CURRENT_MONTH, TODAY_ISO } from "./constants";
import {
  attendanceEligibilityFor, buildAttendanceIndex, buildRegisterPayload, planAttendanceWrite,
  resolveRoster, RECENT_LIMIT,
  type AttendanceIndexPayload, type AttendanceOpError, type AttendanceRegisterPayload,
} from "./attendance";
import type { AttendanceSaveInput } from "./schemas";
import type { AttendanceRecord, Klass, Lesson, Student } from "./types";

const clean = "-_id -__v";

/** Discriminated result so Route Handlers map a failure through ATTENDANCE_ERROR
 * the same way every Lessons handler maps one through LESSON_ERROR. */
export type AttendanceOpResult =
  | { ok: true; register: AttendanceRegisterPayload }
  | { ok: false; reason: AttendanceOpError };

/* ----------------------------------------------------------------- the index */

/** Everything the Attendance index screen renders, shaped on the server.
 *
 * The client is handed a payload, never a collection dump: which lessons are
 * "today", which are "recent", how many, and in what order are business
 * questions, and answering them in the browser would put a second copy of those
 * rules where nothing tests them.
 *
 * READS THE CURRENT TIMETABLE. `ensureRegularLessons()` is deliberately NOT
 * called here. Generation is the Lessons module's job, it is forward-only, and an
 * Attendance read has no business extending the schedule as a side effect — this
 * screen reports on lessons that exist. The lesson LIFECYCLE does run, from the
 * Route Handler, because "Completed" is what most of this payload is derived
 * from.
 *
 * The queries are bounded rather than a full dump: the month (which the summary,
 * the by-class list and Today all read from) plus the newest handful of past
 * Completed lessons. The pure builder re-derives every selection from whatever it
 * is given, so a wider query could not change the answer — only cost more. */
export async function listAttendanceIndex(): Promise<AttendanceIndexPayload> {
  await dbConnect();
  const month = CURRENT_MONTH;

  const [classes, students, monthLessons, recentLessons] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    // Ids only: this read answers "does this student still exist?" and nothing
    // else. Names and avatars are needed by the register, not by the index.
    StudentModel.find().select("id -_id").lean<Array<Pick<Student, "id">>>(),
    LessonModel.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } })
      .select(clean)
      .lean<Lesson[]>(),
    // The true newest-first page of past Completed lessons, so the cap the pure
    // builder applies is a cap over the right candidates and not over whatever
    // the month happened to contain.
    LessonModel.find({ status: "Completed", date: { $lt: TODAY_ISO } })
      .sort({ date: -1, start: -1, id: -1 })
      .limit(RECENT_LIMIT)
      .select(clean)
      .lean<Lesson[]>(),
  ]);

  const lessonById = new Map<string, Lesson>();
  for (const l of [...monthLessons, ...recentLessons]) lessonById.set(l.id, l);
  const lessons = [...lessonById.values()];

  const attendance = await AttendanceModel.find({ lessonId: { $in: lessons.map((l) => l.id) } })
    .select(clean)
    .lean<AttendanceRecord[]>();

  return buildAttendanceIndex({ classes, students, lessons, attendance }, month, TODAY_ISO);
}

/* -------------------------------------------------------------- the register */

/** Read one lesson's register.
 *
 * PERFORMS ZERO ATTENDANCE WRITES. Opening a register is a question, not an
 * action: where no record exists the roster is shown as all-Present, and that
 * default is computed for the response and thrown away. A teacher who opens a
 * lesson and navigates away leaves the database exactly as they found it, which
 * is what keeps "Not taken" on the index truthful.
 *
 * It MAY, however, advance the ordinary lesson lifecycle first. That is existing
 * Sprint 5 behaviour, it is scoped to this lesson's class, and it is what lets a
 * Regular lesson whose date has just passed be marked at all: until it resolves
 * to Completed it is a past Upcoming lesson, which eligibility fails closed on.
 * The lesson is re-read afterwards so the decision is made against the resolved
 * record rather than the stale one. */
export async function getAttendanceRegister(lessonId: string): Promise<AttendanceOpResult> {
  await dbConnect();

  const found = await LessonModel.findOne({ id: lessonId }).select(clean).lean<Lesson>();
  if (!found) return { ok: false, reason: "not_found" };

  await advanceLessonLifecycle(found.classId);
  const lesson = await LessonModel.findOne({ id: lessonId }).select(clean).lean<Lesson>();
  if (!lesson) return { ok: false, reason: "not_found" };

  if (!attendanceEligibilityFor(lesson, TODAY_ISO).eligible) return { ok: false, reason: "not_eligible" };

  const klass = await ClassModel.findOne({ id: lesson.classId }).select(clean).lean<Klass>();
  if (!klass) return { ok: false, reason: "class_not_found" };

  const [students, record] = await Promise.all([
    studentsForRoster(klass),
    AttendanceModel.findOne({ lessonId }).select(clean).lean<AttendanceRecord>(),
  ]);

  return { ok: true, register: buildRegisterPayload(lesson, klass, students, record ?? null) };
}

/** The Student documents behind a class's roster ids.
 *
 * Queried by id, with NO status filter. A Paused, Trial or Archived student is
 * still enrolled and still sits in the room, so they still appear on the
 * register; only a missing document removes someone. Ids that match nothing come
 * back as nothing — they are not repaired, reported or written back. */
async function studentsForRoster(klass: Klass): Promise<Student[]> {
  const ids = klass.studentIds ?? [];
  if (ids.length === 0) return [];
  return StudentModel.find({ id: { $in: ids } }).select(clean).lean<Student[]>();
}

/** Save one lesson's register — the only Attendance write in the application.
 *
 * THE SEQUENCE IS THE CONTRACT:
 *
 *   lesson exists -> lifecycle -> re-read -> eligibility -> class -> roster ->
 *   visible set -> reject foreign ids -> plan -> one updateOne -> re-read
 *
 * Eligibility is re-enforced here rather than trusted from the client, because
 * the button that opened this register may have been drawn minutes ago against a
 * lesson that has since been cancelled.
 *
 * MEMBERSHIP IS ALL-OR-NOTHING. A submitted id outside the currently visible
 * roster fails the whole request with zero writes (`invalid_student`, 422) — the
 * ids are never filtered down to the valid ones and saved anyway, because that
 * would report success for a save that partly did not happen, and because
 * silently dropping ids is exactly how a hostile client would probe for the
 * hidden orphan entries this module exists to protect.
 *
 * CREATE AND UPDATE ARE THE SAME OPERATION. One upsert, one code path, one
 * response. A first save whose register is entirely Present still creates the
 * record: it is financially identical to no record at all, but historically it is
 * the teacher saying "I checked", and the index has to be able to tell the
 * difference between confirmed and not yet done.
 *
 * NOTHING ELSE IS WRITTEN. No Lesson update — saving today's register does not
 * complete today's lesson, and the ordinary lifecycle will do that on its own
 * schedule, at which point the register already sitting there simply starts
 * counting. No Class, Student, Billing or Finance write of any kind. */
export async function saveAttendanceRegister(
  lessonId: string,
  input: AttendanceSaveInput
): Promise<AttendanceOpResult> {
  await dbConnect();

  const found = await LessonModel.findOne({ id: lessonId }).select(clean).lean<Lesson>();
  if (!found) return { ok: false, reason: "not_found" };

  await advanceLessonLifecycle(found.classId);
  const lesson = await LessonModel.findOne({ id: lessonId }).select(clean).lean<Lesson>();
  if (!lesson) return { ok: false, reason: "not_found" };

  if (!attendanceEligibilityFor(lesson, TODAY_ISO).eligible) return { ok: false, reason: "not_eligible" };

  const klass = await ClassModel.findOne({ id: lesson.classId }).select(clean).lean<Klass>();
  if (!klass) return { ok: false, reason: "class_not_found" };

  const students = await studentsForRoster(klass);
  const visibleIds = new Set(resolveRoster(klass.studentIds, students).map((s) => s.id));

  const planned = planAttendanceWrite(lessonId, visibleIds, input.entries);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  const { filter, update } = planned.plan;
  try {
    await AttendanceModel.updateOne(filter, update, { upsert: true });
  } catch (e) {
    // Two first-saves for the same lesson can race: both find no document, both
    // try to insert, and the loser hits the unique `lessonId` index. That is
    // ordinary contention, not a conflict a teacher should be shown — the winner
    // created the document this request also wanted, so re-applying the same
    // `$set` without the upsert converges on exactly the intended state. Any
    // other error is real and propagates. Same precedent as `ensureRegularLessons`.
    if (!isDupKey(e)) throw e;
    if (update.$set) await AttendanceModel.updateOne(filter, { $set: update.$set });
  }

  const record = await AttendanceModel.findOne({ lessonId }).select(clean).lean<AttendanceRecord>();
  return { ok: true, register: buildRegisterPayload(lesson, klass, students, record ?? null) };
}
