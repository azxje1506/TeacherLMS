/* Homework — the API boundary: what a request may carry, and what a route does.
 *
 * Run with:  npm test
 *
 * The validation schemas are exercised directly, because that IS the boundary —
 * a Route Handler does nothing with a body except hand it to one. The handler
 * behaviours that only exist at runtime (auth, status codes, delegation, the
 * absence of a verb) are asserted by scanning the route sources, the same way
 * tests/attendance.test.ts asserts its own route rules.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { homeworkCreateSchema, homeworkUpdateSchema } from "../src/lib/schemas";
import { HOMEWORK_ERROR } from "../src/lib/homework";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const COLLECTION = code("src", "app", "api", "homework", "route.ts");
const ITEM = code("src", "app", "api", "homework", "[id]", "route.ts");

const valid = {
  title: "Reading comprehension · Unit 5",
  description: "Read pages 22–25.",
  classId: "c2",
  scope: "class",
  studentId: null,
  dueDate: "2026-07-18",
  teacherNotes: "",
};

const firstIssue = (r: { success: false; error: { issues: Array<{ message: string }> } }) =>
  r.error.issues[0]?.message;

/* --------------------------------------------------------- create schema */

describe("POST body — what a create may carry", () => {
  it("1. accepts a well-formed class-scoped assignment", () => {
    const r = homeworkCreateSchema.safeParse(valid);
    assert.ok(r.success);
    assert.equal(r.data.scope, "class");
    assert.equal(r.data.studentId, null);
  });

  it("2. accepts a well-formed student-scoped assignment", () => {
    const r = homeworkCreateSchema.safeParse({ ...valid, scope: "student", studentId: "s3" });
    assert.ok(r.success);
    assert.equal(r.data.studentId, "s3");
  });

  it("3. requires a title", () => {
    const r = homeworkCreateSchema.safeParse({ ...valid, title: "" });
    assert.ok(!r.success);
    assert.equal(firstIssue(r), "Title is required");
  });

  it("4. requires a class", () => {
    const r = homeworkCreateSchema.safeParse({ ...valid, classId: "" });
    assert.ok(!r.success);
    assert.equal(firstIssue(r), "Select a class");
  });

  it("5. requires a due date, in ISO form", () => {
    for (const bad of ["", "18/07/2026", "2026-7-8", "tomorrow", "2026-07-18T00:00:00"]) {
      const r = homeworkCreateSchema.safeParse({ ...valid, dueDate: bad });
      assert.ok(!r.success, `${bad} must be refused`);
      assert.equal(firstIssue(r), "Pick a due date");
    }
  });

  it("6. requires a student when the scope is student", () => {
    const r = homeworkCreateSchema.safeParse({ ...valid, scope: "student", studentId: null });
    assert.ok(!r.success);
    assert.equal(firstIssue(r), "Select a student");
  });

  it("7. tolerates a stale studentId on a class-scoped body — the planner stores null", () => {
    // A form that switched scope may still hold the last selection. That is a
    // benign client state, not an attack, and planHomeworkCreate forces null.
    const r = homeworkCreateSchema.safeParse({ ...valid, scope: "class", studentId: "s3" });
    assert.ok(r.success);
  });

  it("8. refuses a scope outside the two", () => {
    assert.ok(!homeworkCreateSchema.safeParse({ ...valid, scope: "lesson" }).success);
    assert.ok(!homeworkCreateSchema.safeParse({ ...valid, scope: "" }).success);
  });

  it("9. defaults the optional text fields rather than leaving them undefined", () => {
    const r = homeworkCreateSchema.safeParse({
      title: "T", classId: "c1", dueDate: "2026-07-18",
    });
    assert.ok(r.success);
    assert.equal(r.data.description, "");
    assert.equal(r.data.teacherNotes, "");
    assert.equal(r.data.scope, "class");
    assert.equal(r.data.studentId, null);
  });

  it("10. allows a past due date — back-dating is a correction", () => {
    assert.ok(homeworkCreateSchema.safeParse({ ...valid, dueDate: "2026-01-05" }).success);
  });

  it("11. REFUSES every server-owned field, one at a time", () => {
    for (const [key, value] of Object.entries({
      id: "hw-x",
      status: "Completed",
      submissions: { s1: "Completed" },
      lessonId: "L-c2-2026-07-13-0900",
      createdAt: "2020-01-01",
    })) {
      const r = homeworkCreateSchema.safeParse({ ...valid, [key]: value });
      assert.ok(!r.success, `${key} must be rejected, not silently dropped`);
    }
  });

  it("12. refuses a payload carrying all of them at once", () => {
    const hostile = {
      ...valid,
      id: "hw-x", status: "Completed", submissions: { s8: "Completed" },
      lessonId: "L-1", createdAt: "2020-01-01",
    };
    assert.ok(!homeworkCreateSchema.safeParse(hostile).success);
  });

  it("13. refuses an unknown field, so a future model addition is opt-in", () => {
    assert.ok(!homeworkCreateSchema.safeParse({ ...valid, grade: 9 }).success);
  });

  it("14. refuses a non-object body", () => {
    for (const body of [null, undefined, "x", 3, []]) {
      assert.ok(!homeworkCreateSchema.safeParse(body).success);
    }
  });
});

/* --------------------------------------------------------- update schema */

describe("PATCH body — what an edit may carry", () => {
  it("15. accepts each editable field on its own", () => {
    assert.ok(homeworkUpdateSchema.safeParse({ title: "New" }).success);
    assert.ok(homeworkUpdateSchema.safeParse({ description: "New" }).success);
    assert.ok(homeworkUpdateSchema.safeParse({ dueDate: "2026-08-01" }).success);
    assert.ok(homeworkUpdateSchema.safeParse({ teacherNotes: "New" }).success);
  });

  it("16. accepts several at once", () => {
    const r = homeworkUpdateSchema.safeParse({ title: "T", dueDate: "2026-08-01" });
    assert.ok(r.success);
    assert.deepEqual(r.data, { title: "T", dueDate: "2026-08-01" });
  });

  it("17. is partial — an omitted key stays omitted, not defaulted", () => {
    const r = homeworkUpdateSchema.safeParse({ title: "T" });
    assert.ok(r.success);
    assert.deepEqual(Object.keys(r.data), ["title"], "no field is invented for the write");
  });

  it("18. accepts an empty patch", () => {
    const r = homeworkUpdateSchema.safeParse({});
    assert.ok(r.success);
    assert.deepEqual(r.data, {});
  });

  it("19. an empty string clears the teacher's notes", () => {
    const r = homeworkUpdateSchema.safeParse({ teacherNotes: "" });
    assert.ok(r.success);
    assert.deepEqual(r.data, { teacherNotes: "" });
  });

  it("20. still refuses an empty title and a malformed date", () => {
    assert.ok(!homeworkUpdateSchema.safeParse({ title: "" }).success);
    assert.ok(!homeworkUpdateSchema.safeParse({ dueDate: "01/08/2026" }).success);
  });

  it("21. REFUSES every immutable field, one at a time", () => {
    for (const [key, value] of Object.entries({
      classId: "c9",
      scope: "student",
      studentId: "s9",
      lessonId: "L-1",
      status: "Completed",
      submissions: { s1: "Completed" },
      createdAt: "2020-01-01",
      id: "hw-x",
    })) {
      const r = homeworkUpdateSchema.safeParse({ [key]: value });
      assert.ok(!r.success, `${key} must be rejected at the boundary`);
    }
  });

  it("22. refuses an immutable field even alongside a legitimate edit", () => {
    // The dangerous shape: a real title change smuggling a submissions replace.
    const r = homeworkUpdateSchema.safeParse({ title: "T", submissions: {} });
    assert.ok(!r.success, "a valid field must not launder an invalid one");
  });

  it("23. refuses an unknown field", () => {
    assert.ok(!homeworkUpdateSchema.safeParse({ notes: "x" }).success);
  });
});

/* --------------------------------------------------------------- routes */

describe("The collection route", () => {
  it("24. exposes GET and POST, and no other verb", () => {
    const verbs = [...COLLECTION.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD)/g)].map((m) => m[1]);
    assert.deepEqual(verbs.sort(), ["GET", "POST"]);
  });

  it("25. guards every handler with the session", () => {
    const handlers = [...COLLECTION.matchAll(/export async function \w+/g)].length;
    const guards = [...COLLECTION.matchAll(/await requireSession\(\)/g)].length;
    assert.equal(guards, handlers, "every handler authenticates");
  });

  it("26. validates the create body before the service sees it", () => {
    assert.ok(COLLECTION.includes("homeworkCreateSchema.safeParse(body)"));
    assert.ok(COLLECTION.indexOf("safeParse") < COLLECTION.indexOf("createHomework("));
  });

  it("27. answers 422 on a malformed body and 201 on a create", () => {
    assert.ok(COLLECTION.includes('error(parsed.error.issues[0]?.message ?? "Invalid input", 422)'));
    assert.ok(COLLECTION.includes("json(res.homework, 201)"));
  });

  it("28. maps a service failure through the shared error table", () => {
    assert.ok(COLLECTION.includes("HOMEWORK_ERROR[res.reason].message"));
    assert.ok(COLLECTION.includes("HOMEWORK_ERROR[res.reason].status"));
  });

  it("29. holds no database logic of its own", () => {
    for (const forbidden of ["HomeworkModel", "ClassModel", "StudentModel", "dbConnect", "mongoose"]) {
      assert.ok(!COLLECTION.includes(forbidden), `${forbidden} belongs in the service`);
    }
  });

  it("30. restates no business rule", () => {
    assert.ok(!/"Active"|"Assigned"|planHomework/.test(COLLECTION));
  });
});

describe("The single-assignment route", () => {
  it("31. exposes PATCH and DELETE — and deliberately no GET", () => {
    const verbs = [...ITEM.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD)/g)].map((m) => m[1]);
    assert.deepEqual(verbs.sort(), ["DELETE", "PATCH"]);
    assert.ok(!verbs.includes("GET"),
      "there is no detail screen, and a detail read would be the one way to fetch a hidden record by id");
  });

  it("32. guards every handler with the session", () => {
    const handlers = [...ITEM.matchAll(/export async function \w+/g)].length;
    const guards = [...ITEM.matchAll(/await requireSession\(\)/g)].length;
    assert.equal(guards, handlers);
  });

  it("33. validates the patch body before the service sees it", () => {
    assert.ok(ITEM.includes("homeworkUpdateSchema.safeParse(body)"));
    assert.ok(ITEM.indexOf("safeParse") < ITEM.indexOf("updateHomework("));
  });

  it("34. DELETE reads no body", () => {
    assert.ok(/export async function DELETE\(_req: Request/.test(ITEM), "the request is unused by name");
    const del = ITEM.slice(ITEM.indexOf("export async function DELETE"));
    assert.ok(!del.includes("req.json()"), "a delete carries no payload");
  });

  it("35. a refused delete answers 409 and carries a code", () => {
    assert.equal(HOMEWORK_ERROR.not_deletable.status, 409);
    assert.ok(ITEM.includes('code: "homework_not_deletable"'));
    assert.ok(ITEM.includes("HOMEWORK_ERROR.not_deletable.status"));
  });

  it("36. a successful delete answers { ok: true }", () => {
    assert.ok(ITEM.includes("json({ ok: true })"));
  });

  it("37. holds no database logic of its own", () => {
    for (const forbidden of ["HomeworkModel", "ClassModel", "StudentModel", "dbConnect", "mongoose"]) {
      assert.ok(!ITEM.includes(forbidden), `${forbidden} belongs in the service`);
    }
  });

  it("38. restates no business rule — deletability is the service's answer", () => {
    assert.ok(!/"Assigned"|canDeleteHomework|planHomeworkDelete/.test(ITEM));
  });
});

describe("What the API deliberately does not offer", () => {
  it("39. there is no submissions endpoint", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "homework");
    for (const p of [
      path.join(dir, "[id]", "submissions"),
      path.join(dir, "[id]", "submissions", "route.ts"),
      path.join(dir, "submissions"),
    ]) {
      assert.ok(!existsSync(p), `${p} must not exist — Sprint 7 records no outcomes`);
    }
    assert.ok(!ITEM.includes("submissions"));
    assert.ok(!COLLECTION.includes("submissions"));
  });

  it("40. there is no duplicate endpoint — duplicate is a create with prefill", () => {
    assert.ok(!existsSync(path.join(process.cwd(), "src", "app", "api", "homework", "[id]", "duplicate")));
    assert.ok(!ITEM.includes("duplicate"));
    assert.ok(!COLLECTION.includes("duplicate"));
  });

  it("41. there is no lesson-scoped homework route", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "homework");
    assert.ok(!existsSync(path.join(dir, "[lessonId]")));
    assert.ok(!ITEM.includes("lesson"));
    assert.ok(!COLLECTION.includes("lesson"));
  });

  it("42. exactly two homework route files exist", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "homework");
    assert.ok(existsSync(path.join(dir, "route.ts")));
    assert.ok(existsSync(path.join(dir, "[id]", "route.ts")));
    assert.ok(!existsSync(path.join(dir, "[id]", "[sub]")));
  });
});

describe("Error mapping is one table", () => {
  it("43. every reason a route can surface is in HOMEWORK_ERROR", () => {
    for (const reason of [
      "not_found", "class_not_found", "class_not_active",
      "student_not_found", "student_not_in_class", "not_deletable",
    ] as const) {
      assert.ok(HOMEWORK_ERROR[reason]);
    }
  });

  it("44. the statuses are the approved ones", () => {
    assert.equal(HOMEWORK_ERROR.not_found.status, 404);
    assert.equal(HOMEWORK_ERROR.class_not_found.status, 404);
    assert.equal(HOMEWORK_ERROR.student_not_found.status, 404);
    assert.equal(HOMEWORK_ERROR.class_not_active.status, 422);
    assert.equal(HOMEWORK_ERROR.student_not_in_class.status, 422);
    assert.equal(HOMEWORK_ERROR.not_deletable.status, 409);
  });

  it("45. neither route invents a status code of its own", () => {
    for (const src of [COLLECTION, ITEM]) {
      const literals = [...src.matchAll(/,\s*(\d{3})\)/g)].map((m) => m[1]);
      for (const s of literals) {
        assert.ok(["422", "201"].includes(s), `${s} must come from HOMEWORK_ERROR, not a literal`);
      }
    }
  });
});
