/* Write-side reconciliation — Sprint 5.6.2.
 *
 * Run with:  npm test
 *
 * These tests are PURE, like tests/recurrence.test.ts: they exercise the two
 * decisions the executor makes on its own — "is this plan safe to write?"
 * (`auditPlan`) and "may this class be deleted?" (`teachingHistoryOf`) — over
 * values constructed in memory. No database is opened.
 *
 * The audit is the answer to RECURRENCE_DESIGN §6 Phase 4 at WRITE time: the
 * planner is pure and correct over the values it was handed, and this asks the
 * different question of whether those values still describe the stored lessons.
 * It duplicates the planner's reasoning on purpose — a check derived from the
 * planner would agree with the planner even when both are wrong.
 *
 * Same fixed calendar as the planner's tests: app clock 2026-07-10 (a Friday). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileContext, type PlanAction, type ReconcileContext } from "../src/lib/recurrence";
import {
  auditPlan, hasTeachingHistory, teachingHistoryOf, RETIRE_ENABLED,
} from "../src/lib/reconciler";
import type { Klass, Lesson } from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const MONTHS = ["2026-07"];
const TUE = "2026-07-14";
const PAST_TUE = "2026-07-07";

const ctx = (o: Partial<ReconcileContext> = {}): ReconcileContext =>
  reconcileContext({ appClock: APP_CLOCK, months: MONTHS, ...o });

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Test Class", type: "group", level: "B1", fee: 1_500_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule: [{ day: 2, start: "10:08", duration: 45 }], color: "#d14242", ...over,
  };
}

function lesson(date: string, start: string, duration: number, over: Partial<Lesson> = {}): Lesson {
  return {
    id: `L-c1-${date}-${start.replace(":", "")}`,
    classId: "c1", type: "regular", date, start, duration,
    classroom: "Room A", status: "Upcoming", chargeable: false, fromId: null, notes: "",
    ...over,
  };
}

const update = (l: Lesson, to: { start: string; duration: number }): PlanAction => ({
  verb: "update", classId: l.classId, date: l.date, lessonId: l.id,
  from: { start: l.start, duration: l.duration }, to,
});
const retire = (l: Lesson): PlanAction => ({
  verb: "retire", classId: l.classId, date: l.date, lessonId: l.id,
  start: l.start, duration: l.duration, reason: "no slot",
});
const insert = (id: string, date: string, start: string): PlanAction => ({
  verb: "insert", classId: "c1", date, lessonId: id, start, duration: 45, status: "Upcoming",
});

const codes = (v: ReturnType<typeof auditPlan>) => v.map((x) => x.code).sort();

/* ------------------------------------------- the plan is audited before a write */

describe("auditPlan — the pre-write check (§6 Phase 4)", () => {
  it("passes a plan whose every target is still safe to touch", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 })], {
      klass: klass(), lessons: [l], ctx: ctx(),
    });
    assert.deepEqual(v, []);
  });

  it("a plan with no write verbs is vacuously safe", () => {
    const l = lesson(TUE, "14:30", 45, { notes: "call the parent" });
    const actions: PlanAction[] = [
      { verb: "keep", classId: "c1", date: TUE, lessonId: l.id, start: l.start, duration: l.duration },
      { verb: "strand", classId: "c1", date: TUE, lessonId: l.id, start: l.start, duration: l.duration,
        notes: l.notes ?? "", reason: "no slot" },
      { verb: "skip", classId: "c1", date: TUE, lessonId: l.id, start: l.start, duration: l.duration,
        frozen: ["attendance"] },
    ];
    assert.deepEqual(auditPlan(actions, { klass: klass(), lessons: [l], ctx: ctx() }), []);
  });

  it("aborts on an action dated before the app clock (§4)", () => {
    const l = lesson(PAST_TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 })], {
      klass: klass(), lessons: [l], ctx: ctx(),
    });
    assert.deepEqual(codes(v), ["past-date"]);
  });

  it("aborts when the target was frozen after the plan was made", () => {
    // The exact race the audit exists for: the teacher cancels a lesson while the
    // schedule edit that plans to move it is in flight.
    const planned = lesson(TUE, "14:30", 45);
    const stored = lesson(TUE, "14:30", 45, { status: "Cancelled" });
    const v = auditPlan([update(planned, { start: "10:08", duration: 45 })], {
      klass: klass(), lessons: [stored], ctx: ctx(),
    });
    assert.deepEqual(codes(v), ["lesson-frozen"]);
    assert.equal(v[0].detail, "not-upcoming");
  });

  it("aborts when an attendance record has appeared for the target", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 })], {
      klass: klass(), lessons: [l], ctx: ctx({ attended: new Set([l.id]) }),
    });
    assert.deepEqual(codes(v), ["lesson-frozen"]);
  });

  it("aborts rather than retire a lesson carrying notes (§5.9)", () => {
    const l = lesson(TUE, "14:30", 45, { notes: "Bring the unit 4 handout" });
    const v = auditPlan([retire(l)], { klass: klass(), lessons: [l], ctx: ctx() });
    assert.deepEqual(codes(v), ["retire-would-destroy-notes"]);
  });

  it("aborts when an insert would collide with an id that already exists", () => {
    // Enforcing this plan is a duplicate-key error, not merely a lost lesson —
    // the shape tests/recurrence.test.ts demonstrates for a missing Phase 0.
    const l = lesson(TUE, "10:08", 45);
    const v = auditPlan([insert(l.id, TUE, "10:08")], { klass: klass(), lessons: [l], ctx: ctx() });
    assert.deepEqual(codes(v), ["insert-collides-with-existing-lesson"]);
  });

  it("aborts when the target lesson has vanished", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 })], {
      klass: klass(), lessons: [], ctx: ctx(),
    });
    assert.deepEqual(codes(v), ["lesson-missing"]);
  });

  it("aborts on any write at all once the class is Archived (§5.8)", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 }), retire(l)], {
      klass: klass({ status: "Archived" }), lessons: [l], ctx: ctx(),
    });
    assert.deepEqual(codes(v), ["class-not-reconcilable"]);
  });

  it("aborts when the class has been deleted underneath the plan", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([retire(l)], { klass: null, lessons: [l], ctx: ctx() });
    assert.deepEqual(codes(v), ["class-not-reconcilable"]);
  });

  it("aborts when two write actions target one lesson", () => {
    const l = lesson(TUE, "14:30", 45);
    const v = auditPlan([update(l, { start: "10:08", duration: 45 }), retire(l)], {
      klass: klass(), lessons: [l], ctx: ctx(),
    });
    assert.deepEqual(codes(v), ["duplicate-action"]);
  });

  it("aborts when an action names another class's lesson", () => {
    const l = lesson(TUE, "14:30", 45, { classId: "c2" });
    const v = auditPlan([{ ...update(l, { start: "10:08", duration: 45 }), classId: "c2" }], {
      klass: klass(), lessons: [l], ctx: ctx(),
    });
    assert.equal(v.some((x) => x.code === "class-mismatch"), true);
  });

  it("aborts on a Makeup or Extra target — they are never reconciled (§2)", () => {
    const l = lesson(TUE, "14:30", 45, { id: "extra-1", type: "extra" });
    const v = auditPlan([retire(l)], { klass: klass(), lessons: [l], ctx: ctx() });
    assert.deepEqual(codes(v), ["lesson-not-regular"]);
  });
});

/* ------------------------------------------------- §2 — the class delete guard */

describe("teachingHistoryOf — deletion is blocked by history (§2)", () => {
  const none = { attendanceRecords: 0, billingRecords: 0 };

  it("a class with no lessons at all may be deleted", () => {
    assert.equal(hasTeachingHistory(teachingHistoryOf([], none, APP_CLOCK)), false);
  });

  it("a class with only future Upcoming lessons may be deleted", () => {
    const lessons = [lesson(TUE, "10:08", 45), lesson("2026-07-21", "10:08", 45)];
    assert.equal(hasTeachingHistory(teachingHistoryOf(lessons, none, APP_CLOCK)), false);
  });

  it("one past lesson blocks it", () => {
    const h = teachingHistoryOf([lesson(PAST_TUE, "10:08", 45, { status: "Completed" })], none, APP_CLOCK);
    assert.equal(h.pastLessons, 1);
    assert.equal(hasTeachingHistory(h), true);
  });

  it("a Completed or Cancelled lesson blocks it even when its date is future (§4)", () => {
    for (const status of ["Completed", "Cancelled"] as const) {
      const h = teachingHistoryOf([lesson(TUE, "10:08", 45, { status })], none, APP_CLOCK);
      assert.equal(hasTeachingHistory(h), true, `${status} is past in the sense that matters`);
    }
  });

  it("an attendance record blocks it — `attendances` has no cascade", () => {
    const h = teachingHistoryOf([], { attendanceRecords: 1, billingRecords: 0 }, APP_CLOCK);
    assert.equal(hasTeachingHistory(h), true);
  });

  it("a billing record blocks it", () => {
    const h = teachingHistoryOf([], { attendanceRecords: 0, billingRecords: 1 }, APP_CLOCK);
    assert.equal(hasTeachingHistory(h), true);
  });
});

/* ------------------------------------------------------ the sprint's promise */

describe("Sprint 5.6.2 guarantees", () => {
  it("retire is still report-only — the hard delete is not enabled", () => {
    // §8: 5.6.2 wires update and insert; retire waits for the §6 Phase 1 snapshot
    // and is turned on by 5.6.4. Flipping this constant is that sprint's job, and
    // this test is the reminder that the flip is a deliberate act.
    assert.equal(RETIRE_ENABLED, false);
  });
});
