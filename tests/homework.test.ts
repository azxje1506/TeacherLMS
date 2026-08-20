/* Homework — the pure domain, and what "completion" counts.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. Every rule Homework embodies lives in
 * src/lib/homework.ts as a function over plain values, so it is exercised
 * directly rather than through a database round trip. The planners are the
 * important cases: `planHomeworkCreate` and `planHomeworkUpdate` return the
 * write as DATA precisely so a test can assert which keys they touch and which
 * they can never produce.
 *
 * Guarantees that are NOT expressible as a function call — that the pure module
 * has no database access at all, that it cannot reach the recurrence engine,
 * that `homeworkCompletion` cannot see a Class — are asserted by scanning the
 * source, the same technique tests/attendance.test.ts and
 * tests/class-lifecycle.test.ts already use.
 *
 * NOTHING HERE TOUCHES THE PRODUCTION DATABASE. The June and July figures below
 * are in-memory fixtures shaped from the live collection as audited, not a
 * connection to it.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HOMEWORK_EDITABLE_FIELDS, HOMEWORK_ERROR, HOMEWORK_STATUSES, INITIAL_HOMEWORK_STATUS,
  canAssignToClass, canDeleteHomework, duplicatePrefill, initialSubmissions,
  isListableHomework, planHomeworkCreate, planHomeworkDelete, planHomeworkUpdate,
  type HomeworkCreateInput, type HomeworkOpError,
} from "../src/lib/homework";
import { homeworkCompletion } from "../src/lib/finance";
import type { Homework, HomeworkStatus, Klass } from "../src/lib/types";

const CLOCK = "2026-07-10";

/** A module's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. Lifted from tests/attendance.test.ts. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE = code("src", "lib", "homework.ts");
const FINANCE = code("src", "lib", "finance.ts");

/* ------------------------------------------------------------------ fixtures */

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Little Explorers · A1", type: "group", level: "A1", fee: 800_000,
    classroom: "Room A", status: "Active", studentIds: ["s1", "s2", "s3"], notes: "",
    schedule: [], color: "#888",
    ...over,
  };
}

function input(over: Partial<HomeworkCreateInput> = {}): HomeworkCreateInput {
  return {
    title: "Reading comprehension · Unit 5",
    description: "Read pages 22–25.",
    classId: "c1",
    scope: "class",
    studentId: null,
    dueDate: "2026-07-18",
    teacherNotes: "",
    ...over,
  };
}

function hw(over: Partial<Homework> = {}): Homework {
  return {
    id: "hw-1", title: "T", description: "D", classId: "c1", lessonId: null,
    scope: "class", studentId: null, dueDate: "2026-07-04", status: "Completed",
    submissions: {}, teacherNotes: "", createdAt: "2026-06-15",
    ...over,
  };
}

const ids = (...v: string[]) => new Set(v);

/* ---------------------------------------------------------------- vocabulary */

describe("Homework vocabulary", () => {
  it("1. is the four approved words, and nothing else", () => {
    assert.deepEqual([...HOMEWORK_STATUSES], ["Assigned", "Completed", "Late", "Missing"]);
  });

  it("2. a new assignment's status is Assigned", () => {
    assert.equal(INITIAL_HOMEWORK_STATUS, "Assigned");
  });

  it("3. exactly four fields are editable — ownership is not among them", () => {
    assert.deepEqual([...HOMEWORK_EDITABLE_FIELDS], ["title", "description", "dueDate", "teacherNotes"]);
    for (const immutable of ["classId", "scope", "studentId", "lessonId", "status", "submissions"]) {
      assert.ok(
        !(HOMEWORK_EDITABLE_FIELDS as readonly string[]).includes(immutable),
        `${immutable} must never be editable`
      );
    }
  });

  it("4. every failure maps to a status and a sentence", () => {
    const reasons: HomeworkOpError[] = [
      "not_found", "class_not_found", "class_not_active",
      "student_not_found", "student_not_in_class", "not_deletable",
    ];
    for (const r of reasons) {
      assert.ok(HOMEWORK_ERROR[r], `${r} is unmapped`);
      assert.ok(HOMEWORK_ERROR[r].status >= 400);
      assert.ok(HOMEWORK_ERROR[r].message.length > 0);
    }
    // The two "not found" sentences match the wording the other modules use.
    assert.equal(HOMEWORK_ERROR.class_not_found.message, "Class not found");
    assert.equal(HOMEWORK_ERROR.not_deletable.status, 409);
    assert.equal(HOMEWORK_ERROR.class_not_active.status, 422);
  });
});

/* --------------------------------------------------------------- eligibility */

describe("Which classes may receive new homework", () => {
  it("5. Active is allowed", () => {
    assert.equal(canAssignToClass(klass({ status: "Active" })), true);
  });

  it("6. Ended is refused — the teaching is over", () => {
    assert.equal(canAssignToClass(klass({ status: "Ended" })), false);
  });

  it("7. Archived is refused — the class is filed away", () => {
    assert.equal(canAssignToClass(klass({ status: "Archived" })), false);
  });

  it("8. an unrecognised status fails closed", () => {
    const weird = { status: "Suspended" } as unknown as Klass;
    assert.equal(canAssignToClass(weird), false);
  });

  it("9. a missing class fails closed", () => {
    assert.equal(canAssignToClass(null), false);
    assert.equal(canAssignToClass(undefined), false);
  });
});

/* ------------------------------------------------------------------ roster */

describe("Who a new assignment is addressed to", () => {
  it("10. keeps the class's own order", () => {
    const c = klass({ studentIds: ["s3", "s1", "s2"] });
    assert.deepEqual(resolved(c, ids("s1", "s2", "s3")), ["s3", "s1", "s2"]);
  });

  it("11. omits roster ids with no Student document", () => {
    const c = klass({ studentIds: ["s1", "s8", "s2"] }); // s8 deleted
    assert.deepEqual(resolved(c, ids("s1", "s2")), ["s1", "s2"]);
  });

  it("12. never invents an id that was not on the roster", () => {
    const c = klass({ studentIds: ["s1"] });
    assert.deepEqual(resolved(c, ids("s1", "s2", "s3")), ["s1"]);
  });

  it("13. Student status is not consulted — Trial, Paused and Archived are enrolled", () => {
    // The set models "the document exists"; nothing here knows a student's status.
    const c = klass({ studentIds: ["s4", "s7", "s16"] });
    assert.deepEqual(resolved(c, ids("s4", "s7", "s16")), ["s4", "s7", "s16"]);
  });

  it("14. a class whose every roster id is unresolvable yields nobody", () => {
    const c = klass({ studentIds: ["s1"] });
    assert.deepEqual(resolved(c, ids()), []);
  });

  it("15. every assignee starts Assigned", () => {
    assert.deepEqual(initialSubmissions(["s1", "s2"]), { s1: "Assigned", s2: "Assigned" });
  });

  it("16. an empty assignee list yields an empty map, not undefined", () => {
    assert.deepEqual(initialSubmissions([]), {});
  });

  it("17. builds a fresh map every call — no aliasing between assignments", () => {
    const a = initialSubmissions(["s1"]);
    const b = initialSubmissions(["s1"]);
    assert.notEqual(a, b);
    a.s1 = "Completed";
    assert.equal(b.s1, "Assigned");
  });
});

/** `resolveAssignedStudentIds` through a class, which is how the planner uses it. */
function resolved(c: Klass, existing: ReadonlySet<string>): string[] {
  const plan = planHomeworkCreate(input(), c, existing, "id-x", CLOCK);
  assert.ok(plan.ok);
  return Object.keys(plan.doc.submissions);
}

/* ------------------------------------------------------------------ create */

describe("Creating homework", () => {
  it("18. an Active class produces a document", () => {
    const plan = planHomeworkCreate(input(), klass(), ids("s1", "s2", "s3"), "id-1", CLOCK);
    assert.ok(plan.ok);
  });

  it("19. a missing class is refused, with nothing planned", () => {
    const plan = planHomeworkCreate(input(), null, ids("s1"), "id-1", CLOCK);
    assert.deepEqual(plan, { ok: false, reason: "class_not_found" });
  });

  it("20. an Ended class is refused", () => {
    const plan = planHomeworkCreate(input(), klass({ status: "Ended" }), ids("s1"), "id-1", CLOCK);
    assert.deepEqual(plan, { ok: false, reason: "class_not_active" });
  });

  it("21. an Archived class is refused", () => {
    const plan = planHomeworkCreate(input(), klass({ status: "Archived" }), ids("s1"), "id-1", CLOCK);
    assert.deepEqual(plan, { ok: false, reason: "class_not_active" });
  });

  it("22. the class is found before its status is judged", () => {
    // A missing class reports class_not_found, never class_not_active.
    const plan = planHomeworkCreate(input(), undefined, ids(), "id-1", CLOCK);
    assert.ok(!plan.ok && plan.reason === "class_not_found");
  });

  it("23. class scope snapshots the resolvable roster, every entry Assigned", () => {
    const c = klass({ studentIds: ["s1", "s8", "s2"] });
    const plan = planHomeworkCreate(input(), c, ids("s1", "s2"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.deepEqual(plan.doc.submissions, { s1: "Assigned", s2: "Assigned" });
  });

  it("24. a ghost roster id is never copied into a NEW assignment", () => {
    const c = klass({ studentIds: ["s1", "s8"] });
    const plan = planHomeworkCreate(input(), c, ids("s1"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.ok(!("s8" in plan.doc.submissions), "a deleted student must not be given new work");
  });

  it("25. an Active class with no resolvable students is ALLOWED, and addresses nobody", () => {
    // The approved create rules list class existence, Active status, scope and the
    // student checks — roster size is deliberately not among them. c4 in production
    // is exactly this shape: Active, roster [s1], s1 deleted.
    const c = klass({ id: "c4", studentIds: ["s1"] });
    const plan = planHomeworkCreate(input({ classId: "c4" }), c, ids(), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.deepEqual(plan.doc.submissions, {});
    assert.equal(plan.doc.status, "Assigned");
  });

  it("26. student scope requires a Student that exists", () => {
    const c = klass({ studentIds: ["s1", "s2"] });
    const plan = planHomeworkCreate(
      input({ scope: "student", studentId: "s1" }), c, ids("s2"), "id-1", CLOCK
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_found" });
  });

  it("27. student scope requires a studentId at all", () => {
    const plan = planHomeworkCreate(
      input({ scope: "student", studentId: null }), klass(), ids("s1"), "id-1", CLOCK
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_found" });
  });

  it("28. the student must be on the class's roster", () => {
    const c = klass({ studentIds: ["s1", "s2"] });
    const plan = planHomeworkCreate(
      input({ scope: "student", studentId: "s9" }), c, ids("s1", "s2", "s9"), "id-1", CLOCK
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_in_class" });
  });

  it("29. student scope stores an empty submissions map", () => {
    const c = klass({ studentIds: ["s1", "s2"] });
    const plan = planHomeworkCreate(
      input({ scope: "student", studentId: "s1" }), c, ids("s1", "s2"), "id-1", CLOCK
    );
    assert.ok(plan.ok);
    assert.deepEqual(plan.doc.submissions, {});
    assert.equal(plan.doc.studentId, "s1");
  });

  it("30. class scope forces studentId to null even if one was supplied", () => {
    const plan = planHomeworkCreate(
      input({ scope: "class", studentId: "s1" }), klass(), ids("s1", "s2", "s3"), "id-1", CLOCK
    );
    assert.ok(plan.ok);
    assert.equal(plan.doc.studentId, null);
  });

  it("31. status is always Assigned", () => {
    for (const scope of ["class", "student"] as const) {
      const plan = planHomeworkCreate(
        input({ scope, studentId: scope === "student" ? "s1" : null }),
        klass(), ids("s1", "s2", "s3"), "id-1", CLOCK
      );
      assert.ok(plan.ok);
      assert.equal(plan.doc.status, "Assigned");
    }
  });

  it("32. lessonId is always null — homework never links a lesson", () => {
    const plan = planHomeworkCreate(input(), klass(), ids("s1"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.equal(plan.doc.lessonId, null);
  });

  it("33. lessonId cannot be supplied by a caller", () => {
    // Not a runtime check — the input type has no such field, so the only way to
    // pass one is to lie to the compiler. It is still dropped.
    const sneaky = { ...input(), lessonId: "L-c1-2026-07-13-0900" } as HomeworkCreateInput;
    const plan = planHomeworkCreate(sneaky, klass(), ids("s1"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.equal(plan.doc.lessonId, null);
  });

  it("34. createdAt is the injected app clock, never a wall clock", () => {
    const plan = planHomeworkCreate(input(), klass(), ids("s1"), "id-1", "2026-01-02");
    assert.ok(plan.ok);
    assert.equal(plan.doc.createdAt, "2026-01-02");
  });

  it("35. the id is the injected one, verbatim", () => {
    const a = planHomeworkCreate(input(), klass(), ids("s1"), "aaa", CLOCK);
    const b = planHomeworkCreate(input(), klass(), ids("s1"), "bbb", CLOCK);
    assert.ok(a.ok && b.ok);
    assert.equal(a.doc.id, "aaa");
    assert.equal(b.doc.id, "bbb");
  });

  it("36. teacher-authored fields are carried through untouched", () => {
    const plan = planHomeworkCreate(
      input({ title: "Bài tập  ", description: "Đọc trang 22–25.", teacherNotes: "  giữ nguyên" }),
      klass(), ids("s1"), "id-1", CLOCK
    );
    assert.ok(plan.ok);
    // Not trimmed, not normalised — teachers write Vietnamese here.
    assert.equal(plan.doc.title, "Bài tập  ");
    assert.equal(plan.doc.description, "Đọc trang 22–25.");
    assert.equal(plan.doc.teacherNotes, "  giữ nguyên");
  });

  it("37. the whole document is exactly this, and nothing more", () => {
    const c = klass({ studentIds: ["s1", "s2"] });
    const plan = planHomeworkCreate(input(), c, ids("s1", "s2"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.deepEqual(plan.doc, {
      id: "id-1",
      title: "Reading comprehension · Unit 5",
      description: "Read pages 22–25.",
      classId: "c1",
      lessonId: null,
      scope: "class",
      studentId: null,
      dueDate: "2026-07-18",
      status: "Assigned",
      submissions: { s1: "Assigned", s2: "Assigned" },
      teacherNotes: "",
      createdAt: CLOCK,
    });
  });

  it("38. a past due date is permitted — back-dating is a correction, not an error", () => {
    const plan = planHomeworkCreate(input({ dueDate: "2026-06-01" }), klass(), ids("s1"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.equal(plan.doc.dueDate, "2026-06-01");
  });

  it("39. neither the input nor the class is mutated", () => {
    const i = Object.freeze(input());
    const roster = Object.freeze(["s1", "s2"]);
    const c = Object.freeze(klass({ studentIds: roster as unknown as string[] }));
    const plan = planHomeworkCreate(i, c, ids("s1", "s2"), "id-1", CLOCK);
    assert.ok(plan.ok);
    assert.deepEqual([...roster], ["s1", "s2"]);
    assert.equal(i.studentId, null);
  });
});

/* -------------------------------------------------------------------- edit */

describe("Editing homework", () => {
  it("40. plans each editable field", () => {
    assert.deepEqual(planHomeworkUpdate({ title: "New title" }), { title: "New title" });
    assert.deepEqual(planHomeworkUpdate({ description: "New body" }), { description: "New body" });
    assert.deepEqual(planHomeworkUpdate({ dueDate: "2026-08-01" }), { dueDate: "2026-08-01" });
    assert.deepEqual(planHomeworkUpdate({ teacherNotes: "note" }), { teacherNotes: "note" });
  });

  it("41. is partial — an absent key is not being changed", () => {
    assert.deepEqual(planHomeworkUpdate({ title: "Only this" }), { title: "Only this" });
  });

  it("42. an explicit undefined is not a value", () => {
    assert.deepEqual(planHomeworkUpdate({ title: undefined }), {});
  });

  it("43. clearing the teacher's notes stores an empty string", () => {
    // Top-level notes fields behave this way across the app (Class.notes,
    // Student.notes). Attendance's remove-the-note rule governs a nested
    // per-student entry, which this is not.
    assert.deepEqual(planHomeworkUpdate({ teacherNotes: "" }), { teacherNotes: "" });
  });

  it("44. an empty patch plans an empty write", () => {
    assert.deepEqual(planHomeworkUpdate({}), {});
  });

  it("45. plans several fields at once", () => {
    assert.deepEqual(
      planHomeworkUpdate({ title: "T", dueDate: "2026-08-01" }),
      { title: "T", dueDate: "2026-08-01" }
    );
  });

  it("46. NEVER emits an ownership field, however it is passed", () => {
    const hostile = {
      title: "ok",
      classId: "c9", scope: "student", studentId: "s9", lessonId: "L-1",
      status: "Completed", submissions: { s1: "Completed" },
    } as Parameters<typeof planHomeworkUpdate>[0];
    const set = planHomeworkUpdate(hostile) as Record<string, unknown>;
    assert.deepEqual(Object.keys(set), ["title"]);
    for (const forbidden of ["classId", "scope", "studentId", "lessonId", "status", "submissions"]) {
      assert.ok(!(forbidden in set), `${forbidden} must never be planned`);
    }
  });

  it("47. cannot emit `submissions` — the key that would erase preserved history", () => {
    const set = planHomeworkUpdate(
      { submissions: {} } as unknown as Parameters<typeof planHomeworkUpdate>[0]
    ) as Record<string, unknown>;
    assert.deepEqual(set, {});
  });

  it("48. is an allow-list, so an unknown key is dropped rather than passed", () => {
    const set = planHomeworkUpdate(
      { somethingNew: 1 } as unknown as Parameters<typeof planHomeworkUpdate>[0]
    ) as Record<string, unknown>;
    assert.deepEqual(set, {});
  });

  it("49. does not mutate the patch it was given", () => {
    const patch = Object.freeze({ title: "T" });
    const set = planHomeworkUpdate(patch);
    assert.notEqual(set, patch);
    assert.deepEqual(patch, { title: "T" });
  });
});

/* ------------------------------------------------------------------ delete */

describe("Deleting homework", () => {
  it("50. an Assigned assignment may be deleted", () => {
    assert.equal(canDeleteHomework(hw({ status: "Assigned" })), true);
  });

  it("51. a Completed assignment may not", () => {
    assert.equal(canDeleteHomework(hw({ status: "Completed" })), false);
  });

  it("52. a Late assignment may not", () => {
    assert.equal(canDeleteHomework(hw({ status: "Late" })), false);
  });

  it("53. a Missing assignment may not", () => {
    assert.equal(canDeleteHomework(hw({ status: "Missing" })), false);
  });

  it("54. an unrecognised status fails closed", () => {
    const weird = { status: "Graded" } as unknown as Homework;
    assert.equal(canDeleteHomework(weird), false);
  });

  it("55. a missing assignment fails closed", () => {
    assert.equal(canDeleteHomework(null), false);
    assert.equal(canDeleteHomework(undefined), false);
  });

  it("56. eligibility reads the top-level status ONLY — the due date is irrelevant", () => {
    // Overdue and still Assigned: nobody has said anything about it, so it is
    // still pending and still deletable. A date passing settles nothing.
    assert.equal(canDeleteHomework(hw({ status: "Assigned", dueDate: "2026-01-01" })), true);
    // Settled long ago, or settled with a future date — the date changes neither.
    assert.equal(canDeleteHomework(hw({ status: "Missing", dueDate: "2026-12-31" })), false);
  });

  it("57. submissions do not affect eligibility either", () => {
    const withGhosts = hw({ status: "Assigned", submissions: { s8: "Assigned", s1: "Assigned" } });
    assert.equal(canDeleteHomework(withGhosts), true);
  });

  it("58. the plan separates absent from settled", () => {
    assert.deepEqual(planHomeworkDelete(null), { ok: false, reason: "not_found" });
    assert.deepEqual(planHomeworkDelete(hw({ status: "Completed" })), { ok: false, reason: "not_deletable" });
    assert.deepEqual(planHomeworkDelete(hw({ status: "Assigned" })), { ok: true });
  });

  it("59. a settled assignment carrying a deleted student's outcome is protected", () => {
    // hw-c1-0 in production: Completed, and s8's `Completed` is the only surviving
    // record that they ever did it.
    const settled = hw({ status: "Completed", submissions: { s8: "Completed", s2: "Completed" } });
    assert.deepEqual(planHomeworkDelete(settled), { ok: false, reason: "not_deletable" });
  });
});

/* --------------------------------------------------------------- duplicate */

describe("Duplicating homework", () => {
  const source = hw({
    id: "hw-c2-0", title: "Vocabulary", description: "Learn 15 words.",
    classId: "c2", scope: "class", studentId: null, dueDate: "2026-07-08",
    status: "Missing", submissions: { s3: "Late", s14: "Missing" },
    teacherNotes: "chase this up", createdAt: "2026-06-15",
  });

  it("60. carries the teacher-authored fields", () => {
    const pre = duplicatePrefill(source);
    assert.equal(pre.title, "Vocabulary");
    assert.equal(pre.description, "Learn 15 words.");
    assert.equal(pre.classId, "c2");
    assert.equal(pre.scope, "class");
    assert.equal(pre.teacherNotes, "chase this up");
  });

  it("61. leaves the due date blank", () => {
    assert.equal(duplicatePrefill(source).dueDate, "");
  });

  it("62. carries no id, createdAt, status, submissions or lessonId", () => {
    const pre = duplicatePrefill(source) as unknown as Record<string, unknown>;
    for (const forbidden of ["id", "createdAt", "status", "submissions", "lessonId"]) {
      assert.ok(!(forbidden in pre), `${forbidden} must never be copied`);
    }
  });

  it("63. cannot carry a historical outcome — not even a ghost one", () => {
    const pre = JSON.stringify(duplicatePrefill(source));
    assert.ok(!pre.includes("Missing"), "no stored outcome may survive a duplicate");
    assert.ok(!pre.includes("Late"));
    assert.ok(!pre.includes("s14"), "no submission key may survive a duplicate");
  });

  it("64. keeps a student-scoped assignment's subject", () => {
    const studentScoped = hw({ scope: "student", studentId: "s5", submissions: {} });
    assert.equal(duplicatePrefill(studentScoped).studentId, "s5");
  });

  it("65. leaves the source assignment untouched", () => {
    const before = JSON.stringify(source);
    duplicatePrefill(source);
    assert.equal(JSON.stringify(source), before);
  });

  it("66. what it produces is exactly what a create would need", () => {
    const pre = duplicatePrefill(source);
    assert.deepEqual(Object.keys(pre).sort(), [
      "classId", "description", "dueDate", "scope", "studentId", "teacherNotes", "title",
    ]);
  });
});

/* -------------------------------------------------------------- visibility */

describe("Which homework is listable", () => {
  it("67. class-scoped work is always listed", () => {
    assert.equal(isListableHomework(hw({ scope: "class", studentId: null }), ids()), true);
  });

  it("68. class-scoped work with hidden ghost entries is still listed", () => {
    const withGhosts = hw({ scope: "class", submissions: { s3: "Late", s14: "Missing" } });
    assert.equal(isListableHomework(withGhosts, ids("s3")), true);
  });

  it("69. student-scoped work whose student exists is listed", () => {
    assert.equal(isListableHomework(hw({ scope: "student", studentId: "s5" }), ids("s5")), true);
  });

  it("70. student-scoped work whose student is gone is NOT listed", () => {
    // hw-c4-1 in production: scope student, studentId s1, s1 deleted. There is no
    // name to render on the card, and no copy exists to stand in for one.
    assert.equal(isListableHomework(hw({ scope: "student", studentId: "s1" }), ids("s2")), false);
  });

  it("71. student-scoped work with no studentId at all is not listed", () => {
    assert.equal(isListableHomework(hw({ scope: "student", studentId: null }), ids("s1")), false);
  });

  it("72. not being listed says nothing about being stored — this is a read rule", () => {
    const ghost = hw({ scope: "student", studentId: "s1", status: "Missing" });
    assert.equal(isListableHomework(ghost, ids()), false);
    // The record itself is untouched by asking the question.
    assert.equal(ghost.status, "Missing");
    assert.equal(ghost.studentId, "s1");
  });
});

/* ------------------------------------------------- completion: unit semantics */

const completion = (homework: Homework[], month = "2026-07") => homeworkCompletion(month, { homework });

describe("homeworkCompletion — class scope counts one unit per stored submission", () => {
  const one = (s: HomeworkStatus, top: HomeworkStatus = "Completed") =>
    completion([hw({ status: top, submissions: { s1: s } })]);

  it("73. Completed is done", () => assert.equal(one("Completed"), 100));
  it("74. Late is done", () => assert.equal(one("Late"), 100));
  it("75. Missing is not done, but is counted", () => assert.equal(one("Missing"), 0));

  it("76. Assigned is excluded from BOTH numerator and denominator", () => {
    // Nothing else in the month, so an excluded entry leaves a zero denominator.
    assert.equal(one("Assigned"), 0);
    // And it does not dilute a sibling that did count.
    const mixed = completion([hw({ submissions: { s1: "Completed", s2: "Assigned" } })]);
    assert.equal(mixed, 100);
  });

  it("77. Completed + Late + Missing is 2/3", () => {
    const r = completion([hw({ submissions: { s1: "Completed", s2: "Late", s3: "Missing" } })]);
    assert.equal(r, 67); // 2/3 = 66.67 -> 67
  });

  it("78. a four-student assignment weighs four units", () => {
    const r = completion([
      hw({ submissions: { s1: "Completed", s2: "Completed", s3: "Missing", s4: "Missing" } }),
    ]);
    assert.equal(r, 50);
  });

  it("79. an assignment whose top-level status is Assigned is skipped entirely", () => {
    const r = completion([
      hw({ status: "Assigned", submissions: { s1: "Completed", s2: "Completed" } }),
    ]);
    assert.equal(r, 0, "a pending assignment contributes nothing, even if outcomes are stored");
  });

  it("80. a class-scoped assignment with no submissions contributes nothing", () => {
    assert.equal(completion([hw({ status: "Completed", submissions: {} })]), 0);
  });
});

describe("homeworkCompletion — student scope counts one unit per assignment", () => {
  const one = (top: HomeworkStatus) =>
    completion([hw({ scope: "student", studentId: "s5", status: top, submissions: {} })]);

  it("81. Completed is 1/1", () => assert.equal(one("Completed"), 100));
  it("82. Late is 1/1", () => assert.equal(one("Late"), 100));
  it("83. Missing is 0/1", () => assert.equal(one("Missing"), 0));

  it("84. Assigned is 0/0 — excluded, not failed", () => {
    assert.equal(one("Assigned"), 0);
    // Proven properly by pairing it with a unit that does count: if Assigned were
    // in the denominator this would be 50, not 100.
    const paired = completion([
      hw({ scope: "student", studentId: "s5", status: "Assigned" }),
      hw({ scope: "student", studentId: "s6", status: "Completed" }),
    ]);
    assert.equal(paired, 100);
  });

  it("85. one assignment is one unit however many students the class has", () => {
    const r = completion([
      hw({ scope: "student", studentId: "s5", status: "Completed" }),
      hw({ submissions: { s1: "Missing", s2: "Missing", s3: "Missing" } }),
    ]);
    assert.equal(r, 25); // 1 done / 4 units
  });
});

describe("homeworkCompletion — what it must not depend on", () => {
  it("86. a submission key for a Student who no longer exists still counts", () => {
    // s8 is deleted in production. The metric never joins Students, so the entry
    // counts exactly as stored — which is the point: deleting a student must not
    // restate a closed month.
    const r = completion([hw({ submissions: { s8: "Completed", s2: "Missing" } })]);
    assert.equal(r, 50);
  });

  it("87. a deleted student's Late counts as done, like anyone else's", () => {
    assert.equal(completion([hw({ submissions: { s8: "Late" } })]), 100);
  });

  it("88. a student-scoped assignment whose subject is gone still counts", () => {
    // hw-c4-1: not listable, still counted.
    const ghost = hw({ scope: "student", studentId: "s1", status: "Missing", submissions: {} });
    assert.equal(isListableHomework(ghost, ids()), false);
    assert.equal(completion([ghost]), 0);
    const paired = completion([ghost, hw({ submissions: { s2: "Completed" } })]);
    assert.equal(paired, 50, "the unlistable record is still one unit in the denominator");
  });

  it("89. it cannot see a Class — the signature forbids it", () => {
    // Not expressible as a call: the parameter type admits only `homework`, so a
    // class's current status cannot reach the formula. Pinned at the source.
    assert.ok(
      FINANCE.includes('export function homeworkCompletion(month: string, data: Pick<AllData, "homework">)'),
      "homeworkCompletion must keep its homework-only signature"
    );
  });

  it("90. the month comes from dueDate and nothing else", () => {
    const june = hw({ dueDate: "2026-06-30", submissions: { s1: "Completed" } });
    const july = hw({ dueDate: "2026-07-01", submissions: { s1: "Missing" } });
    assert.equal(completion([june, july], "2026-06"), 100);
    assert.equal(completion([june, july], "2026-07"), 0);
  });

  it("91. createdAt does not attribute a month", () => {
    const r = completion([hw({ createdAt: "2026-06-15", dueDate: "2026-07-04", submissions: { s1: "Completed" } })], "2026-06");
    assert.equal(r, 0, "June must not claim an assignment merely created in June");
  });

  it("92. a zero denominator is 0", () => {
    assert.equal(completion([]), 0);
    assert.equal(completion([hw({ dueDate: "2026-01-01", submissions: { s1: "Completed" } })]), 0);
  });
});

/* --------------------------------------- completion: live-shape regression */

/* The live collection as audited at Sprint 7 Gate 1, reproduced in memory.
 *
 * THE FIGURES BELOW CHANGED ON PURPOSE. Before Sprint 7, `Late` scored zero and
 * these months read 62% and 22%. Counting late work as done — the approved
 * decision — restates them to 77% and 56%. If a future change moves them back,
 * that is a regression, not a fix. */
const LIVE_JUNE: Homework[] = [
  hw({ id: "hw-c3-0", classId: "c3", scope: "student", studentId: "s5", dueDate: "2026-06-20", status: "Completed", submissions: {} }),
  hw({ id: "hw-c5-1", classId: "c5", dueDate: "2026-06-20", status: "Completed", submissions: { s3: "Completed" } }),
  hw({ id: "hw-c1-0", classId: "c1", dueDate: "2026-06-24", status: "Completed", submissions: { s8: "Completed", s12: "Completed", s4: "Late", s2: "Completed" } }),
  hw({ id: "hw-c3-1", classId: "c3", dueDate: "2026-06-24", status: "Missing", submissions: { s5: "Completed", s7: "Missing", s13: "Missing" } }),
  hw({ id: "hw-c1-1", classId: "c1", dueDate: "2026-06-27", status: "Completed", submissions: { s8: "Late", s12: "Completed", s4: "Missing", s2: "Completed" } }),
];

const LIVE_JULY: Homework[] = [
  hw({ id: "hw-c6-0", classId: "c6", dueDate: "2026-07-01", status: "Missing", submissions: { s11: "Missing" } }),
  hw({ id: "hw-c6-1", classId: "c6", dueDate: "2026-07-04", status: "Completed", submissions: { s11: "Completed" } }),
  hw({ id: "hw-c4-0", classId: "c4", dueDate: "2026-07-04", status: "Late", submissions: { s1: "Late" } }),
  hw({ id: "hw-c6-2", classId: "c6", dueDate: "2026-07-08", status: "Completed", submissions: { s11: "Completed" } }),
  hw({ id: "hw-c4-1", classId: "c4", scope: "student", studentId: "s1", dueDate: "2026-07-08", status: "Missing", submissions: {} }),
  hw({ id: "hw-c2-0", classId: "c2", dueDate: "2026-07-08", status: "Missing", submissions: { s3: "Late", s9: "Missing", s10: "Missing", s14: "Late" } }),
  hw({ id: "hw-c2-1", classId: "c2", dueDate: "2026-07-11", status: "Assigned", submissions: { s3: "Assigned", s9: "Assigned", s10: "Assigned", s14: "Assigned" } }),
  hw({ id: "hw-c4-2", classId: "c4", dueDate: "2026-07-11", status: "Assigned", submissions: { s1: "Assigned" } }),
  hw({ id: "hw-c2-2", classId: "c2", dueDate: "2026-07-15", status: "Assigned", submissions: { s3: "Assigned", s9: "Assigned", s10: "Assigned", s14: "Assigned" } }),
  hw({ id: "hw-c5-0", classId: "c5", dueDate: "2026-07-18", status: "Assigned", submissions: { s3: "Assigned" } }),
];

const LIVE = [...LIVE_JUNE, ...LIVE_JULY];

describe("homeworkCompletion — live-shape regression (the INTENDED Sprint 7 restatement)", () => {
  it("93. June 2026 is 10/13 = 77% — it read 62% before Late counted as done", () => {
    assert.equal(homeworkCompletion("2026-06", { homework: LIVE }), 77);
  });

  it("94. July 2026 is 5/9 = 56% — it read 22% before Late counted as done", () => {
    assert.equal(homeworkCompletion("2026-07", { homework: LIVE }), 56);
  });

  it("95. July's four pending assignments contribute nothing at all", () => {
    const settledOnly = LIVE_JULY.filter((h) => h.status !== "Assigned");
    assert.equal(homeworkCompletion("2026-07", { homework: settledOnly }), 56);
    assert.equal(LIVE_JULY.length - settledOnly.length, 4);
  });

  it("96. the four ghost ids are still counted in both months", () => {
    const alive = new Set(["s2", "s3", "s4", "s5", "s7", "s9", "s10", "s11", "s12", "s15", "s16"]);
    const ghostEntries = LIVE.flatMap((h) =>
      Object.keys(h.submissions).filter((sid) => !alive.has(sid))
    );
    assert.equal(ghostEntries.length, 8, "the audited eight preserved entries");

    // Dropping them would move both months — which is exactly why the metric does not.
    const withoutGhosts = LIVE.map((h) => ({
      ...h,
      submissions: Object.fromEntries(Object.entries(h.submissions).filter(([sid]) => alive.has(sid))),
    })).filter((h) => !(h.scope === "student" && h.studentId && !alive.has(h.studentId)));
    assert.notEqual(homeworkCompletion("2026-06", { homework: withoutGhosts }), 77);
    assert.notEqual(homeworkCompletion("2026-07", { homework: withoutGhosts }), 56);
  });

  it("97. a month with no homework due reads 0", () => {
    assert.equal(homeworkCompletion("2026-05", { homework: LIVE }), 0);
    assert.equal(homeworkCompletion("2026-08", { homework: LIVE }), 0);
  });

  it("98. deleting a pending assignment cannot move either month", () => {
    // The delete rule permits Assigned only, and Assigned is excluded from the
    // metric — so a permitted delete is arithmetically invisible.
    const deletable = LIVE.filter((h) => canDeleteHomework(h));
    assert.equal(deletable.length, 4);
    const after = LIVE.filter((h) => !canDeleteHomework(h));
    assert.equal(homeworkCompletion("2026-06", { homework: after }), 77);
    assert.equal(homeworkCompletion("2026-07", { homework: after }), 56);
  });

  it("99. exactly one live record is unlistable, and it still counts", () => {
    const alive = new Set(["s2", "s3", "s4", "s5", "s7", "s9", "s10", "s11", "s12", "s15", "s16"]);
    const hidden = LIVE.filter((h) => !isListableHomework(h, alive));
    assert.deepEqual(hidden.map((h) => h.id), ["hw-c4-1"]);
    const withoutHidden = LIVE.filter((h) => isListableHomework(h, alive));
    assert.equal(homeworkCompletion("2026-07", { homework: withoutHidden }), 63, "omitting it from the metric would misreport July");
  });
});

/* ---------------------------------------------------------------- boundaries */

describe("The pure core stays pure", () => {
  it("100. no database access of any kind", () => {
    for (const forbidden of ["dbConnect", "server-only", "mongoose", "Schema"]) {
      assert.ok(!CORE.includes(forbidden), `${forbidden} has no place in the pure core`);
    }
    assert.equal([...CORE.matchAll(/\b\w+Model\b/g)].length, 0, "no Mongoose model may be referenced");
  });

  it("101. no write verb is reachable from here", () => {
    const writes = /\.(updateOne|updateMany|deleteOne|deleteMany|insertMany|insertOne|bulkWrite|findOneAndUpdate|findOneAndDelete|replaceOne|save)\s*\(/g;
    assert.deepEqual([...CORE.matchAll(writes)].map((m) => m[1]), []);
  });

  it("102. no clock, no network, no filesystem", () => {
    assert.ok(!/new Date\s*\(/.test(CORE), "the app clock is an argument, never a wall clock");
    assert.ok(!/Date\.now\s*\(/.test(CORE));
    assert.ok(!CORE.includes("fetch("), "no network");
    assert.ok(!CORE.includes("readFileSync"), "no filesystem");
  });

  it("103. it imports types only — no runtime module of the app", () => {
    const imports = [...CORE.matchAll(/^import\s+([\s\S]*?)from\s+"([^"]+)"/gm)];
    assert.deepEqual(imports.map((m) => m[2]), ["./types"], "the pure core needs nothing else");
    assert.ok(imports.every((m) => m[1].includes("type ")), "and it needs only its types");
  });

  it("104. it cannot reach the recurrence engine", () => {
    for (const forbidden of ["recurrence", "reconciler", "lifecycle", "freezeReasons", "homeworked"]) {
      assert.ok(!CORE.includes(forbidden), `${forbidden} is not Homework's business`);
    }
  });

  it("105. lessonId is written exactly once, as null", () => {
    const mentions = [...CORE.matchAll(/lessonId\s*:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(mentions, ["null"], "the only lessonId a plan may carry is null");
  });

  it("106. no Homework writer exists in Sprint 7's core", () => {
    assert.ok(!CORE.includes("HomeworkModel"), "the pure core must not know the model exists");
  });
});

describe("The finance change is the smallest one that works", () => {
  it("107. Late joins Completed in the numerator, at both scopes", () => {
    assert.ok(FINANCE.includes('if (s === "Completed" || s === "Late") done++;'));
    assert.ok(FINANCE.includes('if (hw.status === "Completed" || hw.status === "Late") done++;'));
  });

  it("108. the Assigned exclusions are untouched", () => {
    assert.ok(FINANCE.includes('if (hw.status === "Assigned") continue;'));
    assert.ok(FINANCE.includes('if (s === "Assigned") continue;'));
  });

  it("109. month attribution and the zero-denominator fallback are untouched", () => {
    assert.ok(FINANCE.includes("if (!inMonth(hw.dueDate, month)) continue;"));
    assert.ok(FINANCE.includes("return total === 0 ? 0 : Math.round((done / total) * 100);"));
  });

  it("110. no other finance formula was touched by this sprint", () => {
    // The two neighbours the Homework work must not disturb.
    assert.ok(FINANCE.includes('if (st === "Present" || st === "Late" || st === "Excused") present++;'),
      "attendanceRate is unchanged");
    assert.ok(FINANCE.includes('.filter((l) => inMonth(l.date, month) && l.status === "Completed")'),
      "teachingHours is unchanged");
  });
});
