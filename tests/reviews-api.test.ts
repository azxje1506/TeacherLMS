/* Reviews — the API boundary: what a request may carry, and what a route does.
 *
 * Run with:  npm test
 *
 * The validation schemas are exercised directly, because that IS the boundary —
 * a Route Handler does nothing with a body except hand it to one. The handler
 * behaviours that only exist at runtime (auth, status codes, delegation, and the
 * ABSENCE of a verb) are asserted by scanning the route sources, the same way
 * tests/homework-api.test.ts asserts its own route rules.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { reviewCreateSchema, reviewUpdateSchema } from "../src/lib/schemas";
import { REVIEW_ERROR, SKILL_KEYS } from "../src/lib/reviews";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const COLLECTION = code("src", "app", "api", "reviews", "route.ts");
const ITEM = code("src", "app", "api", "reviews", "[id]", "route.ts");
const BY_STUDENT = code("src", "app", "api", "reviews", "student", "[studentId]", "route.ts");
const ROUTES: Array<[string, string]> = [
  ["/api/reviews", COLLECTION],
  ["/api/reviews/[id]", ITEM],
  ["/api/reviews/student/[studentId]", BY_STUDENT],
];

const skills = Object.fromEntries(SKILL_KEYS.map((k) => [k, 4]));

const valid = {
  studentId: "s1",
  month: "2026-07",
  skills,
  comment: "Emma read aloud with real confidence this month.",
  strengths: "",
  improvements: "",
  goals: "",
  parentNotes: "",
};

const firstIssue = (r: { success: false; error: { issues: Array<{ message: string }> } }) =>
  r.error.issues[0]?.message;

/* --------------------------------------------------------- create schema */

describe("POST body — what a create may carry", () => {
  it("1. accepts a well-formed review", () => {
    const r = reviewCreateSchema.safeParse(valid);
    assert.ok(r.success);
    assert.equal(r.data.month, "2026-07");
    assert.equal(Object.keys(r.data.skills).length, 10);
  });

  it("2. requires a student", () => {
    const r = reviewCreateSchema.safeParse({ ...valid, studentId: "" });
    assert.ok(!r.success);
    assert.equal(firstIssue(r), "Select a student");
  });

  it("3. requires an explicit, well-formed month — the server substitutes none", () => {
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.month;
    assert.ok(!reviewCreateSchema.safeParse(missing).success, "an omitted month is refused");
    for (const bad of ["", "2026", "2026-7", "2026-13", "07/2026", "2026-07-01"]) {
      const r = reviewCreateSchema.safeParse({ ...valid, month: bad });
      assert.ok(!r.success, `${bad} must be refused`);
      assert.equal(firstIssue(r), "Pick a month");
    }
  });

  it("4. requires exactly the ten canonical skills", () => {
    const short = { ...skills };
    delete short.homework;
    assert.ok(!reviewCreateSchema.safeParse({ ...valid, skills: short }).success);
    assert.ok(!reviewCreateSchema.safeParse({ ...valid, skills: { ...skills, magic: 5 } }).success);
    assert.ok(!reviewCreateSchema.safeParse({ ...valid, skills: {} }).success);
  });

  it("5. requires whole ratings from 1 to 5", () => {
    for (const bad of [0, 6, 4.5, "4", null, true, undefined, NaN]) {
      const r = reviewCreateSchema.safeParse({ ...valid, skills: { ...skills, reading: bad } });
      assert.ok(!r.success, `${String(bad)} must be refused`);
    }
  });

  it("6. requires at least one assessment note, on a path the form can render", () => {
    const r = reviewCreateSchema.safeParse({
      ...valid, comment: "   ", parentNotes: "Please sign the reading log.",
    });
    assert.ok(!r.success);
    assert.deepEqual(r.error.issues[0].path, ["comment"], "the group issue lands on a real field");
  });

  it("7. refuses every server-owned or non-existent field", () => {
    for (const field of ["id", "status", "createdAt", "updatedAt", "classId", "lessonId", "average"]) {
      const r = reviewCreateSchema.safeParse({ ...valid, [field]: "x" });
      assert.ok(!r.success, `${field} must be refused, not ignored`);
    }
  });

  it("8. refuses a body that is not an object at all", () => {
    for (const body of [null, undefined, "review", 7, []]) {
      assert.ok(!reviewCreateSchema.safeParse(body).success, String(body));
    }
  });
});

/* --------------------------------------------------------- update schema */

describe("PATCH body — what an edit may carry", () => {
  const patch = { skills, comment: "Corrected after re-reading her work." };

  it("9. accepts a correction to the six authored fields", () => {
    const r = reviewUpdateSchema.safeParse({ ...patch, parentNotes: "Sign here." });
    assert.ok(r.success);
    assert.equal(r.data.parentNotes, "Sign here.");
    assert.equal(r.data.goals, "", "an unwritten field defaults to empty, not undefined");
  });

  it("10. refuses ownership fields outright", () => {
    for (const field of ["id", "studentId", "month"]) {
      const r = reviewUpdateSchema.safeParse({ ...patch, [field]: "smuggled" });
      assert.ok(!r.success, `${field} is fixed at creation`);
    }
  });

  it("11. refuses lifecycle, timestamp and cross-domain fields", () => {
    for (const field of ["status", "createdAt", "updatedAt", "classId", "lessonId", "average"]) {
      const r = reviewUpdateSchema.safeParse({ ...patch, [field]: "smuggled" });
      assert.ok(!r.success, field);
    }
  });

  it("12. requires all ten ratings on an edit, as on a create", () => {
    assert.ok(!reviewUpdateSchema.safeParse({ comment: "c" }).success);
    const short = { ...skills };
    delete short.writing;
    assert.ok(!reviewUpdateSchema.safeParse({ skills: short, comment: "c" }).success);
  });

  it("13. enforces the same prose group rule as a create", () => {
    assert.ok(!reviewUpdateSchema.safeParse({ skills, parentNotes: "Sign here." }).success);
    assert.ok(reviewUpdateSchema.safeParse({ skills, goals: "Read weekly." }).success);
  });
});

/* -------------------------------------------------------- the collection */

describe("The collection route", () => {
  it("14. exposes GET and POST, and nothing else", () => {
    const verbs = [...COLLECTION.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    assert.deepEqual(verbs, ["GET", "POST"]);
  });

  it("15. requires a session on both", () => {
    assert.equal([...COLLECTION.matchAll(/await requireSession\(\)/g)].length, 2);
  });

  it("16. reads through the Reviews service only", () => {
    assert.ok(COLLECTION.includes("listReviewCards"));
    assert.ok(COLLECTION.includes("createReview"));
    assert.ok(!/ReviewModel|dbConnect|\.lean\(/.test(COLLECTION), "a route never touches Mongo itself");
  });

  it("17. validates with reviewCreateSchema and answers 422 on a bad body", () => {
    assert.ok(COLLECTION.includes("reviewCreateSchema.safeParse(body)"));
    assert.ok(COLLECTION.includes('error(parsed.error.issues[0]?.message ?? "Invalid input", 422)'));
  });

  it("18. answers 201 on success", () => {
    assert.ok(COLLECTION.includes("json(res.review, 201)"));
  });

  it("19. answers a duplicate with a stable code as well as a sentence", () => {
    assert.ok(COLLECTION.includes('code: "review_already_exists"'));
    assert.ok(COLLECTION.includes("REVIEW_ERROR.review_already_exists.status"));
    assert.equal(REVIEW_ERROR.review_already_exists.status, 409);
  });

  it("20. maps every other failure through the one error table", () => {
    assert.ok(COLLECTION.includes("error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status)"));
  });
});

/* ------------------------------------------------------- one review */

describe("The single-review route", () => {
  it("21. exposes PATCH, and nothing else", () => {
    const verbs = [...ITEM.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(verbs, ["PATCH"]);
  });

  it("22. offers no GET, so an id cannot be used to probe for a ghost", () => {
    assert.ok(!/export async function GET/.test(ITEM));
  });

  it("23. offers no DELETE and no PUT", () => {
    assert.ok(!/export async function (DELETE|PUT)/.test(ITEM));
  });

  it("24. requires a session", () => {
    assert.ok(ITEM.includes("await requireSession()"));
  });

  it("25. validates with reviewUpdateSchema and answers 422 on a bad body", () => {
    assert.ok(ITEM.includes("reviewUpdateSchema.safeParse(body)"));
    assert.ok(ITEM.includes('error(parsed.error.issues[0]?.message ?? "Invalid input", 422)'));
  });

  it("26. delegates to the service and maps failures through the error table", () => {
    assert.ok(ITEM.includes("updateReview(id, parsed.data)"));
    assert.ok(ITEM.includes("error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status)"));
  });

  it("27. answers 404 for a missing review — and for a ghost, identically", () => {
    assert.equal(REVIEW_ERROR.not_found.status, 404);
    // The route has one failure branch, so it cannot tell the two apart even if
    // it wanted to: the service returns `not_found` for both.
    assert.equal([...ITEM.matchAll(/if \(!res\.ok\)/g)].length, 1);
    assert.ok(!/ghost/i.test(ITEM));
  });
});

/* ------------------------------------------------------ one student */

describe("The student-reviews route", () => {
  it("28. exposes GET, and nothing else", () => {
    const verbs = [...BY_STUDENT.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(verbs, ["GET"]);
  });

  it("29. writes nothing", () => {
    for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.ok(!BY_STUDENT.includes(`export async function ${verb}`), verb);
    }
    assert.ok(!/create|update|delete/i.test(BY_STUDENT.replace(/getStudentReviews/g, "")));
  });

  it("30. requires a session", () => {
    assert.ok(BY_STUDENT.includes("await requireSession()"));
  });

  it("31. answers 404 when the student does not resolve", () => {
    assert.ok(BY_STUDENT.includes("error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status)"));
    assert.equal(REVIEW_ERROR.student_not_found.status, 404);
  });

  it("32. delegates to the Reviews service only", () => {
    assert.ok(BY_STUDENT.includes("getStudentReviews(studentId)"));
    assert.ok(!/ReviewModel|StudentModel|dbConnect/.test(BY_STUDENT));
  });
});

/* ------------------------------------------------- what the API refuses */

describe("What the Reviews API deliberately does not offer", () => {
  it("33. no route deletes a review, anywhere", () => {
    for (const [name, src] of ROUTES) {
      assert.ok(!src.includes("export async function DELETE"), `${name} must expose no DELETE`);
      assert.ok(!src.includes("deleteReview"), name);
    }
  });

  it("34. no route exposes PUT", () => {
    for (const [name, src] of ROUTES) {
      assert.ok(!src.includes("export async function PUT"), name);
    }
  });

  it("35. every handler in every route requires a session", () => {
    for (const [name, src] of ROUTES) {
      const handlers = [...src.matchAll(/export async function (\w+)/g)].length;
      const guards = [...src.matchAll(/await requireSession\(\)/g)].length;
      assert.equal(guards, handlers, `${name}: every handler must guard`);
    }
  });

  it("36. no route reaches the repo, the lifecycle or the recurrence engine", () => {
    for (const [name, src] of ROUTES) {
      for (const forbidden of [
        "repo", "getAll", "advanceLessonLifecycle", "lifecycle", "recurrence", "reconciler",
        "dashboard",
      ]) {
        assert.ok(!src.includes(forbidden), `${name} must not reference ${forbidden}`);
      }
    }
  });

  it("37. no route builds its own error body outside the one table", () => {
    for (const [name, src] of ROUTES) {
      const statuses = [...src.matchAll(/,\s*(\d{3})\s*\)/g)].map((m) => m[1]);
      for (const s of statuses) {
        assert.ok(["201", "422"].includes(s), `${name}: literal status ${s} must come from REVIEW_ERROR`);
      }
    }
  });

  it("38. every route pins the Node runtime, as every other route does", () => {
    for (const [name, src] of ROUTES) {
      assert.ok(src.includes('export const runtime = "nodejs";'), name);
    }
  });

  it("39. the three route files are the only Reviews API surface", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "reviews");
    assert.ok(existsSync(path.join(dir, "route.ts")));
    assert.ok(existsSync(path.join(dir, "[id]", "route.ts")));
    assert.ok(existsSync(path.join(dir, "student", "[studentId]", "route.ts")));
    for (const absent of ["[id]/delete", "bulk", "export", "student/route.ts"]) {
      assert.ok(!existsSync(path.join(dir, absent)), `${absent} must not exist`);
    }
  });
});

/* -------------------------------------------------- one error vocabulary */

describe("Error mapping is one table", () => {
  it("40. every domain outcome the service can return has a status and a sentence", () => {
    for (const reason of [
      "not_found", "student_not_found", "student_not_eligible",
      "month_not_allowed", "review_already_exists",
    ] as const) {
      const entry = REVIEW_ERROR[reason];
      assert.ok(entry, reason);
      assert.ok(entry.status >= 400 && entry.status < 500, `${reason} is a client-side outcome`);
      assert.ok(entry.message.trim().length > 0, reason);
    }
  });

  it("41. the statuses are the agreed ones", () => {
    assert.equal(REVIEW_ERROR.not_found.status, 404);
    assert.equal(REVIEW_ERROR.student_not_found.status, 404);
    assert.equal(REVIEW_ERROR.student_not_eligible.status, 422);
    assert.equal(REVIEW_ERROR.month_not_allowed.status, 422);
    assert.equal(REVIEW_ERROR.review_already_exists.status, 409);
  });

  it("42. no route restates a message the table already owns", () => {
    for (const [name, src] of ROUTES) {
      for (const entry of Object.values(REVIEW_ERROR)) {
        const quoted = `"${entry.message}"`;
        assert.ok(!src.includes(quoted), `${name} must not hardcode ${quoted}`);
      }
    }
  });
});
