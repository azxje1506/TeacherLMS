/* Lesson lifecycle — the stored `Upcoming` -> `Completed` / `Cancelled` transition.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. `resolvedStatusFor` is the whole decision, so
 * exercising it over in-memory values tests the rule itself rather than a database
 * round trip. The executor's own guarantees — which model it writes, which fields,
 * and where it is wired in — are not expressible as a function call, so they are
 * asserted by scanning the source, the same technique tests/class-lifecycle.test.ts
 * already uses for the rules that live inside a Mongo query.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10, a Friday:
 *   past   : 2026-07-05, 2026-07-09
 *   today  : 2026-07-10   <- NOT past, by the `statusForDate` / `planDate` convention
 *   future : 2026-07-11, 2026-07-15
 *
 * The 2026-07-09 date is the live shape from the audit: `L-c6-2026-07-11-1700` was
 * rescheduled backwards across the app clock and is the one lesson in the real
 * database that this transition currently resolves. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { resolvedStatusFor } from "../src/lib/lifecycle";
import { computeRevenue } from "../src/lib/finance";
import { planClass, reconcileContext, satisfiedRegularSlots, slotKey, summarizePlan } from "../src/lib/recurrence";
import { CLASS_STATUSES } from "../src/lib/schemas";
import type {
  AttendanceRecord, ClassStatus, Klass, Lesson, LessonStatus, ScheduleSlot, Student,
} from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const PAST = "2026-07-05";
const PAST_MOVED = "2026-07-09";
const TODAY = "2026-07-10";
const FUTURE = "2026-07-15";
const WED_SLOT: ScheduleSlot = { day: 3, start: "14:30", duration: 45 };

/** A status the engine has never heard of, forced past the type system the way a
 * hand-edited document or a half-finished migration would arrive. */
const UNKNOWN = "Suspended" as unknown as ClassStatus;

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Test Class", type: "group", level: "B1", fee: 1_200_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule: [WED_SLOT], color: "#d14242", ...over,
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

const resolve = (l: Lesson, k: Klass | null) => resolvedStatusFor(l, k, APP_CLOCK);

/** Apply what the rule decided, exactly as the executor's `$set` would — status,
 * and `chargeable: false` on the archived branch. Nothing else may move. */
function applyLifecycle(lessons: Lesson[], k: Klass | null): { lessons: Lesson[]; resolved: number } {
  let resolved = 0;
  const out = lessons.map((l) => {
    const next = resolve(l, k);
    if (next === null) return l;
    resolved++;
    return next === "Cancelled"
      ? { ...l, status: next as LessonStatus, chargeable: false }
      : { ...l, status: next as LessonStatus };
  });
  return { lessons: out, resolved };
}

/** A module's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ============================================================ basic lifecycle */

describe("an Active class delivers what has already happened", () => {
  it("past Upcoming -> Completed", () => {
    assert.equal(resolve(lesson(PAST), klass()), "Completed");
    assert.equal(resolve(lesson(PAST_MOVED), klass()), "Completed");
  });

  it("future Upcoming is untouched", () => {
    assert.equal(resolve(lesson(FUTURE), klass()), null);
  });

  it("TODAY is not past — the boundary follows the existing convention", () => {
    // `statusForDate` generates today as Upcoming and `planDate` keeps today in
    // scope, so today's lesson is still to be taught. One convention, stated in
    // `isPastDate` and reused here rather than restated.
    assert.equal(resolve(lesson(TODAY), klass()), null);
  });

  it("a Completed lesson is never reclassified", () => {
    assert.equal(resolve(lesson(PAST, { status: "Completed" }), klass()), null);
    // …including one carrying a FUTURE date, which §5.5 says is a supported state.
    assert.equal(resolve(lesson(FUTURE, { status: "Completed" }), klass()), null);
  });

  it("a Cancelled lesson is never reclassified, chargeable or not", () => {
    assert.equal(resolve(lesson(PAST, { status: "Cancelled", chargeable: true }), klass()), null);
    assert.equal(resolve(lesson(PAST, { status: "Cancelled", chargeable: false }), klass()), null);
  });
});

/* ========================================================= archived lifecycle */

describe("an Archived class withholds what it did not teach", () => {
  const archived = () => klass({ status: "Archived" });

  it("past Upcoming -> Cancelled, and the executor pairs it with chargeable:false", () => {
    assert.equal(resolve(lesson(PAST), archived()), "Cancelled");

    const { lessons } = applyLifecycle([lesson(PAST)], archived());
    assert.equal(lessons[0].status, "Cancelled");
    assert.equal(lessons[0].chargeable, false);
  });

  it("future Upcoming is untouched — this is what Restore recovers", () => {
    assert.equal(resolve(lesson(FUTURE), archived()), null);
  });

  it("a Completed lesson survives archival with its revenue intact", () => {
    assert.equal(resolve(lesson(PAST, { status: "Completed" }), archived()), null);
  });

  it("an existing Cancelled lesson is left exactly as it is", () => {
    assert.equal(resolve(lesson(PAST, { status: "Cancelled", chargeable: true }), archived()), null);
  });
});

/* ================================================================ fail closed */

describe("anything the rule does not positively recognise is left alone", () => {
  it("an Ended class resolves nothing — its future was retired on the transition", () => {
    assert.equal(resolve(lesson(PAST), klass({ status: "Ended" })), null);
  });

  it("an unrecognised class status resolves nothing", () => {
    assert.equal(resolve(lesson(PAST), klass({ status: UNKNOWN })), null);
  });

  it("a lesson whose class no longer exists resolves nothing (§5.8)", () => {
    assert.equal(resolve(lesson(PAST), null), null);
  });

  it("only Active and Archived resolve, and they resolve differently", () => {
    // Total over the lifecycle, so a status added later cannot silently acquire
    // revenue semantics — it lands on `undefined` in the table and returns null.
    const seen = CLASS_STATUSES.map((s) => [s, resolve(lesson(PAST), klass({ status: s }))]);
    assert.deepEqual(seen, [["Active", "Completed"], ["Ended", null], ["Archived", "Cancelled"]]);
  });
});

/* ============================================================ type protection */

describe("only Regular lessons have a generated lifecycle", () => {
  it("Extra and Makeup are never resolved, whatever their date or class", () => {
    for (const type of ["extra", "makeup"] as const) {
      for (const status of CLASS_STATUSES) {
        assert.equal(resolve(lesson(PAST, { type }), klass({ status })), null, `${type} on ${status}`);
      }
    }
  });
});

/* ================================================================ idempotency */

describe("the transition converges", () => {
  it("a second and third pass resolve nothing", () => {
    const start = [lesson(PAST), lesson(PAST_MOVED), lesson(FUTURE), lesson(TODAY)];

    const first = applyLifecycle(start, klass());
    const second = applyLifecycle(first.lessons, klass());
    const third = applyLifecycle(second.lessons, klass());

    assert.equal(first.resolved, 2, "only the two past lessons are eligible");
    assert.equal(second.resolved, 0, "everything eligible was already resolved");
    assert.equal(third.resolved, 0, "and it stays that way");
    assert.deepEqual(third.lessons, second.lessons);
  });

  it("the same holds on an Archived class", () => {
    const start = [lesson(PAST), lesson(FUTURE)];

    const first = applyLifecycle(start, klass({ status: "Archived" }));
    const second = applyLifecycle(first.lessons, klass({ status: "Archived" }));

    assert.equal(first.resolved, 1);
    assert.equal(second.resolved, 0);
  });
});

/* ==================================================================== restore */

describe("Archive -> Restore cannot resurrect revenue", () => {
  it("a lesson settled while Archived stays Cancelled once the class is Active", () => {
    // The exact sequence updateClass performs: resolve while the OLD status is
    // still stored, THEN flip the status. This is why the ordering is load-bearing.
    const settled = applyLifecycle([lesson(PAST)], klass({ status: "Archived" }));
    assert.equal(settled.lessons[0].status, "Cancelled");
    assert.equal(settled.lessons[0].chargeable, false);

    // …now restore, and run the lifecycle again as any later read would.
    const afterRestore = applyLifecycle(settled.lessons, klass({ status: "Active" }));

    assert.equal(afterRestore.resolved, 0, "restore must not re-resolve a settled lesson");
    assert.equal(afterRestore.lessons[0].status, "Cancelled");
  });

  it("resolving BEFORE the status flip is what prevents the phantom", () => {
    // The counter-example, kept as a test so the ordering cannot be quietly
    // reversed: resolving only AFTER the class is Active yields Completed.
    const wrongOrder = applyLifecycle([lesson(PAST)], klass({ status: "Active" }));

    assert.equal(wrongOrder.lessons[0].status, "Completed",
      "resolving after the flip recognises revenue for a session nobody taught");
  });

  it("a future lesson survives the round trip untouched, and does not duplicate", () => {
    const future = lesson(FUTURE);

    const archived = applyLifecycle([future], klass({ status: "Archived" }));
    assert.equal(archived.resolved, 0);
    assert.deepEqual(archived.lessons[0], future, "not one field moved");

    // Restored: the planner KEEPS it, and generation resumes for the window's
    // other Wednesdays (the 22nd and the 29th) without putting a second lesson on
    // top of the survivor. Both halves matter — forward generation must resume,
    // and it must not duplicate.
    const plan = planClass(klass({ status: "Active" }), archived.lessons, ctx());

    assert.deepEqual(summarizePlan(plan), { keep: 1, update: 0, insert: 2, retire: 0, strand: 0, skip: 0 });
    assert.deepEqual(
      plan.filter((a) => a.verb === "keep").map((a) => a.date), [FUTURE],
      "the survivor is kept, not re-created"
    );
    assert.deepEqual(
      plan.filter((a) => a.verb === "insert").map((a) => a.date), ["2026-07-22", "2026-07-29"],
      "forward generation resumes on the dates that hold nothing"
    );
    assert.equal(plan.some((a) => a.verb === "insert" && a.date === FUTURE), false,
      "nothing may be inserted onto the occupied slot");
    // …and the read-side top-up agrees, so a list read cannot fork it either.
    assert.equal(satisfiedRegularSlots(archived.lessons).has(slotKey("c1", FUTURE, "14:30")), true);
  });

  it("archive and restore with no date passing is a total no-op", () => {
    const stored = [lesson(FUTURE), lesson(PAST, { status: "Completed" })];

    const archived = applyLifecycle(stored, klass({ status: "Archived" }));
    const restored = applyLifecycle(archived.lessons, klass({ status: "Active" }));

    assert.equal(archived.resolved, 0);
    assert.equal(restored.resolved, 0);
    assert.deepEqual(restored.lessons, stored, "no lesson was mutated at any point");
    assert.deepEqual(planClass(klass({ status: "Archived" }), stored, ctx()), [],
      "and the reconciler plans nothing either");
  });
});

const ctx = () => reconcileContext({ appClock: APP_CLOCK, months: ["2026-07"] });

/* ================================================================= reschedule */

describe("rescheduling does not classify — the next lifecycle pass does (R2)", () => {
  it("a lesson moved backwards across the clock keeps its status at the move", () => {
    // `rescheduleLesson` writes date/start/duration and the origin triple; status
    // is not in its `$set`. Asserted against the source, because the move itself
    // is a database operation.
    const src = code("src", "lib", "lessons.ts");
    const fn = src.slice(src.indexOf("export async function rescheduleLesson"));
    const body = fn.slice(0, fn.indexOf("export async function cancelLesson"));

    assert.equal(/status/.test(body), false,
      "rescheduleLesson must not read or write a lesson's status (R2)");
  });

  it("…and the next pass resolves it by the class's status", () => {
    // The live shape: id says 2026-07-11, the lesson now sits on 2026-07-09.
    const moved = lesson(PAST_MOVED, {
      id: "L-c1-2026-07-11-1430",
      originalDate: "2026-07-11", originalStart: "14:30", originalDuration: 45,
      rescheduledAt: "2026-07-09T10:00:00.000Z",
    });

    assert.equal(resolve(moved, klass({ status: "Active" })), "Completed");
    assert.equal(resolve(moved, klass({ status: "Archived" })), "Cancelled");
  });
});

/* =========================================================== revenue invariants */

describe("revenue moves only because its inputs did", () => {
  const MONTH = "2026-07";
  const JULY = ["2026-07-01", "2026-07-08"]; // both past, both Wednesdays

  function student(): Student {
    return {
      id: "s1", first: "Mai", last: "Nguyen", name: "Mai Nguyen", initials: "MN",
      birthday: "2014-03-02", age: 12, school: "Le Loi", grade: 6, gradeLabel: "Grade 6",
      parentId: "", parentName: "", phone: "", status: "Active", notes: "",
      joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
      avatar: null, avatarColor: "#0284c7",
    };
  }
  const finance = (k: Klass, lessons: Lesson[]) => ({
    classes: [k], students: [student()], lessons, attendance: [] as AttendanceRecord[],
  });
  const regularsIn = (lessons: Lesson[], month: string) =>
    lessons.filter((l) => l.type === "regular" && l.date.startsWith(month)).length;

  it("resolving Upcoming -> Completed leaves the month's denominator alone", () => {
    const k = klass({ studentIds: ["s1"] });
    const stored = JULY.map((d) => lesson(d));

    const after = applyLifecycle(stored, k);

    assert.equal(regularsIn(after.lessons, MONTH), regularsIn(stored, MONTH),
      "the count of stored Regular lessons is the per-lesson denominator");
    assert.equal(computeRevenue(MONTH, finance(k, stored)).total, 0, "Upcoming earns nothing");
    assert.equal(computeRevenue(MONTH, finance(k, after.lessons)).total, 1_200_000,
      "both lessons delivered = the full monthly fee for one student");
  });

  it("resolving Upcoming -> Cancelled deletes nothing and prorates the month", () => {
    const k = klass({ status: "Archived", studentIds: ["s1"] });
    // One already taught before the archive, one whose date passed after it.
    const stored = [lesson(JULY[0], { status: "Completed" }), lesson(JULY[1])];

    const after = applyLifecycle(stored, k);

    assert.equal(after.lessons.length, stored.length, "nothing is ever deleted");
    assert.equal(regularsIn(after.lessons, MONTH), 2, "the denominator is preserved");
    assert.equal(computeRevenue(MONTH, finance(k, after.lessons)).total, 600_000,
      "one of two lessons delivered = half the monthly fee, not the whole of it");
  });

  it("a chargeable Cancelled lesson keeps contributing across the transition", () => {
    const k = klass({ status: "Archived", studentIds: ["s1"] });
    const stored = [
      lesson(JULY[0], { status: "Cancelled", chargeable: true }),
      lesson(JULY[1]),
    ];

    const after = applyLifecycle(stored, k);

    assert.equal(after.lessons[0].chargeable, true, "existing chargeable semantics preserved");
    assert.equal(computeRevenue(MONTH, finance(k, after.lessons)).total, 600_000);
  });

  it("months with nothing eligible are financially identical before and after", () => {
    // The Gate 1.5 shape: historical lessons are Completed or Cancelled, so the
    // eligibility filter cannot reach them and a closed month cannot move.
    const k = klass({ studentIds: ["s1"] });
    const june = ["2026-06-03", "2026-06-10"].map((d) => lesson(d, { status: "Completed" }));

    const after = applyLifecycle(june, k);

    assert.equal(after.resolved, 0);
    assert.deepEqual(after.lessons, june);
    assert.deepEqual(computeRevenue("2026-06", finance(k, after.lessons)),
      computeRevenue("2026-06", finance(k, june)));
  });
});

/* ========================================================== the write surface */

describe("the executor's write surface is bounded", () => {
  const src = code("src", "lib", "lifecycle.ts");

  it("writes LessonModel and nothing else", () => {
    const writes = [...src.matchAll(
      /(\w*Model)\.(bulkWrite|updateOne|updateMany|deleteOne|deleteMany|insertOne|insertMany|create|findOneAndUpdate|findOneAndDelete|replaceOne)\b/g
    )];

    assert.ok(writes.length > 0, "the scan found no writes at all — the pattern has drifted");
    for (const m of writes) {
      assert.equal(m[1], "LessonModel", `the lifecycle must not write ${m[1]} (found ${m[0]})`);
    }
  });

  it("sets only `status` and `chargeable`", () => {
    const sets = [...src.matchAll(/\$set:\s*\{([^}]*)\}/g)].map((m) => m[1]);

    assert.ok(sets.length > 0, "no $set found — the scan has drifted");
    for (const body of sets) {
      const fields = [...body.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
      for (const f of fields) {
        assert.ok(["status", "chargeable"].includes(f), `the lifecycle must not write \`${f}\``);
      }
    }
  });

  it("never deletes", () => {
    assert.equal(/deleteOne|deleteMany|\$unset|\$pull/.test(src), false,
      "the lifecycle removes nothing — the revenue denominator must not move");
  });

  it("introduces no second clock", () => {
    assert.equal(/new Date\(/.test(src), false, "the app clock is TODAY_ISO, via isPastDate");
    assert.match(src, /isPastDate\(/, "the past-date boundary must have one definition");
  });
});

/* ============================================================== the call sites */

describe("the lifecycle is wired in at exactly the three approved places", () => {
  it("listLessons advances before it generates", () => {
    const src = code("src", "lib", "lessons.ts");
    const advance = src.indexOf("advanceLessonLifecycle()");
    const ensure = src.indexOf("ensureRegularLessons()", advance);

    assert.ok(advance > 0, "listLessons must advance the lifecycle");
    assert.ok(ensure > advance, "the lifecycle must run BEFORE generation");
  });

  it("the dashboard route advances before it reads, and repo stays a pure read", () => {
    const route = code("src", "app", "api", "dashboard", "route.ts");
    const advance = route.indexOf("advanceLessonLifecycle()");
    const getAll = route.indexOf("getAll()", advance);

    assert.ok(advance > 0, "the only path to computeRevenue must advance the lifecycle");
    assert.ok(getAll > advance, "the lifecycle must run before the read model is built");
    assert.equal(/advanceLessonLifecycle/.test(code("src", "lib", "repo.ts")), false,
      "repo.getAll must stay a pure read");
  });

  it("updateClass advances while the OLD class status is still stored", () => {
    const src = code("src", "lib", "classes.ts");
    const fn = src.slice(src.indexOf("export async function updateClass"));
    const advance = fn.indexOf("advanceLessonLifecycle(id)");
    const write = fn.indexOf("ClassModel.updateOne");

    assert.ok(advance > 0, "updateClass must advance the lifecycle");
    assert.ok(write > advance,
      "advancing AFTER the status write would let a restore turn an archived lesson into revenue");
  });

  it("no other module invokes the executor", () => {
    // One entry point per surface, deliberately. A stray call elsewhere would be a
    // write on a path nobody audited.
    for (const f of [
      ["src", "lib", "recurrence.ts"], ["src", "lib", "reconciler.ts"],
      ["src", "lib", "finance.ts"], ["src", "lib", "dashboard.ts"],
      ["src", "lib", "migration.ts"], ["src", "lib", "repo.ts"],
    ]) {
      assert.equal(/advanceLessonLifecycle/.test(code(...f)), false, `${f.join("/")} must not call it`);
    }
  });

  it("the pure core stays pure — recurrence.ts still opens no database", () => {
    const src = code("src", "lib", "recurrence.ts");
    assert.equal(/Model\.|dbConnect|mongoose/.test(src), false,
      "the lifecycle executor must not have leaked into the pure planner");
  });
});
