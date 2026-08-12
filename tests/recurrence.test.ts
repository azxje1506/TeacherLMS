/* Reconciliation scenario tests — Sprint 5.6.0 scaffolding.
 *
 * Run with:  npm test
 *
 * These tests are PURE. They construct Class and Lesson values in memory and
 * assert on the PLAN the reconciler would produce; no database is opened, no
 * fixture is loaded, and nothing is written — which is also the point of the
 * last test in this file.
 *
 * One case per row of RECURRENCE_DESIGN.md §2, plus the two subtle cases §2 does
 * not state directly (a cancelled lesson's slot must not re-fill, §5.6; a
 * rescheduled lesson must survive a later schedule edit, §5.4). Sprint 5.6.4
 * re-runs the same list against the enforcing reconciler, so the scenarios are
 * written here once and stay put.
 *
 * Fixed calendar used throughout — the app clock is 2026-07-10 (a Friday):
 *   July 2026 Tuesdays  : 7, 14, 21, 28   (the 7th is past)
 *   July 2026 Wednesdays: 1, 8, 15, 22, 29
 * so a Tuesday class has exactly three reconcilable dates: 14, 21 and 28. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  effectiveOrigin, findArchivedClassLessons, findLegacyReschedules, findOrphanedLessons,
  isManuallyEdited, originFromId, planClass, planWouldWrite, reconcileContext, summarizePlan,
  type PlanAction, type ReconcileContext,
} from "../src/lib/recurrence";
import type { Klass, Lesson, ScheduleSlot } from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const MONTHS = ["2026-07"];
const TUE = ["2026-07-14", "2026-07-21", "2026-07-28"]; // future Tuesdays
const WED = ["2026-07-15", "2026-07-22", "2026-07-29"]; // future Wednesdays
const PAST_TUE = "2026-07-07";

const ctx = (o: Partial<ReconcileContext> = {}): ReconcileContext =>
  reconcileContext({ appClock: APP_CLOCK, months: MONTHS, ...o });

function klass(schedule: ScheduleSlot[], over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Test Class", type: "group", level: "B1", fee: 1_500_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule, color: "#d14242", ...over,
  };
}

/** A generated Regular lesson, in the id format the generator mints. */
function lesson(date: string, start: string, duration: number, over: Partial<Lesson> = {}): Lesson {
  return {
    id: `L-c1-${date}-${start.replace(":", "")}`,
    classId: "c1", type: "regular", date, start, duration,
    classroom: "Room A", status: "Upcoming", chargeable: false, fromId: null, notes: "",
    ...over,
  };
}

const verbs = (actions: PlanAction[], verb: PlanAction["verb"]) => actions.filter((a) => a.verb === verb);
const ids = (actions: PlanAction[], verb: PlanAction["verb"]) => verbs(actions, verb).map((a) => a.lessonId).sort();

/* ------------------------------------------------- §2 — editing the schedule */

describe("§2 schedule edits", () => {
  it("change start time — updates future lessons in place, keeping their ids", () => {
    const c = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const lessons = TUE.map((d) => lesson(d, "14:30", 45));

    const plan = planClass(c, lessons, ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 3, insert: 0, retire: 0, strand: 0, skip: 0 });
    assert.deepEqual(ids(plan, "update"), lessons.map((l) => l.id).sort(), "ids are preserved");
    for (const a of verbs(plan, "update")) {
      assert.equal(a.verb === "update" && a.to.start, "10:08");
      assert.equal(a.verb === "update" && a.to.duration, 45);
    }
  });

  it("change duration only — updates in place (today's silent-wrong-end-time case)", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 60 }]);
    const plan = planClass(c, TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 3, insert: 0, retire: 0, strand: 0, skip: 0 });
    for (const a of verbs(plan, "update")) {
      assert.equal(a.verb === "update" && a.to.duration, 60);
    }
  });

  it("change weekday — retires the old weekday and inserts the new one (no identity carried)", () => {
    const c = klass([{ day: 3, start: "14:30", duration: 45 }]);
    const plan = planClass(c, TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 3, retire: 3, strand: 0, skip: 0 });
    assert.deepEqual(verbs(plan, "insert").map((a) => a.date).sort(), WED);
    assert.deepEqual(verbs(plan, "retire").map((a) => a.date).sort(), TUE);
  });

  it("delete one weekday — retires its future lessons and inserts nothing", () => {
    const plan = planClass(klass([]), TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 0, retire: 3, strand: 0, skip: 0 });
    assert.equal(
      verbs(plan, "retire").every((a) => a.verb === "retire" && a.reason.includes("no longer teaches")),
      true
    );
  });

  it("add one weekday — inserts across the window and touches nothing existing", () => {
    const c = klass([
      { day: 2, start: "14:30", duration: 45 },
      { day: 3, start: "09:00", duration: 60 },
    ]);
    const plan = planClass(c, TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 3, update: 0, insert: 3, retire: 0, strand: 0, skip: 0 });
    assert.deepEqual(verbs(plan, "insert").map((a) => a.date).sort(), WED);
  });

  // ADR-002 reversed this case. It originally retired every future Upcoming
  // lesson; it now asserts the opposite, and the reason is the point of the ADR:
  // an Archived class has withdrawn its intent, so a desired set of [] would make
  // every future lesson an orphan BY DEFINITION rather than by evidence — one
  // class-level decision re-expressed as N hard deletes, through a code path that
  // is supposed to fail closed.
  it("archive class — produces NO actions of any verb (§5.8, ADR-002)", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }], { status: "Archived" });
    const lessons = TUE.map((d) => lesson(d, "14:30", 45));

    const plan = planClass(c, lessons, ctx());

    assert.deepEqual(plan, [], "an archived class is excluded before the algorithm begins");
    assert.equal(planWouldWrite(plan), false);
  });

  it("archive class — a stale schedule still produces nothing to update or retire", () => {
    // The dangerous shape: the fossil schedule disagrees with every stored lesson.
    const c = klass([{ day: 3, start: "09:00", duration: 60 }], { status: "Archived" });
    const plan = planClass(c, TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(plan, []);
  });

  it("archived classes are reported instead, so the lessons stay visible (§5.8)", () => {
    const archived = klass([{ day: 2, start: "14:30", duration: 45 }], { status: "Archived" });
    const lingering = [
      lesson(PAST_TUE, "14:30", 45, { status: "Completed" }), // past — not lingering
      ...TUE.map((d) => lesson(d, "14:30", 45)),
    ];

    const found = findArchivedClassLessons([archived], lingering, APP_CLOCK);

    assert.equal(found.length, 1);
    assert.deepEqual(found[0].lessons.map((l) => l.date), TUE);
  });

  it("restore class — regenerates the future from the current schedule", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }], { status: "Active" });
    const plan = planClass(c, [], ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 3, retire: 0, strand: 0, skip: 0 });
    assert.deepEqual(verbs(plan, "insert").map((a) => a.date).sort(), TUE);
  });

  it("an unchanged schedule is a no-op — every lesson is kept, nothing would be written", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }]);
    const plan = planClass(c, TUE.map((d) => lesson(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 3, update: 0, insert: 0, retire: 0, strand: 0, skip: 0 });
    assert.equal(planWouldWrite(plan), false);
  });
});

/* ------------------------------------------- §4 — the past is never in scope */

describe("§4 the past is immutable", () => {
  it("a past lesson is never planned, however wrong its slot looks", () => {
    const c = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const lessons = [lesson(PAST_TUE, "14:30", 45), ...TUE.map((d) => lesson(d, "10:08", 45))];

    const plan = planClass(c, lessons, ctx());

    assert.equal(plan.some((a) => a.date < APP_CLOCK), false);
    assert.deepEqual(summarizePlan(plan), { keep: 3, update: 0, insert: 0, retire: 0, strand: 0, skip: 0 });
  });

  it("a Completed lesson carrying a FUTURE date is frozen, and keeps its slot", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }]);
    const lessons = [
      lesson(TUE[0], "14:30", 45, { status: "Completed" }),
      ...TUE.slice(1).map((d) => lesson(d, "14:30", 45)),
    ];

    const plan = planClass(c, lessons, ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 2, update: 0, insert: 0, retire: 0, strand: 0, skip: 1 });
  });
});

/* ------------------------------------------------ §5.6 — slot consumption */

describe("§5.6 a frozen lesson still occupies its slot", () => {
  it("a cancelled lesson is not resurrected by an insert on the next pass", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }]);
    const lessons = [
      lesson(TUE[0], "14:30", 45, { status: "Cancelled" }),
      ...TUE.slice(1).map((d) => lesson(d, "14:30", 45)),
    ];

    const plan = planClass(c, lessons, ctx());

    assert.equal(verbs(plan, "insert").length, 0, "the cancelled Tuesday must not re-fill");
    assert.deepEqual(summarizePlan(plan), { keep: 2, update: 0, insert: 0, retire: 0, strand: 0, skip: 1 });
  });

  it("a cancelled lesson does not block the OTHER slots on the same day", () => {
    const c = klass([
      { day: 2, start: "09:00", duration: 45 },
      { day: 2, start: "14:30", duration: 45 },
    ]);
    const lessons = [lesson(TUE[0], "14:30", 45, { status: "Cancelled" })];

    const plan = planClass(c, lessons, ctx());
    const firstTuesday = plan.filter((a) => a.date === TUE[0]);

    assert.deepEqual(
      verbs(firstTuesday, "insert").map((a) => a.verb === "insert" && a.start),
      ["09:00"]
    );
    assert.equal(verbs(firstTuesday, "skip").length, 1);
  });
});

/* -------------------------------------------- §5.4 — rescheduled lessons */

describe("§5.4 rescheduled lessons are frozen", () => {
  const moved = (): Lesson =>
    lesson(TUE[0], "10:00", 45, {
      // moved off Tuesday the 14th onto Thursday the 16th
      date: "2026-07-16",
      originalDate: TUE[0],
      originalStart: "10:00",
      originalDuration: 45,
      rescheduledAt: "2026-07-09T08:00:00.000Z",
    });

  it("is skipped where it now sits, and the slot it vacated is not refilled", () => {
    const c = klass([{ day: 2, start: "10:00", duration: 45 }]);
    const lessons = [moved(), ...TUE.slice(1).map((d) => lesson(d, "10:00", 45))];

    const plan = planClass(c, lessons, ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 2, update: 0, insert: 0, retire: 0, strand: 0, skip: 1 });
    assert.equal(verbs(plan, "skip")[0].date, "2026-07-16");
  });

  it("survives a later schedule edit untouched", () => {
    const c = klass([{ day: 2, start: "16:00", duration: 45 }]); // start edited after the move
    const lessons = [moved(), ...TUE.slice(1).map((d) => lesson(d, "10:00", 45))];

    const plan = planClass(c, lessons, ctx());
    const movedAction = plan.find((a) => a.lessonId === moved().id);

    assert.equal(movedAction?.verb, "skip");
    assert.deepEqual(ids(plan, "update"), TUE.slice(1).map((d) => `L-c1-${d}-1000`).sort());
    // The 14th gets nothing new: its session was MOVED, not cancelled, so the slot
    // it vacated stays claimed even though the schedule's time changed underneath
    // it. Re-inserting there would give the teacher the lesson twice.
    assert.equal(verbs(plan, "insert").length, 0);
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 2, insert: 0, retire: 0, strand: 0, skip: 1 });
  });

  it("a LEGACY move (no stored origin) is protected by the id fallback — §6 Phase 0", () => {
    const c = klass([{ day: 2, start: "10:00", duration: 45 }]);
    // Generated for Tuesday the 14th, moved to Thursday the 16th before the origin
    // fields existed: only the id still remembers where it came from.
    const legacy = lesson(TUE[0], "10:00", 45, { date: "2026-07-16" });
    const lessons = [legacy, ...TUE.slice(1).map((d) => lesson(d, "10:00", 45))];

    // The fallback is an explicit opt-in since Phase 0 was applied — the context
    // defaults to false now, and only the Phase 0 verification asks for it.
    const withFallback = planClass(c, lessons, ctx({ legacyOriginFallback: true }));
    assert.equal(withFallback.find((a) => a.lessonId === legacy.id)?.verb, "skip");
    assert.equal(verbs(withFallback, "retire").length, 0);
    assert.equal(verbs(withFallback, "insert").length, 0, "the vacated slot stays occupied");

    // Without the fallback — i.e. if the id stopped being consulted before the
    // Phase 0 back-fill ran — the same lesson is retired. This is the ordering
    // constraint §6 calls the highest risk in the plan.
    const without = planClass(c, lessons, ctx({ legacyOriginFallback: false }));
    assert.equal(without.some((a) => a.verb === "retire" && a.lessonId === legacy.id), true);
    // ...and the slot it had vacated is refilled, minting an id byte-identical to
    // the one just retired. Worth stating: enforcing that plan in the wrong order
    // is a duplicate-key error, not merely a lost lesson.
    assert.equal(without.some((a) => a.verb === "insert" && a.lessonId === legacy.id), true);
  });

  it("occupies the slot it now SITS in when the schedule later gains that slot", () => {
    /* Reported against live class c2. A lesson was moved Friday -> Sunday, and the
     * Sunday slot was added to the recurring schedule AFTERWARDS. The lesson is
     * already sitting on Sunday at exactly that time, so the slot is satisfied and
     * nothing should be generated for it.
     *
     * §5.6 only says a rescheduled lesson consumes the slot it VACATED. It is
     * silent on the slot it now OCCUPIES, and `planDate` implements the section as
     * written: a frozen lesson whose origin is on another date pushes no claim for
     * the date it landed on. The desired Sunday slot therefore reads as unsatisfied
     * and step 6 inserts beside it — a duplicate at the same date, start and
     * duration, which is the fork this engine exists to prevent.
     *
     * Calendar: the app clock is Friday 2026-07-10; July 2026 Sundays are 5, 12,
     * 19, 26 and Fridays are 3, 10, 17, 24, 31. */
    const SUN_HOST = "2026-07-12";   // where the lesson now sits
    const FRI_ORIGIN = "2026-07-10"; // the slot it vacated (the app clock itself)
    const SUN_REST = ["2026-07-19", "2026-07-26"];
    const FRI_REST = ["2026-07-17", "2026-07-24", "2026-07-31"];
    const WED_ALL = ["2026-07-15", "2026-07-22", "2026-07-29"];

    const c = klass([
      { day: 0, start: "10:00", duration: 60 }, // Sunday   — added AFTER the move
      { day: 3, start: "16:00", duration: 60 }, // Wednesday
      { day: 5, start: "10:00", duration: 60 }, // Friday   — the original slot
    ]);

    // Minted for Friday the 10th, moved onto Sunday the 12th. Its id still encodes
    // the origin, exactly as the generator left it — ids are never recomputed.
    const moved = lesson(FRI_ORIGIN, "10:00", 60, {
      date: SUN_HOST,
      originalDate: FRI_ORIGIN,
      originalStart: "10:00",
      originalDuration: 60,
      rescheduledAt: "2026-07-09T08:00:00.000Z",
    });

    const plan = planClass(c, [moved], ctx());

    // 1. the rescheduled lesson is untouched, and its origin survives
    const mine = plan.filter((a) => a.lessonId === moved.id);
    assert.deepEqual(mine.map((a) => a.verb), ["skip"], "the moved lesson is only ever skipped");
    assert.equal(moved.originalDate, FRI_ORIGIN, "origin is not mutated by planning");
    assert.equal(moved.originalStart, "10:00");
    assert.equal(moved.originalDuration, 60);

    // 2. NOTHING is generated on the date it now occupies — the slot is taken
    const onHost = verbs(plan, "insert").filter((a) => a.date === SUN_HOST);
    assert.deepEqual(
      onHost.map((a) => `${a.date} ${a.verb === "insert" ? a.start : ""}`), [],
      "a recurring lesson was generated on top of the rescheduled one"
    );

    // 3. no two planned lessons share a date + start + duration on that day.
    // `update` is excluded because it carries from/to rather than a single slot —
    // and assertion 1 has already established this date produces none.
    const onHostAll = plan
      .filter((a): a is Exclude<PlanAction, { verb: "update" }> =>
        a.date === SUN_HOST && a.verb !== "update" && a.verb !== "retire" && a.verb !== "strand")
      .map((a) => `${a.date} ${a.start} ${a.duration}`);
    assert.equal(new Set(onHostAll).size, onHostAll.length, "duplicate date/start/duration on the host date");
    assert.equal(onHostAll.length, 1, "exactly one lesson stands on the host date");

    // 4. the Friday slot it vacated is NOT refilled for this lesson (§5.6)
    assert.deepEqual(
      verbs(plan, "insert").filter((a) => a.date === FRI_ORIGIN).map((a) => a.lessonId), [],
      "the vacated origin slot was refilled"
    );

    // 5. every OTHER date in the window is still generated normally
    assert.deepEqual(
      ids(plan, "insert"),
      [...SUN_REST.map((d) => `L-c1-${d}-1000`),
       ...WED_ALL.map((d) => `L-c1-${d}-1600`),
       ...FRI_REST.map((d) => `L-c1-${d}-1000`)].sort()
    );
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 8, retire: 0, strand: 0, skip: 1 });
  });
});

/* ------------------------------------------------- §6 Phase 4 — filters */

describe("§6 Phase 4 protective filters", () => {
  it("a lesson with an attendance record is never touched", () => {
    const c = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const lessons = TUE.map((d) => lesson(d, "14:30", 45));
    const plan = planClass(c, lessons, ctx({ attended: new Set([lessons[0].id]) }));

    assert.equal(plan.find((a) => a.lessonId === lessons[0].id)?.verb, "skip");
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 2, insert: 0, retire: 0, strand: 0, skip: 1 });
  });

  it("a lesson referenced by homework is never touched", () => {
    const c = klass([]);
    const lessons = TUE.map((d) => lesson(d, "14:30", 45));
    const plan = planClass(c, lessons, ctx({ homeworked: new Set([lessons[1].id]) }));

    assert.equal(plan.find((a) => a.lessonId === lessons[1].id)?.verb, "skip");
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 0, retire: 2, strand: 0, skip: 1 });
  });

  it("Makeup and Extra lessons are excluded from the reconciler entirely", () => {
    const c = klass([{ day: 2, start: "14:30", duration: 45 }]);
    const lessons = [
      ...TUE.map((d) => lesson(d, "14:30", 45)),
      lesson(WED[0], "18:00", 60, { id: "makeup-1", type: "makeup", fromId: "L-c1-2026-07-07-1430" }),
      lesson(WED[1], "18:00", 60, { id: "extra-1", type: "extra" }),
    ];

    const plan = planClass(c, lessons, ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 3, update: 0, insert: 0, retire: 0, strand: 0, skip: 0 });
    assert.equal(plan.some((a) => a.lessonId === "makeup-1" || a.lessonId === "extra-1"), false);
  });
});

/* ------------------------------------- §5.9 — manually edited lessons */

describe("§5.9 a lesson a teacher has written on", () => {
  const noted = (date: string, start: string, duration: number, text = "Bring the unit 4 handout") =>
    lesson(date, start, duration, { notes: text });

  it("is corrected IN PLACE when its slot moves, keeping both its id and its note", () => {
    const c = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const lessons = TUE.map((d) => noted(d, "14:30", 45));

    const plan = planClass(c, lessons, ctx());

    // Deliberately NOT frozen: freezing would protect the note's TIME, stranding
    // one lesson at 14:30 while its siblings move. Update is the preservation
    // mechanism — the write touches `start` and `duration` and nothing else.
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 3, insert: 0, retire: 0, strand: 0, skip: 0 });
    assert.deepEqual(ids(plan, "update"), lessons.map((l) => l.id).sort(), "ids are preserved");
  });

  it("is NEVER retired — it is stranded and reported instead", () => {
    const plan = planClass(klass([]), TUE.map((d) => noted(d, "14:30", 45)), ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 0, retire: 0, strand: 3, skip: 0 });
    for (const a of verbs(plan, "strand")) {
      assert.equal(a.verb === "strand" && a.notes, "Bring the unit 4 handout");
      assert.equal(a.verb === "strand" && a.reason.includes("notes"), true);
    }
  });

  it("takes the surviving slot when it competes with a plain lesson (§5.2 step 5)", () => {
    // One slot survives on the day; two lessons want it. The noted one must win,
    // or the day ends up with one corrected lesson AND one stale undeletable one.
    const c = klass([{ day: 2, start: "09:00", duration: 60 }]);
    const lessons = [lesson(TUE[0], "07:00", 60), noted(TUE[0], "20:00", 60)];

    const plan = planClass(c, lessons, ctx()).filter((a) => a.date === TUE[0]);

    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 1, insert: 0, retire: 1, strand: 0, skip: 0 });
    assert.deepEqual(ids(plan, "update"), [lessons[1].id], "the noted lesson is paired first");
    assert.deepEqual(ids(plan, "retire"), [lessons[0].id], "the plain one retires");
  });

  it("is not INSERTED beside — it claims its slot through ordinary matching", () => {
    const c = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const plan = planClass(c, [noted(TUE[0], "14:30", 45)], ctx()).filter((a) => a.date === TUE[0]);

    assert.equal(verbs(plan, "insert").length, 0);
    assert.equal(verbs(plan, "update").length, 1);
  });

  it("does not block a genuinely NEW session on the same day", () => {
    const c = klass([
      { day: 2, start: "14:30", duration: 45 },
      { day: 2, start: "18:00", duration: 60 }, // a second weekly session, added
    ]);
    const plan = planClass(c, [noted(TUE[0], "14:30", 45)], ctx()).filter((a) => a.date === TUE[0]);

    assert.deepEqual(summarizePlan(plan), { keep: 1, update: 0, insert: 1, retire: 0, strand: 0, skip: 0 });
  });

  it("`classroom` is not a signal — only `notes` is (§5.9)", () => {
    assert.equal(isManuallyEdited(lesson(TUE[0], "14:30", 45, { classroom: "Room Z" })), false);
    assert.equal(isManuallyEdited(lesson(TUE[0], "14:30", 45, { notes: "   " })), false, "whitespace is not content");
    assert.equal(isManuallyEdited(lesson(TUE[0], "14:30", 45, { notes: "call the parent" })), true);

    // A class-wide classroom rename leaves every earlier lesson holding the old
    // string, so protecting on it would strand lessons nobody wrote on.
    const c = klass([]);
    const plan = planClass(c, [lesson(TUE[0], "14:30", 45, { classroom: "Room A" })], ctx());
    assert.deepEqual(summarizePlan(plan), { keep: 0, update: 0, insert: 0, retire: 1, strand: 0, skip: 0 });
  });
});

/* --------------------------------------- §5.2 step 5 — the pairing heuristic */

describe("§5.2 leftover pairing on a multi-slot weekday", () => {
  it("keeps the matching slots and updates only the one that moved", () => {
    const c = klass([
      { day: 2, start: "07:00", duration: 60 },
      { day: 2, start: "08:30", duration: 60 }, // was 08:00
      { day: 2, start: "20:30", duration: 60 },
    ]);
    const lessons = [
      lesson(TUE[0], "07:00", 60),
      lesson(TUE[0], "08:00", 60),
      lesson(TUE[0], "20:30", 60),
    ];

    const plan = planClass(c, lessons, ctx()).filter((a) => a.date === TUE[0]);

    assert.deepEqual(summarizePlan(plan), { keep: 2, update: 1, insert: 0, retire: 0, strand: 0, skip: 0 });
    const [update] = verbs(plan, "update");
    assert.equal(update.verb === "update" && update.from.start, "08:00");
    assert.equal(update.verb === "update" && update.to.start, "08:30");
  });
});

/* ---------------------------------------------------- reporting helpers */

describe("reporting helpers", () => {
  it("originFromId reads the slot a generated id was minted for", () => {
    assert.deepEqual(originFromId("L-c4-2026-07-14-1430"), { date: "2026-07-14", start: "14:30" });
    assert.equal(originFromId("6a683d57376b4e471a458dd4"), null);
    assert.equal(originFromId("M-L-c1-2026-07-14-1430"), null);
  });

  it("effectiveOrigin prefers the stored origin over the id", () => {
    const l = lesson(TUE[0], "10:00", 45, {
      date: "2026-07-16", originalDate: "2026-07-13", originalStart: "09:00", originalDuration: 30,
    });
    assert.deepEqual(effectiveOrigin(l), {
      date: "2026-07-13", start: "09:00", duration: 30, source: "stored",
    });
  });

  it("findLegacyReschedules lists exactly the Phase 0 back-fill work", () => {
    const stored = lesson(TUE[0], "10:00", 45, { date: "2026-07-16", originalDate: TUE[0] });
    const legacyMove = lesson(TUE[1], "10:00", 45, { date: "2026-07-23" });
    const untouched = lesson(TUE[2], "10:00", 45);

    const found = findLegacyReschedules([stored, legacyMove, untouched]);

    assert.deepEqual(found.map((f) => f.lesson.id), [legacyMove.id]);
    assert.equal(found[0].inferred.source, "legacy-id");
    assert.equal(found[0].inferred.date, TUE[1]);
  });

  it("findOrphanedLessons finds lessons whose class was deleted", () => {
    const orphan = lesson(TUE[0], "10:00", 45, { id: "orphan-1", classId: "gone" });
    assert.deepEqual(
      findOrphanedLessons([klass([])], [lesson(TUE[0], "10:00", 45), orphan]).map((l) => l.id),
      ["orphan-1"]
    );
  });
});

/* ------------------------------------------------------ the sprint's promise */

describe("Sprint 5.6.0 guarantees", () => {
  it("the reconciliation core cannot write: no database access in the module", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "lib", "recurrence.ts"), "utf8");
    const forbidden = [
      "mongoose", "./models", "./db", "dbConnect",
      "bulkWrite", "updateOne", "updateMany", "deleteOne", "deleteMany",
      "insertOne", "insertMany", "findOneAndUpdate", "findOneAndDelete",
    ];
    for (const token of forbidden) {
      assert.equal(src.includes(token), false, `recurrence.ts must not reference ${token}`);
    }
  });
});
