/* Reviews — the pure domain and its validation.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. Every rule Reviews embodies lives in
 * src/lib/reviews.ts as a function over plain values, so it is exercised
 * directly rather than through a database round trip. The planners are the
 * important cases: `planReviewCreate` and `planReviewUpdate` return the write as
 * DATA precisely so a test can assert which keys they touch and which they can
 * never produce.
 *
 * Guarantees that are NOT expressible as a function call — that the pure module
 * has no database access at all, that it holds no clock of its own, that no
 * Review index has been declared on the Mongoose schema — are asserted by
 * scanning the source, the same technique tests/homework.test.ts and
 * tests/attendance.test.ts already use.
 *
 * NOTHING HERE TOUCHES THE PRODUCTION DATABASE. Every student, review and parent
 * below is an in-memory fixture.
 *
 * THE APPLICATION MONTH IS PINNED LOCALLY. `APP_MONTH` is passed to every helper
 * that needs one, so these assertions state the calendar they mean instead of
 * tracking CURRENT_MONTH — which is exactly why the helpers take it as an
 * argument.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ELIGIBLE_REVIEW_STATUSES, REVIEW_EDITABLE_FIELDS, REVIEW_ERROR, REVIEW_MONTH_WINDOW,
  REVIEW_PROSE_FIELDS, REVIEW_RATING_MAX, REVIEW_RATING_MIN, SKILL_KEYS, SKILL_LABEL,
  buildReviewCards, buildReviewHistory, canReviewStudent, hasRequiredProse, isParentLinked,
  isSelectableMonth, latestReview, perfColor, perfLabel, planReviewCreate, planReviewUpdate,
  rankSkills, reviewAverage, reviewMonthOptions,
  type ReviewCreateInput, type ReviewPatch,
} from "../src/lib/reviews";
import { reviewCreateSchema, reviewUpdateSchema } from "../src/lib/schemas";
import { SKILLS } from "../src/lib/constants";
import type { Review, Student, StudentStatus } from "../src/lib/types";

/** The application month these assertions are written against. */
const APP_MONTH = "2026-07";

/** A module's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. Lifted from tests/homework.test.ts. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE = code("src", "lib", "reviews.ts");
const MODELS = code("src", "lib", "models.ts");

/* ------------------------------------------------------------------ fixtures */

/** Every canonical skill at the same rating. */
function flatSkills(rating: number): Record<string, number> {
  return Object.fromEntries(SKILL_KEYS.map((key) => [key, rating]));
}

/** Flat ratings with named dimensions overridden. */
function skills(over: Record<string, number> = {}, base = 3): Record<string, number> {
  return { ...flatSkills(base), ...over };
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
    id: "rv-s1-2026-06", studentId: "s1", month: "2026-06", skills: flatSkills(4),
    comment: "A steady month.", strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  };
}

function createInput(over: Partial<ReviewCreateInput> = {}): ReviewCreateInput {
  return {
    studentId: "s1", month: APP_MONTH, skills: flatSkills(4),
    comment: "Emma read aloud with real confidence this month.",
    strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  };
}

/** A well-formed create payload for the schema (input side: text may be omitted). */
function createPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { studentId: "s1", month: APP_MONTH, skills: flatSkills(4), comment: "Steady work.", ...over };
}

/* =========================================================================
 * 1. Canonical vocabulary
 * ====================================================================== */

describe("Reviews · canonical vocabulary", () => {
  it("scores exactly ten skills", () => {
    assert.equal(SKILL_KEYS.length, 10);
    assert.equal(new Set(SKILL_KEYS).size, 10);
  });

  it("keeps the canonical SKILLS order rather than a second copy of the list", () => {
    assert.deepEqual([...SKILL_KEYS], SKILLS.map(([key]) => key));
    assert.deepEqual([...SKILL_KEYS], [
      "listening", "speaking", "reading", "writing", "grammar",
      "vocabulary", "pronunciation", "confidence", "participation", "homework",
    ]);
  });

  it("labels every key from the canonical source", () => {
    for (const [key, label] of SKILLS) assert.equal(SKILL_LABEL[key], label);
    assert.equal(Object.keys(SKILL_LABEL).length, 10);
  });

  it("rates from 1 to 5", () => {
    assert.equal(REVIEW_RATING_MIN, 1);
    assert.equal(REVIEW_RATING_MAX, 5);
  });

  it("lets an edit touch six fields, none of them ownership", () => {
    assert.deepEqual([...REVIEW_EDITABLE_FIELDS], [
      "skills", "comment", "strengths", "improvements", "goals", "parentNotes",
    ]);
    for (const owned of ["id", "studentId", "month"]) {
      assert.ok(!(REVIEW_EDITABLE_FIELDS as readonly string[]).includes(owned), owned);
    }
  });

  it("excludes parentNotes from the prose minimum", () => {
    assert.deepEqual([...REVIEW_PROSE_FIELDS], ["comment", "strengths", "improvements", "goals"]);
    assert.ok(!(REVIEW_PROSE_FIELDS as readonly string[]).includes("parentNotes"));
  });

  it("maps every failure to one status and one sentence", () => {
    assert.equal(REVIEW_ERROR.student_not_found.status, 404);
    assert.equal(REVIEW_ERROR.student_not_eligible.status, 422);
    assert.equal(REVIEW_ERROR.month_not_selectable.status, 422);
    assert.equal(REVIEW_ERROR.month_already_reviewed.status, 409);
    assert.equal(REVIEW_ERROR.not_found.status, 404);
    for (const entry of Object.values(REVIEW_ERROR)) assert.ok(entry.message.length > 0);
  });
});

/* =========================================================================
 * 2. Average
 * ====================================================================== */

describe("Reviews · average", () => {
  it("averages a floor of 1 and a ceiling of 5", () => {
    assert.equal(reviewAverage(flatSkills(1)), 1);
    assert.equal(reviewAverage(flatSkills(5)), 5);
  });

  it("weights every skill equally over a representative mixed set", () => {
    const mixed = skills({
      listening: 5, speaking: 4, reading: 4, writing: 3, grammar: 4,
      vocabulary: 5, pronunciation: 3, confidence: 4, participation: 5, homework: 3,
    });
    // 5+4+4+3+4+5+3+4+5+3 = 40 over ten dimensions.
    assert.equal(reviewAverage(mixed), 4);
  });

  it("returns the raw value, unrounded and unformatted", () => {
    const avg = reviewAverage(skills({ listening: 5, speaking: 5, reading: 5 }, 3));
    // 5+5+5+3*7 = 36
    assert.equal(avg, 3.6);
    assert.equal(typeof avg, "number");
  });

  it("displays every attainable average cleanly at one decimal", () => {
    for (let total = 10; total <= 50; total++) {
      const base = Math.floor(total / 10);
      const extra = total % 10;
      const dimensions = SKILL_KEYS.map((key, i) => [key, base + (i < extra ? 1 : 0)] as const);
      const avg = reviewAverage(Object.fromEntries(dimensions));
      assert.equal(avg.toFixed(1), (total / 10).toFixed(1), `total ${total}`);
      assert.equal(Math.round(avg * 10), total);
    }
  });

  it("divides by the canonical ten even when a stored document is short a key", () => {
    // Defensive only: validation guarantees ten keys on the way in.
    assert.equal(reviewAverage({ listening: 5 }), 0.5);
    assert.equal(reviewAverage({}), 0);
    assert.equal(reviewAverage(null), 0);
  });

  it("reuses the existing perfLabel thresholds at 2.2 / 3.0 / 3.8 / 4.5", () => {
    assert.equal(perfLabel(4.5), "Excellent");
    assert.equal(perfLabel(4.4), "Strong");
    assert.equal(perfLabel(3.8), "Strong");
    assert.equal(perfLabel(3.7), "Good");
    assert.equal(perfLabel(3.0), "Good");
    assert.equal(perfLabel(2.9), "Developing");
    assert.equal(perfLabel(2.2), "Developing");
    assert.equal(perfLabel(2.1), "Needs support");

    assert.equal(perfColor(3.8), "var(--green)");
    assert.equal(perfColor(3.0), "var(--sky)");
    assert.equal(perfColor(2.2), "var(--amber)");
    assert.equal(perfColor(2.1), "var(--accent)");
  });

  it("states those thresholds nowhere in the Reviews module", () => {
    for (const threshold of ["4.5", "3.8", "3.0", "2.2"]) {
      assert.ok(!CORE.includes(threshold), `reviews.ts restates ${threshold}`);
    }
  });
});

/* =========================================================================
 * 3. Eligibility
 * ====================================================================== */

describe("Reviews · student eligibility", () => {
  it("allows Active, Trial and Paused", () => {
    assert.deepEqual([...ELIGIBLE_REVIEW_STATUSES], ["Active", "Trial", "Paused"]);
    for (const status of ELIGIBLE_REVIEW_STATUSES) {
      assert.equal(canReviewStudent(student({ status })), true, status);
    }
  });

  it("refuses an Archived student", () => {
    assert.equal(canReviewStudent(student({ status: "Archived" })), false);
  });

  it("fails closed on anything it does not recognise", () => {
    assert.equal(canReviewStudent(student({ status: "Graduated" as StudentStatus })), false);
    assert.equal(canReviewStudent(student({ status: "" as StudentStatus })), false);
    assert.equal(canReviewStudent(student({ status: undefined as unknown as StudentStatus })), false);
    assert.equal(canReviewStudent(null), false);
    assert.equal(canReviewStudent(undefined), false);
  });
});

/* =========================================================================
 * 4. Prose rule
 * ====================================================================== */

describe("Reviews · prose group rule", () => {
  const empty = { comment: "", strengths: "", improvements: "", goals: "", parentNotes: "" };

  it("is satisfied by any one of the four assessment fields", () => {
    for (const field of REVIEW_PROSE_FIELDS) {
      assert.equal(hasRequiredProse({ ...empty, [field]: "Something worth saying." }), true, field);
    }
  });

  it("is not satisfied by whitespace", () => {
    assert.equal(hasRequiredProse({ ...empty, comment: "   \n\t " }), false);
  });

  it("is not satisfied by parent notes alone", () => {
    assert.equal(hasRequiredProse({ ...empty, parentNotes: "Please sign the reading log." }), false);
  });

  it("is not satisfied by nothing at all", () => {
    assert.equal(hasRequiredProse(empty), false);
    assert.equal(hasRequiredProse({}), false);
    assert.equal(hasRequiredProse(null), false);
  });
});

/* =========================================================================
 * 5. Skill ranking
 * ====================================================================== */

describe("Reviews · skill ranking", () => {
  const spread = skills({
    listening: 5, speaking: 2, reading: 4, writing: 1, grammar: 3,
    vocabulary: 5, pronunciation: 2, confidence: 4, participation: 3, homework: 1,
  });

  it("returns the three strongest, rating descending", () => {
    const { strengths } = rankSkills(spread);
    assert.deepEqual(strengths.map((s) => s.key), ["listening", "vocabulary", "reading"]);
    assert.deepEqual(strengths.map((s) => s.rating), [5, 5, 4]);
    assert.equal(strengths[0].label, "Listening");
  });

  it("returns the three to focus on, rating ascending", () => {
    const { focus } = rankSkills(spread);
    assert.deepEqual(focus.map((s) => s.key), ["writing", "homework", "speaking"]);
    assert.deepEqual(focus.map((s) => s.rating), [1, 1, 2]);
  });

  it("breaks ties on the canonical order", () => {
    // listening and vocabulary both 5 — listening comes first because SKILLS says so.
    const { strengths } = rankSkills(spread);
    assert.ok(SKILL_KEYS.indexOf("listening") < SKILL_KEYS.indexOf("vocabulary"));
    assert.deepEqual(strengths.slice(0, 2).map((s) => s.key), ["listening", "vocabulary"]);
    // writing and homework both 1 — writing comes first for the same reason.
    const { focus } = rankSkills(spread);
    assert.ok(SKILL_KEYS.indexOf("writing") < SKILL_KEYS.indexOf("homework"));
    assert.deepEqual(focus.slice(0, 2).map((s) => s.key), ["writing", "homework"]);
  });

  it("stays deterministic when every rating is equal", () => {
    const flat = rankSkills(flatSkills(3));
    const again = rankSkills(flatSkills(3));
    assert.deepEqual(flat, again);
    assert.deepEqual(flat.strengths.map((s) => s.key), ["listening", "speaking", "reading"]);
    assert.deepEqual(flat.focus.map((s) => s.key), ["listening", "speaking", "reading"]);
  });

  it("takes three by default and honours an explicit count", () => {
    assert.equal(rankSkills(spread).strengths.length, 3);
    assert.equal(rankSkills(spread, 5).focus.length, 5);
    assert.equal(rankSkills(spread, 0).strengths.length, 0);
    assert.equal(rankSkills(spread, 99).strengths.length, 10);
  });
});

/* =========================================================================
 * 6. Month window
 * ====================================================================== */

describe("Reviews · month window", () => {
  it("spans the application month plus the previous eleven", () => {
    assert.equal(REVIEW_MONTH_WINDOW, 12);
    assert.equal(isSelectableMonth("2026-07", APP_MONTH), true);
    assert.equal(isSelectableMonth("2026-06", APP_MONTH), true);
    assert.equal(isSelectableMonth("2025-08", APP_MONTH), true); // eleven back
  });

  it("refuses twelve months back and further", () => {
    assert.equal(isSelectableMonth("2025-07", APP_MONTH), false);
    assert.equal(isSelectableMonth("2024-12", APP_MONTH), false);
  });

  it("refuses the next month and any future one", () => {
    assert.equal(isSelectableMonth("2026-08", APP_MONTH), false);
    assert.equal(isSelectableMonth("2027-07", APP_MONTH), false);
  });

  it("works across a year boundary", () => {
    assert.equal(isSelectableMonth("2025-12", "2026-01"), true);
    assert.equal(isSelectableMonth("2025-02", "2026-01"), true); // eleven back
    assert.equal(isSelectableMonth("2025-01", "2026-01"), false); // twelve back
    assert.equal(isSelectableMonth("2026-02", "2026-01"), false);
  });

  it("fails closed on a month that is not one", () => {
    for (const bad of ["", "2026", "2026-13", "2026-00", "2026-7", "not-a-month", null, undefined]) {
      assert.equal(isSelectableMonth(bad as string, APP_MONTH), false, String(bad));
    }
    assert.equal(isSelectableMonth("2026-07", "2026-13"), false);
  });

  it("offers twelve deterministic options, newest first", () => {
    const options = reviewMonthOptions(APP_MONTH);
    assert.equal(options.length, 12);
    assert.equal(options[0].month, "2026-07");
    assert.equal(options[11].month, "2025-08");
    assert.deepEqual(options, reviewMonthOptions(APP_MONTH));
    for (const option of options) {
      assert.equal(isSelectableMonth(option.month, APP_MONTH), true, option.month);
      assert.equal(option.taken, false);
    }
  });

  it("keeps a taken month visible, marked", () => {
    const options = reviewMonthOptions(APP_MONTH, ["2026-06", "2026-04"]);
    assert.equal(options.length, 12);
    assert.deepEqual(
      options.filter((o) => o.taken).map((o) => o.month),
      ["2026-06", "2026-04"]
    );
  });

  it("ignores a taken month outside the window rather than adding one", () => {
    const options = reviewMonthOptions(APP_MONTH, ["2020-01"]);
    assert.equal(options.length, 12);
    assert.ok(!options.some((o) => o.month === "2020-01"));
  });

  it("crosses a year boundary in its options", () => {
    const options = reviewMonthOptions("2026-01").map((o) => o.month);
    assert.deepEqual(options.slice(0, 3), ["2026-01", "2025-12", "2025-11"]);
    assert.equal(options[11], "2025-02");
  });

  it("returns nothing for an application month it cannot read", () => {
    assert.deepEqual(reviewMonthOptions("nonsense"), []);
  });
});

/* =========================================================================
 * 7. Create schema
 * ====================================================================== */

describe("Reviews · create schema", () => {
  it("accepts a full, valid payload and defaults the unwritten text", () => {
    const parsed = reviewCreateSchema.safeParse(createPayload());
    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.strengths, "");
    assert.equal(parsed.data!.parentNotes, "");
    assert.equal(Object.keys(parsed.data!.skills).length, 10);
  });

  it("refuses a review missing a skill", () => {
    const short = { ...flatSkills(4) };
    delete short.homework;
    assert.equal(reviewCreateSchema.safeParse(createPayload({ skills: short })).success, false);
  });

  it("refuses an eleventh skill", () => {
    const extra = { ...flatSkills(4), enthusiasm: 5 };
    assert.equal(reviewCreateSchema.safeParse(createPayload({ skills: extra })).success, false);
  });

  it("refuses a rating outside 1..5", () => {
    for (const rating of [0, 6, -1, 99]) {
      const payload = createPayload({ skills: { ...flatSkills(4), reading: rating } });
      assert.equal(reviewCreateSchema.safeParse(payload).success, false, String(rating));
    }
  });

  it("refuses a decimal rating", () => {
    const payload = createPayload({ skills: { ...flatSkills(4), reading: 4.5 } });
    assert.equal(reviewCreateSchema.safeParse(payload).success, false);
  });

  it("refuses a numeric string and a null rating", () => {
    for (const rating of ["4", "", null, undefined, true]) {
      const payload = createPayload({ skills: { ...flatSkills(4), reading: rating } });
      assert.equal(reviewCreateSchema.safeParse(payload).success, false, String(rating));
    }
  });

  it("refuses a month that is not a month", () => {
    for (const month of ["", "2026", "2026-13", "2026-00", "2026-7", "2026-07-01", 202607]) {
      assert.equal(reviewCreateSchema.safeParse(createPayload({ month })).success, false, String(month));
    }
  });

  it("requires the month rather than substituting one", () => {
    const payload = createPayload();
    delete payload.month;
    assert.equal(reviewCreateSchema.safeParse(payload).success, false);
  });

  it("requires a student", () => {
    assert.equal(reviewCreateSchema.safeParse(createPayload({ studentId: "" })).success, false);
  });

  it("enforces the prose group rule on a stable, form-renderable path", () => {
    const parsed = reviewCreateSchema.safeParse(
      createPayload({ comment: "   ", parentNotes: "Please sign the reading log." })
    );
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error!.issues[0].path, ["comment"]);
  });

  it("accepts a review whose only words are under one heading", () => {
    for (const field of REVIEW_PROSE_FIELDS) {
      const payload = createPayload({ comment: "", [field]: "Worth recording." });
      assert.equal(reviewCreateSchema.safeParse(payload).success, true, field);
    }
  });

  it("refuses every server-owned or non-existent top-level field", () => {
    for (const field of ["id", "status", "createdAt", "updatedAt", "classId", "lessonId", "average"]) {
      const payload = createPayload({ [field]: "x" });
      assert.equal(reviewCreateSchema.safeParse(payload).success, false, field);
    }
  });
});

/* =========================================================================
 * 8. Update schema
 * ====================================================================== */

describe("Reviews · update schema", () => {
  it("accepts a valid correction", () => {
    const parsed = reviewUpdateSchema.safeParse({ skills: flatSkills(5), comment: "Corrected." });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.goals, "");
  });

  it("requires all ten ratings", () => {
    const short = { ...flatSkills(4) };
    delete short.writing;
    assert.equal(reviewUpdateSchema.safeParse({ skills: short, comment: "x" }).success, false);
    assert.equal(reviewUpdateSchema.safeParse({ comment: "x" }).success, false);
  });

  it("refuses ownership fields", () => {
    for (const field of ["id", "studentId", "month"]) {
      const payload = { skills: flatSkills(4), comment: "x", [field]: "smuggled" };
      assert.equal(reviewUpdateSchema.safeParse(payload).success, false, field);
    }
  });

  it("refuses lifecycle and timestamp fields", () => {
    for (const field of ["status", "createdAt", "updatedAt", "classId", "lessonId", "average"]) {
      const payload = { skills: flatSkills(4), comment: "x", [field]: "smuggled" };
      assert.equal(reviewUpdateSchema.safeParse(payload).success, false, field);
    }
  });

  it("enforces the same prose group rule as create", () => {
    const parsed = reviewUpdateSchema.safeParse({ skills: flatSkills(4), parentNotes: "Sign here." });
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error!.issues[0].path, ["comment"]);
    assert.equal(reviewUpdateSchema.safeParse({ skills: flatSkills(4), goals: "Read weekly." }).success, true);
  });
});

/* =========================================================================
 * 9. Create planner
 * ====================================================================== */

describe("Reviews · create planner", () => {
  const eligible = student();

  it("refuses a student that is not there", () => {
    const plan = planReviewCreate(createInput(), null, new Set(), "rv-1", APP_MONTH);
    assert.deepEqual(plan, { ok: false, reason: "student_not_found" });
  });

  it("refuses an archived student", () => {
    const plan = planReviewCreate(
      createInput(), student({ status: "Archived" }), new Set(), "rv-1", APP_MONTH
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_eligible" });
  });

  it("refuses a month outside the window, future or ancient", () => {
    for (const month of ["2026-08", "2025-07", "2026-13"]) {
      const plan = planReviewCreate(createInput({ month }), eligible, new Set(), "rv-1", APP_MONTH);
      assert.deepEqual(plan, { ok: false, reason: "month_not_selectable" }, month);
    }
  });

  it("refuses a month this student already has", () => {
    const plan = planReviewCreate(
      createInput({ month: "2026-06" }), eligible, new Set(["2026-06"]), "rv-1", APP_MONTH
    );
    assert.deepEqual(plan, { ok: false, reason: "month_already_reviewed" });
  });

  it("decides in a fixed order — the student before the month", () => {
    // Archived AND a bad month: the student is reported, because a month is only
    // worth judging for a student who may be reviewed at all.
    const plan = planReviewCreate(
      createInput({ month: "2030-01" }), student({ status: "Archived" }), new Set(["2030-01"]),
      "rv-1", APP_MONTH
    );
    assert.deepEqual(plan, { ok: false, reason: "student_not_eligible" });
  });

  it("writes exactly the nine approved fields, and nothing else", () => {
    const input = createInput({
      month: "2026-05",
      skills: skills({ listening: 5 }, 4),
      comment: "A strong month.", strengths: "Reads aloud with confidence.",
      improvements: "Slow down to self-correct.", goals: "One short story a week.",
      parentNotes: "Please sign the reading log.",
    });
    const plan = planReviewCreate(input, eligible, new Set(["2026-06"]), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.doc, {
      id: "rv-new",
      studentId: "s1",
      month: "2026-05",
      skills: skills({ listening: 5 }, 4),
      comment: "A strong month.",
      strengths: "Reads aloud with confidence.",
      improvements: "Slow down to self-correct.",
      goals: "One short story a week.",
      parentNotes: "Please sign the reading log.",
    });
    assert.deepEqual(Object.keys(plan.doc).sort(), [
      "comment", "goals", "id", "improvements", "month", "parentNotes", "skills", "strengths", "studentId",
    ]);
  });

  it("generates no status, no timestamp, no class, no lesson and no average", () => {
    const plan = planReviewCreate(createInput(), eligible, new Set(), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    for (const field of ["status", "createdAt", "updatedAt", "classId", "lessonId", "average", "avg"]) {
      assert.ok(!(field in plan.doc), field);
    }
  });

  it("stores the ten canonical ratings and drops anything else", () => {
    const plan = planReviewCreate(
      createInput({ skills: { ...flatSkills(4), enthusiasm: 5 } }), eligible, new Set(), "rv-new", APP_MONTH
    );
    assert.equal(plan.ok, true);
    assert.deepEqual(Object.keys(plan.doc.skills), [...SKILL_KEYS]);
  });

  it("takes the month from the payload, never from the application month", () => {
    const plan = planReviewCreate(createInput({ month: "2026-02" }), eligible, new Set(), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    assert.equal(plan.doc.month, "2026-02");
    assert.notEqual(plan.doc.month, APP_MONTH);
  });

  it("takes the student id from the student, not the payload", () => {
    const plan = planReviewCreate(
      createInput({ studentId: "spoofed" }), student({ id: "s7" }), new Set(), "rv-new", APP_MONTH
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.doc.studentId, "s7");
  });

  it("never aliases or mutates the caller's input", () => {
    const input = createInput();
    const before = JSON.parse(JSON.stringify(input));
    const plan = planReviewCreate(input, eligible, new Set(), "rv-new", APP_MONTH);
    assert.equal(plan.ok, true);
    plan.doc.skills.listening = 1;
    assert.deepEqual(input, before);
  });
});

/* =========================================================================
 * 10. Update planner
 * ====================================================================== */

describe("Reviews · update planner", () => {
  it("emits only the six editable keys", () => {
    const patch: ReviewPatch = {
      skills: flatSkills(5), comment: "c", strengths: "s",
      improvements: "i", goals: "g", parentNotes: "p",
    };
    const set = planReviewUpdate(patch);
    assert.deepEqual(Object.keys(set).sort(), [...REVIEW_EDITABLE_FIELDS].sort());
  });

  it("cannot emit an ownership key, whatever it is handed", () => {
    const smuggled = {
      id: "rv-other", studentId: "s9", month: "2019-01",
      status: "Draft", createdAt: "2026-07-10", classId: "c1", lessonId: "l1", average: 5,
      comment: "Corrected.",
    } as unknown as ReviewPatch;
    const set = planReviewUpdate(smuggled);
    assert.deepEqual(set, { comment: "Corrected." });
    for (const field of ["id", "studentId", "month", "status", "createdAt", "classId", "lessonId", "average"]) {
      assert.ok(!(field in set), field);
    }
  });

  it("treats an absent key as untouched and an empty string as a value", () => {
    assert.deepEqual(planReviewUpdate({}), {});
    assert.deepEqual(planReviewUpdate({ comment: undefined }), {});
    assert.deepEqual(planReviewUpdate({ parentNotes: "" }), { parentNotes: "" });
    assert.deepEqual(planReviewUpdate(null), {});
  });

  it("rebuilds skills to the canonical ten", () => {
    const set = planReviewUpdate({ skills: { ...flatSkills(3), enthusiasm: 5 } as Record<string, number> });
    assert.deepEqual(Object.keys(set.skills!), [...SKILL_KEYS]);
  });

  it("never mutates or aliases the patch it was given", () => {
    const patch: ReviewPatch = { skills: flatSkills(4), comment: "c" };
    const before = JSON.parse(JSON.stringify(patch));
    const set = planReviewUpdate(patch);
    set.skills!.listening = 1;
    set.comment = "changed";
    assert.deepEqual(patch, before);
  });
});

/* =========================================================================
 * 11. Card and history shaping
 * ====================================================================== */

describe("Reviews · latest and history", () => {
  const may = review({ id: "rv-a", month: "2026-05" });
  const june = review({ id: "rv-b", month: "2026-06" });
  const april = review({ id: "rv-c", month: "2026-04" });

  it("picks the greatest month", () => {
    assert.equal(latestReview([april, june, may])!.id, "rv-b");
  });

  it("breaks a same-month tie deterministically by id", () => {
    const a = review({ id: "rv-aa", month: "2026-06" });
    const b = review({ id: "rv-bb", month: "2026-06" });
    assert.equal(latestReview([a, b])!.id, "rv-bb");
    assert.equal(latestReview([b, a])!.id, "rv-bb");
  });

  it("is null when there is nothing", () => {
    assert.equal(latestReview([]), null);
    assert.equal(latestReview(null), null);
  });

  it("orders history newest month first without touching the input", () => {
    const input = [april, june, may];
    const history = buildReviewHistory(input);
    assert.deepEqual(history.map((r) => r.id), ["rv-b", "rv-a", "rv-c"]);
    assert.deepEqual(input.map((r) => r.id), ["rv-c", "rv-b", "rv-a"]);
  });

  it("orders a same-month pair deterministically", () => {
    const a = review({ id: "rv-aa", month: "2026-06" });
    const b = review({ id: "rv-bb", month: "2026-06" });
    assert.deepEqual(buildReviewHistory([a, b]).map((r) => r.id), ["rv-bb", "rv-aa"]);
    assert.deepEqual(buildReviewHistory([b, a]).map((r) => r.id), ["rv-bb", "rv-aa"]);
  });

  it("scopes to one student when asked", () => {
    const other = review({ id: "rv-z", studentId: "s2", month: "2026-07" });
    assert.deepEqual(buildReviewHistory([june, other], "s1").map((r) => r.id), ["rv-b"]);
  });
});

describe("Reviews · index cards", () => {
  const students = [
    student({ id: "s1", name: "Emma Nguyen", parentId: "p1" }),
    student({ id: "s2", name: "Minh Tran", parentId: "", status: "Trial" }),
    student({ id: "s3", name: "Linh Pham", parentId: "p-gone" }),
    student({ id: "s4", name: "Archived Child", status: "Archived" }),
  ];
  const parents = new Set(["p1"]);
  const reviews = [
    review({ id: "rv-1", studentId: "s1", month: "2026-05", skills: flatSkills(3) }),
    review({ id: "rv-2", studentId: "s1", month: "2026-06", skills: flatSkills(5) }),
    review({ id: "rv-3", studentId: "s4", month: "2026-06" }),
    review({ id: "rv-ghost", studentId: "s-deleted", month: "2026-07" }),
  ];

  it("gives one card per reviewable student, in the order given", () => {
    const cards = buildReviewCards(students, reviews, parents);
    assert.deepEqual(cards.map((c) => c.studentId), ["s1", "s2", "s3"]);
  });

  it("excludes an archived student, and their reviews raise no card", () => {
    const cards = buildReviewCards(students, reviews, parents);
    assert.ok(!cards.some((c) => c.studentId === "s4"));
  });

  it("lets a ghost review create no card at all", () => {
    const cards = buildReviewCards(students, reviews, parents);
    assert.ok(!cards.some((c) => c.studentId === "s-deleted"));
    assert.equal(cards.length, 3);
  });

  it("includes an eligible student with no reviews yet", () => {
    const card = buildReviewCards(students, reviews, parents).find((c) => c.studentId === "s2")!;
    assert.equal(card.reviewCount, 0);
    assert.equal(card.latestMonth, null);
    assert.equal(card.latestAverage, null);
  });

  it("counts a student's own reviews and no one else's", () => {
    const cards = buildReviewCards(students, reviews, parents);
    assert.equal(cards.find((c) => c.studentId === "s1")!.reviewCount, 2);
    assert.equal(cards.find((c) => c.studentId === "s3")!.reviewCount, 0);
  });

  it("takes the average from the latest review only, never a history", () => {
    const card = buildReviewCards(students, reviews, parents).find((c) => c.studentId === "s1")!;
    assert.equal(card.latestMonth, "2026-06");
    assert.equal(card.latestAverage, 5); // June alone; May's 3 is not averaged in
  });

  it("calls a parent linked only when the parent genuinely resolves", () => {
    const cards = buildReviewCards(students, reviews, parents);
    assert.equal(cards.find((c) => c.studentId === "s1")!.parentLinked, true);
    assert.equal(cards.find((c) => c.studentId === "s2")!.parentLinked, false); // no parentId
    assert.equal(cards.find((c) => c.studentId === "s3")!.parentLinked, false); // dangling id
  });

  it("answers the parent question the same way on its own", () => {
    assert.equal(isParentLinked(student({ parentId: "p1" }), parents), true);
    assert.equal(isParentLinked(student({ parentId: "p-gone" }), parents), false);
    assert.equal(isParentLinked(student({ parentId: "" }), parents), false);
    assert.equal(isParentLinked(null, parents), false);
    assert.equal(isParentLinked(student(), null), false);
  });

  it("carries the student's own display values, unformatted", () => {
    const card = buildReviewCards([student()], [], parents)[0];
    assert.equal(card.name, "Emma Nguyen");
    assert.equal(card.initials, "EN");
    assert.equal(card.color, "#d14242");
    assert.equal(card.gradeLabel, "Grade 5");
    assert.equal(card.avatar, null);
  });

  it("survives empty inputs", () => {
    assert.deepEqual(buildReviewCards([], [], new Set()), []);
    assert.deepEqual(buildReviewCards(null, null, null), []);
  });
});

/* =========================================================================
 * 12. What the module is NOT
 * ====================================================================== */

describe("Reviews · the pure module stays pure", () => {
  it("has no server-only marker, so the test runner can load it", () => {
    assert.ok(!CORE.includes("server-only"));
  });

  it("reaches no database, model or connection", () => {
    for (const forbidden of ["mongoose", "./models", "./db", "./repo", "Model<", "Schema"]) {
      assert.ok(!CORE.includes(forbidden), `reviews.ts references ${forbidden}`);
    }
  });

  it("performs no I/O and no fetching", () => {
    for (const forbidden of ["fetch(", "await ", "async ", "node:fs", "process.env"]) {
      assert.ok(!CORE.includes(forbidden), `reviews.ts uses ${forbidden}`);
    }
  });

  it("holds no clock of its own", () => {
    for (const forbidden of ["new Date", "Date.now", "CURRENT_MONTH", "TODAY_ISO", "NOW_STAMP"]) {
      assert.ok(!CORE.includes(forbidden), `reviews.ts reads ${forbidden}`);
    }
  });

  it("imports only the pure modules it needs", () => {
    const imports = [...CORE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(imports)].sort(), ["./calc", "./constants", "./types"]);
  });

  it("declares no Review index — that is a production change, not a domain one", () => {
    assert.ok(!MODELS.includes("ReviewSchema.index"));
    assert.ok(!/ReviewSchema[\s\S]*?\.index\(/.test(MODELS));
    assert.ok(!CORE.includes(".index("));
  });
});
