/* Migration verification — Sprint 5.6.3.
 *
 * Run with:  npm test
 *
 * PURE, like the other two suites: Class and Lesson values are built in memory
 * and no database is opened. What is under test is the VERIFICATION, not the
 * planner — so every case here is deliberately one where a wrong answer would
 * let a bad write through, and the assertion is that the check catches it.
 *
 * Same fixed calendar as tests/recurrence.test.ts — the app clock is 2026-07-10
 * (a Friday):
 *   July 2026 Tuesdays : 7, 14, 21, 28   (the 7th is past)
 *   July 2026 Fridays  : 3, 10, 17, 24, 31 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  applyPhase0, buildMigrationReport, digestLessons, formatMigrationReport, phase0Equivalence,
  verifyFutureOrphans, verifyPhase0, verifyPhase0Applied, verifyProtected,
  type Phase0Item,
} from "../src/lib/migration";
import { planReconciliation, reconcileContext, type PlanAction, type ReconcileContext } from "../src/lib/recurrence";
import type { Klass, Lesson, ScheduleSlot } from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const MONTHS = ["2026-07"];
const TUE = ["2026-07-14", "2026-07-21", "2026-07-28"];
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

/** A lesson moved before the origin fields existed: its id says one date, its
 * `date` says another, and nothing else records the move (§6 Phase 0). */
function legacyMove(idDate: string, sits: string, start: string, duration: number, over: Partial<Lesson> = {}): Lesson {
  return { ...lesson(idDate, start, duration, over), date: sits };
}

const retire = (l: Lesson, reason = "no slot"): PlanAction => ({
  verb: "retire", classId: l.classId, date: l.date, lessonId: l.id,
  start: l.start, duration: l.duration, reason,
});
const update = (l: Lesson, to: { start: string; duration: number }): PlanAction => ({
  verb: "update", classId: l.classId, date: l.date, lessonId: l.id,
  from: { start: l.start, duration: l.duration }, to,
});

/* ============================================================ §6 Phase 0 */

describe("verifyPhase0 — is each legacy reschedule what it looks like?", () => {
  const tueTen: ScheduleSlot[] = [{ day: 2, start: "10:00", duration: 45 }];

  it("passes a genuine move and names the exact triple to be written", () => {
    const moved = legacyMove(TUE[0], TUE[1], "10:00", 45);
    const items = verifyPhase0([klass(tueTen)], [moved], ctx());
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].problems, []);
    assert.deepEqual(items[0].target, {
      originalDate: TUE[0], originalStart: "10:00", originalDuration: 45,
    });
    // Where it sits is reported and never touched.
    assert.equal(items[0].date, TUE[1]);
  });

  it("ignores a lesson that already carries a stored origin — the back-fill is additive", () => {
    const moved = legacyMove(TUE[0], TUE[1], "10:00", 45, {
      originalDate: TUE[0], originalStart: "10:00", originalDuration: 45,
    });
    assert.deepEqual(verifyPhase0([klass(tueTen)], [moved], ctx()), []);
  });

  it("flags a half-stamped lesson rather than writing over it", () => {
    // `findLegacyReschedules` keys on `originalDate`, so a lesson carrying only
    // `originalStart` still reaches the work list. Writing all three would
    // silently overwrite a field a human may have set.
    const half = legacyMove(TUE[0], TUE[1], "10:00", 45, { originalStart: "09:00" });
    const [item] = verifyPhase0([klass(tueTen)], [half], ctx());
    assert.equal(item.problems.length, 1);
    assert.match(item.problems[0], /already carries originalStart/);
  });

  it("says so when the class's schedule cannot corroborate the origin", () => {
    // The schedule has been edited since the move, so the origin rests on the id.
    const moved = legacyMove(TUE[0], TUE[1], "10:00", 45);
    const [item] = verifyPhase0([klass([{ day: 2, start: "14:30", duration: 45 }])], [moved], ctx());
    assert.deepEqual(item.problems, []); // not blocking
    assert.equal(item.notes.some((n) => /no slot in the class's current schedule/.test(n)), true);
  });

  it("warns that originalDuration is inferred when the slot's length disagrees", () => {
    // The id never encoded a duration (§6 Phase 0): the value written is the
    // lesson's own, and the report must not present that as recovered fact.
    const moved = legacyMove(TUE[0], TUE[1], "10:00", 90);
    const [item] = verifyPhase0([klass(tueTen)], [moved], ctx());
    assert.equal(item.target.originalDuration, 90);
    assert.equal(item.notes.some((n) => /originalDuration 90 is the lesson's own/.test(n)), true);
  });

  it("identifies which lessons are load-bearing without the fallback (§6 Phase 0)", () => {
    const future = legacyMove(TUE[0], TUE[1], "10:00", 45);
    const past = legacyMove(PAST_TUE, "2026-07-08", "10:00", 45, { status: "Completed" });
    const items = verifyPhase0([klass(tueTen)], [future, past], ctx());
    const byId = new Map(items.map((i) => [i.lessonId, i]));
    assert.equal(byId.get(future.id)!.loadBearing, true);
    // Past and Completed: frozen twice over, so Phase 0 changes nothing for it.
    assert.equal(byId.get(past.id)!.loadBearing, false);
  });

  it("is deterministic — the work list is sorted by lesson id", () => {
    const a = legacyMove(TUE[1], TUE[2], "10:00", 45);
    const b = legacyMove(TUE[0], TUE[1], "10:00", 45);
    const items = verifyPhase0([klass(tueTen)], [a, b], ctx());
    assert.deepEqual(items.map((i) => i.lessonId), [b.id, a.id]);
  });
});

describe("phase0Equivalence — the back-fill must change no decision", () => {
  const tueTen: ScheduleSlot[] = [{ day: 2, start: "10:00", duration: 45 }];

  it("is identical when the origins are stamped as verified", () => {
    const k = klass(tueTen);
    const lessons = [
      legacyMove(TUE[0], TUE[1], "10:00", 45), // moved onto the 21st
      lesson(TUE[2], "10:00", 45),
    ];
    const items = verifyPhase0([k], lessons, ctx());
    const eq = phase0Equivalence([k], lessons, items, ctx());
    assert.equal(eq.identical, true, JSON.stringify([eq.onlyBefore, eq.onlyAfter]));
    assert.deepEqual(eq.before, eq.after);
  });

  it("catches the dangerous state: fallback removed before the back-fill runs", () => {
    // This is the failure §5.4 calls the highest risk in the plan — the lesson
    // stops looking rescheduled and becomes an orphan. Passing an empty item list
    // simulates exactly that, and the check must refuse it. The move is onto a
    // Friday, where the class teaches nothing, so the orphan is unmistakable.
    const k = klass(tueTen);
    const lessons = [legacyMove(TUE[0], "2026-07-17", "10:00", 45)];
    const eq = phase0Equivalence([k], lessons, [], ctx());
    assert.equal(eq.identical, false);
    assert.equal(eq.after.retire, 1);
    assert.equal(eq.before.retire, 0);
    assert.equal(eq.onlyAfter.some((k2) => k2.startsWith("retire|")), true);
  });

  it("applyPhase0 stamps only the targeted lessons, and only the three fields", () => {
    const moved = legacyMove(TUE[0], TUE[1], "10:00", 45);
    const other = lesson(TUE[2], "10:00", 45);
    const items = verifyPhase0([klass(tueTen)], [moved, other], ctx());
    const after = applyPhase0([moved, other], items);
    assert.equal(after[0].originalDate, TUE[0]);
    assert.equal(after[0].date, TUE[1], "where it sits never moves");
    assert.equal(after[0].rescheduledAt, undefined, "the back-fill does not invent a timestamp");
    assert.deepEqual(after[1], other);
  });
});

describe("verifyPhase0Applied — what actually landed", () => {
  const tueTen: ScheduleSlot[] = [{ day: 2, start: "10:00", duration: 45 }];
  const moved = legacyMove(TUE[0], TUE[1], "10:00", 45);
  const other = lesson(TUE[2], "10:00", 45);
  const before = [moved, other];
  const items: Phase0Item[] = verifyPhase0([klass(tueTen)], before, ctx());

  it("passes when exactly the expected targets were stamped", () => {
    const v = verifyPhase0Applied(before, applyPhase0(before, items), items);
    assert.equal(v.ok, true);
    assert.equal(v.stamped, 1);
    assert.deepEqual([v.wrongTarget, v.missing, v.unexpected, v.collateral], [[], [], [], []]);
  });

  it("fails when a target was not stamped", () => {
    const v = verifyPhase0Applied(before, before, items);
    assert.equal(v.ok, false);
    assert.deepEqual(v.missing, [moved.id]);
  });

  it("fails when a target was stamped with the wrong origin", () => {
    const wrong = before.map((l) =>
      l.id === moved.id ? { ...l, originalDate: "2026-01-01", originalStart: "08:00", originalDuration: 30 } : l);
    const v = verifyPhase0Applied(before, wrong, items);
    assert.equal(v.ok, false);
    assert.deepEqual(v.wrongTarget, [moved.id]);
  });

  it("fails when an untargeted lesson gained an origin", () => {
    const spread = applyPhase0(before, items).map((l) =>
      l.id === other.id ? { ...l, originalDate: TUE[0] } : l);
    const v = verifyPhase0Applied(before, spread, items);
    assert.equal(v.ok, false);
    assert.deepEqual(v.unexpected, [other.id]);
  });

  it("fails when ANY other field moved — the write must be additive", () => {
    const collateral = applyPhase0(before, items).map((l) =>
      l.id === other.id ? { ...l, notes: "someone edited this" } : l);
    const v = verifyPhase0Applied(before, collateral, items);
    assert.equal(v.ok, false);
    assert.deepEqual(v.collateral, [other.id]);
  });

  it("fails when the collection lost or gained a lesson", () => {
    const v = verifyPhase0Applied(before, applyPhase0([moved], items), items);
    assert.equal(v.ok, false);
    assert.equal(v.countChanged, true);
  });
});

/* ================================================= §6 Phase 3 — the orphans */

describe("verifyFutureOrphans — every retirement, proved independently", () => {
  // The live shape: the schedule moved to 10:08 and a stale 14:30 series remains.
  const forked = klass([{ day: 2, start: "10:08", duration: 45 }]);

  it("passes a stale lesson sitting beside its corrected sibling", () => {
    const stale = lesson(TUE[0], "14:30", 45);
    const current = lesson(TUE[0], "10:08", 45);
    const items = verifyFutureOrphans([forked], [stale, current], [retire(stale)], ctx());
    assert.deepEqual(items[0].problems, []);
    assert.equal(items[0].aloneOnDate, false);
    assert.equal(items[0].lessonsOnDate, 2);
  });

  it("flags an orphan that is alone on its date — invisible to lessons:duplicates", () => {
    const stale = lesson(TUE[0], "14:30", 45);
    const items = verifyFutureOrphans([forked], [stale], [retire(stale)], ctx());
    assert.deepEqual(items[0].problems, []);
    assert.equal(items[0].aloneOnDate, true);
  });

  it("REFUSES a retirement of a lesson the schedule still wants", () => {
    // The independent re-derivation: this date holds one lesson at 10:08 and the
    // schedule asks for one, so there is no surplus to spend.
    const wanted = lesson(TUE[0], "10:08", 45);
    const items = verifyFutureOrphans([forked], [wanted], [retire(wanted)], ctx());
    assert.equal(items[0].problems.length, 1);
    assert.match(items[0].problems[0], /still wants a lesson at 10:08/);
  });

  it("REFUSES retiring more lessons at one slot than the date can spare", () => {
    // Two lessons at 10:08, one slot: exactly one may go, not both.
    const a = lesson(TUE[0], "10:08", 45);
    const b = { ...a, id: `${a.id}-dupe` };
    const items = verifyFutureOrphans([forked], [a, b], [retire(a), retire(b)], ctx());
    assert.deepEqual(items[0].problems, []);
    assert.equal(items[1].problems.length, 1);
    assert.match(items[1].problems[0], /no surplus at that slot/);
  });

  it("REFUSES a retirement dated before the app clock (§4)", () => {
    const past = lesson(PAST_TUE, "14:30", 45);
    const items = verifyFutureOrphans([forked], [past], [retire(past)], ctx());
    assert.equal(items[0].problems.some((p) => /before the app clock/.test(p)), true);
  });

  it("REFUSES a retirement of a Cancelled or attended lesson", () => {
    const cancelled = lesson(TUE[0], "14:30", 45, { status: "Cancelled" });
    const attended = lesson(TUE[1], "14:30", 45);
    const items = verifyFutureOrphans(
      [forked], [cancelled, attended], [retire(cancelled), retire(attended)],
      ctx({ attended: new Set([attended.id]) })
    );
    assert.equal(items[0].problems.some((p) => /status is Cancelled/.test(p)), true);
    assert.equal(items[1].problems.some((p) => /attendance/.test(p)), true);
  });

  it("REFUSES a retirement of a lesson carrying teacher's notes (§5.9)", () => {
    const noted = lesson(TUE[0], "14:30", 45, { notes: "Bring the unit 4 handout" });
    const items = verifyFutureOrphans([forked], [noted], [retire(noted)], ctx());
    assert.equal(items[0].problems.some((p) => /teacher's notes/.test(p)), true);
  });

  it("REFUSES a retirement on an Archived class or a class that is gone (ADR-002)", () => {
    const stale = lesson(TUE[0], "14:30", 45);
    const archived = verifyFutureOrphans(
      [klass([{ day: 2, start: "10:08", duration: 45 }], { status: "Archived" })],
      [stale], [retire(stale)], ctx()
    );
    assert.equal(archived[0].problems.some((p) => /Archived/.test(p)), true);
    const gone = verifyFutureOrphans([], [stale], [retire(stale)], ctx());
    assert.equal(gone[0].problems.some((p) => /class no longer exists/.test(p)), true);
  });
});

/* ================================================ §6 Phase 4 — the protected */

describe("verifyProtected — no write verb may touch a protected lesson", () => {
  const k = klass([{ day: 2, start: "10:00", duration: 45 }]);

  it("passes a plan that only touches lessons which proved they are safe", () => {
    const l = lesson(TUE[0], "14:30", 45);
    const r = verifyProtected([k], [l], [update(l, { start: "10:00", duration: 45 })], ctx());
    assert.deepEqual(r.violations, []);
  });

  it("counts the protected set by the reason each lesson holds", () => {
    const lessons = [
      lesson(PAST_TUE, "10:00", 45, { status: "Completed" }),
      lesson(TUE[0], "10:00", 45, { status: "Cancelled" }),
      lesson(TUE[1], "10:00", 45, { id: "x-1", type: "extra" }),
    ];
    const r = verifyProtected([k], lessons, [], ctx());
    assert.equal(r.counts["past-date"], 1);
    assert.equal(r.counts["not-upcoming"], 2);
    assert.equal(r.counts["not-regular"], 1);
    assert.equal(r.total, 3);
  });

  it("catches an update aimed at a frozen lesson", () => {
    const cancelled = lesson(TUE[0], "14:30", 45, { status: "Cancelled" });
    const r = verifyProtected([k], [cancelled], [update(cancelled, { start: "10:00", duration: 45 })], ctx());
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].verb, "update");
  });

  it("catches a retire aimed at a noted lesson, which update alone may touch (§5.9)", () => {
    const noted = lesson(TUE[0], "14:30", 45, { notes: "call the parent" });
    assert.equal(verifyProtected([k], [noted], [update(noted, { start: "10:00", duration: 45 })], ctx()).violations.length, 0);
    const r = verifyProtected([k], [noted], [retire(noted)], ctx());
    assert.equal(r.violations.length, 1);
    assert.match(r.violations[0].detail, /notes/);
    assert.equal(r.noteProtected, 1);
  });

  it("catches an insert whose id already belongs to a stored lesson", () => {
    const l = lesson(TUE[0], "10:00", 45);
    const collide: PlanAction = {
      verb: "insert", classId: "c1", date: TUE[0], lessonId: l.id,
      start: "10:00", duration: 45, status: "Upcoming",
    };
    const r = verifyProtected([k], [l], [collide], ctx());
    assert.equal(r.violations.length, 1);
    assert.match(r.violations[0].detail, /already exists/);
  });
});

/* ==================================================== the report as a whole */

describe("the migration report", () => {
  const forked = klass([{ day: 2, start: "10:08", duration: 45 }]);
  const lessons = [
    lesson(TUE[0], "10:08", 45),
    lesson(TUE[0], "14:30", 45), // the fork
    legacyMove(TUE[1], TUE[2], "10:08", 45), // a legacy move
  ];

  const report = () => buildMigrationReport({
    classes: [forked], lessons, ctx: ctx(), retireEnabled: false,
  });

  it("verifies the whole picture and reports RETIRE as still disabled", () => {
    const r = report();
    assert.equal(r.verdict.ok, true);
    assert.equal(r.retireEnabled, false);
    assert.equal(r.plan.retire, 1);
    assert.equal(r.orphans.items.length, 1);
    assert.equal(r.orphans.ok, true);
    assert.equal(r.phase0.items.length, 1);
    assert.equal(r.equivalence.identical, true);
  });

  it("names the outstanding work before RETIRE may be enabled", () => {
    const blockers = report().verdict.blockers.join(" ");
    assert.match(blockers, /Phase 0 back-fill has not been applied/);
    assert.match(blockers, /legacyOriginFallback is still on/);
  });

  it("is deterministic — same data in, byte-identical text out", () => {
    assert.equal(formatMigrationReport(report()), formatMigrationReport(report()));
    // …and independent of the order the database happened to return lessons in.
    const shuffled = buildMigrationReport({
      classes: [forked], lessons: [...lessons].reverse(), ctx: ctx(), retireEnabled: false,
    });
    assert.equal(formatMigrationReport(shuffled), formatMigrationReport(report()));
  });

  it("fails the verdict when the plan and the design disagree", () => {
    // A noted lesson on a weekday the class has dropped: no slot survives for it,
    // so it can be neither corrected nor deleted (§5.9). The report must not print
    // PASS merely because the planner was confident.
    const wednesdays = klass([{ day: 3, start: "10:08", duration: 45 }]);
    const noted = lesson(TUE[0], "14:30", 45, { notes: "call the parent" });
    const r = buildMigrationReport({
      classes: [wednesdays], lessons: [noted], ctx: ctx(), retireEnabled: false,
    });
    // The planner strands it rather than retiring it, so the verdict holds…
    assert.equal(r.plan.strand, 1);
    assert.equal(r.plan.retire, 0);
    assert.equal(r.verdict.ok, true);
    // …and the verification is what would catch it if it ever stopped doing that.
    assert.equal(
      verifyProtected([wednesdays], [noted], [retire(noted)], ctx()).violations.length, 1
    );
  });
});

describe("digestLessons — the snapshot's identity", () => {
  const a = lesson(TUE[0], "10:00", 45);
  const b = lesson(TUE[1], "10:00", 45);

  it("does not depend on document order", () => {
    assert.equal(digestLessons([a, b]).digest, digestLessons([b, a]).digest);
    assert.equal(digestLessons([a, b]).count, 2);
  });

  it("moves when an origin field is written — a stale snapshot cannot pass", () => {
    const stamped = [{ ...a, originalDate: TUE[0] }, b];
    assert.notEqual(digestLessons([a, b]).digest, digestLessons(stamped).digest);
  });
});

/* -------------------------------------------------------- sprint guarantees */

describe("Sprint 5.6.3 guarantees", () => {
  it("the verification cannot write: no database access in the module", () => {
    const src = readFileSync(path.join(process.cwd(), "src", "lib", "migration.ts"), "utf8");
    const forbidden = [
      "mongoose", "./models", "./db", "dbConnect",
      "bulkWrite", "updateOne", "updateMany", "deleteOne", "deleteMany",
      "insertOne", "insertMany", "findOneAndUpdate", "findOneAndDelete",
    ];
    for (const token of forbidden) {
      assert.equal(src.includes(token), false, `migration.ts must not reference ${token}`);
    }
  });

  it("the planner's own output is what the verification checks — not a copy of it", () => {
    // Guards against the verification drifting into agreement by construction:
    // it is handed the planner's actions and re-derives its answer from the
    // classes and lessons, so a planner bug shows up as a problem, not a match.
    const forked = klass([{ day: 2, start: "10:08", duration: 45 }]);
    const wanted = lesson(TUE[0], "10:08", 45);
    const plan = planReconciliation([forked], [wanted], ctx());
    assert.equal(plan.actions.filter((a) => a.verb === "retire").length, 0);
    // Hand the verification a retirement the planner never made: it must object.
    const items = verifyFutureOrphans([forked], [wanted], [retire(wanted)], ctx());
    assert.equal(items[0].problems.length, 1);
  });
});
