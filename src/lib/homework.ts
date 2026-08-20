/* Homework — the pure domain.
 *
 * Every rule Homework embodies lives here as a function over plain values:
 * whether a class may receive new work, who a new assignment is addressed to,
 * exactly what document a create writes, exactly which keys an edit may touch,
 * whether an assignment may be deleted, and which assignments are listable.
 * Nothing here connects to a database.
 *
 * WHY THE SPLIT. The live Homework collection contains submission entries keyed
 * by students whose documents no longer exist. Those entries are the only record
 * that those people ever did that work, they are invisible to the UI (the roster
 * cannot resolve them), and a save that replaced the `submissions` object would
 * erase all of them silently. The planners below therefore return the write as
 * DATA rather than performing it, so a test can assert precisely which keys a
 * write touches without a database in the loop — the same technique
 * src/lib/attendance.ts uses, and for the same reason.
 *
 * NO `server-only`, for the same reason src/lib/attendance.ts and
 * src/lib/lifecycle.ts have none: the pure decisions are exercised by the test
 * runner, which cannot resolve that module. Nothing here is imported by a client
 * component for its behaviour — the TYPES are shared with the client, which
 * costs nothing at runtime.
 *
 * THE APP CLOCK IS AN ARGUMENT, never a module-level import. `createdAt` is
 * stamped from a clock the caller passes, so a test states the date it expects
 * rather than tracking TODAY_ISO. Homework has no second clock and no lifecycle:
 * a due date passing changes no stored data (PROJECT_RULES, Sprint 7 decisions).
 *
 * SPRINT 7 SCOPE. This module plans creates, edits and deletes; it performs
 * none of them. The index read model and the submission writer are deliberately
 * absent — the first belongs to the screen that renders it, and the second has
 * no designed surface to call it. */

import type { Homework, HomeworkStatus, Klass, Student } from "./types";

/* ------------------------------------------------------------- vocabulary */

/** The four words a Homework status may be, at assignment level and at
 * submission level alike. Shared with validation so the list is stated once. */
export const HOMEWORK_STATUSES = ["Assigned", "Completed", "Late", "Missing"] as const satisfies
  readonly HomeworkStatus[];

/** The status a new assignment is always born with. Nothing in Sprint 7 writes
 * any other value: `Assigned` means no outcome has been recorded, which is
 * exactly true of work that was set a moment ago. */
export const INITIAL_HOMEWORK_STATUS: HomeworkStatus = "Assigned";

/** The only fields a teacher may change after an assignment exists. Ownership —
 * class, scope, assignee — is fixed at creation: an assignment addressed to the
 * wrong class is deleted, if it is still pending, and set again. */
export const HOMEWORK_EDITABLE_FIELDS = ["title", "description", "dueDate", "teacherNotes"] as const;

export type HomeworkEditableField = (typeof HOMEWORK_EDITABLE_FIELDS)[number];

/* ----------------------------------------------------------------- errors */

export type HomeworkOpError =
  | "not_found"
  | "class_not_found"
  | "class_not_active"
  | "student_not_found"
  | "student_not_in_class"
  | "not_deletable";

/** HTTP status + message per failure, so every Route Handler maps one the same
 * way. Plain data, no framework coupling — the shape, and the wording of the
 * "not found" cases, are lifted from ATTENDANCE_ERROR (src/lib/attendance.ts)
 * and LESSON_ERROR (src/lib/lessons.ts) so the modules answer the same question
 * with the same sentence. */
export const HOMEWORK_ERROR: Record<HomeworkOpError, { status: number; message: string }> = {
  not_found: { status: 404, message: "Homework not found" },
  class_not_found: { status: 404, message: "Class not found" },
  class_not_active: { status: 422, message: "Only an active class can be assigned homework" },
  student_not_found: { status: 404, message: "Student not found" },
  student_not_in_class: { status: 422, message: "That student isn't in this class" },
  not_deletable: { status: 409, message: "Only homework that's still assigned can be deleted" },
};

/* ------------------------------------------------------------ eligibility */

/** May this class receive NEW homework?
 *
 * ACTIVE ONLY, and the test is an equality so it fails closed: an Ended class's
 * teaching is over, an Archived class is filed away, and a status this build
 * does not recognise is not a permission. Homework carries a future due date —
 * it is an instruction for work not yet done — so neither of the two non-Active
 * statuses describes a class that should receive more of it.
 *
 * This governs NEW work only. A class's status never changes what it has
 * already been set: existing homework stays listed and counted whatever its
 * class later becomes (see `isListableHomework`, and note that completion
 * reporting never reads a class at all). */
export function canAssignToClass(klass: Pick<Klass, "status"> | null | undefined): boolean {
  return klass?.status === "Active";
}

/* --------------------------------------------------------------- assignees */

/** The roster ids a NEW assignment is addressed to: the class's own order,
 * filtered to students whose documents exist.
 *
 * "RESOLVABLE" MEANS THE DOCUMENT EXISTS — nothing else. Student.status is
 * deliberately NOT consulted, so a Trial, Paused or Archived student is still
 * given the work: they are enrolled, and homework is set for the class.
 *
 * A roster id with no Student document is simply omitted. It is not repaired,
 * reported or written back, and — this is the point — it is never copied into a
 * new assignment. Preserving a ghost entry that already exists is a statement
 * about history; minting a fresh one would be inventing it. */
export function resolveAssignedStudentIds(
  roster: readonly string[] | undefined,
  existingStudentIds: ReadonlySet<string>
): string[] {
  return (roster ?? []).filter((id) => existingStudentIds.has(id));
}

/** The submissions map a new class-scoped assignment starts with: one key per
 * assignee, every one of them `Assigned`. A fresh object every call, so nothing
 * a caller holds can be aliased into a document. */
export function initialSubmissions(assignedIds: readonly string[]): Record<string, HomeworkStatus> {
  const out: Record<string, HomeworkStatus> = {};
  for (const id of assignedIds) out[id] = INITIAL_HOMEWORK_STATUS;
  return out;
}

/* ------------------------------------------------------------------ create */

/** What a teacher supplies when setting homework. Everything else on the
 * document is the server's to decide. */
export interface HomeworkCreateInput {
  title: string;
  description: string;
  classId: string;
  scope: Homework["scope"];
  studentId: string | null;
  dueDate: string; // ISO "YYYY-MM-DD"
  teacherNotes: string;
}

export type HomeworkCreatePlan =
  | { ok: true; doc: Homework }
  | { ok: false; reason: HomeworkOpError };

/** Plan the one document a create writes.
 *
 * ORDER MATTERS, and it is the order the entities are needed in: the class must
 * exist before its status can be judged, and it must be eligible before an
 * assignee is looked for inside it. A caller that stops at the first failure
 * therefore never reports "student not in class" for a class that was never
 * there. Zod validates the SHAPE of the input; it cannot know whether a class is
 * Active or who is on its roster, so those live here.
 *
 * THE ID AND THE CLOCK ARE ARGUMENTS. Minting an ObjectId is the service's job
 * and reading the clock is the caller's, which is what lets a test assert the
 * whole document — every field, exactly — rather than everything except the two
 * that move.
 *
 * `lessonId` IS ALWAYS NULL AND IS NOT AN INPUT. Homework is class-owned. A
 * populated `lessonId` is a freeze signal to the recurrence engine
 * (src/lib/recurrence.ts, `freezeReasons`), so writing one would quietly make a
 * lesson unreconcilable and unretireable — a Sprint 5 behaviour change reached
 * through a Sprint 7 form. `HomeworkCreateInput` has no such field, so it cannot
 * arrive from a caller at all.
 *
 * Inputs are never mutated: the document is built fresh, and so is its
 * submissions map. */
export function planHomeworkCreate(
  input: HomeworkCreateInput,
  klass: Klass | null | undefined,
  existingStudentIds: ReadonlySet<string>,
  generatedId: string,
  appClock: string
): HomeworkCreatePlan {
  if (!klass) return { ok: false, reason: "class_not_found" };
  if (!canAssignToClass(klass)) return { ok: false, reason: "class_not_active" };

  const isStudentScoped = input.scope === "student";
  let studentId: string | null = null;

  if (isStudentScoped) {
    const wanted = input.studentId;
    if (!wanted || !existingStudentIds.has(wanted)) return { ok: false, reason: "student_not_found" };
    if (!(klass.studentIds ?? []).includes(wanted)) return { ok: false, reason: "student_not_in_class" };
    studentId = wanted;
  }

  // A class-scoped assignment carries the roster it was set for; a student-scoped
  // one carries nobody, because its single outcome is the assignment's own status.
  // The empty map is stored rather than omitted — the schema keeps it
  // (`minimize: false`), and "nobody was given this" is a different fact from
  // "this field was never written".
  const submissions = isStudentScoped
    ? {}
    : initialSubmissions(resolveAssignedStudentIds(klass.studentIds, existingStudentIds));

  return {
    ok: true,
    doc: {
      id: generatedId,
      title: input.title,
      description: input.description,
      classId: klass.id,
      lessonId: null,
      scope: input.scope,
      studentId,
      dueDate: input.dueDate,
      status: INITIAL_HOMEWORK_STATUS,
      submissions,
      teacherNotes: input.teacherNotes,
      createdAt: appClock,
    },
  };
}

/* -------------------------------------------------------------------- edit */

/** A correction to the fields a teacher authored. Partial: a key that is absent
 * is a key that is not being changed. */
export type HomeworkPatch = Partial<Pick<Homework, HomeworkEditableField>>;

/** Plan the `$set` an edit writes — and nothing else.
 *
 * THIS IS THE IMMUTABILITY BOUNDARY, and it is an allow-list rather than a
 * deny-list so it fails closed: a key is emitted only because it appears in
 * HOMEWORK_EDITABLE_FIELDS, so a field added to the model later is immutable
 * until someone deliberately lists it here. `classId`, `scope`, `studentId`,
 * `lessonId`, `status` and `submissions` can therefore never be produced,
 * whatever a caller passes.
 *
 * The submissions map is the reason this matters most. Eight stored entries in
 * the live collection belong to students who no longer exist; a `$set` naming
 * `submissions` would replace the whole object and take every one of them with
 * it. No path through this function can emit that key.
 *
 * PARTIAL, AND `undefined` IS NOT A VALUE. Only keys actually supplied are
 * emitted, so an edit of the title leaves the due date untouched rather than
 * rewriting it with what the form happened to hold. An empty string IS supplied:
 * clearing the teacher's notes stores `""`, which is how every other top-level
 * notes field in the app behaves (Class.notes, Student.notes). Attendance's rule
 * about removing an emptied note governs a nested per-student entry object,
 * which this is not.
 *
 * An empty patch plans an empty `$set`; deciding that there is nothing to write
 * belongs to the caller that would have issued it. */
export function planHomeworkUpdate(patch: HomeworkPatch): HomeworkPatch {
  const set: HomeworkPatch = {};
  for (const key of HOMEWORK_EDITABLE_FIELDS) {
    const value = patch[key];
    if (value !== undefined) set[key] = value;
  }
  return set;
}

/* ------------------------------------------------------------------ delete */

/** May this assignment be deleted?
 *
 * PENDING ONLY. Deletion is for work that has not been settled: while an
 * assignment is `Assigned` no outcome has been recorded against it, so removing
 * it destroys no history. Completed, Late and Missing assignments are historical
 * records — and the outcomes they carry include the only surviving evidence that
 * students who have since been deleted did that work.
 *
 * An equality, so it fails closed on any value this build does not recognise.
 *
 * THE DUE DATE IS NOT CONSULTED. An overdue assignment that is still `Assigned`
 * is still pending — nobody has said anything about it — so it stays deletable.
 * A date passing settles nothing. */
export function canDeleteHomework(homework: Pick<Homework, "status"> | null | undefined): boolean {
  return homework?.status === INITIAL_HOMEWORK_STATUS;
}

export type HomeworkDeletePlan =
  | { ok: true }
  | { ok: false; reason: HomeworkOpError };

/** The delete decision in the shape a Route Handler maps through HOMEWORK_ERROR.
 * Absence and ineligibility are different answers: 404 for a record that is not
 * there, 409 for one that is there and settled. */
export function planHomeworkDelete(
  homework: Pick<Homework, "status"> | null | undefined
): HomeworkDeletePlan {
  if (!homework) return { ok: false, reason: "not_found" };
  if (!canDeleteHomework(homework)) return { ok: false, reason: "not_deletable" };
  return { ok: true };
}

/* --------------------------------------------------------------- duplicate */

/** What Duplicate hands the create form. Values only — the type carries no
 * `id`, `createdAt`, `status`, `submissions` or `lessonId`, so a historical
 * outcome cannot be copied even by accident. */
export interface HomeworkPrefill {
  title: string;
  description: string;
  classId: string;
  scope: Homework["scope"];
  studentId: string | null;
  dueDate: string;
  teacherNotes: string;
}

/** Prefill a new assignment from an existing one.
 *
 * NOTHING IS PERSISTED. Duplicate opens the create form; the teacher sees every
 * value before any of it is written, which is what makes "what does Duplicate
 * copy?" answerable without inventing a rule — they can see it, and change it.
 *
 * THE DUE DATE IS DELIBERATELY BLANK. Copying it reliably produces an assignment
 * that is already overdue, and the field is required, so leaving it empty makes
 * the teacher state a date rather than inherit a wrong one. The empty state is
 * the designed one: "Pick a due date" is the existing validation message.
 *
 * The source assignment is only read. */
export function duplicatePrefill(homework: Homework): HomeworkPrefill {
  return {
    title: homework.title,
    description: homework.description,
    classId: homework.classId,
    scope: homework.scope,
    studentId: homework.studentId,
    dueDate: "",
    teacherNotes: homework.teacherNotes,
  };
}

/* -------------------------------------------------------------- visibility */

/** Does this assignment appear on the Homework index?
 *
 * A student-scoped assignment whose student no longer exists is preserved and
 * still counted, but is NOT listed: the card is addressed to somebody, and there
 * is no name to render. Inventing a placeholder for the missing student would be
 * inventing copy the design does not have, so the record is simply omitted — the
 * same treatment a roster id with no Student document already gets.
 *
 * A class-scoped assignment is always listable, including when some of its
 * stored submission keys are ghosts. The card is addressed to the class, which
 * still exists, and its hidden entries are never part of what the screen shows
 * anyway.
 *
 * Not being listed is also not being reachable: an assignment the index omits is
 * one the API refuses to edit or delete, so this predicate is the visibility
 * rule and the interaction rule at once. */
export function isListableHomework(
  homework: Pick<Homework, "scope" | "studentId">,
  existingStudentIds: ReadonlySet<string>
): boolean {
  if (homework.scope !== "student") return true;
  return !!homework.studentId && existingStudentIds.has(homework.studentId);
}

/* -------------------------------------------------------------- read model */

/** One assignment as the API hands it out.
 *
 * `submissions` IS DELIBERATELY ABSENT. Sprint 7 has no surface that records an
 * outcome and no screen that shows one, so the stored map never leaves the
 * server — which also means the preserved entries for students who no longer
 * exist cannot be disclosed by a response, guessed at from one, or addressed by
 * a client that saw one. When a submission-recording design exists, this type is
 * where it becomes visible, deliberately.
 *
 * `lessonId` is absent for the same kind of reason: it is always null, it means
 * nothing to a reader, and shipping it would invite a client to send it back. */
export interface HomeworkListItem {
  id: string;
  title: string;
  description: string;
  classId: string;
  className: string;
  classColor: string;
  scope: Homework["scope"];
  studentId: string | null;
  /** The class's name, or — for student-scoped work — the student's. */
  assigneeName: string;
  dueDate: string;
  status: HomeworkStatus;
  teacherNotes: string;
  createdAt: string;
  /** Pending work may be deleted; settled work is a historical record. */
  deleteEligible: boolean;
}

/** Shape the assignments a client may see.
 *
 * OMISSION IS THE VISIBILITY RULE, and it fails closed twice:
 *
 *  - an assignment whose CLASS no longer exists is dropped. Every card is
 *    labelled with its class, and there is no name to label it with. (No live
 *    record is in this state; the branch exists so that one could never render
 *    as a blank.)
 *  - a STUDENT-SCOPED assignment whose student no longer exists is dropped, per
 *    `isListableHomework`. Nothing stands in for the missing name, because no
 *    such copy exists in the design to stand in with.
 *
 * Both are read rules. Neither repairs, reports or erases anything, and both
 * records keep counting in monthly reporting exactly as stored — being unseen is
 * not being forgotten.
 *
 * A class-scoped assignment is always shaped, including when its stored
 * submissions contain ghost keys. Those keys are simply not part of this type.
 *
 * ORDER: newest due date first, ties broken by id so the same data always
 * produces the same list. This is the order the collection already carries — the
 * dataset it was generated from sorts by due date descending — rather than a new
 * rule; the design ships no sort control to state a different one. */
export function buildHomeworkList(
  homework: readonly Homework[],
  classes: readonly Pick<Klass, "id" | "name" | "color">[],
  students: readonly Pick<Student, "id" | "name">[]
): HomeworkListItem[] {
  const classById = new Map(classes.map((c) => [c.id, c]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const existingStudentIds = new Set(studentById.keys());

  return homework
    .filter((h) => classById.has(h.classId) && isListableHomework(h, existingStudentIds))
    .map((h) => {
      const klass = classById.get(h.classId)!;
      const student = h.scope === "student" && h.studentId ? studentById.get(h.studentId) : undefined;
      return {
        id: h.id,
        title: h.title,
        description: h.description,
        classId: h.classId,
        className: klass.name,
        classColor: klass.color,
        scope: h.scope,
        studentId: h.scope === "student" ? h.studentId : null,
        assigneeName: student ? student.name : klass.name,
        dueDate: h.dueDate,
        status: h.status,
        teacherNotes: h.teacherNotes,
        createdAt: h.createdAt,
        deleteEligible: canDeleteHomework(h),
      };
    })
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------ class option lists */

export interface HomeworkClassOption {
  id: string;
  name: string;
}

/** An Active class, with the students who may actually be assigned work in it. */
export interface HomeworkAssignableClass extends HomeworkClassOption {
  students: Array<{ id: string; name: string }>;
}

/** The classes the index may be filtered by: every class the VISIBLE list
 * actually mentions, whatever its status now is.
 *
 * DERIVED FROM THE LIST, NOT FROM A STATUS. Filtering the options to Active
 * classes would make a past month's homework unreachable the moment its class
 * was ended or archived — a present-tense status hiding a historical fact, which
 * is the one thing the class-lifecycle rules forbid reporting from doing. So the
 * options follow what is on screen: a class appears here because work of its is
 * listed, and for no other reason.
 *
 * This is deliberately NOT the same list as `buildAssignableClasses`. Which
 * classes may receive NEW work and which may be filtered FOR are different
 * questions, and answering them with one list would get one of them wrong. */
export function buildFilterClasses(
  items: readonly HomeworkListItem[],
  classes: readonly Pick<Klass, "id" | "name">[]
): HomeworkClassOption[] {
  const listed = new Set(items.map((i) => i.classId));
  return classes
    .filter((c) => listed.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The classes new homework may be set for, each with the students it could be
 * addressed to.
 *
 * ACTIVE ONLY, through `canAssignToClass` rather than a second status test, so
 * the picker cannot offer a class the API would refuse.
 *
 * The students are the class's roster resolved against real documents, IN ROSTER
 * ORDER, carrying id and name and nothing else — no phone, no email, no status.
 * A roster id with no Student document is omitted, so an unresolvable id can
 * never be chosen as an assignee and never reaches a client. That is the same
 * omission `resolveAssignedStudentIds` performs for a create, expressed for the
 * form that precedes it, so the picker and the write agree on who exists.
 *
 * A class with no resolvable students is still offered: class-scoped work may be
 * set for it — it simply addresses nobody — and only the student picker is empty. */
export function buildAssignableClasses(
  classes: readonly Klass[],
  students: readonly Pick<Student, "id" | "name">[]
): HomeworkAssignableClass[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  return classes
    .filter((c) => canAssignToClass(c))
    .map((c) => ({
      id: c.id,
      name: c.name,
      students: (c.studentIds ?? [])
        .map((id) => byId.get(id))
        .filter((s): s is Pick<Student, "id" | "name"> => !!s)
        .map((s) => ({ id: s.id, name: s.name })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
