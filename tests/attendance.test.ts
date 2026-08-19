/* Attendance — eligibility, the register, and the write that must not erase
 * anything.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. Every rule Attendance embodies lives in
 * src/lib/attendance.ts as a function over plain values, so it is exercised
 * directly rather than through a database round trip. The write is the important
 * case: `planAttendanceWrite` returns the Mongo update as DATA precisely so a
 * test can assert which keys it touches, which it does not, and that a rejected
 * payload produces no operation at all.
 *
 * Guarantees that are NOT expressible as a function call — which model the
 * service writes, which it must never write, that opening a register persists
 * nothing — are asserted by scanning the source, the same technique
 * tests/lifecycle.test.ts and tests/class-lifecycle.test.ts already use for rules
 * that live inside a Mongo query.
 *
 * The end-to-end proof that the planned update really does preserve a hidden
 * sibling entry in MongoDB is NOT here, because it needs a database: it lives in
 * scripts/attendance-scratch-proof.ts and runs against a throwaway database.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10:
 *   past   : 2026-06-15, 2026-07-05, 2026-07-09
 *   today  : 2026-07-10   <- NOT past, by the `isPastDate` convention
 *   future : 2026-07-11, 2026-07-15
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ATTENDANCE_LESSON_TYPES, ATTENDANCE_ERROR, RECENT_LIMIT,
  attendanceEligibilityFor, buildAttendanceIndex, buildRegisterPayload, buildRegisterRows,
  planAttendanceWrite, resolveRoster, summarizeRegister,
} from "../src/lib/attendance";
import {
  draftFrom, isDirty, signatureOf, submitFrom, withAllPresent, withNote, withStatus,
  type Draft,
} from "../src/components/attendance/draft";
import { ATTENDANCE_STATUSES, attendanceSaveSchema } from "../src/lib/schemas";
import { computeRevenue, attendanceRate } from "../src/lib/finance";
import { resolvedStatusFor } from "../src/lib/lifecycle";
import type {
  AttendanceRecord, AttendanceStatus, Klass, Lesson, LessonStatus, LessonType, Student,
} from "../src/lib/types";

const APP_CLOCK = "2026-07-10";
const LAST_MONTH = "2026-06-15";
const PAST = "2026-07-05";
const PAST_MOVED = "2026-07-09";
const TODAY = "2026-07-10";
const FUTURE = "2026-07-15";
const MONTH = "2026-07";

/** A status the engine has never heard of, forced past the type system the way a
 * hand-edited document or a half-finished migration would arrive. */
const UNKNOWN_STATUS = "Pending" as unknown as LessonStatus;
const UNKNOWN_TYPE = "workshop" as unknown as LessonType;

/* ------------------------------------------------------------------ fixtures */

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Test Class", type: "group", level: "B1", fee: 1_200_000,
    classroom: "Room A", status: "Active", studentIds: ["s1", "s2"], notes: "",
    schedule: [{ day: 3, start: "14:30", duration: 45 }], color: "#d14242", ...over,
  };
}

function student(id: string, over: Partial<Student> = {}): Student {
  const n = Number(id.replace(/\D/g, "")) || 1;
  return {
    id, first: `First${n}`, last: `Last${n}`, name: `First${n} Last${n}`, initials: `F${n}`,
    birthday: "2014-01-01", age: 12, school: "PS 1", grade: 6, gradeLabel: "Grade 6",
    parentId: "", parentName: "", phone: "", status: "Active", notes: "",
    joined: "2025-01-01", classes: 1, attendance: 95, balance: 0,
    avatar: null, avatarColor: "#0284c7", ...over,
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

function record(lessonId: string, entries: AttendanceRecord["entries"]): AttendanceRecord {
  return { lessonId, entries };
}

const eligible = (l: Pick<Lesson, "type" | "status" | "date">) => attendanceEligibilityFor(l, APP_CLOCK);

/** A module's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE = code("src", "lib", "attendance.ts");
const SERVICE = code("src", "lib", "attendance-service.ts");
const TAKE_PAGE = code("src", "app", "(app)", "attendance", "[lessonId]", "page.tsx");
const INDEX_PAGE = code("src", "app", "(app)", "attendance", "page.tsx");
const FINANCE = code("src", "lib", "finance.ts");
const LESSONS = code("src", "lib", "lessons.ts");
const MODELS = code("src", "lib", "models.ts");

/* ========================================================== 1-11 eligibility */

describe("eligibility — what may be marked", () => {
  it("1-3. a Completed lesson of any supported type is eligible", () => {
    for (const type of ATTENDANCE_LESSON_TYPES) {
      const r = eligible(lesson(PAST, { type, status: "Completed" }));
      assert.deepEqual(r, { eligible: true, kind: "completed" }, `${type} Completed`);
    }
  });

  it("4-6. today's Upcoming lesson is eligible, for every supported type", () => {
    // Today is not past, so the lesson is still Upcoming while it is being
    // taught — and that is exactly when a teacher marks the register.
    for (const type of ATTENDANCE_LESSON_TYPES) {
      const r = eligible(lesson(TODAY, { type, status: "Upcoming" }));
      assert.deepEqual(r, { eligible: true, kind: "today" }, `${type} today`);
    }
  });

  it("7. a future lesson is not eligible", () => {
    assert.deepEqual(eligible(lesson(FUTURE)), { eligible: false, reason: "future" });
  });

  it("7b. a future lesson already marked Completed still fails as future", () => {
    // Order matters: the date is checked BEFORE the status, so a data fault
    // cannot buy itself a register. "Not yet" is the honest answer.
    assert.deepEqual(
      eligible(lesson(FUTURE, { status: "Completed" })),
      { eligible: false, reason: "future" }
    );
  });

  it("8-9. a Cancelled lesson is out of scope, chargeable or not", () => {
    for (const chargeable of [true, false]) {
      assert.deepEqual(
        eligible(lesson(PAST, { status: "Cancelled", chargeable })),
        { eligible: false, reason: "cancelled" },
        `chargeable: ${chargeable}`
      );
    }
  });

  it("10. an unrecognised status fails closed", () => {
    assert.deepEqual(
      eligible(lesson(PAST, { status: UNKNOWN_STATUS })),
      { eligible: false, reason: "unsupported_status" }
    );
    assert.deepEqual(
      eligible(lesson(TODAY, { status: UNKNOWN_STATUS })),
      { eligible: false, reason: "unsupported_status" }
    );
  });

  it("10b. an unrecognised lesson type fails closed, before anything else", () => {
    assert.deepEqual(
      eligible(lesson(PAST, { type: UNKNOWN_TYPE, status: "Completed" })),
      { eligible: false, reason: "unsupported_type" }
    );
  });

  it("11. a PAST lesson still Upcoming fails closed until the lifecycle resolves it", () => {
    // This is the unresolved state, not an eligible one: the lifecycle has not
    // yet said whether the class was Active (Completed) or Archived (Cancelled),
    // and marking a register for a lesson that may turn out to be cancelled would
    // be inventing history.
    assert.deepEqual(eligible(lesson(PAST)), { eligible: false, reason: "unsupported_status" });
    assert.deepEqual(eligible(lesson(PAST_MOVED)), { eligible: false, reason: "unsupported_status" });

    // …and once the ordinary Sprint 5 lifecycle HAS resolved it, it is eligible.
    const resolved = resolvedStatusFor(lesson(PAST), klass(), APP_CLOCK);
    assert.equal(resolved, "Completed");
    assert.deepEqual(
      eligible(lesson(PAST, { status: resolved! })),
      { eligible: true, kind: "completed" }
    );
  });

  it("the API enforces eligibility itself, rather than trusting a hidden button", () => {
    // Both service entry points call the authority; neither takes the client's
    // word for it.
    const calls = SERVICE.match(/attendanceEligibilityFor\(/g) ?? [];
    assert.ok(calls.length >= 2, "both read and save must check eligibility");
  });
});

/* ====================================================== 12-16 default / read */

describe("the default register is a read, never a write", () => {
  const roster = resolveRoster(["s1", "s2"], [student("s1"), student("s2")]);

  it("12. with no record, every resolvable student defaults to Present with no note", () => {
    const rows = buildRegisterRows(roster, undefined);
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.note, r.saved]), [
      ["s1", "Present", "", false],
      ["s2", "Present", "", false],
    ]);
  });

  it("13. reading a register performs zero Attendance writes", () => {
    // Everything between the read's start and its return is a find. The only
    // write verbs in the module belong to the SAVE path, and there is exactly one.
    const read = SERVICE.slice(
      SERVICE.indexOf("export async function getAttendanceRegister"),
      SERVICE.indexOf("async function studentsForRoster")
    );
    assert.ok(read.length > 0, "could not isolate the read path");
    for (const verb of ["updateOne", "updateMany", "create", "insertMany", "bulkWrite", "deleteOne", "deleteMany", "findOneAndUpdate", "save("]) {
      assert.ok(!read.includes(verb), `the read path must not call ${verb}`);
    }
    // And building the default rows is pure — it returns values, it cannot write.
    assert.ok(!CORE.includes("AttendanceModel"), "the pure core must not touch a model");
  });

  it("14. a roster id with no Student document is omitted", () => {
    const rows = buildRegisterRows(
      resolveRoster(["s1", "ghost", "s2"], [student("s1"), student("s2")]),
      undefined
    );
    assert.deepEqual(rows.map((r) => r.id), ["s1", "s2"]);
  });

  it("15. a stored entry for a student who no longer exists is never exposed", () => {
    const rows = buildRegisterRows(roster, {
      s1: { status: "Late" },
      deleted: { status: "Absent", note: "gone" },
    });
    assert.deepEqual(rows.map((r) => r.id), ["s1", "s2"]);
    assert.ok(!JSON.stringify(rows).includes("deleted"));
    assert.ok(!JSON.stringify(rows).includes("gone"));
  });

  it("16. an empty visible roster is supported and rates null, not 0%", () => {
    const rows = buildRegisterRows(resolveRoster([], []), undefined);
    assert.deepEqual(rows, []);
    assert.equal(summarizeRegister(rows).rate, null);
  });

  it("a stored status this app does not recognise falls back without hiding the record", () => {
    const rows = buildRegisterRows(roster, {
      s1: { status: "Tardy" as unknown as AttendanceStatus },
    });
    assert.equal(rows[0].status, "Present");
    assert.equal(rows[0].saved, true, "the record exists and must not read as absent");
  });

  it("a duplicated roster id is still one seat", () => {
    assert.deepEqual(resolveRoster(["s1", "s1"], [student("s1")]).map((r) => r.id), ["s1"]);
  });
});

/* ====================================================== 17-27 write planner */

const VISIBLE = new Set(["s2", "s3"]);
const plan = (submitted: Parameters<typeof planAttendanceWrite>[2], visible = VISIBLE) =>
  planAttendanceWrite("L1", visible, submitted);

describe("the write planner — exactly what a save may touch", () => {
  it("17. a first save emits one upsert, filtered on the lesson", () => {
    const r = plan({ s2: { status: "Late" } });
    assert.ok(r.ok);
    assert.deepEqual(r.plan.filter, { lessonId: "L1" });
    assert.equal(r.plan.upsert, true);
    assert.deepEqual(Object.keys(r.plan.update).sort(), ["$set", "$setOnInsert"]);
  });

  it("18. an all-Present first save still creates the record", () => {
    // SAVE-PRESENT-A: financially identical to no record, historically different.
    // The teacher said "I checked", and the index has to be able to show that.
    const r = plan({ s2: { status: "Present" }, s3: { status: "Present" } });
    assert.ok(r.ok);
    assert.deepEqual(r.plan.update.$setOnInsert, { lessonId: "L1" });
    assert.deepEqual(r.plan.update.$set, {
      "entries.s2": { status: "Present" },
      "entries.s3": { status: "Present" },
    });
  });

  it("19. an identical payload produces an identical plan", () => {
    const a = plan({ s3: { status: "Absent" }, s2: { status: "Late", note: "Bus" } });
    // Same content, different key order — the plan must not depend on it.
    const b = plan({ s2: { status: "Late", note: "Bus" }, s3: { status: "Absent" } });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.plan, b.plan);
    assert.equal(JSON.stringify(a.plan), JSON.stringify(b.plan));
  });

  it("20. an id outside the visible roster is rejected, with zero operations", () => {
    const r = plan({ s2: { status: "Late" }, intruder: { status: "Absent" } });
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.reason, "invalid_student");
    assert.deepEqual(r.invalidIds, ["intruder"]);
    // No partial plan escapes: the failure carries no update at all, so the valid
    // half of the payload cannot be written "helpfully".
    assert.ok(!("plan" in r));
  });

  it("21. a hidden key never appears in the emitted update paths", () => {
    const r = plan({ s2: { status: "Late" }, s3: { status: "Present" } });
    assert.ok(r.ok);
    const paths = Object.keys(r.plan.update.$set!);
    assert.deepEqual(paths, ["entries.s2", "entries.s3"]);
    assert.ok(!paths.some((p) => p.includes("deletedStudent")));
    // Every path addresses ONE student. Nothing addresses `entries` itself.
    for (const p of paths) assert.match(p, /^entries\.[^.]+$/);
  });

  it("22. a visible entry is written as a complete object, not field by field", () => {
    const r = plan({ s2: { status: "Late", note: "Bus" } });
    assert.ok(r.ok);
    assert.deepEqual(r.plan.update.$set, { "entries.s2": { status: "Late", note: "Bus" } });
    assert.ok(!("entries.s2.status" in r.plan.update.$set!), "must not patch a subfield");
  });

  it("23. clearing a note removes it, because the whole entry is replaced", () => {
    const r = plan({ s2: { status: "Late", note: "" } });
    assert.ok(r.ok);
    assert.deepEqual(r.plan.update.$set, { "entries.s2": { status: "Late" } });
    assert.ok(!("note" in r.plan.update.$set!["entries.s2"]));
  });

  it("a non-empty note is preserved exactly — no trimming, no truncation, Unicode intact", () => {
    const note = "  Nghỉ ốm — bố mẹ đã báo trước 😀  ";
    const r = plan({ s2: { status: "Excused", note } });
    assert.ok(r.ok);
    assert.equal(r.plan.update.$set!["entries.s2"].note, note);
  });

  it("24-25. `date` appears in neither $set nor $setOnInsert", () => {
    const r = plan({ s2: { status: "Present" } });
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.plan.update.$setOnInsert), ["lessonId"]);
    assert.ok(!JSON.stringify(r.plan.update).includes('"date"'));
    // And the planner itself never mentions the legacy field.
    const planner = CORE.slice(
      CORE.indexOf("export function planAttendanceWrite"),
      CORE.indexOf("export interface AttendanceStatCounts")
    );
    assert.ok(planner.length > 0, "could not isolate the planner");
    assert.ok(!/\bdate\b/.test(planner));
  });

  it("26. no timestamps are written, and the schema declares none", () => {
    const r = plan({ s2: { status: "Present" } });
    assert.ok(r.ok);
    const json = JSON.stringify(r.plan.update);
    assert.ok(!json.includes("createdAt") && !json.includes("updatedAt"));
    // AttendanceSchema must not opt into Mongoose timestamps.
    const schema = MODELS.slice(MODELS.indexOf("const AttendanceSchema"), MODELS.indexOf("const BillingSchema"));
    assert.ok(!schema.includes("timestamps"), "AttendanceSchema must not enable timestamps");
  });

  it("27. the entries object is never replaced wholesale, and nothing is removed", () => {
    const r = plan({ s2: { status: "Late" } });
    assert.ok(r.ok);
    assert.ok(!("entries" in r.plan.update.$set!), "a bare `entries` key would wipe hidden siblings");
    for (const op of ["$unset", "$pull", "$pop", "$rename"]) {
      assert.ok(!JSON.stringify(r.plan.update).includes(op), `${op} must never be planned`);
    }
    // …nor may the module reach for a destructive verb anywhere.
    for (const verb of ["$unset", "$pull", "deleteOne", "deleteMany", "replaceOne"]) {
      assert.ok(!CORE.includes(verb) && !SERVICE.includes(verb), `${verb} must not appear`);
    }
  });

  it("an empty submission still creates the record, with a legal update", () => {
    // An empty `$set` is not a valid Mongo update, so it is omitted entirely.
    const r = plan({}, new Set<string>());
    assert.ok(r.ok);
    assert.deepEqual(r.plan.update, { $setOnInsert: { lessonId: "L1" } });
  });

  it("the payload schema validates shape only, and leaves membership to the service", () => {
    const good = attendanceSaveSchema.safeParse({ entries: { s2: { status: "Late" } } });
    assert.ok(good.success);
    assert.equal(good.data.entries.s2.note, "", "an omitted note defaults to the project convention");

    assert.equal(attendanceSaveSchema.safeParse({ entries: { s2: { status: "Nope" } } }).success, false);
    assert.equal(attendanceSaveSchema.safeParse({ entries: { "": { status: "Late" } } }).success, false);
    assert.equal(attendanceSaveSchema.safeParse({}).success, false, "entries is required");
    // A student id nobody has ever heard of is SHAPE-valid: Zod cannot know a
    // roster, which is precisely why the service re-checks.
    assert.equal(attendanceSaveSchema.safeParse({ entries: { ghost: { status: "Late" } } }).success, true);
  });

  it("the runtime status list is the single source, and is exhaustive", () => {
    assert.deepEqual([...ATTENDANCE_STATUSES].sort(), ["Absent", "Excused", "Late", "Present"]);
    // The compile-time half of this guarantee is ATTENDANCE_STATUSES_ARE_EXHAUSTIVE
    // in lib/schemas: adding a status to the type without adding it here fails
    // `npx tsc`, which this suite cannot express but the build does.
  });
});

/* ================================================== 28-33 revenue / statuses */

describe("status semantics reach revenue without the formula changing", () => {
  const students = [student("s1"), student("s2")];
  const classes = [klass({ fee: 1_000_000, studentIds: ["s1", "s2"] })];
  // One regular lesson this month, so per-lesson value = the whole monthly fee.
  const lessons = [lesson(PAST, { status: "Completed" })];
  const revenueWith = (entries: AttendanceRecord["entries"]) =>
    computeRevenue(MONTH, {
      classes, students, lessons,
      attendance: [record(lessons[0].id, entries)],
    }).total;

  const bothPresent = revenueWith({ s1: { status: "Present" }, s2: { status: "Present" } });

  it("28-30. Present, Late and Excused all contribute full revenue", () => {
    for (const status of ["Present", "Late", "Excused"] as AttendanceStatus[]) {
      assert.equal(
        revenueWith({ s1: { status }, s2: { status: "Present" } }),
        bothPresent,
        `${status} must be worth a full share`
      );
    }
  });

  it("31. Absent is the only status that withholds a student's contribution", () => {
    const withAbsent = revenueWith({ s1: { status: "Absent" }, s2: { status: "Present" } });
    assert.equal(withAbsent, bothPresent / 2);
  });

  it("32. the denominator does not move — attendance changes the amount, not the baseline", () => {
    // Per-lesson value is monthly fee ÷ REGULAR lessons scheduled. Attendance is
    // not in that division, so marking everyone absent cannot inflate anyone
    // else's share.
    const allAbsent = revenueWith({ s1: { status: "Absent" }, s2: { status: "Absent" } });
    assert.equal(allAbsent, 0);
    // Two enrolled students, one Regular lesson, fee 1,000,000 — each student's
    // share IS the per-lesson value, so a full register is worth 2,000,000. The
    // shares do not divide the fee between the students; that is the rule.
    assert.equal(bothPresent, 2_000_000);
  });

  it("33. no record and an all-Present record are financially identical", () => {
    const none = computeRevenue(MONTH, { classes, students, lessons, attendance: [] }).total;
    assert.equal(none, bothPresent);
    // …but they are NOT the same historically, which is why the save still writes.
    assert.equal(attendanceRate(MONTH, { lessons, attendance: [] }), 0);
    assert.equal(
      attendanceRate(MONTH, { lessons, attendance: [record(lessons[0].id, { s1: { status: "Present" }, s2: { status: "Present" } })] }),
      100
    );
  });
});

/* ============================================================== 34-38 today */

describe("today's Upcoming lesson", () => {
  const l = lesson(TODAY, { status: "Upcoming" });
  const students = [student("s1"), student("s2")];
  const classes = [klass({ fee: 1_000_000 })];

  it("34. is eligible for attendance", () => {
    assert.deepEqual(eligible(l), { eligible: true, kind: "today" });
  });

  it("35. saving does not complete it — Attendance never writes a lesson status", () => {
    // The planner's filter and update mention the Attendance collection alone.
    const r = planAttendanceWrite(l.id, new Set(["s1"]), { s1: { status: "Absent" } });
    assert.ok(r.ok);
    assert.ok(!JSON.stringify(r.plan).includes("status: \"Completed\""));
    const save = SERVICE.slice(SERVICE.indexOf("export async function saveAttendanceRegister"));
    assert.ok(!/LessonModel\.(updateOne|updateMany|bulkWrite|create|deleteOne|findOneAndUpdate)/.test(save));
  });

  it("36. immediate revenue is unchanged, because the lesson is still Upcoming", () => {
    const lessons = [l];
    const before = computeRevenue(MONTH, { classes, students, lessons, attendance: [] }).total;
    const after = computeRevenue(MONTH, {
      classes, students, lessons,
      attendance: [record(l.id, { s1: { status: "Absent" }, s2: { status: "Present" } })],
    }).total;
    assert.equal(before, 0, "an Upcoming lesson contributes nothing");
    assert.equal(after, 0);
    // The monthly rate is unmoved too — it counts Completed lessons only.
    assert.equal(attendanceRate(MONTH, { lessons, attendance: [record(l.id, { s1: { status: "Absent" } })] }), 0);
  });

  it("37. once the lifecycle completes the lesson, the saved Absent starts counting", () => {
    const att = [record(l.id, { s1: { status: "Absent" }, s2: { status: "Present" } })];
    const resolved = resolvedStatusFor(l, klass(), "2026-07-11");
    assert.equal(resolved, "Completed");
    const lessons = [{ ...l, status: resolved! }];
    assert.equal(computeRevenue(MONTH, { classes, students, lessons, attendance: att }).total, 1_000_000);
    assert.equal(attendanceRate(MONTH, { lessons, attendance: att }), 50);
  });

  it("38. the lifecycle writes lesson status only, and never touches Attendance", () => {
    const LIFECYCLE = code("src", "lib", "lifecycle.ts");
    assert.ok(!LIFECYCLE.includes("AttendanceModel"), "the lifecycle must not know about registers");
    assert.ok(!LIFECYCLE.includes("entries"));
  });
});

/* ================================================== 39-42 historical editing */

describe("historical correction", () => {
  const students = [student("s1"), student("s2")];
  const classes = [klass({ fee: 1_000_000 })];
  const june = lesson(LAST_MONTH, { status: "Completed", id: "L-c1-2026-06-15-1430" });

  it("39. a past Completed register is editable through the same path", () => {
    assert.deepEqual(eligible(june), { eligible: true, kind: "completed" });
    // No separate historical endpoint, no month lock, no dated guard anywhere.
    for (const src of [CORE, SERVICE]) {
      assert.ok(!/closedMonth|monthLock|isClosed|pastMonth/i.test(src));
    }
  });

  it("40. Present -> Absent changes that month's derived revenue and rate", () => {
    const input = { classes, students, lessons: [june] };
    const before = record(june.id, { s1: { status: "Present" }, s2: { status: "Present" } });
    const after = record(june.id, { s1: { status: "Absent" }, s2: { status: "Present" } });

    assert.equal(computeRevenue("2026-06", { ...input, attendance: [before] }).total, 2_000_000);
    assert.equal(computeRevenue("2026-06", { ...input, attendance: [after] }).total, 1_000_000);
    assert.equal(attendanceRate("2026-06", { lessons: [june], attendance: [before] }), 100);
    assert.equal(attendanceRate("2026-06", { lessons: [june], attendance: [after] }), 50);
    // This is intended: an explicit teacher correction is allowed to move a
    // closed month. What is NOT allowed is an automatic process doing it.
  });

  it("41-42. the lesson, the class and billing are untouched by the correction", () => {
    const r = planAttendanceWrite(june.id, new Set(["s1", "s2"]), {
      s1: { status: "Absent" }, s2: { status: "Present" },
    });
    assert.ok(r.ok);
    const json = JSON.stringify(r.plan);
    for (const foreign of ["classId", "fee", "chargeable", "billing", "Billing"]) {
      assert.ok(!json.includes(foreign), `${foreign} must not appear in an Attendance write`);
    }
  });
});

/* ============================================ 43-45 missing/deleted students */

describe("students who are gone, and students who are merely not Active", () => {
  it("43. a hidden orphan entry is untouched by a save of the visible register", () => {
    // The write mentions only the visible keys, so Mongo cannot reach the others.
    // The end-to-end proof against a real database is the scratch-DB script.
    const r = planAttendanceWrite("L1", new Set(["visibleA", "visibleB"]), {
      visibleA: { status: "Late", note: "" },
      visibleB: { status: "Present" },
    });
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.plan.update.$set!), ["entries.visibleA", "entries.visibleB"]);
    assert.ok(!JSON.stringify(r.plan).includes("deletedStudent"));
  });

  it("44. a client naming a hidden id is refused outright", () => {
    const r = planAttendanceWrite("L1", new Set(["visibleA", "visibleB"]), {
      visibleA: { status: "Present" },
      deletedStudent: { status: "Absent" },
    });
    assert.ok(!r.ok);
    assert.equal(r.reason, "invalid_student");
    assert.equal(ATTENDANCE_ERROR.invalid_student.status, 422);
  });

  it("45. a Paused, Trial or Archived roster student still appears", () => {
    // Membership is "does the document exist", NOT "is the student Active". The
    // register shows the people in the room; finance's Archived rule is a
    // different question with a different answer, and is deliberately not copied.
    const roster = ["s1", "s2", "s3", "s4"];
    const students = [
      student("s1", { status: "Active" }), student("s2", { status: "Trial" }),
      student("s3", { status: "Paused" }), student("s4", { status: "Archived" }),
    ];
    assert.deepEqual(resolveRoster(roster, students).map((r) => r.id), roster);
    assert.ok(!CORE.includes('status !== "Archived"'), "the roster must not filter by student status");
  });
});

/* =============================================================== 46-48 date */

describe("the Lesson owns the date", () => {
  it("46. a legacy AttendanceRecord.date is left exactly as it is", () => {
    const r = planAttendanceWrite("L1", new Set(["s1"]), { s1: { status: "Late" } });
    assert.ok(r.ok);
    // Nothing in the update addresses `date`, so an existing one is neither
    // updated nor removed — the field is simply not part of the conversation.
    assert.ok(!Object.keys(r.plan.update.$set!).some((k) => k.includes("date")));
    assert.ok(!("date" in r.plan.update.$setOnInsert));
  });

  it("47. a new record's write plan contains no date at all", () => {
    const r = planAttendanceWrite("L-new", new Set(["s1"]), { s1: { status: "Present" } });
    assert.ok(r.ok);
    assert.deepEqual(r.plan.update.$setOnInsert, { lessonId: "L-new" });
  });

  it("48. every reader resolves the date through the Lesson", () => {
    const payload = buildRegisterPayload(
      lesson(PAST, { status: "Completed" }),
      klass(),
      [student("s1"), student("s2")],
      // A record whose legacy date DISAGREES with the lesson, exactly as some
      // live records do after a reschedule.
      { lessonId: "L-c1-2026-07-05-1430", date: "2026-01-01", entries: {} }
    );
    assert.equal(payload.lesson.date, PAST, "the lesson's date wins");
    assert.ok(!JSON.stringify(payload).includes("2026-01-01"));
    // …and the payload never carries the legacy field forward.
    assert.ok(!("date" in (payload as unknown as Record<string, unknown>)));
  });
});

/* ============================================================== 49-56 index */

describe("the index screen's payload", () => {
  const classes = [
    klass({ id: "c1", name: "Alpha", color: "#d14242", studentIds: ["s1", "s2"] }),
    klass({ id: "c2", name: "Beta", color: "#0284c7", studentIds: ["s1"] }),
  ];
  const students = [student("s1"), student("s2")];

  const todayA = lesson(TODAY, { id: "T-1", start: "09:00" });
  const todayB = lesson(TODAY, { id: "T-2", start: "14:00", classId: "c2" });
  const todayCancelled = lesson(TODAY, { id: "T-3", start: "16:00", status: "Cancelled" });
  const future = lesson(FUTURE, { id: "F-1" });
  const pastUpcoming = lesson(PAST, { id: "U-1" }); // unresolved
  const done = (n: number, date: string, start = "10:00", over: Partial<Lesson> = {}) =>
    lesson(date, { id: `D-${n}`, start, status: "Completed", ...over });

  const past = [
    done(1, "2026-07-09"), done(2, "2026-07-08"), done(3, "2026-07-07"), done(4, "2026-07-06"),
    done(5, "2026-07-03"), done(6, "2026-07-02"), done(7, "2026-07-01"), done(8, "2026-06-30"),
    done(9, "2026-06-29"),
  ];

  const lessons = [todayA, todayB, todayCancelled, future, pastUpcoming, ...past];
  const attendance = [
    record("D-1", { s1: { status: "Present" }, s2: { status: "Absent" } }),
    record("T-1", { s1: { status: "Present" }, s2: { status: "Present" } }),
  ];
  const index = buildAttendanceIndex({ classes, students, lessons, attendance }, MONTH, APP_CLOCK);

  it("49. Today holds today's eligible lessons, sorted by start time", () => {
    assert.deepEqual(index.today.map((c) => c.lessonId), ["T-1", "T-2"]);
    assert.deepEqual(index.today.map((c) => c.start), ["09:00", "14:00"]);
  });

  it("49b. a lesson cancelled today is not offered as something to take", () => {
    assert.ok(!index.today.some((c) => c.lessonId === "T-3"));
  });

  it("50. future lessons appear nowhere", () => {
    const json = JSON.stringify(index);
    assert.ok(!json.includes("F-1"));
  });

  it("51. Recent holds past COMPLETED lessons only", () => {
    assert.ok(!index.recent.some((c) => c.lessonId === "U-1"), "an unresolved past lesson is not history");
    assert.ok(!index.recent.some((c) => c.date >= APP_CLOCK), "today is not 'recent'");
    assert.ok(index.recent.every((c) => c.lessonId.startsWith("D-")));
  });

  it("51b. Recent covers all three lesson types", () => {
    const mixed = buildAttendanceIndex(
      {
        classes, students, attendance: [],
        lessons: [
          done(10, PAST, "09:00", { type: "regular" }),
          done(11, PAST, "10:00", { type: "makeup" }),
          done(12, PAST, "11:00", { type: "extra" }),
        ],
      },
      MONTH, APP_CLOCK
    );
    assert.deepEqual(mixed.recent.map((c) => c.type).sort(), ["extra", "makeup", "regular"]);
  });

  it("52. Recent is newest first", () => {
    const dates = index.recent.map((c) => c.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(dates[0], "2026-07-09");
  });

  it("53. Recent is capped at 8, with no pager", () => {
    assert.equal(RECENT_LIMIT, 8);
    assert.equal(index.recent.length, 8);
    // …and the screen offers no pager, no search and no filters, because the
    // imported design has none and missing UI is never invented.
    assert.ok(!/pageSize|setPage|pageCount|paginat/i.test(INDEX_PAGE));
    assert.ok(!INDEX_PAGE.includes("chipStyle"), "no filter chips");
    assert.ok(!INDEX_PAGE.includes("<input"), "no search or date input");
    assert.ok(!INDEX_PAGE.includes("useState"), "the screen holds no filter state at all");
  });

  it("54. taken / not-taken is driven by whether a record exists", () => {
    const t1 = index.today.find((c) => c.lessonId === "T-1")!;
    const t2 = index.today.find((c) => c.lessonId === "T-2")!;
    assert.equal(t1.taken, true);
    assert.equal(t1.rate, 100, "a taken card shows the register's own figure");
    assert.equal(t2.taken, false);
    assert.equal(t2.rate, null);

    const d1 = index.recent.find((c) => c.lessonId === "D-1")!;
    assert.equal(d1.taken, true);
    assert.equal(d1.rate, 50);
    assert.equal(index.recent.find((c) => c.lessonId === "D-2")!.taken, false);
  });

  it("55. a class with no stored attendance this month is omitted, not shown as 0%", () => {
    // c1 has one Completed lesson with a register (D-1); c2 has none.
    assert.deepEqual(index.byClass.map((c) => c.classId), ["c1"]);
    assert.ok(!index.byClass.some((c) => c.rate === 0 && c.classId === "c2"));
  });

  it("55b. the by-class rate is `attendanceRate` over that class's lessons — not a second formula", () => {
    const c1Lessons = lessons.filter((l) => l.classId === "c1" && l.date.startsWith(MONTH));
    assert.equal(index.byClass[0].rate, attendanceRate(MONTH, { lessons: c1Lessons, attendance }));
  });

  it("56. the four monthly status counts share the rate's denominator", () => {
    const { present, late, absent, excused, entries, rate } = index.summary;
    // Counted over Completed lessons of the month with a register: D-1 only.
    // T-1 is today and still Upcoming, so its register is not in this month's
    // reporting yet — the same rule `attendanceRate` already applies.
    assert.deepEqual({ present, late, absent, excused }, { present: 1, late: 0, absent: 1, excused: 0 });
    assert.equal(entries, 2);
    assert.equal(present + late + absent + excused, entries);
    assert.equal(rate, attendanceRate(MONTH, { lessons, attendance }));
    assert.equal(rate, 50);
  });

  it("the resolvable student count is what the register will show", () => {
    const withGhost = buildAttendanceIndex(
      {
        classes: [klass({ id: "c1", studentIds: ["s1", "ghost", "s2"] })],
        students, attendance: [], lessons: [todayA],
      },
      MONTH, APP_CLOCK
    );
    assert.equal(withGhost.today[0].studentCount, 2);
  });
});

/* ================================================== 57-65 local UI behaviour */

describe("the register's local state", () => {
  const rows = buildRegisterRows(
    resolveRoster(["s1", "s2", "s3"], [student("s1"), student("s2"), student("s3")]),
    { s1: { status: "Absent", note: "Sick" }, s2: { status: "Late" } }
  );
  const baseline: Draft = draftFrom(rows);

  it("57. Mark all present changes statuses only", () => {
    const next = withAllPresent(baseline, rows);
    assert.deepEqual(Object.values(next).map((e) => e.status), ["Present", "Present", "Present"]);
  });

  it("58. Mark all present preserves every note", () => {
    const next = withAllPresent(baseline, rows);
    assert.equal(next.s1.note, "Sick", "a note is the teacher's own words");
    assert.equal(next.s2.note, "");
    assert.equal(next.s3.note, "");
  });

  it("59. pressing one segment changes exactly one row", () => {
    const next = withStatus(baseline, "s2", "Excused");
    assert.equal(next.s2.status, "Excused");
    assert.equal(next.s2.note, "", "the row keeps its note");
    assert.deepEqual(next.s1, baseline.s1);
    assert.deepEqual(next.s3, baseline.s3);
  });

  it("60. typing a note changes exactly one row", () => {
    const next = withNote(baseline, "s3", "Late bus");
    assert.equal(next.s3.note, "Late bus");
    assert.equal(next.s3.status, "Present", "the row keeps its status");
    assert.deepEqual(next.s1, baseline.s1);
    assert.deepEqual(next.s2, baseline.s2);
  });

  it("61. dirty tracks the draft against the server's baseline, and a save clears it", () => {
    assert.equal(isDirty(rows, baseline, baseline), false);
    const edited = withStatus(baseline, "s1", "Present");
    assert.equal(isDirty(rows, edited, baseline), true);
    // Saving replaces the baseline with what the server confirmed.
    const savedRows = buildRegisterRows(
      resolveRoster(["s1", "s2", "s3"], [student("s1"), student("s2"), student("s3")]),
      { s1: { status: "Present", note: "Sick" }, s2: { status: "Late" } }
    );
    const newBaseline = draftFrom(savedRows);
    assert.equal(isDirty(savedRows, newBaseline, newBaseline), false);
    // An identical server response does not reset a form mid-edit.
    assert.equal(signatureOf(rows), signatureOf(draftRowsAgain()), "the signature is content-based");
  });

  it("the save payload is the complete visible register", () => {
    const entries = submitFrom(rows, withStatus(baseline, "s2", "Absent"));
    assert.deepEqual(Object.keys(entries).sort(), ["s1", "s2", "s3"]);
    assert.equal(entries.s2.status, "Absent");
    assert.equal(entries.s1.note, "Sick");
  });

  it("62. no 'Last updated' is rendered, because no trustworthy timestamp exists", () => {
    assert.ok(!/Last updated/i.test(TAKE_PAGE));
    assert.ok(!/updatedLabel|updatedAt|NOW_STAMP|rescheduledAt|Date\.now|new Date\(\)/.test(TAKE_PAGE));
    // The design's slot is occupied by the Unsaved changes indicator, which IS
    // backed by real local state.
    assert.ok(TAKE_PAGE.includes("Unsaved changes"));
  });

  it("63. there is no past-month warning or banner", () => {
    assert.ok(!/banner|warning|closed month|past month/i.test(TAKE_PAGE));
  });

  it("64-65. there is no overwrite dialog and no unsaved-navigation dialog", () => {
    for (const src of [TAKE_PAGE, INDEX_PAGE]) {
      assert.ok(!/ConfirmDialog|beforeunload|confirm\(|Are you sure/i.test(src));
    }
    // The register screen deliberately imports no dialog component at all.
    assert.ok(!TAKE_PAGE.includes("@/components/ui/dialog"));
  });

  /** The same rows, rebuilt — a "refetch that changed nothing". */
  function draftRowsAgain() {
    return buildRegisterRows(
      resolveRoster(["s1", "s2", "s3"], [student("s1"), student("s2"), student("s3")]),
      { s1: { status: "Absent", note: "Sick" }, s2: { status: "Late" } }
    );
  }
});

/* ==================================================== 66-75 isolation checks */

describe("Attendance stays inside its own module", () => {
  it("66-70. the writer touches AttendanceModel and nothing else", () => {
    const models = [...SERVICE.matchAll(/\b(\w+Model)\.\w+/g)].map((m) => m[1]);
    const written = [...SERVICE.matchAll(/\b(\w+Model)\.(updateOne|updateMany|create|insertMany|bulkWrite|deleteOne|deleteMany|findOneAndUpdate|replaceOne)/g)]
      .map((m) => m[1]);
    assert.deepEqual([...new Set(written)], ["AttendanceModel"], "only Attendance may be written");
    // The other models appear, but only as reads.
    assert.deepEqual(
      [...new Set(models)].sort(),
      ["AttendanceModel", "ClassModel", "LessonModel", "StudentModel"]
    );
    for (const forbidden of ["BillingModel", "HomeworkModel", "ReviewModel", "ParentModel"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} is not Attendance's business`);
    }
  });

  it("70b. no billing or finance write exists anywhere in the module", () => {
    for (const src of [CORE, SERVICE]) {
      assert.ok(!/Billing|balance|invoice/i.test(src));
    }
  });

  it("71. the finance formulas are unmodified and are reused, not restated", () => {
    // Attendance calls attendanceRate; it does not carry a copy.
    assert.ok(CORE.includes("attendanceRate"), "the monthly rate must be the existing function");
    assert.ok(!CORE.includes("export function attendanceRate"), "and must not be redefined here");
    assert.ok(!CORE.includes("computeRevenue"));
    // The two formulas whose semantics this sprint depends on, still saying what
    // they said: Present/Late/Excused attend, Absent alone withholds.
    assert.ok(FINANCE.includes('st === "Present" || st === "Late" || st === "Excused"'));
    assert.ok(FINANCE.includes('if (st === "Absent") continue;'));
    assert.ok(FINANCE.includes('l.status === "Completed" || (l.status === "Cancelled" && l.chargeable === true)'));
  });

  it("72. no migration or seed path is involved", () => {
    for (const src of [CORE, SERVICE]) {
      assert.ok(!/migration|seed|backfill|remediat/i.test(src));
    }
  });

  it("73. forward-only generation is untouched, and Attendance never generates", () => {
    for (const src of [CORE, SERVICE]) {
      assert.ok(!src.includes("ensureRegularLessons"), "Attendance must not generate lessons");
    }
    assert.ok(!code("src", "app", "api", "attendance", "route.ts").includes("ensureRegularLessons"));
    // The Lessons module still refuses to create anything in the past.
    assert.ok(LESSONS.includes("isPastDate"));
  });

  it("74. the Sprint 5 lifecycle is called, never reimplemented", () => {
    assert.ok(SERVICE.includes("advanceLessonLifecycle"));
    assert.ok(!SERVICE.includes("resolvedStatusFor"), "the transition has one definition");
    assert.ok(!CORE.includes("advanceLessonLifecycle"), "the pure core stays out of the database");
  });

  it("75. reschedule handling is not touched", () => {
    for (const src of [CORE, SERVICE, TAKE_PAGE, INDEX_PAGE]) {
      assert.ok(!/reschedul/i.test(src));
    }
  });

  it("the pure core imports nothing that would drag a database into a test", () => {
    for (const forbidden of ["server-only", "mongoose", "dbConnect", "./models", "./db"]) {
      assert.ok(!CORE.includes(forbidden), `the pure core must not import ${forbidden}`);
    }
  });

  it("the service is the only place Attendance reaches the database", () => {
    assert.ok(SERVICE.includes('import "server-only"'));
    for (const page of [TAKE_PAGE, INDEX_PAGE]) {
      assert.ok(!page.includes("attendance-service"), "a client page must not import the service");
      assert.ok(!page.includes("AttendanceModel"));
    }
  });

  it("every error reason maps to a status and a message", () => {
    assert.deepEqual(Object.keys(ATTENDANCE_ERROR).sort(), [
      "class_not_found", "invalid_student", "not_eligible", "not_found",
    ]);
    assert.equal(ATTENDANCE_ERROR.not_found.status, 404);
    assert.equal(ATTENDANCE_ERROR.class_not_found.status, 404);
    assert.equal(ATTENDANCE_ERROR.not_eligible.status, 422);
    // Wording reused from LESSON_ERROR so the app answers alike.
    assert.equal(ATTENDANCE_ERROR.not_found.message, "Lesson not found");
    assert.equal(ATTENDANCE_ERROR.class_not_found.message, "Class not found");
    // A duplicate-key race converges instead of surfacing as a user error.
    assert.ok(!Object.keys(ATTENDANCE_ERROR).includes("save_conflict"));
    assert.ok(SERVICE.includes("isDupKey"));
  });
});
