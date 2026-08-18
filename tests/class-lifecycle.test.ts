/* Class lifecycle — Active → Ended → Archived.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here: Class, Lesson and Student values are built in
 * memory and the assertions are made against the PLAN the reconciler would produce
 * and the revenue the finance engine would report. No database is opened.
 *
 * Two of the rules under test are not expressible as a pure function call, because
 * they live in a Mongo query (`ensureRegularLessons`) or behind `server-only`
 * (`assertNoScheduleConflict`). Those are covered by asserting that the modules
 * DERIVE their rule from `TEACHING_CLASS_STATUSES` rather than restating it — the
 * same technique the §5.6.0 purity scan already uses. A test that only checked the
 * constant would pass while the query it is supposed to govern said something else.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10, a Friday:
 *   July 2026 Tuesdays  : 7 (past), 14, 21, 28 (future, CURRENT month)
 *   August 2026 Tuesdays: 4, 11, 18, 25          (future, NEXT month)
 *
 * The July/August split is load-bearing rather than cosmetic. An Ended class is
 * reconciled from next month onward, so a retirement assertion belongs on an
 * August date and a preservation assertion belongs on a July one. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isReconcilableClass, isTeachingClass, monthOf, planClass, reconcileContext,
  satisfiedRegularSlots, slotKey, summarizePlan,
  RECONCILABLE_CLASS_STATUSES, TEACHING_CLASS_STATUSES,
  type PlanAction, type ReconcileContext,
} from "../src/lib/recurrence";
import { auditPlan } from "../src/lib/reconciler";
import { computeRevenue } from "../src/lib/finance";
import { CLASS_STATUSES } from "../src/lib/schemas";
import type {
  AttendanceRecord, ClassStatus, Klass, Lesson, ScheduleSlot, Student,
} from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const MONTHS = ["2026-07", "2026-08"];
const TUE = ["2026-07-14", "2026-07-21", "2026-07-28"]; // future, current month
const AUG = ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"]; // future, next month
const PAST_TUE = "2026-07-07";
const TUE_SLOT: ScheduleSlot = { day: 2, start: "14:30", duration: 45 };

const ctx = (o: Partial<ReconcileContext> = {}): ReconcileContext =>
  reconcileContext({ appClock: APP_CLOCK, months: MONTHS, ...o });

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Test Class", type: "group", level: "B1", fee: 1_200_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule: [TUE_SLOT], color: "#d14242", ...over,
  };
}

function lesson(date: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id: `L-c1-${date}-1430`,
    classId: "c1", type: "regular", date, start: "14:30", duration: 45,
    classroom: "Room A", status: "Upcoming", chargeable: false, fromId: null, notes: "",
    ...over,
  };
}

const verbs = (actions: PlanAction[], verb: PlanAction["verb"]) => actions.filter((a) => a.verb === verb);
const dates = (actions: PlanAction[], verb: PlanAction["verb"]) => verbs(actions, verb).map((a) => a.date).sort();

/** A status the engine has never heard of, forced past the type system the way a
 * hand-edited document or a half-finished migration would arrive. */
const UNKNOWN = "Suspended" as unknown as ClassStatus;

/** A module's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. Several of these rules are documented in a comment that
 * quotes the very token the scan forbids — "this used to read `$ne: Archived`" is
 * exactly the sentence a naive scan would trip over. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")       // block comments, JSDoc included
    .replace(/(^|[^:])\/\/.*$/gm, "$1");     // line comments, sparing `https://`
}

/* ============================================================ the status set */

describe("the status set is defined once", () => {
  it("CLASS_STATUSES is the lifecycle, in lifecycle order", () => {
    assert.deepEqual([...CLASS_STATUSES], ["Active", "Ended", "Archived"]);
  });

  it("only Active teaches; Active and Ended are reconcilable", () => {
    assert.deepEqual([...TEACHING_CLASS_STATUSES], ["Active"]);
    assert.deepEqual([...RECONCILABLE_CLASS_STATUSES], ["Active", "Ended"]);
  });

  it("Ended and Archived are never interchangeable", () => {
    // The one property the whole design rests on: they agree about the present
    // (neither teaches) and disagree about the future (only Ended is reconciled,
    // and reconciling an Ended class is what clears its lessons).
    assert.equal(isTeachingClass("Ended"), isTeachingClass("Archived"));
    assert.notEqual(isReconcilableClass("Ended"), isReconcilableClass("Archived"));
  });
});

/* ================================================ 1, 2, 11 — generation */

describe("generation follows Active alone", () => {
  it("1. an Active class generates its window", () => {
    assert.equal(isTeachingClass("Active"), true);

    const plan = planClass(klass(), [], ctx());

    assert.deepEqual(dates(plan, "insert"), [...TUE, ...AUG]);
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 7, retire: 0, strand: 0, skip: 0 });
  });

  it("2. an Ended class generates nothing — no insert is even representable", () => {
    assert.equal(isTeachingClass("Ended"), false);

    // With lessons already retired, an Ended class's plan is empty rather than a
    // fresh set of inserts. This is the regression that matters most: if the top-up
    // still generated, ending a class would undo itself on the next list read.
    const plan = planClass(klass({ status: "Ended" }), [], ctx());

    assert.deepEqual(plan, []);
  });

  it("2b. the read-side top-up asks TEACHING_CLASS_STATUSES, not `not Archived`", () => {
    const src = code("src", "lib", "lessons.ts");
    assert.match(src, /status:\s*\{\s*\$in:\s*\[\.\.\.TEACHING_CLASS_STATUSES\]\s*\}/,
      "ensureRegularLessons must derive its filter from the teaching-status list");
    assert.equal(src.includes('$ne: "Archived"'), false,
      "`$ne: Archived` would generate for an Ended class and undo the transition");
  });

  it("11. reopening an Ended class makes it eligible again", () => {
    // Ended → Active is nothing more than the status going back: the same planner
    // pass that corrects a schedule edit re-derives the window from the schedule,
    // so no retired lesson has to be remembered or resurrected individually.
    const plan = planClass(klass({ status: "Active" }), [], ctx());

    assert.deepEqual(dates(plan, "insert"), [...TUE, ...AUG]);
  });
});

/* ================================================ 3–7 — the Ended transition */

describe("Active → Ended retires the future and nothing else", () => {
  // Retirement assertions live on AUGUST dates: an Ended class is reconciled from
  // next month onward, so July is the wrong month to prove a retirement with. The
  // current-month rule has its own suite below.
  it("3. every eligible future Upcoming lesson is retired", () => {
    const lessons = AUG.map((d) => lesson(d));

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.deepEqual(dates(plan, "retire"), AUG);
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 0, retire: 4, strand: 0, skip: 0 });
  });

  it("3b. an Ended plan can only skip, strand or retire", () => {
    // Structural, not incidental: the desired set is empty, so there is no slot for
    // an insert to fill or an update to move a lesson into.
    const lessons = [
      lesson(AUG[0]),
      lesson(AUG[1], { status: "Cancelled" }),
      lesson(AUG[2], { notes: "parent asked to be called" }),
    ];

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.ok(plan.length > 0, "the fixture must actually produce a plan");
    assert.deepEqual(verbs(plan, "insert"), []);
    assert.deepEqual(verbs(plan, "update"), []);
    assert.deepEqual(verbs(plan, "keep"), []);
  });

  it("4. Completed lessons are never touched — past or future-dated", () => {
    const lessons = [
      lesson(PAST_TUE, { status: "Completed" }),      // history
      lesson(AUG[0], { status: "Completed" }),        // future date, already taught
      lesson(AUG[1]),                                 // the only retire candidate
    ];

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.equal(plan.some((a) => a.date < APP_CLOCK), false, "the past never enters a plan (§4)");
    assert.deepEqual(dates(plan, "retire"), [AUG[1]]);
    assert.deepEqual(dates(plan, "skip"), [AUG[0]], "a Completed lesson is skipped, not retired");
  });

  it("5. a lesson with an attendance record survives", () => {
    const lessons = AUG.map((d) => lesson(d));
    const attended = new Set([lessons[0].id]);

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx({ attended }));

    assert.deepEqual(dates(plan, "skip"), [AUG[0]]);
    assert.deepEqual(dates(plan, "retire"), AUG.slice(1));
    assert.equal(verbs(plan, "retire").some((a) => a.lessonId === lessons[0].id), false,
      "retiring it would orphan the attendance record — attendances have no cascade");
  });

  it("6. a lesson referenced by homework survives", () => {
    const lessons = AUG.map((d) => lesson(d));
    const homeworked = new Set([lessons[1].id]);

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx({ homeworked }));

    assert.deepEqual(dates(plan, "skip"), [AUG[1]]);
    assert.deepEqual(dates(plan, "retire"), [AUG[0], AUG[2], AUG[3]]);
  });

  it("6b. a lesson carrying teacher's notes is stranded, never retired (§5.9)", () => {
    const lessons = [lesson(AUG[0], { notes: "moved to the small room" }), lesson(AUG[1])];

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.deepEqual(dates(plan, "strand"), [AUG[0]]);
    assert.deepEqual(dates(plan, "retire"), [AUG[1]]);
  });

  it("6c. a deliberately rescheduled lesson survives the transition", () => {
    const moved = lesson(AUG[2], {
      originalDate: AUG[1], originalStart: "14:30", originalDuration: 45,
      rescheduledAt: "2026-07-09T10:00:00.000Z",
    });

    const plan = planClass(klass({ status: "Ended" }), [moved], ctx());

    assert.deepEqual(dates(plan, "skip"), [AUG[2]]);
    assert.deepEqual(verbs(plan, "retire"), []);
  });

  it("7. nothing but Lesson documents is ever written", () => {
    // Attendance, Homework and Billing have no cascade and are read-only to the
    // reconciler. Asserted against the executor's source, because a plan cannot
    // show what it does NOT touch.
    const src = code("src", "lib", "reconciler.ts");
    const writes = [...src.matchAll(
      /(\w*Model)\.(bulkWrite|updateOne|updateMany|deleteOne|deleteMany|insertOne|insertMany|create|findOneAndUpdate|findOneAndDelete)\b/g
    )];

    assert.ok(writes.length > 0, "the scan found no writes at all — the pattern has drifted");
    for (const m of writes) {
      assert.equal(m[1], "LessonModel", `the reconciler must not write ${m[1]} (found ${m[0]})`);
    }
  });

  it("7b. the plan only ever names Regular lessons of the class being ended", () => {
    const lessons = [
      lesson(AUG[0]),
      { ...lesson(AUG[1]), id: "M-makeup-1", type: "makeup" as const },
      { ...lesson(AUG[2]), id: "X-extra-1", type: "extra" as const },
    ];

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.deepEqual(plan.map((a) => a.lessonId), [lessons[0].id],
      "Makeup and Extra are never generated, never reconciled and never retired (§2)");
  });
});

/* ================================================ 8, 9 — historical revenue */

describe("historical revenue outlives the class's status", () => {
  const MONTH = "2026-06";
  const JUNE = ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"];

  function student(): Student {
    return {
      id: "s1", first: "Mai", last: "Nguyen", name: "Mai Nguyen", initials: "MN",
      birthday: "2014-03-02", age: 12, school: "Le Loi", grade: 6, gradeLabel: "Grade 6",
      parentId: "", parentName: "", phone: "", status: "Active", notes: "",
      joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
      avatar: null, avatarColor: "#0284c7",
    };
  }

  const taught = (status: ClassStatus) => ({
    classes: [klass({ status, studentIds: ["s1"] })],
    students: [student()],
    lessons: JUNE.map((d) => lesson(d, { status: "Completed" })),
    attendance: [] as AttendanceRecord[],
  });

  it("8. a class taught in June still reports June revenue after it Ends in July", () => {
    const active = computeRevenue(MONTH, taught("Active"));
    const ended = computeRevenue(MONTH, taught("Ended"));

    assert.equal(active.total, 1_200_000, "four completed lessons at fee/4 for one student");
    assert.deepEqual(ended, active, "ending a class in July cannot change what June earned");
  });

  it("9. …and still reports it after the class is Archived in August", () => {
    const archived = computeRevenue(MONTH, taught("Archived"));

    // This is RECURRENCE_DESIGN §9.1. Before the fix `computeRevenue` skipped the
    // class outright, so archiving silently rewrote every closed month.
    assert.equal(archived.total, 1_200_000);
    assert.deepEqual(archived.perClass.map((r) => r.classId), ["c1"]);
  });

  it("9b. no status lets a future lesson leak into revenue", () => {
    for (const status of CLASS_STATUSES) {
      const upcoming = {
        classes: [klass({ status, studentIds: ["s1"] })],
        students: [student()],
        lessons: JUNE.map((d) => lesson(d)), // Upcoming, not Completed
        attendance: [] as AttendanceRecord[],
      };
      assert.equal(computeRevenue(MONTH, upcoming).total, 0, `${status} counted an Upcoming lesson`);
    }
  });

  it("9c. revenue reads no class status at all", () => {
    const src = code("src", "lib", "finance.ts");
    assert.equal(/c\.status/.test(src), false,
      "computeRevenue must derive from lessons; reading the class's current status is §9.1");
  });
});

/* ================================================ 10 — schedule slots */

describe("only a teaching class holds its schedule slots", () => {
  it("10. Ended releases its slots, exactly as Archived does", () => {
    assert.equal(isTeachingClass("Ended"), false);
    assert.equal(isTeachingClass("Archived"), false);
    assert.equal(isTeachingClass("Active"), true);
  });

  it("10b. the conflict rule and the availability query both derive from that list", () => {
    const src = code("src", "lib", "classes.ts");
    assert.match(src, /if\s*\(!isTeachingClass\(input\.status\)\)\s*return;/,
      "assertNoScheduleConflict must skip any class that is not teaching");
    assert.equal(
      src.split("$in: [...TEACHING_CLASS_STATUSES]").length - 1, 2,
      "both the conflict check and the availability preview must ask the same question"
    );
    assert.equal(/status:\s*"Active"\s*,/.test(src), false,
      "no hardcoded Active literal may survive beside the derived queries");
  });
});

/* ================================================ 12 — Archived is unchanged */

describe("12. Archived keeps its existing meaning", () => {
  it("produces no actions of any verb, however stale its schedule (§5.8, ADR-002)", () => {
    const stale = klass({ status: "Archived", schedule: [{ day: 3, start: "09:00", duration: 60 }] });

    assert.deepEqual(planClass(klass({ status: "Archived" }), TUE.map((d) => lesson(d)), ctx()), []);
    assert.deepEqual(planClass(stale, TUE.map((d) => lesson(d)), ctx()), []);
  });

  it("keeps its future lessons where Ended would have retired them", () => {
    // The single assertion that proves the two statuses were not collapsed. Uses
    // next-month lessons, because those are the ones Ended actually acts on.
    const lessons = AUG.map((d) => lesson(d));

    const archived = planClass(klass({ status: "Archived" }), lessons, ctx());
    const ended = planClass(klass({ status: "Ended" }), lessons, ctx());

    assert.deepEqual(archived, []);
    assert.equal(verbs(ended, "retire").length, 4);
  });

  it("the current-month stopgap did not leak into Archived", () => {
    // Archived produces nothing in ANY month — that was true before the stopgap and
    // must stay true. The rule added is Ended-only.
    for (const lessons of [TUE.map((d) => lesson(d)), AUG.map((d) => lesson(d))]) {
      assert.deepEqual(planClass(klass({ status: "Archived" }), lessons, ctx()), []);
    }
  });

  it("a write aimed at an Archived class is still refused by the audit", () => {
    const l = lesson(TUE[0]);
    const v = auditPlan(
      [{ verb: "retire", classId: "c1", date: TUE[0], lessonId: l.id, start: l.start, duration: l.duration, reason: "x" }],
      { klass: klass({ status: "Archived" }), lessons: [l], ctx: ctx() }
    );

    assert.deepEqual(v.map((x) => x.code), ["class-not-reconcilable"]);
  });

  it("a retirement on an Ended class passes the same audit", () => {
    const l = lesson(TUE[0]);
    const v = auditPlan(
      [{ verb: "retire", classId: "c1", date: TUE[0], lessonId: l.id, start: l.start, duration: l.duration, reason: "ended" }],
      { klass: klass({ status: "Ended" }), lessons: [l], ctx: ctx() }
    );

    assert.deepEqual(v, [], "ending a class must not be blocked by the guard that blocks archiving");
  });
});

/* ================================================ 13 — reopening is not a fork */

describe("13. reopening an Ended class creates no duplicates", () => {
  it("a lesson that survived the transition keeps its slot on the way back", () => {
    // The realistic shape: c1 ended holding four August Tuesdays. Three retired;
    // the first was Cancelled, so it was frozen and stayed. Reopening must fill the
    // three gaps and must NOT put a second lesson on top of the cancelled one —
    // which would fork the series and silently undo the cancellation (§5.6).
    const survivor = lesson(AUG[0], { status: "Cancelled" });

    const plan = planClass(klass({ status: "Active" }), [survivor], ctx());

    assert.deepEqual(dates(plan, "insert"), [...TUE, ...AUG.slice(1)]);
    assert.deepEqual(dates(plan, "skip"), [AUG[0]]);
    assert.equal(verbs(plan, "insert").some((a) => a.date === AUG[0]), false);
  });

  it("the read-side top-up agrees — the survivor's slot is already satisfied", () => {
    const survivor = lesson(AUG[0], { status: "Cancelled" });

    const satisfied = satisfiedRegularSlots([survivor]);

    assert.equal(satisfied.has(slotKey("c1", AUG[0], "14:30")), true);
    assert.equal(satisfied.has(slotKey("c1", AUG[1], "14:30")), false);
  });

  it("ending and reopening twice is stable", () => {
    // Start from a fully generated window: July (current month) plus August.
    const start = [...TUE, ...AUG].map((d) => lesson(d));

    // End: only August retires — July is out of scope for an Ended class.
    const ending = planClass(klass({ status: "Ended" }), start, ctx());
    const retired = new Set(verbs(ending, "retire").map((a) => a.lessonId));
    const afterEnd = start.filter((l) => !retired.has(l.id));
    assert.deepEqual(afterEnd.map((l) => l.date), TUE, "the current month survives intact");

    // …reopen, and only the retired August dates come back — no July duplicates.
    const reopened = planClass(klass({ status: "Active" }), afterEnd, ctx());
    assert.deepEqual(dates(reopened, "insert"), AUG);
    assert.deepEqual(dates(reopened, "keep"), TUE);

    // Ending again retires exactly what reopening created — no drift either way.
    const regenerated = [...afterEnd, ...AUG.map((d) => lesson(d))];
    assert.deepEqual(dates(planClass(klass({ status: "Ended" }), regenerated, ctx()), "retire"), AUG);
  });
});

/* ======================= the current-month stopgap (revenue denominator) =====
 *
 * Ending a class must not shrink the number of Regular lessons stored for the
 * CURRENT month, because `computeRevenue` divides the monthly fee by exactly that
 * count. These tests pin the rule from both ends: the planner leaves this month
 * alone, and the revenue figure consequently does not move.
 *
 * `computeRevenue` itself is deliberately untouched — the fix is upstream of it,
 * and 9c above already asserts it reads no class status at all. */

describe("an Ended class does not touch the current calendar month", () => {
  it("mid-month end, 8 lessons (4 past + 4 upcoming): the 4 upcoming are preserved", () => {
    // The exact scenario from the audit, on the app clock's own month.
    const past = ["2026-07-01", "2026-07-03", "2026-07-07", "2026-07-09"]
      .map((d) => lesson(d, { status: "Completed" }));
    const upcoming = ["2026-07-14", "2026-07-16", "2026-07-21", "2026-07-23"].map((d) => lesson(d));

    const plan = planClass(klass({ status: "Ended" }), [...past, ...upcoming], ctx());

    assert.deepEqual(plan, [], "nothing in the current month may be planned for an Ended class");
    assert.deepEqual(verbs(plan, "retire"), []);
  });

  it("eligible lessons in the NEXT month are still retired", () => {
    // Same class, same transition — the rule is a month boundary, not a switch that
    // turns Ended retirement off.
    const thisMonth = TUE.map((d) => lesson(d));
    const nextMonth = AUG.map((d) => lesson(d));

    const plan = planClass(klass({ status: "Ended" }), [...thisMonth, ...nextMonth], ctx());

    assert.deepEqual(dates(plan, "retire"), AUG);
    assert.equal(plan.some((a) => monthOf(a.date) === "2026-07"), false);
  });

  it("past lessons are never retired, in any month", () => {
    const lessons = [
      lesson("2026-06-30", { status: "Completed" }), // previous month, in window
      lesson(PAST_TUE, { status: "Completed" }),     // current month, behind the clock
      lesson(AUG[0]),                                // the only eligible candidate
    ];

    const plan = planClass(klass({ status: "Ended" }), lessons, ctx({ months: ["2026-06", ...MONTHS] }));

    assert.equal(plan.some((a) => a.date < APP_CLOCK), false);
    assert.deepEqual(dates(plan, "retire"), [AUG[0]]);
  });

  it("the current-month revenue denominator is unchanged by ending the class", () => {
    // fee 1,000,000 · 8 regular lessons in July · 4 taught, 4 still to come · one
    // enrolled student, all Present. Before the stopgap this reported 500,000 and
    // then 1,000,000 — the full monthly fee for half a month's teaching.
    const taughtDates = ["2026-07-01", "2026-07-03", "2026-07-07", "2026-07-09"];
    const upcomingDates = ["2026-07-14", "2026-07-16", "2026-07-21", "2026-07-23"];
    const stored = [
      ...taughtDates.map((d) => lesson(d, { status: "Completed" })),
      ...upcomingDates.map((d) => lesson(d)),
    ];

    const student: Student = {
      id: "s1", first: "Mai", last: "Nguyen", name: "Mai Nguyen", initials: "MN",
      birthday: "2014-03-02", age: 12, school: "Le Loi", grade: 6, gradeLabel: "Grade 6",
      parentId: "", parentName: "", phone: "", status: "Active", notes: "",
      joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
      avatar: null, avatarColor: "#0284c7",
    };
    const finance = (status: ClassStatus, lessons: Lesson[]) => ({
      classes: [klass({ status, fee: 1_000_000, studentIds: ["s1"] })],
      students: [student],
      lessons,
      attendance: [] as AttendanceRecord[],
    });

    const before = computeRevenue("2026-07", finance("Active", stored));

    // End the class and APPLY whatever the planner decided, exactly as the executor
    // would (retire === deleteOne, so a retired lesson leaves the collection).
    const plan = planClass(klass({ status: "Ended", fee: 1_000_000, studentIds: ["s1"] }), stored, ctx());
    const retired = new Set(verbs(plan, "retire").map((a) => a.lessonId));
    const after = computeRevenue("2026-07", finance("Ended", stored.filter((l) => !retired.has(l.id))));

    assert.equal(retired.size, 0, "no current-month lesson may be deleted");
    assert.equal(before.total, 500_000, "4 of 8 lessons taught = half the monthly fee");
    assert.equal(after.total, 500_000, "ending the class must not change what July earned");
    assert.deepEqual(after, before);
  });

  it("…and the same holds when next month's lessons DO get retired", () => {
    // Retiring August must not disturb July's denominator either — the two months
    // are counted independently by `inMonth`.
    const july = [
      ...["2026-07-01", "2026-07-07"].map((d) => lesson(d, { status: "Completed" })),
      ...["2026-07-14", "2026-07-21"].map((d) => lesson(d)),
    ];
    const stored = [...july, ...AUG.map((d) => lesson(d))];

    const student: Student = {
      id: "s1", first: "Mai", last: "Nguyen", name: "Mai Nguyen", initials: "MN",
      birthday: "2014-03-02", age: 12, school: "Le Loi", grade: 6, gradeLabel: "Grade 6",
      parentId: "", parentName: "", phone: "", status: "Active", notes: "",
      joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
      avatar: null, avatarColor: "#0284c7",
    };
    const finance = (lessons: Lesson[]) => ({
      classes: [klass({ status: "Ended", fee: 1_000_000, studentIds: ["s1"] })],
      students: [student],
      lessons,
      attendance: [] as AttendanceRecord[],
    });

    const plan = planClass(klass({ status: "Ended", fee: 1_000_000, studentIds: ["s1"] }), stored, ctx());
    const retired = new Set(verbs(plan, "retire").map((a) => a.lessonId));
    const survivors = stored.filter((l) => !retired.has(l.id));

    assert.equal(retired.size, 4, "all four August lessons retire");
    assert.equal(computeRevenue("2026-07", finance(stored)).total, 500_000);
    assert.equal(computeRevenue("2026-07", finance(survivors)).total, 500_000);
  });

  it("reconciliation stays idempotent — a second pass plans nothing new", () => {
    const stored = [...TUE.map((d) => lesson(d)), ...AUG.map((d) => lesson(d))];
    const ended = klass({ status: "Ended" });

    const first = planClass(ended, stored, ctx());
    const retired = new Set(verbs(first, "retire").map((a) => a.lessonId));
    const survivors = stored.filter((l) => !retired.has(l.id));

    const second = planClass(ended, survivors, ctx());
    const third = planClass(ended, survivors, ctx());

    assert.equal(verbs(first, "retire").length, 4);
    assert.deepEqual(second, [], "everything eligible was already retired");
    assert.deepEqual(third, second, "and it stays that way");
  });

  it("the rule is a month comparison, not a hardcoded month", () => {
    // Move the app clock into August and the boundary moves with it: August becomes
    // the protected month and September becomes eligible.
    const augClock = ctx({ appClock: "2026-08-10", months: ["2026-08", "2026-09"] });
    const lessons = [lesson("2026-08-18"), lesson("2026-09-01")];

    const plan = planClass(klass({ status: "Ended" }), lessons, augClock);

    assert.deepEqual(dates(plan, "retire"), ["2026-09-01"]);
  });
});

/* ================================================ 14 — unknown status */

describe("14. an unrecognised status fails closed", () => {
  it("is neither teaching nor reconcilable", () => {
    assert.equal(isTeachingClass(UNKNOWN), false);
    assert.equal(isReconcilableClass(UNKNOWN), false);
    assert.equal(isTeachingClass(""), false);
    assert.equal(isReconcilableClass("active"), false, "the check is exact, not case-insensitive");
  });

  it("plans nothing — it neither generates nor retires", () => {
    // Both directions matter. Generating would invent lessons for a class nobody
    // has decided about; retiring would delete on the strength of a value the
    // engine does not understand.
    assert.deepEqual(planClass(klass({ status: UNKNOWN }), [], ctx()), []);
    assert.deepEqual(planClass(klass({ status: UNKNOWN }), TUE.map((d) => lesson(d)), ctx()), []);
  });

  it("is refused by the audit even if a plan somehow named it", () => {
    const l = lesson(TUE[0]);
    const v = auditPlan(
      [{ verb: "retire", classId: "c1", date: TUE[0], lessonId: l.id, start: l.start, duration: l.duration, reason: "x" }],
      { klass: klass({ status: UNKNOWN }), lessons: [l], ctx: ctx() }
    );

    assert.deepEqual(v.map((x) => x.code), ["class-not-reconcilable"]);
  });

  it("a missing class is refused the same way", () => {
    const l = lesson(TUE[0]);
    const v = auditPlan(
      [{ verb: "retire", classId: "c1", date: TUE[0], lessonId: l.id, start: l.start, duration: l.duration, reason: "x" }],
      { klass: null, lessons: [l], ctx: ctx() }
    );

    assert.deepEqual(v.map((x) => x.code), ["class-not-reconcilable"]);
  });
});
