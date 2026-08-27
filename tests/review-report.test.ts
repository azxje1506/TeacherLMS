/* Reviews — the composer's read model and the monthly report it generates.
 *
 * Run with:  npm test
 *
 * THE LIVE PREVIEW IS TESTED AS A FUNCTION, not as a screen. That is the whole
 * reason `buildMonthlyReviewReportDraft` is a pure function over plain values:
 * "does moving a rating move the overall score, the radar and the strongest
 * skill, without saving anything?" is the central promise of Gate 4.4D, and here
 * it is an ordinary assertion rather than something only a browser could see.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildMonthlyReviewReportDraft, previousReviewOf,
  type ReviewComposerData, type ReviewComposerMonth, type ReviewReportDraft,
} from "../src/lib/review-report";
import { SKILL_KEYS, perfColor, perfLabel, reviewAverage } from "../src/lib/reviews";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ------------------------------------------------------------------ fixtures */

const skills = (rating: number): Record<string, number> =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, rating]));

function month(over: Partial<ReviewComposerMonth> = {}): ReviewComposerMonth {
  return {
    month: "2026-07",
    taken: false,
    reviewId: null,
    attendance: { attended: 8, total: 10, pct: 80, registersTaken: 5, lessonsCompleted: 5 },
    homework: { done: 3, total: 4, pct: 75 },
    ...over,
  };
}

function context(over: Partial<ReviewComposerData> = {}): ReviewComposerData {
  return {
    mode: "create",
    student: {
      id: "s1", name: "Emma Chen", initials: "EC", color: "#d14242",
      avatar: null, gradeLabel: "Grade 3", status: "Active",
    },
    parent: { name: "Jennifer Chen", relationship: "Mother" },
    parentLinked: true,
    month: {
      current: "2026-07",
      options: [
        month({ month: "2026-07" }),
        month({
          month: "2026-06", taken: true, reviewId: "rv-june",
          attendance: { attended: 2, total: 2, pct: 100, registersTaken: 1, lessonsCompleted: 1 },
          homework: { done: 0, total: 0, pct: null },
        }),
      ],
      immutable: false,
    },
    review: {
      id: null, skills: {}, comment: "", strengths: "", improvements: "",
      goals: "", parentNotes: "", average: 0,
    },
    history: [{ month: "2026-06", skills: skills(3), comment: "A steady June." }],
    appMonth: "2026-07",
    appDate: "2026-07-10",
    ...over,
  };
}

function draft(over: Partial<ReviewReportDraft> = {}): ReviewReportDraft {
  return {
    month: "2026-07",
    skills: skills(3),
    comment: "", strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  };
}

/* =========================================================================
 * 1. The draft report — a preview with nothing saved
 * ====================================================================== */

describe("buildMonthlyReviewReportDraft — a report before there is a record", () => {
  it("1. needs no review id, and produces a whole document from a blank create", () => {
    const ctx = context();
    assert.equal(ctx.review.id, null, "a create has no record yet");
    const report = buildMonthlyReviewReportDraft(ctx, draft());

    assert.equal(report.period, "2026-07");
    assert.equal(report.student.name, "Emma Chen");
    assert.equal(report.parent?.name, "Jennifer Chen");
    assert.equal(report.skills.length, 10);
    assert.equal(report.radar.current.length, 10);
    assert.equal(report.meta.generatedOn, "2026-07-10");
  });

  it("2. is pure — the same context and draft always give the same document", () => {
    const ctx = context();
    const a = buildMonthlyReviewReportDraft(ctx, draft({ comment: "Steady." }));
    const b = buildMonthlyReviewReportDraft(ctx, draft({ comment: "Steady." }));
    assert.deepEqual(a, b);
  });

  it("3. mutates neither the context nor the draft it was given", () => {
    const ctx = context();
    const before = JSON.parse(JSON.stringify(ctx));
    const d = draft();
    const dBefore = JSON.parse(JSON.stringify(d));
    buildMonthlyReviewReportDraft(ctx, d);
    assert.deepEqual(ctx, before, "the context is read, never written");
    assert.deepEqual(d, dBefore, "and so is the draft");
  });

  it("4. carries the ten canonical skills, in canonical order, with the DRAFT's ratings", () => {
    const d = draft({ skills: { ...skills(3), listening: 5 } });
    const report = buildMonthlyReviewReportDraft(context(), d);
    assert.deepEqual(report.skills.map((s) => s.key), [...SKILL_KEYS]);
    assert.equal(report.skills.find((s) => s.key === "listening")?.rating, 5);
  });

  it("5. an eleventh key cannot survive into the report", () => {
    const d = draft({ skills: { ...skills(3), attitude: 5 } });
    const report = buildMonthlyReviewReportDraft(context(), d);
    assert.equal(report.skills.length, 10);
    assert.ok(!report.skills.some((s) => s.key === "attitude"));
    assert.ok(!("attitude" in report.radar.current.reduce<Record<string, unknown>>(
      (acc, a) => { acc[a.key] = a.rating; return acc; }, {}
    )));
  });
});

/* =========================================================================
 * 2. LIVE — what the draft moves, and what it cannot
 * ====================================================================== */

describe("The preview is live — a rating moves six things at once", () => {
  it("6. the overall score is the DRAFT's average, not the persisted review's", () => {
    const ctx = context({
      review: { ...context().review, id: "rv-july", skills: skills(2), average: 2 },
      mode: "edit",
    });
    const report = buildMonthlyReviewReportDraft(ctx, draft({ skills: skills(5) }));
    assert.equal(report.summary.overallScore, 5, "the unsaved edit is what is previewed");
    assert.notEqual(report.summary.overallScore, ctx.review.average);
  });

  it("7. changing one rating changes the average, its label and its colour", () => {
    const low = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(3) }));
    const high = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(5) }));

    assert.equal(low.summary.overallScore, 3);
    assert.equal(high.summary.overallScore, 5);
    // The band comes from the app's ONE thresholds table, never a second copy.
    assert.equal(low.summary.performanceLabel, perfLabel(3));
    assert.equal(high.summary.performanceLabel, perfLabel(5));
    assert.equal(low.summary.performanceColor, perfColor(3));
    assert.equal(high.summary.performanceColor, perfColor(5));
    assert.notEqual(low.summary.performanceLabel, high.summary.performanceLabel);
  });

  it("8. the average is the domain's own, not a formula restated here", () => {
    const d = draft({ skills: { ...skills(3), listening: 5, homework: 1 } });
    const report = buildMonthlyReviewReportDraft(context(), d);
    assert.equal(report.summary.overallScore, reviewAverage(d.skills));
  });

  it("9. the radar and the bars read the SAME draft ratings — they cannot disagree", () => {
    const d = draft({ skills: { ...skills(2), speaking: 4 } });
    const report = buildMonthlyReviewReportDraft(context(), d);
    for (const axis of report.radar.current) {
      const bar = report.skills.find((s) => s.key === axis.key);
      assert.equal(axis.rating, bar?.rating, `${axis.key} disagrees between radar and bar`);
    }
  });

  it("10. the strongest and weakest skills follow the draft", () => {
    const a = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), reading: 5, writing: 1 } })
    );
    assert.equal(a.teacherSummary.strongest?.key, "reading");
    assert.equal(a.teacherSummary.weakest?.key, "writing");

    const b = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), grammar: 5, listening: 1 } })
    );
    assert.equal(b.teacherSummary.strongest?.key, "grammar");
    assert.equal(b.teacherSummary.weakest?.key, "listening");
  });

  it("11. the biggest improvement is measured against the PREVIOUS review, from the draft", () => {
    // History holds June at 3 across the board.
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), vocabulary: 5 } })
    );
    assert.equal(report.teacherSummary.improvement?.key, "vocabulary");
    assert.equal(report.teacherSummary.improvement?.from, 3);
    assert.equal(report.teacherSummary.improvement?.to, 5);
  });

  it("12. a month that held or fell everywhere has NO biggest improvement", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(2) }));
    assert.equal(report.teacherSummary.improvement, null,
      "never the least-bad decline dressed up as progress");
  });

  it("13. a first review has no comparison at all", () => {
    const report = buildMonthlyReviewReportDraft(context({ history: [] }), draft());
    assert.equal(report.radar.previous, null);
    assert.equal(report.teacherSummary.improvement, null);
  });

  it("14. the teacher's words reach the report verbatim", () => {
    const d = draft({
      comment: "A steady month.", strengths: "Reads aloud with confidence.",
      improvements: "Slow down.", goals: "One story a week.", parentNotes: "Sign the log.",
    });
    const report = buildMonthlyReviewReportDraft(context(), d);
    assert.deepEqual(report.feedback, {
      comment: "A steady month.", strengths: "Reads aloud with confidence.",
      improvements: "Slow down.", goals: "One story a week.", parentNotes: "Sign the log.",
    });
  });

  it("15. changing prose changes NOTHING numeric", () => {
    const base = buildMonthlyReviewReportDraft(context(), draft());
    const typed = buildMonthlyReviewReportDraft(context(), draft({ comment: "Anything at all." }));
    assert.deepEqual(typed.summary, base.summary);
    assert.deepEqual(typed.skills, base.skills);
    assert.deepEqual(typed.radar, base.radar);
    assert.deepEqual(typed.teacherSummary, base.teacherSummary);
    assert.notEqual(typed.feedback.comment, base.feedback.comment);
  });
});

/* =========================================================================
 * 3. What the form may NOT move
 * ====================================================================== */

describe("Attendance and Homework are the server's, and the month's", () => {
  it("16. no rating or sentence in the draft can move either figure", () => {
    const base = buildMonthlyReviewReportDraft(context(), draft());
    const edited = buildMonthlyReviewReportDraft(context(), draft({
      skills: skills(5), comment: "x", strengths: "y", improvements: "z", goals: "g", parentNotes: "p",
    }));
    assert.deepEqual(edited.summary.attendance, base.summary.attendance);
    assert.deepEqual(edited.summary.homework, base.summary.homework);
    assert.equal(edited.summary.attendance?.pct, 80);
    assert.equal(edited.summary.homework?.pct, 75);
  });

  it("17. changing the draft MONTH does move them — a different month has different figures", () => {
    const july = buildMonthlyReviewReportDraft(context(), draft({ month: "2026-07" }));
    const june = buildMonthlyReviewReportDraft(context(), draft({ month: "2026-06" }));
    assert.equal(july.summary.attendance?.pct, 80);
    assert.equal(june.summary.attendance?.pct, 100);
    assert.equal(june.period, "2026-06");
  });

  it("18. an empty denominator is `null`, and never 0%", () => {
    const june = buildMonthlyReviewReportDraft(context(), draft({ month: "2026-06" }));
    assert.equal(june.summary.homework?.pct, null, "no homework outcomes is not 0% completion");
    assert.equal(june.summary.homework?.total, 0);
    assert.notEqual(june.summary.homework?.pct, 0);
  });

  it("19. a month the server offered no figures for is `null`, not zeroed", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft({ month: "2025-01" }));
    assert.equal(report.summary.attendance, null);
    assert.equal(report.summary.homework, null);
  });

  it("20. the comparison follows the month too", () => {
    // June's own review is in history; a draft FOR June must not compare
    // against itself — `previousReview` matches strictly earlier months.
    const june = buildMonthlyReviewReportDraft(context(), draft({ month: "2026-06" }));
    assert.equal(june.radar.previous, null, "a month never compares against its own record");

    const july = buildMonthlyReviewReportDraft(context(), draft({ month: "2026-07" }));
    assert.equal(july.radar.previous?.month, "2026-06");
  });

  it("21. `previousReviewOf` is the one answer both panes ask", () => {
    const ctx = context();
    assert.equal(previousReviewOf(ctx.history, "2026-07")?.comment, "A steady June.");
    assert.equal(previousReviewOf(ctx.history, "2026-06"), null);
    assert.equal(previousReviewOf([], "2026-07"), null);
  });
});

/* =========================================================================
 * 4. Empty semantics — absence is never a zero and never a name
 * ====================================================================== */

describe("The report states absence honestly", () => {
  it("22. no resolvable parent is `null`, never an invented name", () => {
    const report = buildMonthlyReviewReportDraft(
      context({ parent: null, parentLinked: false }), draft()
    );
    assert.equal(report.parent, null);
  });

  it("23. empty prose stays empty — nothing is generated to fill it", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft());
    assert.deepEqual(report.feedback, {
      comment: "", strengths: "", improvements: "", goals: "", parentNotes: "",
    });
  });

  it("24. a missing rating counts as 0 rather than poisoning the average with NaN", () => {
    const partial: Record<string, number> = { listening: 4 };
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: partial }));
    assert.ok(Number.isFinite(report.summary.overallScore));
    assert.equal(report.summary.overallScore, 0.4);
    assert.equal(report.skills.length, 10);
  });
});

/* =========================================================================
 * 5. No lifecycle, no fabrication, no persistence
 * ====================================================================== */

describe("The report model carries only what Sprint 8 has", () => {
  const SRC = code("src", "lib", "review-report.ts");

  it("25. there is no status, no publication and no lifecycle anywhere in it", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft());
    for (const key of ["status", "published", "publishedOn", "isDraft", "final"]) {
      assert.ok(!(key in report), `MonthlyReviewReport must not carry ${key}`);
    }
    assert.ok(!/publishedOn|isPublished|"Published"|"Final"/.test(SRC));
  });

  it("26. no concern, achievement or generated prose exists to be rendered", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft());
    for (const key of ["concern", "achievement", "aiSummary", "summaryText"]) {
      assert.ok(!(key in report), key);
      assert.ok(!(key in report.teacherSummary), key);
    }
    assert.ok(!/concern|achievement|aiSummary/i.test(SRC));
  });

  it("27. the teacher summary is exactly three deterministic facts", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft());
    assert.deepEqual(Object.keys(report.teacherSummary).sort(), ["improvement", "strongest", "weakest"]);
  });

  it("28. `generatedOn` is the application date the CONTEXT carried, not a clock", () => {
    assert.ok(!/new Date\s*\(|Date\.now/.test(SRC), "the module holds no clock");
    const report = buildMonthlyReviewReportDraft(context({ appDate: "2025-12-31" }), draft());
    assert.equal(report.meta.generatedOn, "2025-12-31");
  });

  it("29. the module writes nothing and reaches no database", () => {
    for (const forbidden of [
      "server-only", "dbConnect", "Model", "mongoose", "fetch(", "localStorage",
      "updateOne", "create(", "insert",
    ]) {
      assert.ok(!SRC.includes(forbidden), `review-report.ts must not reference ${forbidden}`);
    }
  });

  it("30. it restates no threshold and no formula of its own", () => {
    for (const threshold of ["4.5", "3.8", "3.0", "2.2"]) {
      assert.ok(!SRC.includes(threshold), `review-report.ts restates threshold ${threshold}`);
    }
    // The average, the ranking and the radar all come from the modules that own
    // them; this file composes, it does not compute.
    assert.ok(SRC.includes("reviewAverage(skills)"));
    assert.ok(SRC.includes("buildTeacherSummary(skills"));
    assert.ok(SRC.includes("radarAxes(skills)"));
    assert.ok(!/\/\s*SKILL_KEYS\.length|total \+=/.test(SRC), "no second average");
  });
});
