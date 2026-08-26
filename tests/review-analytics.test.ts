/* Sprint 8 Gate 4.4B — the cross-domain read models and the pure Review analytics.
 *
 * Run with:  npm test
 *
 * TWO KINDS OF ASSERTION, and the distinction matters:
 *
 *  - the per-student Attendance and Homework metrics are claimed to be FILTERS
 *    of the existing aggregates rather than second formulas, and a claim like
 *    that is only worth anything if it is executed. So section 3 does not assert
 *    "the code looks similar" — it runs both functions over the same fixture and
 *    proves the identity: summing every student's contribution reproduces the
 *    aggregate's own numerator and denominator, and the same percentage;
 *  - the "reads only, writes nothing" guarantees cannot be expressed as a
 *    function call, so they are scanned, the technique every suite here uses.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  attendanceRate, homeworkCompletion, studentAttendanceRate, studentHomeworkCompletion,
} from "../src/lib/finance";
import {
  biggestImprovement, buildReviewAnalytics, buildReviewHeatmap, buildReviewRadar,
  buildTeacherSummary, previousReview, radarAxes, reviewDistribution, reviewTrend,
  trendWindowPoints, TREND_WINDOWS,
} from "../src/lib/review-analytics";
import { SKILL_KEYS, monthsAgo, reviewAverage } from "../src/lib/reviews";
import type { AttendanceRecord, Homework, Lesson } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ANALYTICS = code("src", "lib", "review-analytics.ts");
const FINANCE = code("src", "lib", "finance.ts");
const SERVICE = code("src", "lib", "reviews-service.ts");

/* ------------------------------------------------------------------ fixtures */

const MONTH = "2026-06";

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1", classId: "c1", type: "regular", date: "2026-06-03", start: "18:00",
    duration: 90, classroom: "Room A", status: "Completed", notes: "",
    ...over,
  } as Lesson;
}

/** A register, written the way the app writes one: `lessonId` plus entries. */
function register(lessonId: string, entries: Record<string, string>): AttendanceRecord {
  return {
    lessonId,
    entries: Object.fromEntries(
      Object.entries(entries).map(([sid, status]) => [sid, { status, note: "" }])
    ),
  } as unknown as AttendanceRecord;
}

function homework(over: Partial<Homework> = {}): Homework {
  return {
    id: "hw1", title: "Unit 3", description: "", classId: "c1", lessonId: null,
    scope: "class", studentId: null, dueDate: "2026-06-10", status: "Completed",
    submissions: {}, teacherNotes: "", createdAt: "2026-06-01",
    ...over,
  };
}

const skills = (over: Partial<Record<string, number>> = {}, base = 3): Record<string, number> =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, over[k] ?? base]));

/* =========================================================================
 * 1. Per-student Attendance
 * ====================================================================== */

describe("studentAttendanceRate — one student's stored entries", () => {
  const lessons: Lesson[] = [
    lesson({ id: "l1", date: "2026-06-03" }),
    lesson({ id: "l2", date: "2026-06-10" }),
    lesson({ id: "l3", date: "2026-06-17" }),
  ];

  it("1. Present, Late and Excused all count as attended", () => {
    const attendance = [
      register("l1", { s1: "Present" }),
      register("l2", { s1: "Late" }),
      register("l3", { s1: "Excused" }),
    ];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.attended, 3);
    assert.equal(r.total, 3);
    assert.equal(r.pct, 100);
  });

  it("2. Absent is the only status that withholds", () => {
    const attendance = [
      register("l1", { s1: "Present" }),
      register("l2", { s1: "Absent" }),
      register("l3", { s1: "Excused" }),
    ];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.attended, 2);
    assert.equal(r.total, 3);
    assert.equal(r.pct, 67, "2/3 rounded, the same rounding the aggregate uses");
  });

  it("3. an Upcoming lesson is excluded, register or not", () => {
    const withUpcoming = [...lessons, lesson({ id: "l4", date: "2026-06-24", status: "Upcoming" })];
    const attendance = [register("l1", { s1: "Present" }), register("l4", { s1: "Absent" })];
    const r = studentAttendanceRate("s1", MONTH, { lessons: withUpcoming, attendance });
    assert.equal(r.total, 1, "only the Completed lesson's entry counted");
    assert.equal(r.attended, 1);
    assert.equal(r.lessonsCompleted, 3, "the Upcoming lesson is not a completed lesson");
  });

  it("4. a Cancelled lesson is excluded, chargeable or not", () => {
    const withCancelled = [...lessons, lesson({ id: "l5", date: "2026-06-25", status: "Cancelled" })];
    const attendance = [register("l5", { s1: "Absent" })];
    const r = studentAttendanceRate("s1", MONTH, { lessons: withCancelled, attendance });
    assert.equal(r.total, 0);
    assert.equal(r.pct, null);
  });

  it("5. a Completed lesson outside the month is excluded", () => {
    const spanning = [lesson({ id: "l1", date: "2026-06-03" }), lesson({ id: "lx", date: "2026-05-28" })];
    const attendance = [register("l1", { s1: "Present" }), register("lx", { s1: "Absent" })];
    const r = studentAttendanceRate("s1", MONTH, { lessons: spanning, attendance });
    assert.equal(r.total, 1);
    assert.equal(r.attended, 1);
  });

  it("6. the LESSON owns the date — a legacy register date is never read", () => {
    /* PROJECT_RULES, Date ownership: `AttendanceRecord.date` is a mirror that
     * some stored records carry with a value that disagrees with their lesson's.
     * The lesson wins, so a register stamped with another month still counts in
     * its lesson's month. */
    const rec = { ...register("l1", { s1: "Present" }), date: "2026-01-01" } as AttendanceRecord;
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance: [rec] });
    assert.equal(r.total, 1, "counted in June, where its lesson is");
  });

  it("7. a lesson with no entry for this student invents nothing", () => {
    const attendance = [
      register("l1", { s1: "Present" }),
      register("l2", { s2: "Present" }), // s1 not on this register at all
      register("l3", { s1: "Absent" }),
    ];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.total, 2, "l2 contributes nothing for s1 — not a default Present");
    assert.equal(r.attended, 1);
    assert.equal(r.pct, 50);
  });

  it("8. no stored entry at all yields null, never 0%", () => {
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance: [] });
    assert.equal(r.total, 0);
    assert.equal(r.attended, 0);
    assert.equal(r.pct, null, "0% would state an assessment the data never made");
    assert.notEqual(r.pct, 0);
  });

  it("9. one student's entry never reaches another's figure", () => {
    const attendance = [
      register("l1", { s1: "Present", s2: "Absent" }),
      register("l2", { s1: "Absent", s2: "Present" }),
    ];
    const a = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    const b = studentAttendanceRate("s2", MONTH, { lessons, attendance });
    assert.deepEqual([a.attended, a.total], [1, 2]);
    assert.deepEqual([b.attended, b.total], [1, 2]);
  });

  it("10. a ghost student's entry does not reach a named student's figure", () => {
    const attendance = [register("l1", { s1: "Present", "s-deleted": "Absent" })];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.total, 1);
    assert.equal(r.attended, 1);
  });

  it("11. coverage reports the gap instead of disguising it", () => {
    // Three completed lessons; a register exists for one of them.
    const attendance = [register("l2", { s1: "Present" })];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.lessonsCompleted, 3);
    assert.equal(r.registersTaken, 1);
    assert.equal(r.total, 1);
    assert.equal(r.pct, 100, "100% of what was recorded — and 1-of-3 coverage says the rest");
  });

  it("12. coverage counts registers for lessons in scope only", () => {
    const attendance = [
      register("l1", { s1: "Present" }),
      register("lx", { s1: "Present" }), // no such lesson in scope
    ];
    const r = studentAttendanceRate("s1", MONTH, { lessons, attendance });
    assert.equal(r.registersTaken, 1);
    assert.equal(r.lessonsCompleted, 3);
    assert.ok(r.registersTaken <= r.lessonsCompleted, "coverage can never exceed 100%");
  });

  it("13. every lesson type counts — attendance belongs to a lesson, not a type", () => {
    const typed = [
      lesson({ id: "l1", type: "regular" }),
      lesson({ id: "l2", type: "makeup" }),
      lesson({ id: "l3", type: "extra" }),
    ];
    const attendance = [
      register("l1", { s1: "Present" }),
      register("l2", { s1: "Present" }),
      register("l3", { s1: "Present" }),
    ];
    assert.equal(studentAttendanceRate("s1", MONTH, { lessons: typed, attendance }).total, 3);
  });

  it("14. the app clock is never consulted — the month is the argument", () => {
    const r = studentAttendanceRate("s1", "2026-05", {
      lessons: [lesson({ id: "l1", date: "2026-05-04" })],
      attendance: [register("l1", { s1: "Present" })],
    });
    assert.equal(r.total, 1, "a month that is not CURRENT_MONTH works exactly the same");
  });
});

/* =========================================================================
 * 2. Per-student Homework
 * ====================================================================== */

describe("studentHomeworkCompletion — one student's outcomes", () => {
  it("15. class-scoped Completed and Late both count as done", () => {
    const hw = [
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Completed", submissions: { s1: "Late" } }),
    ];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total, r.pct], [2, 2, 100]);
  });

  it("16. class-scoped Missing is the opposite of done", () => {
    const hw = [
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Completed", submissions: { s1: "Missing" } }),
    ];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total, r.pct], [1, 2, 50]);
  });

  it("17. an Assigned submission is excluded from numerator AND denominator", () => {
    const hw = [
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Completed", submissions: { s1: "Assigned" } }),
    ];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total, r.pct], [1, 1, 100], "Assigned is not a failure");
  });

  it("18. a top-level Assigned assignment is skipped whole, as the aggregate skips it", () => {
    /* SURPRISING BUT DELIBERATE. Sprint 7's aggregate skips an assignment whose
     * own status is Assigned before it looks at any submission. Reproducing that
     * exactly is what keeps this a filter; diverging would create the second
     * formula this gate exists to avoid. */
    const hw = [homework({ id: "h1", status: "Assigned", submissions: { s1: "Completed" } })];
    assert.equal(studentHomeworkCompletion("s1", MONTH, { homework: hw }).total, 0);
    assert.equal(homeworkCompletion(MONTH, { homework: hw }), 0, "and the aggregate agrees");
  });

  it("19. a student-scoped assignment counts for its assignee", () => {
    const hw = [homework({ id: "h1", scope: "student", studentId: "s1", status: "Late" })];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total, r.pct], [1, 1, 100]);
  });

  it("20. a student-scoped assignment for somebody else is excluded", () => {
    const hw = [homework({ id: "h1", scope: "student", studentId: "s2", status: "Completed" })];
    assert.equal(studentHomeworkCompletion("s1", MONTH, { homework: hw }).total, 0);
    assert.equal(studentHomeworkCompletion("s1", MONTH, { homework: hw }).pct, null);
  });

  it("21. the month is the DUE DATE's month", () => {
    const hw = [
      homework({ id: "h1", dueDate: "2026-06-30", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", dueDate: "2026-07-01", status: "Completed", submissions: { s1: "Missing" } }),
    ];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total], [1, 1], "July's assignment belongs to July");
  });

  it("22. another student's ghost submission cannot reach this figure", () => {
    const hw = [
      homework({
        id: "h1", status: "Completed",
        submissions: { s1: "Completed", "s-deleted": "Missing" },
      }),
    ];
    const r = studentHomeworkCompletion("s1", MONTH, { homework: hw });
    assert.deepEqual([r.done, r.total, r.pct], [1, 1, 100]);
    // And the aggregate still counts the ghost, exactly as Sprint 7 requires.
    assert.equal(homeworkCompletion(MONTH, { homework: hw }), 50);
  });

  it("23. no eligible outcome yields null, never 0%", () => {
    const r = studentHomeworkCompletion("s1", MONTH, { homework: [] });
    assert.deepEqual([r.done, r.total, r.pct], [0, 0, null]);
    assert.notEqual(r.pct, 0);
  });

  it("24. a class-scoped assignment this student is not on contributes nothing", () => {
    const hw = [homework({ id: "h1", status: "Completed", submissions: { s2: "Completed" } })];
    assert.equal(studentHomeworkCompletion("s1", MONTH, { homework: hw }).total, 0);
  });

  it("25. it is NOT the Review's homework skill rating", () => {
    // The rating is the teacher's 1-5 judgement; this counts submissions. The
    // function cannot see a review at all — it takes homework and nothing else.
    const hw = [homework({ id: "h1", status: "Missing", submissions: { s1: "Missing" } })];
    assert.equal(studentHomeworkCompletion("s1", MONTH, { homework: hw }).pct, 0,
      "a genuine zero: an outcome was recorded and it was Missing");
    assert.ok(!FINANCE.includes("SKILL_KEYS") && !FINANCE.includes("reviewAverage"),
      "finance.ts must not read a review to answer a homework question");
  });
});

/* =========================================================================
 * 3. THE RECONCILIATION IDENTITY
 *
 * The claim under test is that each per-student helper is a FILTER of the
 * existing aggregate, not a second reporting formula. These run both and prove
 * it arithmetically on controlled fixtures.
 * ====================================================================== */

describe("Reconciliation — the per-student metric is a filter, not a second formula", () => {
  const lessons: Lesson[] = [
    lesson({ id: "l1", date: "2026-06-03" }),
    lesson({ id: "l2", date: "2026-06-10" }),
    lesson({ id: "l3", date: "2026-06-17", status: "Upcoming" }),
    lesson({ id: "l4", date: "2026-05-27" }),
  ];
  const attendance = [
    register("l1", { s1: "Present", s2: "Absent", s3: "Excused" }),
    register("l2", { s1: "Late", s2: "Present", "s-deleted": "Absent" }),
    register("l3", { s1: "Absent" }),          // Upcoming — excluded either way
    register("l4", { s1: "Present", s2: "Present" }), // May — excluded either way
  ];
  /** Every student id the month's registers name, ghosts included — which is
   * exactly the set the aggregate iterates. */
  const named = ["s1", "s2", "s3", "s-deleted"];

  it("26. summing every named student reproduces the aggregate's numerator and denominator", () => {
    let attended = 0, total = 0;
    for (const sid of named) {
      const r = studentAttendanceRate(sid, MONTH, { lessons, attendance });
      attended += r.attended;
      total += r.total;
    }
    // The aggregate, recomputed here from the same fixture, entry by entry.
    const monthLessonIds = new Set(
      lessons.filter((l) => l.date.startsWith(MONTH) && l.status === "Completed").map((l) => l.id)
    );
    let aggPresent = 0, aggTotal = 0;
    for (const rec of attendance) {
      if (!monthLessonIds.has(rec.lessonId)) continue;
      for (const sid of Object.keys(rec.entries)) {
        aggTotal++;
        const st = rec.entries[sid]?.status;
        if (st === "Present" || st === "Late" || st === "Excused") aggPresent++;
      }
    }
    assert.equal(total, aggTotal, "denominators must agree");
    assert.equal(attended, aggPresent, "numerators must agree");
    // Stated independently so the identity cannot pass by both sides being wrong
    // the same way: l1 names three students, l2 names three, and the Upcoming
    // and May registers contribute nothing to either side.
    assert.equal(total, 6);
    assert.equal(attended, 4, "Present, Excused, Late, Present — the two Absents withhold");
  });

  it("27. and the percentage the sum produces is the aggregate's own percentage", () => {
    let attended = 0, total = 0;
    for (const sid of named) {
      const r = studentAttendanceRate(sid, MONTH, { lessons, attendance });
      attended += r.attended;
      total += r.total;
    }
    assert.equal(Math.round((attended / total) * 100), attendanceRate(MONTH, { lessons, attendance }));
  });

  it("28. status interpretation is identical, status by status", () => {
    /* One lesson, one student, one status at a time: the per-student figure and
     * the aggregate must agree on every member of the vocabulary. */
    const one = [lesson({ id: "l1", date: "2026-06-03" })];
    for (const [status, expected] of [
      ["Present", 100], ["Late", 100], ["Excused", 100], ["Absent", 0],
    ] as const) {
      const data = { lessons: one, attendance: [register("l1", { s1: status })] };
      assert.equal(studentAttendanceRate("s1", MONTH, data).pct, expected, status);
      assert.equal(attendanceRate(MONTH, data), expected, `aggregate: ${status}`);
    }
  });

  it("29. an empty per-student denominator does not change aggregate behaviour", () => {
    const data = { lessons, attendance };
    const before = attendanceRate(MONTH, data);
    const absent = studentAttendanceRate("s-never-enrolled", MONTH, data);
    assert.equal(absent.pct, null);
    assert.equal(attendanceRate(MONTH, data), before, "the aggregate is untouched");
  });

  it("30. the aggregate keeps returning 0 for an empty month — unchanged, deliberately", () => {
    /* The aggregate's `total === 0 ? 0` branch is Sprint 6 behaviour and other
     * screens depend on it. The per-student helper does NOT reuse it; it is the
     * new function that distinguishes "no data" from "nothing attended". */
    assert.equal(attendanceRate(MONTH, { lessons: [], attendance: [] }), 0);
    assert.equal(studentAttendanceRate("s1", MONTH, { lessons: [], attendance: [] }).pct, null);
  });

  it("31. homework: summing every named student reproduces the aggregate", () => {
    const hw = [
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed", s2: "Missing" } }),
      homework({ id: "h2", status: "Late", submissions: { s1: "Late", "s-deleted": "Completed" } }),
      homework({ id: "h3", scope: "student", studentId: "s2", status: "Missing" }),
      homework({ id: "h4", status: "Assigned", submissions: { s1: "Completed" } }), // skipped whole
      homework({ id: "h5", dueDate: "2026-07-02", status: "Completed", submissions: { s1: "Completed" } }),
    ];
    let done = 0, total = 0;
    for (const sid of ["s1", "s2", "s-deleted"]) {
      const r = studentHomeworkCompletion(sid, MONTH, { homework: hw });
      done += r.done;
      total += r.total;
    }
    assert.equal(total, 5, "h1's two, h2's two, h3's one");
    assert.equal(done, 3);
    assert.equal(Math.round((done / total) * 100), homeworkCompletion(MONTH, { homework: hw }));
  });

  it("32. the existing aggregates were not edited to make the identity pass", () => {
    // Both keep their original signature, their `0` empty branch and their name.
    assert.match(FINANCE, /export function attendanceRate\(month: string, data: Pick<AllData, "lessons" \| "attendance">\): number/);
    assert.match(FINANCE, /export function homeworkCompletion\(month: string, data: Pick<AllData, "homework">\): number/);
    assert.equal([...FINANCE.matchAll(/total === 0 \? 0 :/g)].length, 2, "both aggregates keep the 0 branch");
    assert.equal([...FINANCE.matchAll(/total === 0 \? null :/g)].length, 2, "both new helpers use null");
  });
});

/* =========================================================================
 * 4. Radar
 * ====================================================================== */

describe("Radar — the ten axes and their comparison", () => {
  const history = [
    { month: "2026-03", skills: skills({ listening: 2 }) },
    { month: "2026-05", skills: skills({ listening: 3 }) },
    { month: "2026-06", skills: skills({ listening: 5 }) },
  ];

  it("33. the axes are the ten canonical skills, in canonical order", () => {
    const axes = radarAxes(skills());
    assert.deepEqual(axes.map((a) => a.key), [...SKILL_KEYS]);
    assert.equal(axes.length, 10);
  });

  it("34. current values are the selected review's own ratings", () => {
    const r = buildReviewRadar(history[2], history);
    assert.equal(r.month, "2026-06");
    assert.equal(r.current.find((a) => a.key === "listening")?.rating, 5);
  });

  it("35. the comparison is the previous chronological review", () => {
    const r = buildReviewRadar(history[2], history);
    assert.equal(r.previous?.month, "2026-05");
    assert.equal(r.previous?.axes.find((a) => a.key === "listening")?.rating, 3);
  });

  it("36. a skipped calendar month still compares to the prior REVIEW", () => {
    // May follows March with April missing; the comparison is March, not "none".
    const r = buildReviewRadar(history[1], history);
    assert.equal(r.previous?.month, "2026-03", "April has no review — March is still previous");
  });

  it("37. a first review has no comparison", () => {
    const r = buildReviewRadar(history[0], history);
    assert.equal(r.previous, null);
  });

  it("38. history order in does not change the answer", () => {
    const shuffled = [history[2], history[0], history[1]];
    assert.equal(buildReviewRadar(history[2], shuffled).previous?.month, "2026-05");
    // And the caller's array is never sorted in place.
    assert.deepEqual(shuffled.map((r) => r.month), ["2026-06", "2026-03", "2026-05"]);
  });

  it("39. previousReview never returns the selected review itself", () => {
    assert.equal(previousReview(history, "2026-03"), null);
    assert.equal(previousReview(history, "2026-06")?.month, "2026-05");
  });
});

/* =========================================================================
 * 5. Trend
 * ====================================================================== */

describe("Trend — one point per review, and nothing invented", () => {
  const history = [
    { month: "2025-12", skills: skills({}, 2) },
    { month: "2026-02", skills: skills({}, 3) },
    { month: "2026-06", skills: skills({}, 5) },
  ];

  it("40. points are chronological, oldest first", () => {
    const pts = reviewTrend([history[2], history[0], history[1]]);
    assert.deepEqual(pts.map((p) => p.month), ["2025-12", "2026-02", "2026-06"]);
  });

  it("41. each point is that review's own average", () => {
    const pts = reviewTrend(history);
    assert.deepEqual(pts.map((p) => p.average), [2, 3, 5]);
    assert.equal(pts[0].average, reviewAverage(history[0].skills));
  });

  it("42. a month with no review contributes no point — nothing is interpolated", () => {
    const pts = reviewTrend(history);
    assert.equal(pts.length, 3, "January, March, April and May are simply absent");
    assert.ok(!pts.some((p) => p.month === "2026-01"));
    assert.ok(!pts.some((p) => p.average === 0), "and no zero was filled in");
  });

  it("43. the 6M window is measured from the application month", () => {
    // App month 2026-07 -> 2026-02 .. 2026-07 inclusive.
    const pts = trendWindowPoints(reviewTrend(history), "2026-07", 6);
    assert.deepEqual(pts.map((p) => p.month), ["2026-02", "2026-06"]);
  });

  it("44. the 12M window reaches back across the year boundary", () => {
    const pts = trendWindowPoints(reviewTrend(history), "2026-07", 12);
    assert.deepEqual(pts.map((p) => p.month), ["2025-12", "2026-02", "2026-06"]);
    assert.equal(monthsAgo("2025-12", "2026-07"), 7, "December is seven months back, not five");
  });

  it("45. the window's far edge is exclusive, its near edge inclusive", () => {
    const pts = [
      { month: "2026-01", average: 1 }, // 6 months back — outside a 6M window
      { month: "2026-02", average: 2 }, // 5 back — inside
      { month: "2026-07", average: 3 }, // 0 back — inside
    ];
    assert.deepEqual(
      trendWindowPoints(pts, "2026-07", 6).map((p) => p.month),
      ["2026-02", "2026-07"]
    );
  });

  it("46. a future month is excluded from any window", () => {
    const pts = [{ month: "2026-09", average: 4 }];
    assert.deepEqual(trendWindowPoints(pts, "2026-07", 12), []);
  });

  it("47. the two offered windows are the design's own 6M and 12M", () => {
    assert.deepEqual([...TREND_WINDOWS], [6, 12]);
  });
});

/* =========================================================================
 * 6. Distribution
 * ====================================================================== */

describe("Distribution — ten skills across five rating buckets", () => {
  it("48. always five buckets, ascending, one per rating value", () => {
    const d = reviewDistribution(skills());
    assert.deepEqual(d.map((b) => b.rating), [1, 2, 3, 4, 5]);
  });

  it("49. the counts sum to ten and the percentages to 100", () => {
    const d = reviewDistribution(skills({ listening: 5, speaking: 5, reading: 1 }));
    assert.equal(d.reduce((s, b) => s + b.count, 0), 10);
    assert.equal(d.reduce((s, b) => s + b.pct, 0), 100);
  });

  it("50. an all-fives review puts ten in one bucket and zero in the rest", () => {
    const d = reviewDistribution(skills({}, 5));
    assert.deepEqual(d.map((b) => b.count), [0, 0, 0, 0, 10]);
    assert.deepEqual(d.map((b) => b.pct), [0, 0, 0, 0, 100]);
  });

  it("51. a mixed review distributes exactly", () => {
    const d = reviewDistribution(skills({ listening: 1, speaking: 2, reading: 4, writing: 5 }));
    // six left at the base of 3
    assert.deepEqual(d.map((b) => b.count), [1, 1, 6, 1, 1]);
    assert.deepEqual(d.map((b) => b.pct), [10, 10, 60, 10, 10]);
  });

  it("52. zero-count buckets are kept in the data model", () => {
    const d = reviewDistribution(skills({}, 4));
    assert.equal(d.length, 5, "the UI may choose not to draw them; the data keeps them");
    assert.equal(d.filter((b) => b.count === 0).length, 4);
  });

  it("53. it is a distribution across SKILLS, never across students", () => {
    // The function's only argument is one review's ratings — a population
    // distribution is not expressible through this signature.
    assert.equal(reviewDistribution(skills()).reduce((s, b) => s + b.count, 0), SKILL_KEYS.length);
    assert.ok(!ANALYTICS.includes("students"), "no student collection is reachable from here");
  });

  it("54. the same review always produces the same buckets", () => {
    const s = skills({ listening: 2, grammar: 5 });
    assert.deepEqual(reviewDistribution(s), reviewDistribution(s));
  });
});

/* =========================================================================
 * 7. Heatmap
 * ====================================================================== */

describe("Heatmap — skills by review month", () => {
  const history = [
    { month: "2026-02", skills: skills({ listening: 2 }) },
    { month: "2026-06", skills: skills({ listening: 4 }) },
  ];

  it("55. rows are the ten canonical skills, in canonical order", () => {
    const h = buildReviewHeatmap(history);
    assert.deepEqual(h.rows.map((r) => r.key), [...SKILL_KEYS]);
  });

  it("56. columns are the review months, chronological", () => {
    const h = buildReviewHeatmap([history[1], history[0]]);
    assert.deepEqual(h.months, ["2026-02", "2026-06"]);
  });

  it("57. a calendar month without a review is not a column", () => {
    const h = buildReviewHeatmap(history);
    assert.equal(h.months.length, 2, "March, April and May are absent, not blank and not zero");
    for (const row of h.rows) {
      assert.equal(row.cells.length, 2, "one cell per real month");
      assert.ok(!row.cells.includes(0), "and no synthesised zero");
    }
  });

  it("58. each cell is the stored rating for that skill in that month", () => {
    const h = buildReviewHeatmap(history);
    const listening = h.rows.find((r) => r.key === "listening")!;
    assert.deepEqual(listening.cells, [2, 4]);
  });

  it("59. a skill missing from a legacy review is null, not zero", () => {
    const partial = [{ month: "2026-06", skills: { listening: 4 } as Record<string, number> }];
    const h = buildReviewHeatmap(partial);
    assert.deepEqual(h.rows.find((r) => r.key === "listening")!.cells, [4]);
    assert.deepEqual(h.rows.find((r) => r.key === "speaking")!.cells, [null]);
  });

  it("60. an empty history is an empty grid, not a grid of zeroes", () => {
    const h = buildReviewHeatmap([]);
    assert.deepEqual(h.months, []);
    assert.equal(h.rows.length, 10);
    for (const row of h.rows) assert.deepEqual(row.cells, []);
  });
});

/* =========================================================================
 * 8. Biggest improvement
 * ====================================================================== */

describe("Biggest improvement — strictly positive, or nothing", () => {
  it("61. the largest positive delta wins", () => {
    const prev = skills({ listening: 2, speaking: 3 });
    const latest = skills({ listening: 3, speaking: 5 });
    const best = biggestImprovement(latest, prev);
    assert.equal(best?.key, "speaking");
    assert.deepEqual([best?.from, best?.to, best?.delta], [3, 5, 2]);
  });

  it("62. an equal delta breaks on canonical SKILLS order", () => {
    // listening is index 0, writing index 3 — both improved by 2.
    const prev = skills({ listening: 2, writing: 2 });
    const latest = skills({ listening: 4, writing: 4 });
    assert.equal(biggestImprovement(latest, prev)?.key, "listening");
  });

  it("63. no previous review yields null", () => {
    assert.equal(biggestImprovement(skills({}, 5), null), null);
    assert.equal(biggestImprovement(skills({}, 5), undefined), null);
  });

  it("64. an entirely flat month yields null", () => {
    assert.equal(biggestImprovement(skills({}, 4), skills({}, 4)), null);
  });

  it("65. a month of declines yields null — never the least-bad fall", () => {
    const prev = skills({ listening: 5, speaking: 4 });
    const latest = skills({ listening: 2, speaking: 3 });
    assert.equal(biggestImprovement(latest, prev), null,
      "a smaller decline is not an improvement");
  });

  it("66. holding steady is not a rise", () => {
    // Nine skills fall 5 -> 1; grammar holds at 5. Nothing rose.
    assert.equal(biggestImprovement(skills({ grammar: 5 }, 1), skills({}, 5)), null);
  });

  it("66b. one genuine rise among nine falls is still the improvement", () => {
    // Nine fall 5 -> 1; grammar rises 3 -> 5. A bad month with one bright spot.
    assert.equal(
      biggestImprovement(skills({ grammar: 5 }, 1), skills({ grammar: 3 }, 5))?.key,
      "grammar"
    );
  });

  it("67. a skill missing on either side is skipped, not treated as zero", () => {
    const prev = { listening: 1 } as Record<string, number>;
    const latest = skills({ listening: 2 });
    const best = biggestImprovement(latest, prev);
    assert.equal(best?.key, "listening", "only the skill present on both sides is comparable");
    assert.equal(best?.delta, 1, "and no 3-from-nothing delta was invented");
  });
});

/* =========================================================================
 * 9. Teacher summary
 * ====================================================================== */

describe("Teacher summary — deterministic, and deliberately incomplete", () => {
  const prev = skills({ listening: 2, grammar: 4 });
  const latest = skills({ listening: 5, grammar: 4, writing: 1 });

  it("68. strongest is the highest-rated skill", () => {
    assert.equal(buildTeacherSummary(latest, prev).strongest?.key, "listening");
    assert.equal(buildTeacherSummary(latest, prev).strongest?.rating, 5);
  });

  it("69. weakest is the lowest-rated skill", () => {
    assert.equal(buildTeacherSummary(latest, prev).weakest?.key, "writing");
    assert.equal(buildTeacherSummary(latest, prev).weakest?.rating, 1);
  });

  it("70. both agree with the strengths/focus card, because both are rankSkills", () => {
    assert.ok(ANALYTICS.includes("rankSkills(latest, 1)"), "the same ranking, not a second one");
  });

  it("71. improvement is carried through, and is null without a previous review", () => {
    assert.equal(buildTeacherSummary(latest, prev).improvement?.key, "listening");
    assert.equal(buildTeacherSummary(latest, null).improvement, null);
  });

  it("72. ties break on canonical order in both directions", () => {
    const flat = skills({}, 3);
    const s = buildTeacherSummary(flat, null);
    assert.equal(s.strongest?.key, SKILL_KEYS[0]);
    assert.equal(s.weakest?.key, SKILL_KEYS[0]);
  });

  it("73. there is NO concern, NO achievement and NO generated prose", () => {
    const s = buildTeacherSummary(latest, prev) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(s).sort(), ["improvement", "strongest", "weakest"]);
    for (const forbidden of ["concern", "achievement", "aiSummary", "summaryText", "headline"]) {
      assert.ok(!(forbidden in s), `${forbidden} must not exist on the summary`);
      assert.ok(!ANALYTICS.includes(forbidden), `${forbidden} must not exist in the module`);
    }
  });

  it("74. a missing latest review yields an empty summary, not invented values", () => {
    assert.deepEqual(buildTeacherSummary(null, prev), {
      strongest: null, weakest: null, improvement: null,
    });
  });
});

/* =========================================================================
 * 10. The assembled set
 * ====================================================================== */

describe("buildReviewAnalytics — one object, so the surfaces cannot drift", () => {
  const history = [
    { month: "2026-04", skills: skills({ listening: 2 }) },
    { month: "2026-06", skills: skills({ listening: 5 }) },
  ];

  it("75. carries every chart the amendment approved, and nothing else", () => {
    const a = buildReviewAnalytics(history[1], history);
    assert.deepEqual(Object.keys(a).sort(), [
      "average", "distribution", "heatmap", "month", "radar", "summary", "trend",
    ]);
  });

  it("76. each part agrees with the helper that produced it", () => {
    const a = buildReviewAnalytics(history[1], history);
    assert.equal(a.month, "2026-06");
    assert.equal(a.average, reviewAverage(history[1].skills));
    assert.deepEqual(a.radar, buildReviewRadar(history[1], history));
    assert.deepEqual(a.distribution, reviewDistribution(history[1].skills));
    assert.deepEqual(a.trend, reviewTrend(history));
    assert.deepEqual(a.heatmap, buildReviewHeatmap(history));
    assert.deepEqual(a.summary, buildTeacherSummary(history[1].skills, history[0].skills));
  });

  it("77. a single-review student gets every chart, with the comparison absent", () => {
    const only = [history[0]];
    const a = buildReviewAnalytics(history[0], only);
    assert.equal(a.radar.previous, null);
    assert.equal(a.summary.improvement, null);
    assert.equal(a.trend.length, 1);
    assert.equal(a.heatmap.months.length, 1);
    assert.equal(a.distribution.length, 5, "a distribution needs no history");
  });

  it("78. carries no attendance or homework — those are another domain's", () => {
    const a = buildReviewAnalytics(history[1], history) as unknown as Record<string, unknown>;
    for (const forbidden of ["attendance", "homework", "attendancePct", "homeworkPct"]) {
      assert.ok(!(forbidden in a), `${forbidden} belongs to the report, not to the charts`);
    }
  });
});

/* =========================================================================
 * 11. Reads only — the write-surface proof
 * ====================================================================== */

describe("Gate 4.4B adds reads only", () => {
  it("79. the analytics module is pure — no db, no clock, no I/O, no React", () => {
    for (const forbidden of [
      "mongoose", "./models", "./db", "./repo", "server-only", "dbConnect",
      "fetch(", "await ", "async ", "node:fs", "process.env",
      "new Date", "Date.now", "CURRENT_MONTH", "TODAY_ISO",
      "useState", "useQuery", "React", "\"use client\"",
    ]) {
      assert.ok(!ANALYTICS.includes(forbidden), `review-analytics.ts references ${forbidden}`);
    }
  });

  it("80. it imports only the pure modules it needs", () => {
    const imports = [...ANALYTICS.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(imports)].sort(), ["./reviews"]);
  });

  it("81. it holds no presentation — no labels, no colours, no formatting", () => {
    for (const forbidden of ["perfColor", "perfLabel", "toFixed", "SKILL_LABEL", "var(--", "#"]) {
      assert.ok(!ANALYTICS.includes(forbidden), `${forbidden} is the UI's job, not the domain's`);
    }
  });

  it("82. the new finance helpers write nothing and read no other domain", () => {
    for (const forbidden of [
      "Model.", "updateOne", "insertOne", "deleteOne", "save(", "createIndex",
      "dbConnect", "server-only", "fetch(",
    ]) {
      assert.ok(!FINANCE.includes(forbidden), `finance.ts references ${forbidden}`);
    }
  });

  it("83. the Reviews service gained no write verb in this gate", () => {
    const writes = [...SERVICE.matchAll(/(\w+Model)\.(create|updateOne|updateMany|deleteOne|deleteMany|insertMany|replaceOne|bulkWrite|findOneAndUpdate)\(/g)]
      .map((m) => `${m[1]}.${m[2]}`);
    assert.deepEqual(writes.sort(), ["ReviewModel.create", "ReviewModel.updateOne"]);
  });

  it("84. no Student, Class, Lesson, Parent, Attendance or Homework WRITE exists in Reviews", () => {
    /* Gate 4.4C gave the Reviews service four more collections to READ, for the
     * two approved derived metrics. The write boundary is unmoved, and this is
     * the assertion of it: every verb applied to a model that is not
     * ReviewModel must be a read. */
    for (const forbidden of [
      "StudentModel.create", "StudentModel.updateOne", "StudentModel.deleteOne",
      "ClassModel.create", "ClassModel.updateOne",
      "LessonModel.create", "LessonModel.updateOne", "LessonModel.deleteOne",
      "AttendanceModel.create", "AttendanceModel.updateOne",
      "HomeworkModel.create", "HomeworkModel.updateOne", "HomeworkModel.deleteOne",
      "BillingModel.", "ParentModel.update", "ParentModel.create",
    ]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} must not appear in the Reviews service`);
    }
    // And the same rule stated positively, so a verb nobody thought to list fails too.
    const READS = ["find", "findOne", "countDocuments"];
    for (const [, model, verb] of SERVICE.matchAll(/\b(\w+Model)\.(\w+)/g)) {
      if (model === "ReviewModel") continue;
      assert.ok(READS.includes(verb), `${model}.${verb} is a write on another domain`);
    }
  });

  it("85. nothing here calls the Dashboard, the lifecycle or the reconciler", () => {
    for (const src of [ANALYTICS, FINANCE, SERVICE]) {
      for (const forbidden of [
        "advanceLessonLifecycle", "reconcile", "ensureRegularLessons", "/api/dashboard",
        "buildDashboard", "getAll(",
      ]) {
        assert.ok(!src.includes(forbidden), `${forbidden} must not be reachable`);
      }
    }
  });
});
