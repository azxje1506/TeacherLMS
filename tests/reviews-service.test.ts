/* Reviews — the service's read models, and the write surface it is allowed.
 *
 * Run with:  npm test
 *
 * NO DATABASE. This project has no integration-test infrastructure and Sprint 8
 * forbids creating one against production, so the service is tested the way
 * tests/homework-service.test.ts tests its own, and for the same two reasons:
 *
 *  - the SHAPING is exercised directly, because every decision the service acts
 *    on lives in src/lib/reviews.ts as a function over plain values, and the
 *    fixtures below are the exact inputs the service reads out of Mongo;
 *  - the GUARANTEES that only exist inside a Mongo call — which model may be
 *    written, with which verb, touching which fields, and what a ghost record
 *    may never reveal — are asserted by scanning the source.
 *
 * The second half is not a compromise. `src/lib/reviews-service.ts` imports
 * `server-only`, so it cannot be imported by this runner at all; and "the
 * service writes ReviewModel and nothing else" is not expressible as a function
 * call in any case. A scan is the only form in which it can be pinned, and it is
 * the form the Sprint 5, 6 and 7 suites already chose for this class of rule.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildReviewCards, buildReviewHistory, canReviewStudent, isParentLinked, planReviewCreate,
  planReviewUpdate, reviewAverage, reviewMonthOptions,
} from "../src/lib/reviews";
import { isDupKey } from "../src/lib/db";
import { CURRENT_MONTH } from "../src/lib/constants";
import type { Review, Student, StudentStatus } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE = code("src", "lib", "reviews-service.ts");
const MODELS = code("src", "lib", "models.ts");

/** The application month the service passes into every pure helper. */
const APP_MONTH = CURRENT_MONTH;

/* ------------------------------------------------------------------ fixtures */

function flatSkills(rating: number): Record<string, number> {
  return Object.fromEntries([
    "listening", "speaking", "reading", "writing", "grammar",
    "vocabulary", "pronunciation", "confidence", "participation", "homework",
  ].map((key) => [key, rating]));
}

function student(over: Partial<Student> = {}): Student {
  return {
    id: "s1", first: "Emma", last: "Nguyen", name: "Emma Nguyen", initials: "EN",
    birthday: "2015-04-02", age: 11, school: "Le Quy Don", grade: 5, gradeLabel: "Grade 5",
    parentId: "p1", parentName: "Linh Nguyen", phone: "", status: "Active", notes: "",
    joined: "2025-09-01", classes: 1, attendance: 96, balance: 0,
    avatar: null, avatarColor: "#d14242",
    ...over,
  };
}

function review(over: Partial<Review> = {}): Review {
  return {
    id: "rv-1", studentId: "s1", month: "2026-06", skills: flatSkills(4),
    comment: "A steady month.", strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  };
}

/* The collection as the service reads it: four students of differing status, one
 * of whom references a Parent that no longer exists, plus a review left behind
 * by a student who was deleted. */
const STUDENTS: Student[] = [
  student({ id: "s1", name: "Emma Nguyen", status: "Active", parentId: "p1" }),
  student({ id: "s2", name: "Lucas Chen", status: "Trial", parentId: "" }),
  student({ id: "s3", name: "Liam Park", status: "Paused", parentId: "p-deleted" }),
  student({ id: "s4", name: "Mia Tran", status: "Archived", parentId: "p1" }),
];

const REVIEWS: Review[] = [
  review({ id: "rv-s1-05", studentId: "s1", month: "2026-05", skills: flatSkills(3) }),
  review({ id: "rv-s1-06", studentId: "s1", month: "2026-06", skills: flatSkills(5) }),
  review({ id: "rv-s4-06", studentId: "s4", month: "2026-06" }),
  review({ id: "rv-ghost", studentId: "s-deleted", month: "2026-06" }),
];

const PARENT_IDS = new Set(["p1"]);

/** Exactly what `listReviewCards` returns, minus the Mongo round trip. */
const cards = () => buildReviewCards(STUDENTS, REVIEWS, PARENT_IDS);

/* =========================================================================
 * listReviewCards — the index read model
 * ====================================================================== */

describe("listReviewCards — what the index is shown", () => {
  it("1. includes an eligible student who has no reviews yet", () => {
    const card = cards().find((c) => c.studentId === "s2")!;
    assert.ok(card, "a student with nothing written is still offered a review");
    assert.equal(card.reviewCount, 0);
    assert.equal(card.latestMonth, null);
    assert.equal(card.latestAverage, null);
  });

  it("2. omits an archived student", () => {
    assert.ok(!cards().some((c) => c.studentId === "s4"));
  });

  it("3. lets a ghost review raise no card", () => {
    assert.ok(!cards().some((c) => c.studentId === "s-deleted"));
    assert.deepEqual(cards().map((c) => c.studentId), ["s1", "s2", "s3"]);
  });

  it("4. carries exactly one review id per card — the latest, and never a ghost's", () => {
    /* GATE 4.4D'S REMEDIATION NARROWED THIS RULE RATHER THAN DROPPING IT. The
     * index used to carry no review id at all, which meant a teacher looking at
     * a student with months of history was offered nothing but "write another
     * one". The card now names the LATEST review so it can be opened.
     *
     * WHAT MADE THAT SAFE IS UNCHANGED: a card exists only for a student who
     * RESOLVES, and the id is taken from that student's own reviews. The one
     * record that would need guarding — a review whose student is gone — raises
     * no card to put an id on, so the disclosure this test was written to
     * prevent is still structurally impossible. That is what is asserted now. */
    const payload = JSON.stringify({ month: APP_MONTH, cards: cards() });
    assert.ok(!payload.includes("rv-ghost"), "a ghost review's id must never reach the index");
    assert.ok(!payload.includes("s-deleted"), "nor its deleted student's");
    assert.ok(!payload.includes("rv-s4-06"), "nor an archived student's, whose card is omitted");

    // s1 has May and June; the id is June's — the same review the month and the
    // average describe, so a card cannot open one review while describing another.
    const s1 = cards().find((c) => c.studentId === "s1")!;
    assert.equal(s1.latestReviewId, "rv-s1-06");
    assert.equal(s1.latestMonth, "2026-06");
    assert.ok(!payload.includes("rv-s1-05"), "and only the latest, not the history");

    // A student with nothing written has no id to offer.
    assert.equal(cards().find((c) => c.studentId === "s2")!.latestReviewId, null);
    assert.equal(cards().find((c) => c.studentId === "s3")!.latestReviewId, null);

    /* One id per card and no more: the whole set of ids on the payload is
     * exactly the set of latest reviews of resolvable, eligible students. */
    const ids = cards().map((c) => c.latestReviewId).filter(Boolean);
    assert.deepEqual(ids, ["rv-s1-06"]);
  });

  it("5. selects the latest review by greatest month", () => {
    const card = cards().find((c) => c.studentId === "s1")!;
    assert.equal(card.latestMonth, "2026-06");
  });

  it("6. counts a student's own reviews and nobody else's", () => {
    assert.equal(cards().find((c) => c.studentId === "s1")!.reviewCount, 2);
    assert.equal(cards().find((c) => c.studentId === "s3")!.reviewCount, 0);
  });

  it("7. averages the latest review only — no history is folded in", () => {
    const card = cards().find((c) => c.studentId === "s1")!;
    assert.equal(card.latestAverage, 5, "June alone; May's 3 is not averaged in");
    assert.equal(card.latestAverage, reviewAverage(flatSkills(5)));
  });

  it("8. calls a parent linked only when the parent document resolves", () => {
    const found = cards();
    assert.equal(found.find((c) => c.studentId === "s1")!.parentLinked, true);
    assert.equal(found.find((c) => c.studentId === "s2")!.parentLinked, false, "no parentId at all");
    assert.equal(found.find((c) => c.studentId === "s3")!.parentLinked, false, "stale parentId");
    assert.equal(isParentLinked(student({ parentId: "p-deleted" }), PARENT_IDS), false);
  });

  it("9. reads parents only for ids students actually reference", () => {
    assert.ok(
      SERVICE.includes("ParentModel.find({ id: { $in: parentIds } }).select(\"id -_id\")"),
      "the parent read is a resolution check, not a join"
    );
    assert.ok(SERVICE.includes("parentIds.length === 0"), "no query when nothing references a parent");
  });

  it("10. sends no review history from the index", () => {
    const keys = new Set(cards().flatMap((c) => Object.keys(c)));
    for (const forbidden of ["reviews", "history", "id"]) {
      assert.ok(!keys.has(forbidden), `a card must not carry ${forbidden}`);
    }
    assert.ok(keys.has("reviewCount") && keys.has("latestMonth") && keys.has("latestAverage"));
  });

  it("11. the index payload carries the application month, from the app clock", () => {
    assert.ok(SERVICE.includes("month: CURRENT_MONTH"));
    assert.equal(APP_MONTH, "2026-07");
  });
});

/* =========================================================================
 * getStudentReviews — the profile read model
 * ====================================================================== */

describe("getStudentReviews — one student's payload", () => {
  const own = REVIEWS.filter((r) => r.studentId === "s1");

  it("12. orders history newest month first", () => {
    assert.deepEqual(buildReviewHistory(own, "s1").map((r) => r.month), ["2026-06", "2026-05"]);
  });

  it("13. scopes history to the requested student — no other student's ids appear", () => {
    const history = buildReviewHistory(REVIEWS, "s1");
    assert.deepEqual(history.map((r) => r.id), ["rv-s1-06", "rv-s1-05"]);
    assert.ok(!history.some((r) => r.id === "rv-ghost"));
  });

  it("14. lets an archived student's history be read, with create withheld", () => {
    const archived = student({ id: "s4", status: "Archived" });
    assert.equal(canReviewStudent(archived), false, "canCreate is false");
    assert.deepEqual(
      buildReviewHistory(REVIEWS, "s4").map((r) => r.id),
      ["rv-s4-06"],
      "the history is still readable"
    );
  });

  it("15. refuses a student who does not resolve", () => {
    assert.ok(
      SERVICE.includes("if (!student) return { ok: false, reason: \"student_not_found\" };"),
      "a deleted student's reviews are reachable through nothing"
    );
  });

  it("16. offers the twelve selectable months, flagging the ones already written", () => {
    const months = reviewMonthOptions(APP_MONTH, own.map((r) => r.month));
    assert.equal(months.length, 12);
    assert.equal(months[0].month, APP_MONTH);
    assert.deepEqual(months.filter((m) => m.taken).map((m) => m.month), ["2026-06", "2026-05"]);
  });

  it("17. derives the average on the way out and stores none", () => {
    assert.ok(SERVICE.includes("average: reviewAverage(doc.skills)"));
    assert.ok(!/average:\s*doc\.average/.test(SERVICE), "no stored average is ever read");
  });

  it("18. carries the two approved derived metrics, and still generates nothing", () => {
    /* GATE 4.2 PINNED THIS AT "reviews only". The Gate 4.4A scope amendment put
     * an Attendance percentage and a Homework completion percentage on the
     * Reviews surfaces, so the payload now carries both — DERIVED LIVE, never
     * stored on a review, and computed by the helpers in finance.ts beside the
     * aggregates they must agree with.
     *
     * What has NOT changed is everything the original assertion was really
     * protecting: nothing is generated, nothing is exported, and no report or
     * PDF structure lives in a read payload. */
    assert.ok(SERVICE.includes("studentAttendanceRate("), "the approved per-student metric");
    assert.ok(SERVICE.includes("studentHomeworkCompletion("), "and its homework sibling");
    assert.ok(SERVICE.includes("buildReviewAnalytics("), "charts come from the pure module");

    // The aggregates are NOT used here — a per-student surface must not show a
    // studio-wide figure.
    assert.ok(!/[^t]attendanceRate\(/.test(SERVICE), "the studio aggregate has no place on one student's page");
    assert.ok(!/[^t]homeworkCompletion\(/.test(SERVICE), "likewise");

    for (const forbidden of [
      "achievements", "achievement", "aiSummary", "concern", "jspdf", "buildReport",
      "MonthlyReviewReport", "generatedOn", "preparedFor",
    ]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} is not part of a Reviews read payload`);
    }
  });

  it("18b. no derived percentage is ever persisted onto a review", () => {
    /* The whole point of deriving live: a percentage copied onto a Review
     * document would be a second copy of a fact, free to drift from the first.
     * The two write verbs may not carry one. */
    const created = SERVICE.slice(SERVICE.indexOf("ReviewModel.create("));
    assert.ok(!/attendance|homework(?!Completion)/i.test(created.slice(0, 200)),
      "a create writes the planned document and nothing else");
    assert.ok(!SERVICE.includes("$set: { attendance"), "and an edit writes six planned keys");
  });
});

/* =========================================================================
 * createReview — the write boundary
 * ====================================================================== */

describe("createReview — who may be reviewed, and for which month", () => {
  const input = (over: Partial<{ studentId: string; month: string }> = {}) => ({
    studentId: "s1", month: APP_MONTH, skills: flatSkills(4),
    comment: "A steady month.", strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  });

  for (const status of ["Active", "Trial", "Paused"] as StudentStatus[]) {
    it(`19. allows a create for a ${status} student`, () => {
      const plan = planReviewCreate(
        input(), student({ status }), new Set(), "rv-new", APP_MONTH
      );
      assert.equal(plan.ok, true);
    });
  }

  it("20. rejects a create for an archived student", () => {
    const plan = planReviewCreate(
      input(), student({ status: "Archived" }), new Set(), "rv-new", APP_MONTH
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_eligible" });
  });

  it("21. rejects a create for a student who does not exist", () => {
    const plan = planReviewCreate(input(), null, new Set(), "rv-new", APP_MONTH);
    assert.deepEqual(plan, { ok: false, reason: "student_not_found" });
  });

  it("22. rejects a future month and one older than the window", () => {
    for (const month of ["2026-08", "2027-01", "2025-07", "2020-01"]) {
      const plan = planReviewCreate(input({ month }), student(), new Set(), "rv-new", APP_MONTH);
      assert.deepEqual(plan, { ok: false, reason: "month_not_allowed" }, month);
    }
  });

  it("23. rejects a duplicate BEFORE anything is written", () => {
    const plan = planReviewCreate(
      input({ month: "2026-06" }), student(), new Set(["2026-06"]), "rv-new", APP_MONTH
    );
    assert.deepEqual(plan, { ok: false, reason: "review_already_exists" });
    // The refusal is a plan, not a write: the insert below is unreachable unless
    // `planned.ok`, which the source states in one place.
    assert.ok(SERVICE.includes("if (!planned.ok) return { ok: false, reason: planned.reason };"));
    const insertAt = SERVICE.indexOf("ReviewModel.create");
    const guardAt = SERVICE.indexOf("if (!planned.ok)");
    assert.ok(guardAt > 0 && guardAt < insertAt, "nothing is inserted before the plan is checked");
  });

  it("24. reads only the month it is about, not the student's whole history", () => {
    assert.ok(
      SERVICE.includes("ReviewModel.find({ studentId: input.studentId, month: input.month })"),
      "the duplicate check is scoped to one (studentId, month)"
    );
  });

  it("25. maps a duplicate-key persistence error to the same domain outcome", () => {
    assert.ok(SERVICE.includes("if (isDupKey(e)) return { ok: false, reason: \"review_already_exists\" };"));
    assert.ok(SERVICE.includes("throw e;"), "any other error still propagates");
    // The helper the mapping relies on recognises what Mongo actually raises.
    assert.equal(isDupKey({ code: 11000 }), true);
    assert.equal(isDupKey({ writeErrors: [{ code: 11000 }] }), true);
    assert.equal(isDupKey({ code: 121 }), false);
    assert.equal(isDupKey(new Error("network")), false);
  });

  it("26. writes exactly the planner's document, once", () => {
    assert.ok(SERVICE.includes("await ReviewModel.create({ _id, ...planned.doc });"),
      "create must persist exactly what planReviewCreate produced");
    assert.equal([...SERVICE.matchAll(/ReviewModel\.create/g)].length, 1);
  });

  it("27. persists the nine approved fields and invents none", () => {
    const plan = planReviewCreate(input(), student(), new Set(), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    assert.deepEqual(Object.keys(plan.doc).sort(), [
      "comment", "goals", "id", "improvements", "month", "parentNotes", "skills", "strengths", "studentId",
    ]);
    for (const invented of ["status", "createdAt", "updatedAt", "classId", "lessonId", "average"]) {
      assert.ok(!(invented in plan.doc), invented);
    }
  });

  it("28. never substitutes the application month for the payload's", () => {
    const plan = planReviewCreate(input({ month: "2026-03" }), student(), new Set(), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    assert.equal(plan.doc.month, "2026-03");
    // CURRENT_MONTH reaches the planner as the window boundary, never as a value.
    assert.ok(SERVICE.includes("CURRENT_MONTH\n  );") || /planReviewCreate\([\s\S]*?CURRENT_MONTH/.test(SERVICE));
    assert.ok(!/month:\s*CURRENT_MONTH,?\s*\n?\s*skills/.test(SERVICE));
  });

  it("29. mints identity as an ObjectId, never a count", () => {
    assert.ok(SERVICE.includes("new mongoose.Types.ObjectId()"));
    assert.ok(!/countDocuments\(\)\s*\+\s*1|length \+ 1/.test(SERVICE));
  });
});

/* =========================================================================
 * updateReview — the edit boundary
 * ====================================================================== */

describe("updateReview — what an edit may touch", () => {
  it("30. writes only the six editable keys", () => {
    const set = planReviewUpdate({
      skills: flatSkills(5), comment: "c", strengths: "s",
      improvements: "i", goals: "g", parentNotes: "p",
    });
    assert.deepEqual(Object.keys(set).sort(), [
      "comment", "goals", "improvements", "parentNotes", "skills", "strengths",
    ]);
  });

  it("31. cannot emit an ownership key, whatever the request carried", () => {
    const set = planReviewUpdate({
      id: "other", studentId: "s9", month: "2019-01", comment: "c",
    } as Parameters<typeof planReviewUpdate>[0]);
    assert.deepEqual(set, { comment: "c" });
  });

  it("32. the only `$set` is the planner's, passed through unmodified", () => {
    const sets = [...SERVICE.matchAll(/\$set:\s*([^\s,}]+)/g)].map((m) => m[1]);
    assert.deepEqual(sets, ["set"], "one $set, and its value is the planned object");
    assert.ok(SERVICE.includes("const set = planReviewUpdate(patch);"),
      "the key set must come from the pure allow-list, not be built here");
  });

  it("33. an empty plan issues no query", () => {
    assert.ok(/if\s*\(Object\.keys\(set\)\.length\s*>\s*0\)/.test(SERVICE));
  });

  it("34. updates one document by id, and never upserts", () => {
    assert.ok(SERVICE.includes("await ReviewModel.updateOne({ id }, { $set: set });"));
    assert.equal([...SERVICE.matchAll(/updateOne/g)].length, 1);
    assert.ok(!/upsert/i.test(SERVICE), "a patch may never create a document");
  });

  it("35. refuses a review that does not exist", () => {
    assert.ok(SERVICE.includes("if (!doc) return { ok: false, reason: \"not_found\" };"));
  });

  it("36. refuses a ghost review with the SAME answer, disclosing nothing", () => {
    assert.ok(
      SERVICE.includes("if (student === 0) return { ok: false, reason: \"not_found\" };"),
      "a review whose student is gone is unreachable"
    );
    assert.ok(!/ghost_review|ghost_/.test(SERVICE), "no distinct public code may advertise a ghost");
    const reasons = [...SERVICE.matchAll(/reason:\s*"(\w+)"/g)].map((m) => m[1]);
    /* `student_not_eligible` joined the literals in Gate 4.4D: the Create
     * composer's read refuses an Archived student itself, with the same reason
     * the create endpoint gives, so a page opened from a stale card cannot show
     * a form the API would reject. It was always in REVIEW_ERROR — until now the
     * only path that produced it was the create planner's. */
    assert.deepEqual([...new Set(reasons)].sort(), [
      "not_found", "review_already_exists", "student_not_eligible", "student_not_found",
    ], "the service emits only domain outcomes the error table names");
    /* And every one of them is a member of the domain's own error union, so the
     * service can emit no outcome a Route Handler has no status and sentence
     * for. Read from src/lib/reviews.ts rather than imported, because this suite
     * scans sources and holds no runtime import of the domain. */
    const table = readFileSync(path.join(process.cwd(), "src", "lib", "reviews.ts"), "utf8");
    for (const reason of new Set(reasons)) {
      assert.ok(
        new RegExp(`^\\s*${reason}:\\s*\\{ status:`, "m").test(table),
        `${reason} is not in REVIEW_ERROR`
      );
    }
  });

  it("37. loads the review before any write, on every edit path", () => {
    const loadAt = SERVICE.indexOf("const loaded = await loadInteractable(id);");
    const writeAt = SERVICE.indexOf("ReviewModel.updateOne");
    assert.ok(loadAt > 0 && loadAt < writeAt, "interactability is decided first");
  });

  it("38. never consults the student's status on an edit", () => {
    // An archived student's existing review stays correctable: eligibility gates
    // create only, so `canReviewStudent` must not appear on the edit path.
    const editPath = SERVICE.slice(SERVICE.indexOf("async function loadInteractable"));
    assert.ok(!editPath.includes("canReviewStudent"));
    assert.ok(!/status/.test(editPath.replace(/countDocuments/g, "")),
      "the edit path reads existence, not status");
  });
});

/* =========================================================================
 * The write surface, and what it can never reach
 * ====================================================================== */

describe("The service writes ReviewModel and nothing else", () => {
  it("39. no other model is written", () => {
    const writes = [...SERVICE.matchAll(
      /\b(\w+Model)\.(create|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|replaceOne|save)\s*\(/g
    )].map((m) => m[1]);
    assert.deepEqual([...new Set(writes)], ["ReviewModel"], "only Review may be written");
  });

  it("40. exactly two write verbs, each used once", () => {
    const verbs = [...SERVICE.matchAll(
      /\bReviewModel\.(create|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|replaceOne)\s*\(/g
    )].map((m) => m[1]).sort();
    assert.deepEqual(verbs, ["create", "updateOne"]);
  });

  it("41. no delete verb exists at all — a review is a historical record", () => {
    for (const forbidden of ["deleteOne", "deleteMany", "findOneAndDelete", "remove("]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} has no place here`);
    }
  });

  it("42. no mass or blind write verb exists at all", () => {
    for (const forbidden of ["updateMany", "bulkWrite", "replaceOne", "insertMany", "findOneAndUpdate"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} has no place here`);
    }
  });

  it("43. every model but ReviewModel appears ONLY as a read", () => {
    /* THIS IS THE ASSERTION THAT MATTERS, and it is unchanged in substance: the
     * Reviews service may write exactly one collection. Gate 4.4C widened WHICH
     * models it reads — the derived Attendance and Homework metrics need Class,
     * Lesson, Attendance and Homework data — but not what it may do to them. */
    const referenced = [...new Set([...SERVICE.matchAll(/\b(\w+Model)\.\w+/g)].map((m) => m[1]))].sort();
    assert.deepEqual(referenced, [
      "AttendanceModel", "ClassModel", "HomeworkModel", "LessonModel",
      "ParentModel", "ReviewModel", "StudentModel",
    ]);
    for (const m of referenced.filter((x) => x !== "ReviewModel")) {
      const calls = [...SERVICE.matchAll(new RegExp(`\\b${m}\\.(\\w+)`, "g"))].map((x) => x[1]);
      assert.ok(calls.length > 0, m);
      for (const c of calls) {
        assert.ok(["find", "findOne", "countDocuments"].includes(c), `${m}.${c} is not a read`);
      }
    }
  });

  it("44. Billing and Activity remain none of its business, and neither does a whole-collection read", () => {
    for (const forbidden of ["BillingModel", "ActivityModel"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} must not be referenced`);
    }
    /* Every cross-domain read is NARROWED BY QUERY to this student's own
     * classes or to them by name. `Model.find()` with no filter would pull the
     * whole collection to draw one profile. */
    assert.ok(!/(?:Lesson|Attendance|Homework|Class)Model\.find\(\)/.test(SERVICE), "no unfiltered read");
    assert.ok(SERVICE.includes("ClassModel.find({ studentIds: studentId })"), "classes are scoped to the student");
  });

  it("45. no lifecycle, recurrence, reconciliation or whole-database read", () => {
    for (const forbidden of [
      "advanceLessonLifecycle", "lifecycle", "recurrence", "reconciler", "reconcile",
      "ensureRegularLessons", "generate", "getAll",
    ]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} must not be reachable from Reviews`);
    }
    /* `repo` is matched as a MODULE, not as a substring. Gate 4.4D added an
     * import of ./review-report, and "review-report" contains "repo" — a bare
     * substring test would have failed on a filename while proving nothing. What
     * must not be reachable is the whole-database repository itself. */
    assert.ok(!/from "\.\/repo"|from "@\/lib\/repo"|\brepo\./.test(SERVICE),
      "the whole-database repo must not be reachable from Reviews");
  });

  it("46. it is server-only, and says so", () => {
    assert.ok(SERVICE.includes('import "server-only";'));
  });

  it("47. it holds no clock of its own", () => {
    assert.ok(!/new Date\s*\(|Date\.now/.test(SERVICE), "the app clock is the only time source");
    assert.ok(SERVICE.includes("CURRENT_MONTH"));
    /* GATE 4.4D ADMITTED `TODAY_ISO`, AND IT IS NOT A SECOND CLOCK. The
     * generated report carries the day it was generated on, which is a property
     * of the DOCUMENT — no Review stores it, and nothing writes it anywhere. It
     * comes from src/lib/constants.ts, the SAME application clock CURRENT_MONTH
     * comes from, so the two can never disagree. What this test still forbids is
     * a wall clock: `new Date()` and `Date.now` remain absent, above. */
    assert.ok(
      [...SERVICE.matchAll(/TODAY_ISO/g)].length <= 2,
      "TODAY_ISO is the app clock read once, not a date computed per call"
    );
    assert.ok(
      SERVICE.includes('import { CURRENT_MONTH, TODAY_ISO } from "./constants";'),
      "both come from the one application clock"
    );
  });

  it("48. no timestamp or status is invented", () => {
    for (const forbidden of ["updatedAt", "createdAt", "timestamps"]) {
      assert.ok(!SERVICE.includes(forbidden), forbidden);
    }
  });

  it("49. no ownership field is ever assigned in the service", () => {
    // `studentId:` and `month:` appear only inside the outgoing DTO, which reads
    // from the stored document; neither is ever the target of a write.
    const writeRegion = SERVICE.slice(SERVICE.indexOf("export async function createReview"));
    assert.ok(!/\bmonth:\s*(CURRENT_MONTH|APP_MONTH)/.test(writeRegion));
  });

  it("50. no internal Mongo identity can reach the wire", () => {
    assert.ok(SERVICE.includes('const clean = "-_id -__v";'));
    const projections = [...SERVICE.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    for (const p of projections) {
      assert.ok(p.includes("-_id"), `projection "${p}" must exclude _id`);
    }
    assert.ok(!/\b_id\b\s*:/.test(SERVICE.replace(/_id, \.\.\.planned\.doc/g, "")) ||
      SERVICE.includes("create({ _id, ...planned.doc })"),
      "the only _id is the minted one handed to create");
  });
});

/* =========================================================================
 * Persistence safety — the Gate 4 invariant
 * ====================================================================== */

describe("No Review index is declared anywhere", () => {
  it("51. models.ts declares no compound (studentId, month) Review index", () => {
    assert.ok(!MODELS.includes("ReviewSchema.index"));
    assert.ok(!/ReviewSchema[\s\S]*?\.index\(/.test(MODELS));
    assert.ok(!/studentId:\s*1/.test(MODELS), "no compound index key appears in the model file");
  });

  it("52. the service declares no index and issues no DDL", () => {
    for (const forbidden of [
      ".index(", "createIndex", "syncIndexes", "ensureIndex", "dropIndex", "collection.",
    ]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} would be an unauthorised schema change`);
    }
  });

  it("53. the service is nevertheless ready for the index that Gate 5 will add", () => {
    assert.ok(SERVICE.includes("isDupKey"), "a duplicate-key error already maps to the domain outcome");
  });
});

/* =========================================================================
 * Phase boundary — no UI exists yet
 * ====================================================================== */

describe("The service stays a server, whatever the client does", () => {
  /* Gate 4.2 asserted these three as "no Reviews UI exists yet". Gate 4.3 built
   * the UI, so two of them would now be false statements about the phase rather
   * than invariants. What they were really protecting survives, and is stated
   * here as the thing that must hold FOREVER: the boundary between the two. */

  it("54. the client never imports the service's runtime, only its types", () => {
    const dir = path.join(process.cwd(), "src", "components", "reviews");
    assert.ok(existsSync(dir), "the Reviews client arrived in Gate 4.3");
    for (const file of ["api.ts", "form.ts", "reviews-ui.ts", "student-reviews.tsx"]) {
      const src = readFileSync(path.join(dir, file), "utf8");
      const runtimeImport = /^import\s+(?!type)[^;]*from\s+"@\/lib\/reviews-service"/m.test(src);
      assert.ok(!runtimeImport, `${file} may import types from the service, never its code`);
    }
  });

  it("55. the page reaches the service only through the API", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src", "app", "(app)", "reviews", "page.tsx"), "utf8"
    );
    assert.ok(!/from "@\/lib\/reviews-service"/.test(page.replace(/import type[^;]+;/g, "")),
      "no runtime import of a server-only module");
    assert.ok(page.includes("@/components/reviews/api"), "it goes through the fetchers");
  });

  it("56. no client-side data fetching leaked INTO the service", () => {
    for (const forbidden of ["useQuery", "useMutation", "react-query", "\"use client\"", "useState"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} has no place in a server module`);
    }
  });
});

/* =========================================================================
 * Gate 4.5 — rollout readiness
 *
 * The integrity tool and the index sequencing are the two things standing
 * between this branch and a production write, and both are claims about files
 * rather than about behaviour a unit test can execute: the script talks to
 * production Atlas, which no test may do. So they are read as text — the same
 * technique the suites above use for "this module must not import that one".
 * ====================================================================== */

/** Raw, for the constants and the provenance prose. */
const INTEGRITY = readFileSync(path.join(process.cwd(), "scripts", "reviews-integrity.mjs"), "utf8");
/** Comment-stripped, for the forbidden-verb scan — the file NAMES the verbs it
 * refuses to use, and a scan that could not tell a promise from a call would
 * fail on the sentence promising not to make one. */
const INTEGRITY_CODE = code("scripts", "reviews-integrity.mjs");
const PKG = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const DB = readFileSync(path.join(process.cwd(), "src", "lib", "db.ts"), "utf8");

describe("The Reviews integrity tool is read-only, and stays that way", () => {
  it("57. the script exists and npm exposes it under the agreed name", () => {
    assert.equal(PKG.scripts["reviews:integrity"], "node scripts/reviews-integrity.mjs");
    assert.ok(INTEGRITY.length > 0);
  });

  it("58. it issues no write verb, and no DDL of any kind", () => {
    /* THIS IS THE WHOLE POINT OF THE TOOL. Its output is only trustworthy
     * because it cannot be the thing that changed what it is measuring — and it
     * is emphatically not the thing that creates the unique index. */
    for (const forbidden of [
      "insertOne", "insertMany", "updateOne", "updateMany", "replaceOne",
      "deleteOne", "deleteMany", "bulkWrite", "findOneAndUpdate", "findOneAndDelete",
      "createIndex", "dropIndex", "createIndexes", "syncIndexes", "ensureIndex",
      "createCollection", "drop(", "renameCollection", "aggregate(", "$out", "$merge",
    ]) {
      assert.ok(!INTEGRITY_CODE.includes(forbidden), `${forbidden} has no place in a read-only probe`);
    }
  });

  it("59. the only driver calls it makes are countDocuments and find", () => {
    const calls = [...INTEGRITY_CODE.matchAll(/\b(?:col|collection\([^)]*\))\s*\.\s*([a-zA-Z]+)\(/g)]
      .map((m) => m[1]);
    for (const call of calls) {
      assert.ok(["countDocuments", "find"].includes(call), `unexpected driver call: .${call}()`);
    }
    assert.ok(calls.includes("countDocuments") && calls.includes("find"));
  });

  it("60. the digest construction is the one the baseline will be taken from", () => {
    // id-sorted, _id and __v stripped, JSON.stringify, SHA-256 — identical to
    // scripts/homework-integrity.mjs, so the two tools cannot mean different
    // things by the word "digest".
    assert.ok(INTEGRITY.includes(".sort({ id: 1 })"), "sorted by the natural key");
    assert.ok(INTEGRITY.includes('new Set(["_id", "__v"])'), "storage keys stripped");
    assert.ok(INTEGRITY.includes('createHash("sha256")'));
    assert.ok(INTEGRITY.includes("JSON.stringify(stripped)"));
  });

  it("61. it reports every fact Gate 5 has to read off it", () => {
    for (const fact of ["count", "digest", "histogram", "resolvable", "ghost", "duplicates"]) {
      assert.ok(INTEGRITY.includes(`${fact}`), `the probe must report ${fact}`);
    }
    // A duplicate pair is a HARD failure: it is the one condition that makes the
    // Gate 5.3 unique index impossible.
    assert.match(INTEGRITY, /duplicates\.length > 0[\s\S]{0,300}fail\(/);
  });

  it("62. NO accepted baseline is banked — Sprint 8 has authorised no write", () => {
    /* `null` is the correct value for the whole of Gate 4.5 and it is a
     * statement, not an omission. The day it stops being null, a production
     * write must have been authorised and verified first. */
    assert.match(INTEGRITY, /const ACCEPTED_BASELINE = null;/);
  });

  it("63. the Gate 1 numbers are a reproduction reference, not an acceptance", () => {
    assert.match(INTEGRITY, /const GATE_1_OBSERVATION = \{/);
    assert.ok(INTEGRITY.includes("c4418428f5d247b7c58caf046ce09c6e71f24dd30caab3bc86d4032a5fa8c4d5"));
    assert.ok(INTEGRITY.includes("count: 33"));
    // And the file says out loud that they must not be promoted by copying.
    assert.ok(/IT IS NOT A BASELINE/.test(INTEGRITY));
  });

  it("64. nothing is auto-learned — no expectation is assigned from a query", () => {
    /* A baseline that reads itself back out of the collection it is checking
     * detects nothing. Both constants must be literals. */
    assert.ok(!/ACCEPTED_BASELINE\s*=\s*(?!null)/.test(INTEGRITY.replace("const ACCEPTED_BASELINE = null;", "")));
    assert.ok(!/GATE_1_OBSERVATION\.\w+\s*=/.test(INTEGRITY), "the reference is never written to");
    assert.ok(!/(EXPECTED|BASELINE|OBSERVATION)[^\n]*=\s*(count|digest|docs|await)/.test(INTEGRITY));
  });
});

describe("Production index sequencing — what Gate 5 must do first", () => {
  it("65. models.ts still declares no compound Review index", () => {
    assert.ok(!/ReviewSchema[\s\S]*?\.index\(/.test(MODELS));
    assert.ok(!MODELS.includes("studentId: 1"), "no compound key spec appears anywhere in the model file");
  });

  it("66. mongoose autoIndex is left at its default, which is ON", () => {
    /* THIS IS THE FACT THAT DECIDES THE SEQUENCING. `dbConnect` does not pass
     * `autoIndex: false`, and mongoose's default is `true` — so every index a
     * schema DECLARES is built implicitly the first time the model is used, in
     * every process, including a Vercel deploy.
     *
     * Therefore adding `ReviewSchema.index({studentId:1, month:1},{unique:true})`
     * to source is not an inert declaration: it is a deploy-time DDL nobody
     * authorised, and if a duplicate pair existed it would fail asynchronously
     * on the connection rather than anywhere a human would see it.
     *
     * Gate 5 must therefore create the index EXPLICITLY first (5.3), and only
     * then add the declaration — at which point the implicit build is a no-op
     * against an index that already exists with the same spec.
     *
     * If someone later sets autoIndex:false, this fails, and the sequencing
     * recommendation has to be made again rather than inherited. */
    assert.ok(!/autoIndex/.test(DB), "src/lib/db.ts must not silently change this without a decision");
    assert.ok(DB.includes("mongoose.connect("), "and the connection is still the one place it would go");
  });

  it("67. the one-shot DDL script does not exist yet", () => {
    // Gate 4.5 prepares the approach; it does not ship the tool that performs it.
    for (const name of [
      "reviews-create-index.mjs", "reviews-index.mjs", "create-review-index.mjs",
    ]) {
      assert.ok(
        !existsSync(path.join(process.cwd(), "scripts", name)),
        `${name} is a Gate 5 artefact, not a Gate 4.5 one`
      );
    }
    assert.ok(!("reviews:index" in PKG.scripts), "no index script is wired up yet");
  });

  it("68. no smoke fixture or disposable Review data ships in the repo", () => {
    /* There is no Review delete, so disposable smoke data would be permanent.
     * The first production write must be a legitimate review, which means the
     * repository must carry no prefabricated one to paste in. */
    const seed = readFileSync(path.join(process.cwd(), "src", "lib", "seed-data.ts"), "utf8");
    for (const marker of ["smoke", "SMOKE", "gate5", "Gate 5 review", "test review", "TODO review"]) {
      assert.ok(!seed.includes(marker), `${marker} suggests fixture data for a production write`);
    }
  });
});
