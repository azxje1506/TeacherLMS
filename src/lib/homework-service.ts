/* Homework — the DB-bound service.
 *
 * Every Homework database access in the application lives in this file, and
 * every DECISION it acts on lives in src/lib/homework.ts. The split is the same
 * one Attendance draws, for the same reason: a write that must never touch the
 * preserved submissions of deleted students is only provably correct if "which
 * keys does this write?" is computed somewhere a test can reach. So the pure
 * core plans, and this module hands the plan to Mongo, unmodified.
 *
 * WHAT THIS MODULE MAY WRITE: `HomeworkModel`, and nothing else. Not Class, not
 * Student, not Lesson, not Attendance, not Billing. There is no exception — not
 * even the lesson lifecycle that Attendance legitimately calls, because nothing
 * Homework reads is derived from a lesson's status. Homework is class-owned.
 *
 * THREE WRITE VERBS, EACH USED ONCE: `create` on POST, one `updateOne` with a
 * `$set` of at most four keys on PATCH, one `deleteOne` on DELETE. No
 * `replaceOne`, no `updateMany`, no `deleteMany`, no `bulkWrite`, and no write of
 * any kind on a read path.
 *
 * `submissions` IS WRITTEN EXACTLY ONCE, at insert, from a map the pure planner
 * built. Sprint 7 has no submission writer: there is no designed surface that
 * records an outcome, so there is no endpoint, no service function and no code
 * path that can reach that field again. The eight stored entries in the live
 * collection that belong to students who no longer exist are therefore
 * unreachable by construction rather than by care.
 *
 * NO RECURRENCE, EVER. `Homework.lessonId` is a freeze signal to the
 * reconciliation engine, and this module always stores `null` — the create
 * planner has no input for it. Nothing here imports or calls recurrence,
 * reconciliation, generation or the lesson lifecycle.
 */

import "server-only";
import { dbConnect } from "./db";
import { ClassModel, HomeworkModel, StudentModel, mongoose } from "./models";
import { TODAY_ISO } from "./constants";
import {
  buildAssignableClasses, buildFilterClasses, buildHomeworkList, canAssignToClass,
  isListableHomework, planHomeworkCreate, planHomeworkDelete, planHomeworkUpdate,
  type HomeworkAssignableClass, type HomeworkClassOption, type HomeworkListItem,
  type HomeworkOpError,
} from "./homework";
import type { HomeworkCreateBody, HomeworkUpdateBody } from "./schemas";
import type { Homework, Klass, Student } from "./types";

const clean = "-_id -__v";

/** Discriminated result so Route Handlers map a failure through HOMEWORK_ERROR
 * the same way every Attendance handler maps one through ATTENDANCE_ERROR. */
export type HomeworkOpResult =
  | { ok: true; homework: HomeworkListItem }
  | { ok: false; reason: HomeworkOpError };

export type HomeworkDeleteResult =
  | { ok: true }
  | { ok: false; reason: HomeworkOpError };

export interface HomeworkListPayload {
  items: HomeworkListItem[];
  /** Classes the list may be filtered by — whatever their status now is. */
  filterClasses: HomeworkClassOption[];
  /** Classes new work may be set for, with the students it may be addressed to. */
  assignableClasses: HomeworkAssignableClass[];
}

/* ------------------------------------------------------------------ reads */

/** Everything the Homework screen renders, shaped on the server.
 *
 * The client is handed a payload, never a collection dump. That is partly the
 * house convention and partly the point of this whole module: the stored
 * `submissions` map is never in the response, so a client cannot read, infer or
 * address the preserved entries of students who no longer exist.
 *
 * THE STUDENT READ IS DRIVEN BY IDS THE SCREEN NEEDS NAMES FOR — the assignees of
 * student-scoped work, and the rosters of the classes new work may be set for.
 * It is never driven by a submissions map, so a stored key belonging to a deleted
 * student is not merely withheld from the response: it is never looked up, and an
 * id that resolves to nothing simply returns nothing.
 *
 * Two class lists, because they answer two different questions — see
 * `buildFilterClasses` and `buildAssignableClasses`. Both are derived by the pure
 * core from the same single read. */
export async function listHomework(): Promise<HomeworkListPayload> {
  await dbConnect();

  const [homework, classes] = await Promise.all([
    HomeworkModel.find().select(clean).lean<Homework[]>(),
    ClassModel.find().select(clean).lean<Klass[]>(),
  ]);

  const assigneeIds = homework
    .filter((h) => h.scope === "student" && h.studentId)
    .map((h) => h.studentId as string);
  const rosterIds = classes.filter((c) => canAssignToClass(c)).flatMap((c) => c.studentIds ?? []);
  const wantedIds = [...new Set([...assigneeIds, ...rosterIds])];

  const students = wantedIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: wantedIds } }).select("id name -_id")
        .lean<Array<Pick<Student, "id" | "name">>>();

  const items = buildHomeworkList(homework, classes, students);

  return {
    items,
    filterClasses: buildFilterClasses(items, classes),
    assignableClasses: buildAssignableClasses(classes, students),
  };
}

/** Load one assignment, and refuse the ones nobody may interact with.
 *
 * THERE IS NO PUBLIC DETAIL ROUTE — the index payload already carries everything
 * the edit form needs — so this is an internal read that exists to make PATCH and
 * DELETE agree with the list about what exists.
 *
 * A student-scoped assignment whose student no longer resolves answers
 * `not_found`, and answers it BEFORE anything else is considered. It is not
 * listed, so it must not be reachable: the index omitting a record and the API
 * refusing it are one rule, not a UI convention with an API bypass behind it.
 * `not_found` rather than a distinct reason is deliberate — a separate code
 * would advertise the existence of a record the client may not see, and would
 * hint at the identity of the deleted student behind it. */
async function loadInteractable(
  id: string
): Promise<{ ok: true; doc: Homework } | { ok: false; reason: HomeworkOpError }> {
  const doc = await HomeworkModel.findOne({ id }).select(clean).lean<Homework>();
  if (!doc) return { ok: false, reason: "not_found" };

  if (doc.scope === "student") {
    const found = doc.studentId
      ? await StudentModel.countDocuments({ id: doc.studentId })
      : 0;
    const existing = new Set(found > 0 && doc.studentId ? [doc.studentId] : []);
    if (!isListableHomework(doc, existing)) return { ok: false, reason: "not_found" };
  }

  return { ok: true, doc };
}

/** Re-shape one stored assignment into the public item, resolving its labels.
 * Used to answer a create or an edit with the same shape the list returns. */
async function present(doc: Homework): Promise<HomeworkListItem | null> {
  const [klass, student] = await Promise.all([
    ClassModel.findOne({ id: doc.classId }).select("id name color -_id")
      .lean<Pick<Klass, "id" | "name" | "color">>(),
    doc.scope === "student" && doc.studentId
      ? StudentModel.findOne({ id: doc.studentId }).select("id name -_id").lean<Pick<Student, "id" | "name">>()
      : null,
  ]);
  if (!klass) return null;
  return buildHomeworkList([doc], [klass], student ? [student] : [])[0] ?? null;
}

/* ----------------------------------------------------------------- create */

/** Set homework for a class, or for one student in it.
 *
 * THE SEQUENCE IS THE CONTRACT:
 *
 *   class exists -> class is Active -> assignee resolves -> assignee is enrolled
 *   -> mint id -> plan -> one insert
 *
 * and nothing is written until every step has passed. Eligibility is decided
 * here rather than trusted from the client, because the class picker that opened
 * the form may have been drawn before the class was archived.
 *
 * WHICH STUDENTS ARE READ depends on the scope, and the difference matters. A
 * class-scoped assignment reads the whole roster, because it is addressed to
 * whoever is currently on it. A student-scoped assignment reads only the one
 * named student — so an id that resolves to no document produces
 * `student_not_found`, and one that resolves but is not on the roster produces
 * `student_not_in_class`. Those are separate failures because they are separate
 * mistakes, and because a roster may itself contain an id with no document: such
 * an id is never a valid assignee, and it fails on existence, not on membership.
 *
 * IDENTITY IS A MongoDB ObjectId, with the string `id` mirroring it, exactly as
 * Classes, Parents and Lessons do. Never sequential, never derived from a count,
 * so two simultaneous creates cannot collide on a read-then-write window. The
 * unique `id` index remains the database's own last word.
 *
 * NOTHING ELSE IS WRITTEN. No Class update — setting homework does not change a
 * roster. No Student update. No Lesson, Attendance or Billing write of any kind,
 * and no reconciliation: `lessonId` is null, so no lesson is frozen by this. */
export async function createHomework(input: HomeworkCreateBody): Promise<HomeworkOpResult> {
  await dbConnect();

  const klass = await ClassModel.findOne({ id: input.classId }).select(clean).lean<Klass>();

  // Read the students the plan will actually be judged against: the whole roster
  // for class scope, and only the named assignee for student scope.
  const wantedIds = input.scope === "student"
    ? (input.studentId ? [input.studentId] : [])
    : (klass?.studentIds ?? []);
  const students = wantedIds.length === 0
    ? []
    : await StudentModel.find({ id: { $in: wantedIds } }).select("id -_id").lean<Array<Pick<Student, "id">>>();

  const _id = new mongoose.Types.ObjectId();
  const planned = planHomeworkCreate(
    input,
    klass,
    new Set(students.map((s) => s.id)),
    _id.toString(),
    TODAY_ISO
  );
  if (!planned.ok) return { ok: false, reason: planned.reason };

  await HomeworkModel.create({ _id, ...planned.doc });

  const item = await present(planned.doc);
  return item ? { ok: true, homework: item } : { ok: false, reason: "class_not_found" };
}

/* ------------------------------------------------------------------- edit */

/** Correct the fields a teacher authored.
 *
 * WRITES AT MOST FOUR KEYS, and the set is computed by `planHomeworkUpdate` from
 * an allow-list rather than filtered out of the request here. `classId`, `scope`,
 * `studentId`, `lessonId`, `status` and `submissions` cannot appear in it —
 * which is what makes an edit incapable of erasing a preserved submission, and
 * incapable of moving an assignment to a different class while keeping the old
 * class's roster inside it.
 *
 * AN EMPTY PATCH WRITES NOTHING. A request that names no editable field is not
 * an error and not a no-op that pretends otherwise: there is simply nothing to
 * set, so no query is issued and the assignment is returned unchanged.
 *
 * HISTORICAL CORRECTION IS ALLOWED, with no month lock and no warning. Changing
 * a due date may move an assignment between months and may therefore change a
 * closed month's reported completion. That is intended — a correction is a
 * statement that the record was wrong.
 *
 * No timestamp is written. The schema carries none, and a derived "last updated"
 * would be a guess presented to a teacher as a fact. */
export async function updateHomework(
  id: string,
  patch: HomeworkUpdateBody
): Promise<HomeworkOpResult> {
  await dbConnect();

  const loaded = await loadInteractable(id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const set = planHomeworkUpdate(patch);
  if (Object.keys(set).length > 0) {
    await HomeworkModel.updateOne({ id }, { $set: set });
  }

  const after = await HomeworkModel.findOne({ id }).select(clean).lean<Homework>();
  if (!after) return { ok: false, reason: "not_found" };

  const item = await present(after);
  return item ? { ok: true, homework: item } : { ok: false, reason: "not_found" };
}

/* ----------------------------------------------------------------- delete */

/** Delete an assignment that has not been settled.
 *
 * PENDING ONLY. While an assignment is `Assigned` no outcome has been recorded
 * against it, so removing it destroys no history. A Completed, Late or Missing
 * assignment is refused with ZERO writes — the decision is made before any query
 * that could change anything, and the refusal is the API's, not a disabled
 * button's. Those records carry outcomes, and some of those outcomes are the
 * only surviving evidence that students who have since been deleted did the
 * work.
 *
 * ONE DOCUMENT, NO CASCADE. `deleteOne` by id. No Class, Student, Lesson,
 * Attendance or Billing cleanup, and no other Homework is touched — an
 * assignment is not a parent of anything. No reconciliation runs, because no
 * lesson was ever frozen by it. */
export async function deleteHomework(id: string): Promise<HomeworkDeleteResult> {
  await dbConnect();

  const loaded = await loadInteractable(id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const planned = planHomeworkDelete(loaded.doc);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  await HomeworkModel.deleteOne({ id });
  return { ok: true };
}
