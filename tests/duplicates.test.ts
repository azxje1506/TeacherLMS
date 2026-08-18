/* Duplicate-detector tests — the pure judging core of `npm run lessons:duplicates`.
 *
 * Run with:  npm test
 *
 * PURE. Every case builds Class and Lesson values in memory and asserts on the
 * verdicts; no database is opened and nothing is written. The script itself calls
 * `main()` at module load, which is why the judging lives in src/lib/duplicates.ts
 * and this file tests that instead.
 *
 * The defect these lock down: the detector used to ask "does A slot exist that
 * this lesson matches?" once per lesson, so two lessons stored at the same
 * start/duration both matched a single schedule slot and both were reported KEEP.
 * A slot is capacity, consumable once — not a predicate.
 *
 * Fixed calendar — app clock 2026-07-10 (a Friday):
 *   2026-07-12 is a SUNDAY (day 0), 2026-07-15 a Wednesday, 2026-07-17 a Friday. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { judgeDate, noKeep, wasMoved, weekdayOf, type Judged } from "../src/lib/duplicates";
import type { Klass, Lesson, ScheduleSlot } from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const SUN = "2026-07-12";
const SUN_SLOT: ScheduleSlot = { day: 0, start: "10:00", duration: 60 };

function klass(schedule: ScheduleSlot[], over: Partial<Klass> = {}): Klass {
  return {
    id: "c2", name: "Grammar Stars · B1", type: "group", level: "B1", fee: 1_500_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule, color: "#d14242", ...over,
  };
}

function lesson(id: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id, classId: "c2", type: "regular", date: SUN, start: "10:00", duration: 60,
    classroom: "Room A", status: "Upcoming", chargeable: false, fromId: null, notes: "",
    ...over,
  };
}

const judge = (k: Klass, lessons: Lesson[], attended: string[] = []) =>
  judgeDate({ klass: k, date: SUN, lessons, attended: new Set(attended), appClock: APP_CLOCK });

const verdictOf = (j: Judged[], id: string) => j.find((x) => x.lesson.id === id)?.verdict;
const removable = (j: Judged[]) =>
  j.filter((x) => x.verdict === "CANDIDATE" && x.protections.length === 0).map((x) => x.lesson.id).sort();

/* ------------------------------------------------------ capacity, not membership */

describe("one schedule slot supports exactly one lesson", () => {
  it("1. two plain lessons, one slot — one KEEP, one CANDIDATE", () => {
    const j = judge(klass([SUN_SLOT]), [
      lesson("L-c2-2026-07-12-1000"),
      lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.equal(j.filter((x) => x.verdict === "KEEP").length, 1);
    assert.equal(j.filter((x) => x.verdict === "CANDIDATE").length, 1);
    // Deterministic: ordered by start then id, so the lexicographically first id
    // takes the slot — the same rule the planner's `byLesson` comparator uses, so
    // the two independently agree on WHICH duplicate survives.
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1000"), "KEEP");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-2200"), "CANDIDATE");
    assert.deepEqual(removable(j), ["L-c2-2026-07-12-2200"]);
  });

  it("2. RESCHEDULED + two plain lessons, one slot — the reschedule takes it, both plain are CANDIDATE", () => {
    // The live c2 shape on 2026-07-12.
    const moved = lesson("L-c2-2026-07-10-1000", {
      originalDate: "2026-07-10", originalStart: "10:00", originalDuration: 60,
      rescheduledAt: "2026-07-09T08:00:00.000Z",
    });
    const j = judge(klass([SUN_SLOT]), [moved, lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200")]);

    assert.equal(verdictOf(j, "L-c2-2026-07-10-1000"), "RESCHEDULED", "never a candidate");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1000"), "CANDIDATE");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-2200"), "CANDIDATE");
    assert.equal(j.filter((x) => x.verdict === "KEEP").length, 0, "the reschedule consumed the only slot");
    assert.deepEqual(removable(j), ["L-c2-2026-07-12-1000", "L-c2-2026-07-12-2200"]);
    assert.equal(noKeep(j), false, "the date is explained — a reschedule occupies it");
  });

  it("3. two identical slots, two plain lessons — both KEEP", () => {
    const j = judge(klass([SUN_SLOT, { ...SUN_SLOT }]), [
      lesson("L-c2-2026-07-12-1000"),
      lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.deepEqual(j.map((x) => x.verdict), ["KEEP", "KEEP"], "capacity is 2, so nothing is surplus");
    assert.deepEqual(removable(j), []);
  });

  it("a third lesson against two identical slots is still surplus", () => {
    const j = judge(klass([SUN_SLOT, { ...SUN_SLOT }]), [
      lesson("L-c2-2026-07-12-1000"),
      lesson("L-c2-2026-07-12-1100"),
      lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.equal(j.filter((x) => x.verdict === "KEEP").length, 2);
    assert.deepEqual(removable(j), ["L-c2-2026-07-12-2200"]);
  });
});

/* --------------------------------------------------------------- protections */

describe("protections — a protected surplus lesson is never safely removable", () => {
  it("4. a surplus lesson carrying teacher's notes (§5.9)", () => {
    const j = judge(klass([SUN_SLOT]), [
      lesson("L-c2-2026-07-12-1000"),
      lesson("L-c2-2026-07-12-2200", { notes: "bring the graded essays" }),
    ]);
    assert.equal(verdictOf(j, "L-c2-2026-07-12-2200"), "CANDIDATE");
    const noted = j.find((x) => x.lesson.id === "L-c2-2026-07-12-2200")!;
    assert.ok(noted.protections.some((p) => /notes/i.test(p)), `expected a notes protection, got ${JSON.stringify(noted.protections)}`);
    assert.deepEqual(removable(j), [], "never reported as safely removable");
  });

  it("whitespace-only notes are not human-authored content", () => {
    const j = judge(klass([SUN_SLOT]), [
      lesson("L-c2-2026-07-12-1000"),
      lesson("L-c2-2026-07-12-2200", { notes: "   " }),
    ]);
    assert.deepEqual(removable(j), ["L-c2-2026-07-12-2200"]);
  });

  it("attendance, Cancelled and past all still protect a surplus lesson", () => {
    const attended = judge(klass([SUN_SLOT]),
      [lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200")], ["L-c2-2026-07-12-2200"]);
    assert.deepEqual(removable(attended), [], "attendance record");

    const cancelled = judge(klass([SUN_SLOT]),
      [lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200", { status: "Cancelled" })]);
    assert.deepEqual(removable(cancelled), [], "cancelled");

    const past = judgeDate({
      klass: klass([{ day: 0, start: "10:00", duration: 60 }]), date: "2026-07-05",
      lessons: [lesson("L-c2-2026-07-05-1000", { date: "2026-07-05" }),
                lesson("L-c2-2026-07-05-2200", { date: "2026-07-05" })],
      appClock: APP_CLOCK,
    });
    assert.deepEqual(removable(past), [], "past lesson");
  });
});

/* ------------------------------------------------------------ identity & scope */

describe("scope and identity", () => {
  it("5. a stale, non-canonical id does not affect slot matching", () => {
    // Matching reads the STORED start/duration. `…-2200` is stored at 10:00
    // because the reconciler corrected it in place and kept its id (ADR-001).
    const stale = judge(klass([SUN_SLOT]), [lesson("L-c2-2026-07-12-2200"), lesson("nonsense-id")]);
    assert.equal(stale.filter((x) => x.verdict === "KEEP").length, 1);
    assert.equal(stale.filter((x) => x.verdict === "CANDIDATE").length, 1);
    // Reverse the ids and the SAME lesson shape still yields one of each.
    const swapped = judge(klass([SUN_SLOT]), [lesson("L-c2-2026-07-12-1000"), lesson("zzz")]);
    assert.equal(swapped.filter((x) => x.verdict === "KEEP").length, 1);
    assert.equal(swapped.filter((x) => x.verdict === "CANDIDATE").length, 1);
  });

  it("6. different starts still fork exactly as before", () => {
    const j = judge(klass([{ day: 0, start: "10:08", duration: 45 }]), [
      lesson("L-c2-2026-07-12-1008", { start: "10:08", duration: 45 }),
      lesson("L-c2-2026-07-12-1430", { start: "14:30", duration: 45 }),
    ]);
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1008"), "KEEP");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1430"), "CANDIDATE");
    assert.match(j.find((x) => x.verdict === "CANDIDATE")!.reason, /no slot in the class's current schedule/);
  });

  it("a weekday the class no longer teaches says so", () => {
    const j = judge(klass([{ day: 3, start: "16:00", duration: 60 }]), [
      lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.deepEqual(j.map((x) => x.verdict), ["CANDIDATE", "CANDIDATE"]);
    assert.match(j[0].reason, /no longer teaches on this weekday/);
    assert.equal(noKeep(j), true);
  });

  it("7. Makeup and Extra never participate (§2)", () => {
    const j = judge(klass([SUN_SLOT]), [
      { ...lesson("M-something"), type: "makeup" },
      { ...lesson("X-something"), type: "extra" },
      lesson("L-c2-2026-07-12-1000"),
    ]);
    assert.equal(j.length, 1, "only the Regular lesson is judged");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1000"), "KEEP", "a makeup did not consume the slot");
  });

  it("an Archived class yields no candidates at all (§5.8, ADR-002)", () => {
    const j = judge(klass([SUN_SLOT], { status: "Archived" }), [
      lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.deepEqual(j.map((x) => x.verdict), ["ARCHIVED", "ARCHIVED"]);
    assert.deepEqual(removable(j), []);
    assert.equal(noKeep(j), false);
  });

  it("an Ended class yields no candidates either, under its own verdict", () => {
    // Not folded into ARCHIVED: the two say opposite things about the class's
    // future, and the detector is read by a person deciding what to delete. An
    // Ended class's future was already retired by the reconciler, so anything
    // still stored survived that pass because it was past or protected.
    const j = judge(klass([SUN_SLOT], { status: "Ended" }), [
      lesson("L-c2-2026-07-12-1000"), lesson("L-c2-2026-07-12-2200"),
    ]);
    assert.deepEqual(j.map((x) => x.verdict), ["ENDED", "ENDED"]);
    assert.deepEqual(removable(j), []);
    assert.equal(noKeep(j), false, "an ended class's date is explained, not unexplained");
  });

  it("a legacy move with no stored origin is still RESCHEDULED", () => {
    const legacy = lesson("L-c2-2026-07-10-1000"); // id encodes the 10th, sits on the 12th
    assert.equal(wasMoved(legacy), true);
    const j = judge(klass([SUN_SLOT]), [legacy, lesson("L-c2-2026-07-12-1000")]);
    assert.equal(verdictOf(j, "L-c2-2026-07-10-1000"), "RESCHEDULED");
    assert.equal(verdictOf(j, "L-c2-2026-07-12-1000"), "CANDIDATE");
  });

  it("2026-07-12 really is a Sunday — the fixture calendar is what it claims", () => {
    assert.equal(weekdayOf(SUN), 0);
    assert.equal(weekdayOf("2026-07-15"), 3);
    assert.equal(weekdayOf("2026-07-17"), 5);
  });
});

/* ----------------------------------------------------------------- guarantees */

describe("detector guarantees", () => {
  it("the judging core cannot write: no database access in the module", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/duplicates.ts"), "utf8");
    for (const forbidden of ["mongoose", "Model", "dbConnect", "bulkWrite", "deleteOne", "updateOne"]) {
      assert.equal(src.includes(forbidden), false, `src/lib/duplicates.ts must not reference ${forbidden}`);
    }
  });

  it("it does not depend on the planner — §6 Phase 3 needs an independent check", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/duplicates.ts"), "utf8");
    assert.equal(src.includes("./recurrence"), false, "duplicates.ts must not import the planner");
  });
});
