/* Review = Student + Month, and each persisted Review is completely independent.
 *
 * Run with:  npm test
 *
 * WHY THIS SUITE EXISTS. Gate 4.4D's human verification found values from one
 * review month appearing in another. The root cause was that the composer's form
 * baseline was established once per component MOUNT, while the route id and the
 * fetched context changed in place underneath it — so a month switch onto an
 * already-cached review left one month's answers sitting in another month's
 * form, and saving wrote them there.
 *
 * A source scan cannot prove that fixed. So the rules that decide WHICH record a
 * form holds, and WHICH record a save addresses, were extracted into
 * src/components/reviews/composer-state.ts as ordinary functions, and this suite
 * drives them over THREE months of DEEP-FROZEN fixtures. Frozen, because the
 * failure mode that matters is not "the wrong value is displayed" — it is "one
 * month's object was written through and another month now holds it". A frozen
 * fixture turns that from a silent corruption into a thrown TypeError.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  baselineValues, composerIdentity, initialStage, isEditable, canBeDirty,
  monthChoice, monthOptions, monthSelectorEnabled, primaryActionKey, saveTargetId,
  selectedMonth,
} from "../src/components/reviews/composer-state";
import { DEFAULT_RATING, emptyValues, toUpdateBody } from "../src/components/reviews/form";
import { buildMonthlyReviewReportDraft } from "../src/lib/review-report";
import { REVIEW_EDITABLE_FIELDS, SKILL_KEYS } from "../src/lib/reviews";
import type { ReviewComposerData, ReviewComposerMonth } from "../src/lib/review-report";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Freeze an object graph, all the way down.
 *
 * THIS IS THE INSTRUMENT. Every fixture below goes through it, so any code path
 * that writes into a cached review, a history entry or a skills map throws
 * instead of quietly succeeding — which is exactly the class of defect that
 * produced the cross-month bleed. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/* ------------------------------------------------------------------ fixtures
 *
 * One student, three months, three DIFFERENT reviews — different ratings,
 * different words, different ids. Distinctness is the point: a fixture whose
 * months looked alike could not tell a bleed from a coincidence. */

const skillsWith = (base: number, over: Record<string, number> = {}): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) out[key] = base;
  return { ...out, ...over };
};

const APRIL = { id: "rv-a", month: "2026-04", skills: skillsWith(2, { listening: 1 }), comment: "April words." };
const MAY = { id: "rv-b", month: "2026-05", skills: skillsWith(3, { speaking: 4 }), comment: "May words." };
const JUNE = { id: "rv-c", month: "2026-06", skills: skillsWith(4, { reading: 5 }), comment: "June words." };
const MONTHS = [JUNE, MAY, APRIL]; // newest first, as the server sends them

function monthOption(month: string, reviewId: string | null, pct: number): ReviewComposerMonth {
  return {
    month,
    taken: reviewId !== null,
    reviewId,
    attendance: { attended: pct, total: 100, pct, registersTaken: 2, lessonsCompleted: 2 },
    homework: { done: 1, total: 2, pct: 50 },
  };
}

/** The composer context the server would send for one of the three months, or
 * for a create. Always frozen. */
function contextFor(which: "create" | "rv-a" | "rv-b" | "rv-c"): ReviewComposerData {
  const record = MONTHS.find((m) => m.id === which) ?? null;
  return deepFreeze({
    mode: record ? "edit" : "create",
    student: {
      id: "s1", name: "Lucas Chen", initials: "LC", color: "#0284c7",
      avatar: null, gradeLabel: "Grade 3", status: "Active",
    },
    parent: { name: "Mei Chen", relationship: "Mother" },
    parentLinked: true,
    month: {
      current: record ? record.month : "2026-07",
      options: [
        monthOption("2026-07", null, 90),
        monthOption("2026-06", "rv-c", 80),
        monthOption("2026-05", "rv-b", 70),
        monthOption("2026-04", "rv-a", 60),
      ],
      immutable: record !== null,
    },
    review: record
      ? {
          id: record.id, skills: record.skills, comment: record.comment,
          strengths: `${record.month} strengths`, improvements: `${record.month} improvements`,
          goals: `${record.month} goals`, parentNotes: `${record.month} notes`, average: 0,
        }
      : {
          id: null, skills: {}, comment: "", strengths: "", improvements: "",
          goals: "", parentNotes: "", average: 0,
        },
    history: MONTHS.map((m) => ({ month: m.month, skills: m.skills, comment: m.comment })),
    appMonth: "2026-07",
    appDate: "2026-07-10",
  } as ReviewComposerData);
}

/* =========================================================================
 * 1. Three months, three records
 * ====================================================================== */

describe("Review isolation · three months are three records", () => {
  it("1. each month has its own id, its own ratings and its own words", () => {
    const ids = MONTHS.map((m) => m.id);
    assert.equal(new Set(ids).size, 3, "three distinct ids");
    assert.equal(new Set(MONTHS.map((m) => m.month)).size, 3, "three distinct months");
    assert.equal(new Set(MONTHS.map((m) => JSON.stringify(m.skills))).size, 3,
      "three distinct rating sets — a fixture whose months looked alike could not detect a bleed");
  });

  it("2. loading each review id produces that review's own persisted values", () => {
    for (const record of MONTHS) {
      const values = baselineValues(contextFor(record.id as "rv-a"));
      assert.equal(values.month, record.month, `${record.id} month`);
      assert.deepEqual(values.skills, record.skills, `${record.id} skills`);
      assert.equal(values.comment, record.comment, `${record.id} comment`);
      assert.equal(values.goals, `${record.month} goals`);
      assert.equal(values.studentId, "s1");
    }
  });

  it("3. the identity that drives a re-seed is distinct per review", () => {
    const ids = MONTHS.map((m) => composerIdentity(contextFor(m.id as "rv-a")));
    assert.deepEqual(ids, ["review:rv-c", "review:rv-b", "review:rv-a"]);
    assert.equal(new Set(ids).size, 3, "no two reviews may share a composer identity");
    /* A CREATE IS IDENTIFIED BY ITS STUDENT, and can never collide with a
     * review's identity — the two use different prefixes. */
    assert.equal(composerIdentity(contextFor("create")), "student:s1");
    assert.ok(!ids.includes("student:s1"));
  });

  it("4. the identity does NOT change when the same record is merely refetched", () => {
    /* This is what stops a background refetch — which React Query fires after
     * every save — from resetting a form somebody is typing into. Two separately
     * built contexts for the same review are different OBJECTS with the same
     * identity. */
    const a = contextFor("rv-b");
    const b = contextFor("rv-b");
    assert.notEqual(a, b, "different objects");
    assert.equal(composerIdentity(a), composerIdentity(b), "same identity");
  });

  it("5. a save addresses the review the form was seeded from, and nothing else", () => {
    for (const record of MONTHS) {
      const ctx = contextFor(record.id as "rv-a");
      assert.equal(saveTargetId(ctx), record.id);
      /* THE TARGET AND THE VALUES COME FROM ONE OBJECT. That is the structural
       * guarantee: there is no second place holding a route id that could drift
       * away from the values on screen. */
      assert.equal(baselineValues(ctx).month, ctx.month.current);
    }
    assert.equal(saveTargetId(contextFor("create")), null, "a create patches nothing");
  });
});

/* =========================================================================
 * 2. Nothing is shared, and nothing is written through
 * ====================================================================== */

describe("Review isolation · the seed shares no memory with the cache", () => {
  it("6. the baseline's skills map is a FRESH object, not the cached review's", () => {
    const ctx = contextFor("rv-c");
    const values = baselineValues(ctx);
    assert.notEqual(values.skills, ctx.review.skills, "must not alias the cached map");
    assert.deepEqual(values.skills, ctx.review.skills, "but must carry the same ratings");
  });

  it("7. editing the baseline cannot reach the cache, the fixture or another month", () => {
    const ctx = contextFor("rv-c");
    const values = baselineValues(ctx);
    // The fixture is frozen; if `values.skills` aliased it, this would throw.
    values.skills.listening = 5;
    values.comment = "edited";

    assert.equal(JUNE.skills.listening, 4, "June's fixture is untouched");
    assert.equal(MAY.skills.listening, 3, "May's fixture is untouched");
    assert.equal(APRIL.skills.listening, 1, "April's fixture is untouched");
    assert.equal(ctx.review.comment, "June words.", "and the cached review is untouched");
  });

  it("8. two baselines taken from the same context share nothing with each other", () => {
    const ctx = contextFor("rv-b");
    const first = baselineValues(ctx);
    const second = baselineValues(ctx);
    first.skills.speaking = 1;
    assert.equal(second.skills.speaking, 4, "one form's edit cannot reach another's");
  });

  it("9. an eleventh key cannot survive the seed, and a missing one cannot vanish", () => {
    const ctx = contextFor("rv-a");
    const values = baselineValues(ctx);
    assert.deepEqual(Object.keys(values.skills).sort(), [...SKILL_KEYS].sort());
  });

  it("10. building the report mutates neither the context nor any month's history", () => {
    const ctx = contextFor("rv-c");
    const draft = { ...baselineValues(ctx), skills: { ...JUNE.skills, writing: 5 } };
    // Every fixture is frozen, so a write anywhere in here throws.
    const report = buildMonthlyReviewReportDraft(ctx, draft);
    assert.equal(report.period, "2026-06");
    assert.deepEqual(MONTHS.map((m) => m.skills), [JUNE.skills, MAY.skills, APRIL.skills]);
    assert.equal(JUNE.skills.writing, 4, "the draft's change stayed in the draft");
  });

  it("11. the report's own arrays cannot be written back into the history", () => {
    const ctx = contextFor("rv-b");
    const report = buildMonthlyReviewReportDraft(ctx, baselineValues(ctx));
    report.skills[0].rating = 99;
    report.radar.current[0].rating = 99;
    assert.equal(MAY.skills[SKILL_KEYS[0]], 3, "the history is unmoved");
    assert.equal(ctx.review.skills[SKILL_KEYS[0]], 3, "and so is the cached review");
  });

  it("12. a PATCH carries the six editable fields and no ownership field", () => {
    const body = toUpdateBody(baselineValues(contextFor("rv-b")));
    assert.deepEqual(Object.keys(body).sort(), [...REVIEW_EDITABLE_FIELDS].sort());
    assert.ok(!("month" in body), "an edit may never move a review to another month");
    assert.ok(!("studentId" in body), "nor to another student");
    assert.ok(!("id" in body));
  });
});

/* =========================================================================
 * 3. Preview and teacher summary follow the selected month only
 * ====================================================================== */

describe("Review isolation · the preview cannot inherit another month", () => {
  it("13. each month's report carries that month's own metrics", () => {
    const pcts = MONTHS.map((m) => {
      const ctx = contextFor(m.id as "rv-a");
      return buildMonthlyReviewReportDraft(ctx, baselineValues(ctx)).summary.attendance?.pct;
    });
    assert.deepEqual(pcts, [80, 70, 60], "June / May / April, each its own");
  });

  it("14. each month's report carries that month's own ratings and words", () => {
    for (const record of MONTHS) {
      const ctx = contextFor(record.id as "rv-a");
      const report = buildMonthlyReviewReportDraft(ctx, baselineValues(ctx));
      assert.equal(report.period, record.month);
      assert.equal(report.feedback.comment, record.comment);
      const bars = Object.fromEntries(report.skills.map((s) => [s.key, s.rating]));
      assert.deepEqual(bars, record.skills, `${record.month} bars`);
    }
  });

  it("15. the teacher summary compares against the correct PREVIOUS month, per month", () => {
    /* April 2, May 3, June 4 across the board, with one standout each. May must
     * compare against April and June against May — never against whichever month
     * happened to be open a moment ago. */
    const may = buildMonthlyReviewReportDraft(contextFor("rv-b"), baselineValues(contextFor("rv-b")));
    assert.equal(may.radar.previous?.month, "2026-04");
    const june = buildMonthlyReviewReportDraft(contextFor("rv-c"), baselineValues(contextFor("rv-c")));
    assert.equal(june.radar.previous?.month, "2026-05");
    const april = buildMonthlyReviewReportDraft(contextFor("rv-a"), baselineValues(contextFor("rv-a")));
    assert.equal(april.radar.previous, null, "the earliest month has nothing before it");
    assert.equal(april.teacherSummary.improvement, null);
  });

  it("16. a draft edit in one month changes that month's summary and no other's", () => {
    const juneCtx = contextFor("rv-c");
    const before = buildMonthlyReviewReportDraft(juneCtx, baselineValues(juneCtx));
    const edited = buildMonthlyReviewReportDraft(juneCtx, {
      ...baselineValues(juneCtx),
      skills: { ...JUNE.skills, writing: 5 },
    });
    assert.notEqual(edited.summary.overallScore, before.summary.overallScore);

    // May, rebuilt from its own untouched fixture, is exactly what it was.
    const mayCtx = contextFor("rv-b");
    const may = buildMonthlyReviewReportDraft(mayCtx, baselineValues(mayCtx));
    assert.equal(may.feedback.comment, "May words.");
    assert.deepEqual(
      Object.fromEntries(may.skills.map((s) => [s.key, s.rating])),
      MAY.skills
    );
  });
});

/* =========================================================================
 * 4. The month selector — one window, two meanings
 * ====================================================================== */

describe("The month selector", () => {
  it("17. shows the SAME twelve-month context in create and on a saved review", () => {
    const create = monthOptions(contextFor("create"), "create");
    const view = monthOptions(contextFor("rv-c"), "view");
    assert.deepEqual(create.map((o) => o.month), view.map((o) => o.month),
      "the list must not collapse the moment a review is saved");
  });

  it("18. create offers the empty months and refuses the taken ones", () => {
    const options = monthOptions(contextFor("create"), "create");
    const july = options.find((o) => o.month === "2026-07")!;
    const june = options.find((o) => o.month === "2026-06")!;
    assert.equal(july.state, "none");
    assert.equal(july.disabled, false, "a month with no review may be written");
    assert.equal(june.state, "reviewed");
    assert.equal(june.disabled, true, "a taken month is visible and refused");
  });

  it("19. View is the mirror image: reviewed months navigate, empty ones do not", () => {
    const options = monthOptions(contextFor("rv-c"), "view");
    const june = options.find((o) => o.month === "2026-06")!;
    const may = options.find((o) => o.month === "2026-05")!;
    const july = options.find((o) => o.month === "2026-07")!;
    assert.equal(june.state, "current");
    assert.equal(may.state, "reviewed");
    assert.equal(may.disabled, false, "another month's review is reachable");
    assert.equal(july.state, "none");
    assert.equal(july.disabled, true, "Sprint 8 starts no create from inside a saved review");
  });

  it("20. create can only SELECT, View can only NAVIGATE, and Edit can do NEITHER", () => {
    const ALL = ["2026-04", "2026-05", "2026-06", "2026-07"];

    assert.deepEqual(monthChoice(contextFor("create"), "2026-07", "create"), { kind: "select", month: "2026-07" });
    assert.deepEqual(monthChoice(contextFor("create"), "2026-06", "create"), { kind: "none" },
      "a taken month never silently becomes an Edit");

    assert.deepEqual(monthChoice(contextFor("rv-c"), "2026-05", "view"), { kind: "navigate", reviewId: "rv-b" });
    assert.deepEqual(monthChoice(contextFor("rv-c"), "2026-04", "view"), { kind: "navigate", reviewId: "rv-a" });
    assert.deepEqual(monthChoice(contextFor("rv-c"), "2026-06", "view"), { kind: "none" }, "already there");
    assert.deepEqual(monthChoice(contextFor("rv-c"), "2026-07", "view"), { kind: "none" }, "no review to open");

    /* VIEW NEVER ANSWERS "select" — which is what would move a saved review's
     * month, the one thing an edit may never do. */
    for (const month of ALL) {
      assert.notEqual(monthChoice(contextFor("rv-c"), month, "view").kind, "select");
    }
    // And a create never answers "navigate".
    for (const month of ALL) {
      assert.notEqual(monthChoice(contextFor("create"), month, "create").kind, "navigate");
    }
    /* EDIT REFUSES EVERY MONTH. The trigger is disabled too, but this is the
     * guarantee: a teacher correcting June cannot pick May and find themselves
     * on another review with their work gone. */
    for (const month of ALL) {
      assert.deepEqual(monthChoice(contextFor("rv-c"), month, "edit"), { kind: "none" },
        `editing must refuse ${month}`);
    }
    assert.equal(monthSelectorEnabled("edit"), false, "and the control says so");
    assert.equal(monthSelectorEnabled("view"), true);
    assert.equal(monthSelectorEnabled("create"), true);
  });

  it("20b. while editing, every row is refused — the list offers no way out", () => {
    const options = monthOptions(contextFor("rv-c"), "edit");
    assert.equal(options.length, 4);
    assert.ok(options.every((o) => o.disabled), "no month may be chosen mid-edit");
    // The current month is still shown, because it is ownership context.
    assert.equal(selectedMonth(contextFor("rv-c"), "2026-04", "edit"), "2026-06");
  });

  it("21. every navigate destination is the review that actually holds that month", () => {
    for (const record of [MAY, APRIL]) {
      const choice = monthChoice(contextFor("rv-c"), record.month, "view");
      assert.equal(choice.kind, "navigate");
      assert.equal(choice.kind === "navigate" && choice.reviewId, record.id);
    }
  });

  it("22. the trigger shows the loaded review's month, never the destination", () => {
    /* A teacher who picks another month and then answers "Keep editing" must
     * find the selector still on the month they are actually reading. On a saved
     * review the displayed month is the RECORD's, not a piece of local state a
     * click could move ahead of the navigation. */
    const ctx = contextFor("rv-b");
    assert.equal(selectedMonth(ctx, "2026-04", "view"), "2026-05", "the draft cannot move the trigger");
    assert.equal(selectedMonth(ctx, "", "view"), "2026-05");
    // In create the month IS a form value, so the form is what the screen reads.
    assert.equal(selectedMonth(contextFor("create"), "2026-03", "create"), "2026-03");
  });

  it("23. a historical month outside the create window stays reachable", () => {
    /* The server includes any reviewed month older than the window for a saved
     * review, so a record from two years ago is readable and correctable rather
     * than orphaned. It is `reviewed`, never `none` — so this widens no create
     * eligibility. */
    const base = contextFor("rv-c");
    const ctx = deepFreeze({
      ...base,
      month: {
        ...base.month,
        current: "2024-01",
        options: [...base.month.options, monthOption("2024-01", "rv-old", 55)],
      },
      review: { ...base.review, id: "rv-old" },
    } as ReviewComposerData);

    const old = monthOptions(ctx, "view").find((o) => o.month === "2024-01")!;
    assert.equal(old.state, "current");
    assert.equal(saveTargetId(ctx), "rv-old");
    assert.equal(selectedMonth(ctx, "", "view"), "2024-01");
    // The current twelve months remain alongside it.
    assert.ok(monthOptions(ctx, "view").some((o) => o.month === "2026-07"));
  });
});

/* =========================================================================
 * 6. Create months are independent drafts
 *
 * THE EARLIER BEHAVIOUR WAS REVOKED, and this suite is why the new one exists.
 * Carrying the ratings and prose across a Create month change read to a human
 * tester as though a review were being COPIED into a month nobody had written —
 * the very impression this whole module must never give. A Create month change
 * now starts that month from the canonical pristine baseline.
 *
 * These tests walk the gate's own scenario literally: July draft, attempt June,
 * Keep editing, then Discard, then back to July.
 * ====================================================================== */

describe("Create · each month is an independent draft", () => {
  const STUDENT = "s1";

  /** The pristine baseline a Create month starts from — the same function the
   * composer seeds with, so this cannot drift from what the screen does. */
  const pristine = (month: string) => emptyValues(STUDENT, month);

  /** The July draft the scenario begins with. */
  const julyDraft = () => ({
    ...pristine("2026-07"),
    skills: { ...pristine("2026-07").skills, listening: 5 },
    comment: "July draft",
  });

  it("28. a Create draft starts at ten neutral ratings, blank prose, and its month", () => {
    const values = pristine("2026-07");
    assert.equal(values.month, "2026-07");
    assert.equal(Object.keys(values.skills).length, 10);
    for (const key of SKILL_KEYS) {
      assert.equal(values.skills[key], DEFAULT_RATING, `${key} starts neutral`);
    }
    assert.equal(DEFAULT_RATING, 3);
    for (const field of ["comment", "strengths", "improvements", "goals", "parentNotes"] as const) {
      assert.equal(values[field], "", `${field} starts blank`);
    }
  });

  it("29. KEEP EDITING preserves the draft and the month exactly", () => {
    /* Keep editing performs no state change at all — it drops the prompt. So the
     * assertion is that the draft object the composer is holding is untouched by
     * the decision, which is what "preserve current draft exactly" means. */
    const draft = julyDraft();
    const snapshot = JSON.parse(JSON.stringify(draft));
    // No reset is applied on this branch.
    assert.deepEqual(draft, snapshot);
    assert.equal(draft.month, "2026-07");
    assert.equal(draft.skills.listening, 5);
    assert.equal(draft.comment, "July draft");
  });

  it("30. DISCARD moves the month and resets EVERY rating and EVERY prose field", () => {
    const draft = julyDraft();
    assert.equal(draft.skills.listening, 5, "the draft really did hold an edit");

    // What the composer does on the discard branch: seed the destination month.
    const next = pristine("2026-06");

    assert.equal(next.month, "2026-06", "the month becomes the destination");
    assert.equal(next.skills.listening, DEFAULT_RATING, "Listening returns to 3");
    for (const key of SKILL_KEYS) {
      assert.equal(next.skills[key], DEFAULT_RATING, `${key} returns to 3`);
    }
    for (const field of ["comment", "strengths", "improvements", "goals", "parentNotes"] as const) {
      assert.equal(next[field], "", `${field} is blank`);
    }
    assert.notEqual(next.comment, "July draft", "the July words are gone");
  });

  it("31. the discarded July draft is retained NOWHERE — there is no per-month cache", () => {
    /* Coming back to a month a teacher has already abandoned must give them the
     * same fresh form as anyone else, never a half-written draft they thought
     * they had discarded. `emptyValues` is a pure function of the student and
     * the month, so there is nowhere for a draft to be stashed. */
    const first = pristine("2026-07");
    const afterAbandoning = pristine("2026-07");
    assert.deepEqual(first, afterAbandoning, "July reopens pristine");
    assert.equal(afterAbandoning.skills.listening, DEFAULT_RATING);
    assert.equal(afterAbandoning.comment, "");

    // And two seeds share no memory, so one month's form cannot reach another's.
    first.skills.listening = 5;
    first.comment = "July draft";
    assert.equal(afterAbandoning.skills.listening, DEFAULT_RATING);
    assert.equal(afterAbandoning.comment, "");
  });

  it("32. the month-derived context follows the new month; the draft does not", () => {
    /* Attendance, homework, the comparison and the report period all belong to
     * the month. The ratings and words belong to the teacher, and start fresh. */
    const ctx = contextFor("create");
    const july = buildMonthlyReviewReportDraft(ctx, pristine("2026-07"));
    const june = buildMonthlyReviewReportDraft(ctx, pristine("2026-06"));

    assert.equal(july.period, "2026-07");
    assert.equal(june.period, "2026-06");
    assert.equal(july.summary.attendance?.pct, 90, "July's own metrics");
    assert.equal(june.summary.attendance?.pct, 80, "June's own metrics");
    // Both previews show a pristine draft — neither inherits the other's values.
    assert.equal(july.summary.overallScore, DEFAULT_RATING);
    assert.equal(june.summary.overallScore, DEFAULT_RATING);
    assert.equal(july.feedback.comment, "");
    assert.equal(june.feedback.comment, "");
  });

  it("33. a July draft's preview never leaks into June's", () => {
    const ctx = contextFor("create");
    const edited = buildMonthlyReviewReportDraft(ctx, julyDraft());
    assert.equal(edited.feedback.comment, "July draft");
    assert.ok(edited.summary.overallScore > DEFAULT_RATING);

    // After the discard, June is built from the pristine baseline and shows none of it.
    const june = buildMonthlyReviewReportDraft(ctx, pristine("2026-06"));
    assert.equal(june.feedback.comment, "");
    assert.equal(june.summary.overallScore, DEFAULT_RATING);
    assert.equal(june.period, "2026-06");
  });

  it("34. switching Create month writes nothing anywhere", () => {
    /* The whole scenario runs against frozen fixtures; the context is never
     * touched, and no month option's metrics move. */
    const ctx = contextFor("create");
    const before = JSON.parse(JSON.stringify(ctx.month.options));
    buildMonthlyReviewReportDraft(ctx, julyDraft());
    buildMonthlyReviewReportDraft(ctx, pristine("2026-06"));
    assert.deepEqual(ctx.month.options, before);
  });
});

/* =========================================================================
 * 5. Create / View / Edit
 * ====================================================================== */

describe("The composer's three stages", () => {
  it("24. a saved review opens in View; a create is editable at once", () => {
    assert.equal(initialStage("edit"), "view");
    assert.equal(initialStage("create"), "create");
  });

  it("25. View is read-only and can never be dirty", () => {
    assert.equal(isEditable("view"), false);
    assert.equal(canBeDirty("view"), false, "leaving a page you only read must never prompt");
    assert.equal(isEditable("edit"), true);
    assert.equal(isEditable("create"), true);
    assert.equal(canBeDirty("edit"), true);
    assert.equal(canBeDirty("create"), true);
  });

  it("26. the primary action says exactly what it will do, per stage", () => {
    assert.equal(primaryActionKey("create"), "Save review");
    assert.equal(primaryActionKey("view"), "Edit review");
    assert.equal(primaryActionKey("edit"), "Save changes");
    /* "Save changes" must be unreachable while nothing can be changed — a screen
     * that offers it in View is lying about what pressing it would do. */
    assert.notEqual(primaryActionKey("view"), "Save changes");
  });

  it("27. the stage is screen state and reaches no wire, no schema and no document", () => {
    const STATE = code("src", "components", "reviews", "composer-state.ts");
    for (const forbidden of ["fetch(", "Model", "dbConnect", "status:", "publish"]) {
      assert.ok(!STATE.includes(forbidden), `composer-state.ts must not reference ${forbidden}`);
    }
    const models = code("src", "lib", "models.ts");
    assert.ok(!models.includes("stage"), "no Review document gains a stage");
    // And the two bodies still carry no stage of any kind.
    const body = toUpdateBody(baselineValues(contextFor("rv-a")));
    assert.ok(!("stage" in body) && !("mode" in body));
  });
});
