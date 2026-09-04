/* Revenue — what a month earned, and the two ways that figure used to move.
 *
 * Run with:  npm test
 *
 * PURE. `computeRevenue` is a function over plain values, so the whole engine is
 * exercised directly rather than through a database round trip.
 *
 * WHAT THIS SUITE IS FOR. tests/attendance.test.ts already covers how a register
 * changes revenue, and tests/class-lifecycle.test.ts already covers that a
 * class's CURRENT status cannot rewrite a closed month (RECURRENCE_DESIGN §9.1).
 * Neither is repeated here. This suite covers the two Sprint 9 changes and the
 * business rules they had to preserve while making them:
 *
 *   1. a STUDENT's current status can no longer rewrite a closed month either —
 *      the same defect as §9.1, surviving on the other entity;
 *   2. `total`, `perClass` and `byType` reconcile EXACTLY, in whole đồng, rather
 *      than each rounding independently and happening to agree.
 *
 * AND WHAT IT DELIBERATELY DOES NOT FIX. A DELETED student is still excluded,
 * so deletion still erases their history. That defect is explicitly deferred
 * (Sprint 9 Gate 2), and there is a test below pinning the current behaviour so
 * that a later gate changing it has to change this file on purpose rather than
 * discovering it by accident.
 *
 * NOTHING HERE TOUCHES THE PRODUCTION DATABASE. Fixtures are shaped from the
 * live collections as audited in Sprint 9 Gate 1, not connected to them.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { computeRevenue } from "../src/lib/finance";
import type { AttendanceRecord, Klass, Lesson, Student } from "../src/lib/types";

const MONTH = "2026-06";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const FINANCE = code("src", "lib", "finance.ts");

/* ------------------------------------------------------------------ fixtures */

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Little Explorers · A1", type: "group", level: "A1",
    fee: 800_000, classroom: "Room A", status: "Active",
    studentIds: ["s1", "s2"], notes: "", schedule: [], color: "#888",
    ...over,
  };
}

function student(id: string, over: Partial<Student> = {}): Student {
  return {
    id, first: id, last: "T", name: `${id} T`, initials: "XT",
    birthday: "2015-01-01", age: 11, school: "S", grade: 5, gradeLabel: "Grade 5",
    parentId: "", parentName: "", phone: "", status: "Active", notes: "",
    joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
    avatar: null, avatarColor: "#888",
    ...over,
  };
}

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "L1", classId: "c1", type: "regular", date: `${MONTH}-03`, start: "18:00",
    duration: 90, classroom: "Room A", status: "Completed", chargeable: false,
    fromId: null, notes: "",
    ...over,
  };
}

const register = (lessonId: string, entries: AttendanceRecord["entries"]): AttendanceRecord =>
  ({ lessonId, entries });

/** Four Regular lessons in the month, so a share is worth fee ÷ 4. */
const fourRegular = (over: Partial<Lesson> = {}) =>
  ["03", "10", "17", "24"].map((d, i) =>
    lesson({ id: `L${i + 1}`, date: `${MONTH}-${d}`, ...over }));

/* ============================================ the business rules, preserved */

describe("Revenue · which lessons count", () => {
  const students = [student("s1"), student("s2")];
  const classes = [klass()];

  const revenue = (lessons: Lesson[], attendance: AttendanceRecord[] = []) =>
    computeRevenue(MONTH, { classes, students, lessons, attendance }).total;

  it("1. a Completed Regular lesson earns one share per enrolled student", () => {
    // 4 regular scheduled -> 200,000 a share. One completed lesson, two students.
    const lessons = fourRegular({ status: "Upcoming" });
    lessons[0].status = "Completed";
    assert.equal(revenue(lessons), 400_000);
  });

  it("2. all four completed earn the whole monthly fee, per student", () => {
    assert.equal(revenue(fourRegular()), 1_600_000);
  });

  it("3. an Upcoming lesson earns nothing", () => {
    assert.equal(revenue(fourRegular({ status: "Upcoming" })), 0);
  });

  it("4. a non-chargeable Cancelled lesson earns nothing", () => {
    const lessons = fourRegular({ status: "Cancelled", chargeable: false });
    assert.equal(revenue(lessons), 0);
  });

  it("5. a chargeable Cancelled lesson earns exactly as a Completed one does", () => {
    const completed = revenue(fourRegular());
    const chargeable = revenue(fourRegular({ status: "Cancelled", chargeable: true }));
    assert.equal(chargeable, completed);
  });

  it("6. the denominator does NOT shrink when a lesson is cancelled", () => {
    // Three completed and one cancelled still divides by four, so the class earns
    // three quarters of the fee rather than the whole of it.
    const lessons = fourRegular();
    lessons[3] = { ...lessons[3], status: "Cancelled", chargeable: false };
    assert.equal(revenue(lessons), 1_200_000);
  });

  it("7. a Makeup lesson is worth the same share as a Regular one", () => {
    const lessons = [...fourRegular(), lesson({ id: "M1", type: "makeup", date: `${MONTH}-26` })];
    assert.equal(revenue(lessons), 2_000_000, "four regular + one makeup, two students");
  });

  it("8. an Extra lesson adds on top of the monthly fee", () => {
    const lessons = [...fourRegular(), lesson({ id: "E1", type: "extra", date: `${MONTH}-26` })];
    assert.equal(revenue(lessons), 2_000_000);
  });

  it("9. a Makeup or Extra lesson never enters the denominator", () => {
    const withExtras = [
      ...fourRegular(),
      lesson({ id: "M1", type: "makeup", date: `${MONTH}-26` }),
      lesson({ id: "E1", type: "extra", date: `${MONTH}-27` }),
    ];
    // Still 200,000 a share: 6 countable lessons x 2 students = 2,400,000.
    assert.equal(revenue(withExtras), 2_400_000);
  });

  it("10. an Absent student withholds their own share and nobody else's", () => {
    const lessons = fourRegular();
    const att = [register("L1", { s1: { status: "Absent" }, s2: { status: "Present" } })];
    assert.equal(revenue(lessons, att), 1_400_000);
  });

  it("11. Late and Excused are chargeable — only Absent withholds", () => {
    const lessons = fourRegular();
    for (const status of ["Present", "Late", "Excused"] as const) {
      const att = [register("L1", { s1: { status }, s2: { status } })];
      assert.equal(revenue(lessons, att), 1_600_000, status);
    }
  });

  it("12. no register at all is financially identical to an all-Present one", () => {
    const lessons = fourRegular();
    const allPresent = [register("L1", { s1: { status: "Present" }, s2: { status: "Present" } })];
    assert.equal(revenue(lessons, []), revenue(lessons, allPresent));
  });

  it("13. a class with no Regular lessons that month earns nothing at all", () => {
    // No denominator exists, so nothing can be priced — an Extra alone is not a
    // month's teaching.
    assert.equal(revenue([lesson({ id: "E1", type: "extra" })]), 0);
  });

  it("14. a lesson in another month is not this month's revenue", () => {
    assert.equal(revenue(fourRegular({ date: "2026-05-03" })), 0);
  });
});

/* ============================== 1. a student's status cannot rewrite history */

describe("Revenue · archiving a student does not move a closed month", () => {
  const classes = [klass({ studentIds: ["s1", "s2"] })];
  const lessons = fourRegular();

  const withStatus = (status: Student["status"]) =>
    computeRevenue(MONTH, {
      classes,
      students: [student("s1", { status }), student("s2")],
      lessons,
      attendance: [],
    });

  it("15. an Active student's month is 1,600,000", () => {
    assert.equal(withStatus("Active").total, 1_600_000);
  });

  it("16. archiving them afterwards leaves June exactly where it was", () => {
    // THE SPRINT 9 FIX. This used to drop to 800,000: `computeRevenue` filtered
    // `status !== "Archived"`, so filing somebody away in October erased the
    // months they had already been taught in.
    assert.equal(withStatus("Archived").total, 1_600_000);
  });

  it("17. no status changes an already-earned figure", () => {
    for (const status of ["Active", "Trial", "Paused", "Archived"] as const) {
      assert.equal(withStatus(status).total, 1_600_000, status);
    }
  });

  it("18. …and the per-class breakdown does not move either", () => {
    assert.deepEqual(withStatus("Archived").perClass, withStatus("Active").perClass);
  });

  it("19. an unrecognised status is not a filter either — membership is resolution alone", () => {
    const rogue = student("s1", { status: "Suspended" as Student["status"] });
    const r = computeRevenue(MONTH, {
      classes, students: [rogue, student("s2")], lessons, attendance: [],
    });
    assert.equal(r.total, 1_600_000);
  });

  it("20. the engine reads no student status at all", () => {
    assert.ok(!FINANCE.includes('"Archived"'), "no student-status literal survives");
    assert.ok(!/students\s*\.\s*filter/.test(FINANCE), "students are not filtered by status");
    assert.ok(/students\.map\(\(s\)\s*=>\s*s\.id\)/.test(FINANCE), "membership is id resolution");
  });

  it("21. …and reads no class status either — §9.1 stays fixed", () => {
    assert.ok(!/c\.status/.test(FINANCE));
    assert.ok(!FINANCE.includes('"Ended"'));
  });
});

describe("Revenue · the deletion defect remains deferred, deliberately", () => {
  it("22. a roster id with no Student document still earns nothing", () => {
    // NOT A FIX, A PIN. Deleting a student still erases their history, because
    // the only membership record — `Klass.studentIds` — is a mutable current
    // value with no history, so counting it would repair deletion while leaving
    // the identical erasure caused by merely un-enrolling somebody. If a later
    // gate resolves this with an enrolment-history model, it must change this
    // test on purpose rather than discover the behaviour by accident.
    const r = computeRevenue(MONTH, {
      classes: [klass({ studentIds: ["s1", "s2"] })],
      students: [student("s1")], // s2 has been deleted
      lessons: fourRegular(),
      attendance: [],
    });
    assert.equal(r.total, 800_000, "s2's share is gone with s2");
  });

  it("23. the engine reads no enrolment history, because none exists", () => {
    for (const banned of ["enrolment", "enrollment", "enrolledAt", "leftAt", "membershipHistory"]) {
      assert.ok(!FINANCE.includes(banned), `finance.ts must not pretend to have ${banned}`);
    }
  });
});

/* =================================== 2. exact integer VND, and reconciliation */

describe("Revenue · exact integer đồng", () => {
  const invariants = (r: ReturnType<typeof computeRevenue>) => {
    const perClassSum = r.perClass.reduce((s, x) => s + x.amount, 0);
    const byTypeSum = r.byType.regular + r.byType.makeup + r.byType.extra;
    return { perClassSum, byTypeSum };
  };

  it("24. sum(perClass) === total, on a clean division", () => {
    const r = computeRevenue(MONTH, {
      classes: [klass()], students: [student("s1"), student("s2")],
      lessons: fourRegular(), attendance: [],
    });
    const { perClassSum } = invariants(r);
    assert.equal(perClassSum, r.total);
  });

  it("25. sum(byType) === total, on a clean division", () => {
    const r = computeRevenue(MONTH, {
      classes: [klass()], students: [student("s1"), student("s2")],
      lessons: fourRegular(), attendance: [],
    });
    const { byTypeSum } = invariants(r);
    assert.equal(byTypeSum, r.total);
  });

  it("26. 750,000 ÷ 9 repeats for ever, and both invariants STILL hold exactly", () => {
    // The production `c2` case in 2026-04 and 2026-05. 750,000/9 = 83,333.333…,
    // which is precisely where independent rounding used to be able to disagree.
    const nine = Array.from({ length: 9 }, (_, i) =>
      lesson({ id: `R${i}`, classId: "c2", date: `${MONTH}-${String(i + 1).padStart(2, "0")}` }));
    const r = computeRevenue(MONTH, {
      classes: [klass({ id: "c2", name: "Grammar Stars · B1", fee: 750_000, studentIds: ["s1", "s2", "s3"] })],
      students: [student("s1"), student("s2"), student("s3")],
      lessons: nine,
      attendance: [],
    });
    const { perClassSum, byTypeSum } = invariants(r);
    assert.equal(perClassSum, r.total);
    assert.equal(byTypeSum, r.total);
    assert.equal(r.total, 2_250_000, "9 lessons x 3 students x 750,000/9 is exactly three fees");
  });

  it("27. …and a partial month of that class is still exact", () => {
    // 5 of 9 lessons completed, 3 students: 750,000 x 15 / 9 = 1,250,000.
    const nine = Array.from({ length: 9 }, (_, i) =>
      lesson({
        id: `R${i}`, classId: "c2", date: `${MONTH}-${String(i + 1).padStart(2, "0")}`,
        status: i < 5 ? "Completed" : "Upcoming",
      }));
    const r = computeRevenue(MONTH, {
      classes: [klass({ id: "c2", fee: 750_000, studentIds: ["s1", "s2", "s3"] })],
      students: [student("s1"), student("s2"), student("s3")],
      lessons: nine, attendance: [],
    });
    assert.equal(r.total, 1_250_000);
    assert.equal(invariants(r).byTypeSum, r.total);
    assert.equal(invariants(r).perClassSum, r.total);
  });

  it("28. every figure is a whole đồng — no float reaches a total", () => {
    const nine = Array.from({ length: 9 }, (_, i) =>
      lesson({ id: `R${i}`, classId: "c2", date: `${MONTH}-${String(i + 1).padStart(2, "0")}`,
        status: i < 7 ? "Completed" : "Upcoming" }));
    const r = computeRevenue(MONTH, {
      classes: [klass({ id: "c2", fee: 750_000, studentIds: ["s1", "s2", "s3"] })],
      students: [student("s1"), student("s2"), student("s3")],
      lessons: nine, attendance: [],
    });
    assert.ok(Number.isInteger(r.total), "total");
    for (const row of r.perClass) assert.ok(Number.isInteger(row.amount), row.classId);
    for (const k of ["regular", "makeup", "extra"] as const) {
      assert.ok(Number.isInteger(r.byType[k]), k);
    }
  });

  it("29. the three type buckets reconcile across a mixed month", () => {
    const nine = Array.from({ length: 9 }, (_, i) =>
      lesson({ id: `R${i}`, classId: "c2", date: `${MONTH}-${String(i + 1).padStart(2, "0")}` }));
    const lessons = [
      ...nine,
      lesson({ id: "M1", classId: "c2", type: "makeup", date: `${MONTH}-27` }),
      lesson({ id: "E1", classId: "c2", type: "extra", date: `${MONTH}-28` }),
    ];
    const r = computeRevenue(MONTH, {
      classes: [klass({ id: "c2", fee: 750_000, studentIds: ["s1", "s2", "s3"] })],
      students: [student("s1"), student("s2"), student("s3")],
      lessons, attendance: [],
    });
    assert.equal(invariants(r).byTypeSum, r.total);
    assert.ok(r.byType.makeup > 0 && r.byType.extra > 0, "both extra types earned something");
  });

  it("30. a lesson type with no shares receives no đồng in the allocation", () => {
    const r = computeRevenue(MONTH, {
      classes: [klass()], students: [student("s1"), student("s2")],
      lessons: fourRegular(), attendance: [],
    });
    assert.equal(r.byType.makeup, 0);
    assert.equal(r.byType.extra, 0);
    assert.equal(r.byType.regular, r.total);
  });

  it("31. both invariants hold across several classes at once", () => {
    const classes = [
      klass({ id: "c1", fee: 800_000, studentIds: ["s1", "s2"] }),
      klass({ id: "c2", fee: 750_000, studentIds: ["s2", "s3"] }),
      klass({ id: "c3", fee: 700_000, studentIds: ["s3"] }),
    ];
    const lessons = [
      ...fourRegular(),
      ...Array.from({ length: 9 }, (_, i) =>
        lesson({ id: `B${i}`, classId: "c2", date: `${MONTH}-${String(i + 1).padStart(2, "0")}` })),
      ...Array.from({ length: 7 }, (_, i) =>
        lesson({ id: `C${i}`, classId: "c3", date: `${MONTH}-${String(i + 1).padStart(2, "0")}` })),
      lesson({ id: "M9", classId: "c3", type: "makeup", date: `${MONTH}-28` }),
    ];
    const r = computeRevenue(MONTH, {
      classes, students: [student("s1"), student("s2"), student("s3")], lessons, attendance: [],
    });
    const { perClassSum, byTypeSum } = invariants(r);
    assert.equal(perClassSum, r.total);
    assert.equal(byTypeSum, r.total);
  });

  it("32. a class earning nothing raises no perClass row", () => {
    const r = computeRevenue(MONTH, {
      classes: [klass(), klass({ id: "c9", studentIds: [] })],
      students: [student("s1"), student("s2")],
      lessons: [...fourRegular(), lesson({ id: "Z1", classId: "c9" })],
      attendance: [],
    });
    assert.deepEqual(r.perClass.map((x) => x.classId), ["c1"]);
  });
});

/* ============================================================== isolation */

describe("Revenue · reads no bill", () => {
  it("33. finance.ts reaches no Billing model, collection or helper", () => {
    for (const banned of ["BillingModel", "billings", "./billing", "collectedFor", "paidAmount"]) {
      assert.ok(!FINANCE.includes(banned), `finance.ts must not reference ${banned}`);
    }
  });

  it("34. computeRevenue's input cannot carry billing — it is not in the signature", () => {
    assert.ok(/Pick<AllData,\s*"classes"\s*\|\s*"students"\s*\|\s*"lessons"\s*\|\s*"attendance">/.test(FINANCE));
  });

  it("35. finance.ts reads no Student.balance", () => {
    assert.ok(!/\bbalance\b/.test(FINANCE));
  });

  it("36. finance.ts writes nothing and holds no clock of its own", () => {
    for (const banned of ["dbConnect", "updateOne", "bulkWrite", "save(", "new Date", "Date.now"]) {
      assert.ok(!FINANCE.includes(banned), `finance.ts must not use ${banned}`);
    }
  });
});
