/* Homework — the service's read model, and the write surface it is allowed.
 *
 * Run with:  npm test
 *
 * NO DATABASE. This project has no integration-test infrastructure and Gate 4.2
 * explicitly forbids creating one against production, so the service is tested
 * the way tests/attendance.test.ts tests its own: the SHAPING is exercised
 * directly, because it lives in the pure core as a function over plain values,
 * and the GUARANTEES that only exist inside a Mongo call — which model may be
 * written, with which verb, touching which fields — are asserted by scanning the
 * source.
 *
 * That split is not a compromise. "The service writes HomeworkModel and nothing
 * else" is not expressible as a function call at all; a scan is the only form in
 * which it can be pinned, and it is the form the Sprint 5 and Sprint 6 suites
 * already chose for the same class of rule.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildHomeworkList } from "../src/lib/homework";
import type { Homework, Klass, Student } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE = code("src", "lib", "homework-service.ts");
const CORE = code("src", "lib", "homework.ts");
const FINANCE = code("src", "lib", "finance.ts");

/* ------------------------------------------------------------------ fixtures */

const CLASSES: Array<Pick<Klass, "id" | "name" | "color">> = [
  { id: "c1", name: "Little Explorers · A1", color: "#e11" },
  { id: "c2", name: "Grammar Stars · B1", color: "#22a" },
  { id: "c4", name: "Emma Chen · 1-on-1", color: "#3b3" },
];

const STUDENTS: Array<Pick<Student, "id" | "name">> = [
  { id: "s2", name: "Lucas Chen" },
  { id: "s3", name: "Liam Park" },
  { id: "s5", name: "Noah Rodriguez" },
];

function hw(over: Partial<Homework> = {}): Homework {
  return {
    id: "hw-1", title: "T", description: "D", classId: "c1", lessonId: null,
    scope: "class", studentId: null, dueDate: "2026-07-04", status: "Completed",
    submissions: {}, teacherNotes: "", createdAt: "2026-06-15",
    ...over,
  };
}

const list = (h: Homework[]) => buildHomeworkList(h, CLASSES, STUDENTS);

/* --------------------------------------------------------------- list shape */

describe("listHomework — what a client is shown", () => {
  it("1. shapes a class-scoped assignment with its class's labels", () => {
    const [item] = list([hw({ id: "a", classId: "c2" })]);
    assert.equal(item.id, "a");
    assert.equal(item.classId, "c2");
    assert.equal(item.className, "Grammar Stars · B1");
    assert.equal(item.classColor, "#22a");
    assert.equal(item.assigneeName, "Grammar Stars · B1", "class-scoped work is addressed to the class");
    assert.equal(item.studentId, null);
  });

  it("2. shapes a student-scoped assignment with the student's name", () => {
    const [item] = list([hw({ scope: "student", studentId: "s5" })]);
    assert.equal(item.assigneeName, "Noah Rodriguez");
    assert.equal(item.studentId, "s5");
  });

  it("3. a class-scoped assignment carrying ghost submission keys is still listed", () => {
    const items = list([hw({ id: "a", submissions: { s2: "Completed", s8: "Late", s14: "Missing" } })]);
    assert.equal(items.length, 1, "hidden entries never remove a record from the list");
    assert.equal(items[0].id, "a");
  });

  it("4. NEVER leaks a stored submission — not the map, not a key, not a ghost id", () => {
    const items = list([hw({ submissions: { s2: "Completed", s8: "Late", s13: "Missing", s14: "Missing" } })]);
    const wire = JSON.stringify(items);
    assert.ok(!wire.includes("submissions"), "the submissions map must never be serialised");
    for (const ghost of ["s8", "s13", "s14"]) {
      assert.ok(!wire.includes(ghost), `${ghost} must not reach the client`);
    }
    assert.ok(!("submissions" in (items[0] as unknown as Record<string, unknown>)));
  });

  it("5. never leaks lessonId either", () => {
    const items = list([hw()]);
    assert.ok(!JSON.stringify(items).includes("lessonId"));
  });

  it("6. omits a student-scoped assignment whose student no longer resolves", () => {
    // hw-c4-1 in production: scope student, studentId s1, s1 deleted.
    const items = list([
      hw({ id: "visible", classId: "c1" }),
      hw({ id: "ghost", classId: "c4", scope: "student", studentId: "s1", status: "Missing" }),
    ]);
    assert.deepEqual(items.map((i) => i.id), ["visible"]);
  });

  it("7. omits it without inventing a stand-in name", () => {
    const wire = JSON.stringify(list([
      hw({ id: "ghost", classId: "c4", scope: "student", studentId: "s1" }),
    ]));
    assert.equal(wire, "[]");
    assert.ok(!/[Dd]eleted/.test(wire), "no fallback label may be fabricated");
    assert.ok(!wire.includes("s1"), "and the missing student's id must not appear");
  });

  it("8. fails closed when the class is gone — no card without a label", () => {
    const items = list([hw({ id: "orphan", classId: "c99" })]);
    assert.deepEqual(items, []);
  });

  it("9. marks pending work deletable and settled work not", () => {
    const items = list([
      hw({ id: "pending", status: "Assigned", dueDate: "2026-07-18" }),
      hw({ id: "done", status: "Completed", dueDate: "2026-07-17" }),
      hw({ id: "late", status: "Late", dueDate: "2026-07-16" }),
      hw({ id: "missing", status: "Missing", dueDate: "2026-07-15" }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.id, i.deleteEligible]),
      [["pending", true], ["done", false], ["late", false], ["missing", false]]
    );
  });

  it("10. orders by due date, newest first, ties broken deterministically", () => {
    const items = list([
      hw({ id: "b", dueDate: "2026-07-04" }),
      hw({ id: "a", dueDate: "2026-07-04" }),
      hw({ id: "c", dueDate: "2026-07-18" }),
    ]);
    assert.deepEqual(items.map((i) => i.id), ["c", "a", "b"]);
  });

  it("11. carries what an edit form needs, so no detail request is required", () => {
    const [item] = list([hw({ title: "T", description: "D", teacherNotes: "N", dueDate: "2026-07-04" })]);
    assert.equal(item.title, "T");
    assert.equal(item.description, "D");
    assert.equal(item.teacherNotes, "N");
    assert.equal(item.dueDate, "2026-07-04");
  });

  it("12. exposes exactly this field set, and no more", () => {
    const [item] = list([hw()]);
    assert.deepEqual(Object.keys(item).sort(), [
      "assigneeName", "classColor", "classId", "className", "createdAt", "deleteEligible",
      "description", "dueDate", "id", "scope", "status", "studentId", "teacherNotes", "title",
    ]);
  });

  it("13. an empty collection is an empty list, not an error", () => {
    assert.deepEqual(list([]), []);
  });
});

/* ----------------------------------------------------- service write surface */

describe("The service writes HomeworkModel and nothing else", () => {
  it("14. no other model is written", () => {
    const writes = [...SERVICE.matchAll(
      /\b(\w+Model)\.(create|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|replaceOne|save)\s*\(/g
    )].map((m) => m[1]);
    assert.deepEqual([...new Set(writes)], ["HomeworkModel"], "only Homework may be written");
  });

  it("15. exactly three write verbs, each used once", () => {
    const verbs = [...SERVICE.matchAll(
      /\bHomeworkModel\.(create|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|replaceOne)\s*\(/g
    )].map((m) => m[1]).sort();
    assert.deepEqual(verbs, ["create", "deleteOne", "updateOne"]);
  });

  it("16. no mass or blind write verb exists at all", () => {
    for (const forbidden of ["updateMany", "deleteMany", "bulkWrite", "replaceOne", "insertMany"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} has no place here`);
    }
  });

  it("17. the other models appear, but only as reads", () => {
    const referenced = [...new Set([...SERVICE.matchAll(/\b(\w+Model)\.\w+/g)].map((m) => m[1]))].sort();
    assert.deepEqual(referenced, ["ClassModel", "HomeworkModel", "StudentModel"]);
    for (const m of ["ClassModel", "StudentModel"]) {
      const calls = [...SERVICE.matchAll(new RegExp(`\\b${m}\\.(\\w+)`, "g"))].map((x) => x[1]);
      for (const c of calls) {
        assert.ok(["find", "findOne", "countDocuments"].includes(c), `${m}.${c} is not a read`);
      }
    }
  });

  it("18. Billing, Attendance, Lesson, Review and Parent are not its business", () => {
    for (const forbidden of ["BillingModel", "AttendanceModel", "LessonModel", "ReviewModel", "ParentModel"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} must not be referenced`);
    }
  });

  it("19. no finance or balance write of any kind", () => {
    assert.ok(!/balance|invoice|Billing/i.test(SERVICE));
  });
});

/* ------------------------------------------------------- exact field surface */

describe("Which fields a write may touch", () => {
  it("20. the only `$set` is the planner's, passed through unmodified", () => {
    const sets = [...SERVICE.matchAll(/\$set:\s*([^\s,}]+)/g)].map((m) => m[1]);
    assert.deepEqual(sets, ["set"], "one $set, and its value is the planned object");
    assert.ok(SERVICE.includes("const set = planHomeworkUpdate(patch);"),
      "the key set must come from the pure allow-list, not be built here");
  });

  it("21. an empty plan issues no query", () => {
    assert.ok(
      /if\s*\(Object\.keys\(set\)\.length\s*>\s*0\)/.test(SERVICE),
      "a patch naming nothing editable must not write"
    );
  });

  it("22. the service never names submissions — the field is unreachable after create", () => {
    assert.ok(!SERVICE.includes("submissions"),
      "no code path may address submissions; it is written once, inside the planned document");
  });

  it("23. the service never names status, so nothing can rewrite one", () => {
    assert.ok(!/\bstatus\b/.test(SERVICE));
  });

  it("24. the service never names lessonId", () => {
    assert.ok(!SERVICE.includes("lessonId"));
  });

  it("25. the created document is the planner's, spread whole and unedited", () => {
    assert.ok(SERVICE.includes("await HomeworkModel.create({ _id, ...planned.doc });"),
      "create must persist exactly what planHomeworkCreate produced");
  });

  it("26. no ownership field is ever assigned in the service", () => {
    for (const owned of ["classId:", "scope:", "studentId:", "createdAt:"]) {
      assert.ok(!SERVICE.includes(owned), `${owned} must not be set here`);
    }
  });

  it("27. delete removes one document, by id", () => {
    assert.ok(SERVICE.includes("await HomeworkModel.deleteOne({ id });"));
    assert.equal([...SERVICE.matchAll(/deleteOne/g)].length, 1, "exactly one delete call exists");
  });

  it("28. no timestamp is invented", () => {
    assert.ok(!/updatedAt|new Date\s*\(|Date\.now/.test(SERVICE));
  });
});

/* ----------------------------------------------------------- orchestration */

describe("The service orchestrates the pure core rather than restating it", () => {
  it("29. every decision comes from a planner", () => {
    for (const fn of ["planHomeworkCreate", "planHomeworkUpdate", "planHomeworkDelete", "isListableHomework", "buildHomeworkList"]) {
      assert.ok(SERVICE.includes(fn), `${fn} must be called, not reimplemented`);
    }
  });

  it("30. and none of them is redefined here", () => {
    for (const fn of ["planHomeworkCreate", "planHomeworkUpdate", "planHomeworkDelete", "canDeleteHomework", "canAssignToClass"]) {
      assert.ok(!SERVICE.includes(`function ${fn}`), `${fn} has one definition, in the pure core`);
    }
  });

  it("31. eligibility is not re-tested with a literal status comparison", () => {
    assert.ok(!/"Active"|'Active'/.test(SERVICE), "Active-only lives in canAssignToClass");
    assert.ok(!/"Assigned"|'Assigned'/.test(SERVICE), "the delete rule lives in canDeleteHomework");
  });

  it("32. identity is an ObjectId mirrored into `id`, as Classes and Parents do", () => {
    assert.ok(SERVICE.includes("new mongoose.Types.ObjectId()"));
    assert.ok(SERVICE.includes("_id.toString()"));
    assert.ok(!/hw-\$\{|counter|countDocuments\(\)\s*\+/.test(SERVICE), "no race-prone counter");
  });

  it("33. the app clock is the shared one, never a wall clock", () => {
    assert.ok(SERVICE.includes("TODAY_ISO"));
    assert.ok(!/new Date\s*\(/.test(SERVICE));
  });

  it("34. student reads are scoped — the roster for class scope, one id for student scope", () => {
    assert.ok(SERVICE.includes('input.scope === "student"'));
    assert.ok(SERVICE.includes("wantedIds"), "the read set is chosen by scope");
  });

  it("35. an unlistable record is refused before anything else is considered", () => {
    const del = SERVICE.slice(SERVICE.indexOf("export async function deleteHomework"));
    assert.ok(
      del.indexOf("loadInteractable") < del.indexOf("planHomeworkDelete"),
      "the ghost check must precede the deletability check"
    );
    const patch = SERVICE.slice(SERVICE.indexOf("export async function updateHomework"));
    assert.ok(patch.indexOf("loadInteractable") < patch.indexOf("planHomeworkUpdate"));
  });

  it("36. an unlistable record answers not_found, never a distinct reason", () => {
    const loader = SERVICE.slice(SERVICE.indexOf("async function loadInteractable"), SERVICE.indexOf("async function present"));
    const reasons = [...loader.matchAll(/reason:\s*"(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(reasons)], ["not_found"],
      "a separate code would advertise a record the client may not see");
  });
});

/* -------------------------------------------------------- recurrence safety */

describe("Homework cannot reach the recurrence engine", () => {
  it("37. the service imports nothing from recurrence, reconciliation or the lifecycle", () => {
    for (const forbidden of [
      "recurrence", "reconciler", "lifecycle", "advanceLessonLifecycle",
      "ensureRegularLessons", "reconcileClass", "freezeReasons", "homeworked",
    ]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} is not Homework's business`);
    }
  });

  it("38. and neither does the pure core", () => {
    for (const forbidden of ["recurrence", "reconciler", "lifecycle"]) {
      assert.ok(!CORE.includes(forbidden));
    }
  });

  it("39. no lesson can be frozen by a homework write", () => {
    // The freeze signal is a non-null Homework.lessonId. The service never names
    // the field, and the only value the core can plan for it is null.
    assert.ok(!SERVICE.includes("lessonId"));
    assert.deepEqual([...CORE.matchAll(/lessonId\s*:\s*([^,\n]+)/g)].map((m) => m[1].trim()), ["null"]);
  });

  it("40. the service does not import the Lesson model or any lesson helper", () => {
    const imports = [...SERVICE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["./constants", "./db", "./homework", "./models", "./schemas", "./types"]);
    // Plus the bare side-effect import that keeps this module off the client.
    assert.ok(SERVICE.includes('import "server-only";'));
  });
});

/* --------------------------------------------------------- reporting safety */

describe("Gate 4.2 changes no reporting semantics", () => {
  it("41. the Gate 4.1 completion change is intact and is still the only one", () => {
    assert.ok(FINANCE.includes('if (s === "Completed" || s === "Late") done++;'));
    assert.ok(FINANCE.includes('if (hw.status === "Completed" || hw.status === "Late") done++;'));
    assert.ok(FINANCE.includes('export function homeworkCompletion(month: string, data: Pick<AllData, "homework">)'));
  });

  it("42. finance exposes exactly one homework function, and the service calls none", () => {
    const homeworkExports = [...FINANCE.matchAll(/export function (\w*[Hh]omework\w*)/g)].map((m) => m[1]);
    assert.deepEqual(homeworkExports, ["homeworkCompletion"]);
    assert.ok(!SERVICE.includes("homeworkCompletion"), "the service does not compute reporting");
    assert.ok(!SERVICE.includes("finance"));
  });

  it("43. no submissions writer exists anywhere in the module", () => {
    const submissionsRoute = path.join(process.cwd(), "src", "app", "api", "homework", "[id]", "submissions");
    assert.ok(!existsSync(submissionsRoute), "Sprint 7 records no outcomes");
    assert.ok(!SERVICE.includes("submissions"));
  });
});

/* -------------------------------------------------------------- GET payload */

describe("The index payload carries what the screen needs, and no more", () => {
  it("44. returns the items and both class lists", () => {
    assert.ok(SERVICE.includes("items,"));
    assert.ok(SERVICE.includes("filterClasses: buildFilterClasses(items, classes)"));
    assert.ok(SERVICE.includes("assignableClasses: buildAssignableClasses(classes, students)"));
  });

  it("45. the filter list is derived from the visible items, never from a status", () => {
    // buildFilterClasses takes the ITEMS — so a class appears because its work is
    // listed, not because it is Active. Ending or archiving a class cannot make
    // its past homework unreachable.
    assert.ok(SERVICE.includes("buildFilterClasses(items, classes)"));
    assert.ok(!/status:\s*"Active"/.test(SERVICE), "no status query decides what may be filtered for");
  });

  it("46. eligibility for the assignable list comes from the pure rule", () => {
    assert.ok(SERVICE.includes("classes.filter((c) => canAssignToClass(c))"));
    assert.ok(!/"Active"|'Active'/.test(SERVICE));
  });

  it("47. the student read is driven by assignees and rosters — never by submissions", () => {
    const list = SERVICE.slice(SERVICE.indexOf("export async function listHomework"), SERVICE.indexOf("async function loadInteractable"));
    assert.ok(list.includes("assigneeIds"));
    assert.ok(list.includes("rosterIds"));
    assert.ok(!list.includes("submissions"),
      "a stored key for a deleted student is never even looked up");
  });

  it("48. only id and name are selected for a student", () => {
    assert.ok(SERVICE.includes('.select("id name -_id")'));
    for (const leaked of ["phone", "email", "balance", "birthday", "parentId"]) {
      assert.ok(!SERVICE.includes(leaked), `${leaked} must not be read or returned`);
    }
  });

  it("49. the payload still exposes no submissions anywhere", () => {
    assert.ok(!SERVICE.includes("submissions"));
  });
});
