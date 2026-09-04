/* Finance — the service's read model, and the write surface it is allowed.
 *
 * Run with:  npm test
 *
 * NO DATABASE. This project has no integration-test infrastructure and Sprint 9
 * forbids creating one against production, so the service is tested the way
 * tests/reviews-service.test.ts and tests/homework-service.test.ts test their
 * own, and for the same two reasons:
 *
 *  - the SHAPING is exercised directly, because every decision the service acts
 *    on lives in src/lib/billing.ts as a function over plain values, and the
 *    fixtures below are the exact documents the service reads out of Mongo;
 *  - the GUARANTEES that only exist inside a Mongo call — which model may be
 *    written, with which verb, touching which fields, that a read writes
 *    NOTHING, and what a ghost record may never reveal — are asserted by
 *    scanning the source.
 *
 * The second half is not a compromise. `src/lib/finance-service.ts` imports
 * `server-only`, so it cannot be imported by this runner at all; and "a Finance
 * read is a read" is not expressible as a function call in any case. A scan is
 * the only form in which it can be pinned, and it is the form the Sprint 5-8
 * suites already chose for this class of rule.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildBillingBranch, type BillingResolution } from "../src/lib/billing";
import { CURRENT_MONTH, TODAY_ISO } from "../src/lib/constants";
import type { Billing, Klass, Student } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE = code("src", "lib", "finance-service.ts");
const MONTH = CURRENT_MONTH;

/* ------------------------------------------------------------------ fixtures */

function bill(over: Partial<Billing> & Pick<Billing, "id" | "studentId" | "classId">): Billing {
  return {
    month: MONTH, fee: 800_000, status: "Unpaid", paidDate: null, notes: "",
    ...over,
  };
}

function student(id: string, over: Partial<Student> = {}): Student {
  return {
    id, first: id, last: "T", name: `${id} Test`, initials: "XT",
    birthday: "2015-01-01", age: 11, school: "S", grade: 5, gradeLabel: "Grade 5",
    parentId: "", parentName: "", phone: "", status: "Active", notes: "",
    joined: "2026-01-10", classes: 1, attendance: 100, balance: 0,
    avatar: null, avatarColor: "#d14242",
    ...over,
  };
}

function klass(id: string, over: Partial<Klass> = {}): Klass {
  return {
    id, name: `Class ${id}`, type: "group", level: "A1", fee: 800_000,
    classroom: "Room A", status: "Active", studentIds: [], notes: "",
    schedule: [], color: "#0284c7",
    ...over,
  };
}

const resolution = (
  students: Student[], classes: Klass[], parents: string[] = []
): BillingResolution => ({ students, classes, livingParentIds: new Set(parents) });

/* ============================================================ the read model */

describe("Finance · the month's tuition branch", () => {
  const bills = [
    bill({ id: "B-c1-s2-2026-07", studentId: "s2", classId: "c1", status: "Paid", paidDate: "2026-07-06" }),
    bill({ id: "B-c1-s12-2026-07", studentId: "s12", classId: "c1", status: "Unpaid" }),
    bill({ id: "B-c2-s9-2026-07", studentId: "s9", classId: "c2", fee: 750_000, status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 300_000 }),
  ];
  const ctx = resolution(
    [student("s2"), student("s12"), student("s9")],
    [klass("c1"), klass("c2", { name: "Grammar Stars · B1", color: "#16a34a" })]
  );

  it("1. bills every record in the month", () => {
    assert.equal(buildBillingBranch(bills, ctx).billed, 2_350_000);
  });

  it("2. collects exactly what is known", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.knownCollected, 1_100_000);
    assert.equal(b.knownOutstanding, 1_250_000);
    assert.equal(b.unknownAmountBills, 0);
    assert.equal(b.unknownAmount, 0);
    assert.equal(b.amountsComplete, true);
    assert.equal(b.knownCollected + b.knownOutstanding, b.billed);
  });

  it("3. counts each status", () => {
    assert.deepEqual(buildBillingBranch(bills, ctx).counts,
      { paid: 1, partiallyPaid: 1, unpaid: 1, total: 3 });
  });

  it("4. an empty month is a well-formed empty branch, not an error", () => {
    const b = buildBillingBranch([], resolution([], []));
    assert.equal(b.billed, 0);
    assert.equal(b.collectionRate, null, "No data, never 0%");
    assert.deepEqual(b.rows, []);
    assert.deepEqual(b.perClass, []);
    assert.deepEqual(b.outstandingStudents, []);
    assert.equal(b.hiddenRecords, 0);
  });

  it("5. carries a row per listable bill, with the class's own name and colour", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.rows.length, 3);
    const row = b.rows.find((r) => r.classId === "c2")!;
    assert.equal(row.className, "Grammar Stars · B1");
    assert.equal(row.classColor, "#16a34a");
  });

  it("6. a row's collected and outstanding are the pure helpers' answers", () => {
    const b = buildBillingBranch(bills, ctx);
    const partial = b.rows.find((r) => r.status === "Partially Paid")!;
    assert.equal(partial.paidAmount, 300_000);
    assert.equal(partial.collected, 300_000);
    assert.equal(partial.outstanding, 450_000);
  });
});

describe("Finance · legacy partials propagate as unknown", () => {
  const bills = [
    bill({ id: "B1", studentId: "s2", classId: "c1", status: "Paid", paidDate: "2026-07-06" }),
    // The nine production records: Partially Paid, no amount ever recorded.
    bill({ id: "B2", studentId: "s9", classId: "c1", fee: 700_000, status: "Partially Paid", paidDate: "2026-07-06" }),
  ];
  const ctx = resolution([student("s2"), student("s9")], [klass("c1")]);

  it("7. the month keeps the money it can prove, and flags the rest", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.billed, 1_500_000, "billed is always knowable");
    assert.equal(b.knownCollected, 800_000, "the Paid bill is not hidden by the incomplete one");
    assert.equal(b.knownOutstanding, 0);
    assert.equal(b.unknownAmount, 700_000, "the incomplete bill's whole fee");
    assert.equal(b.amountsComplete, false);
    assert.equal(b.collectionRate, 53, "a floor: at least 53% was collected");
  });

  it("8. …and says how many records are responsible, and whose", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.unknownAmountBills, 1);
    // s9 still exists here, so this is a gap a teacher could go and settle.
    assert.equal(b.unknownLiveAmountBills, 1);
    assert.equal(b.unknownHistoricalAmountBills, 0);
  });

  it("9. the incomplete record's own fee is never counted as collected", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.notEqual(b.knownCollected, 1_500_000, "not treated as paid in full");
    assert.notEqual(b.knownCollected, 1_150_000, "and not as half paid");
    assert.equal(b.knownCollected, 800_000);
  });

  it("10. no reader substitutes half the fee", () => {
    const row = buildBillingBranch(bills, ctx).rows.find((r) => r.billId === "B2")!;
    assert.equal(row.paidAmount, null);
    assert.equal(row.collected, null);
    assert.equal(row.outstanding, null);
    assert.notEqual(row.collected, 350_000);
  });

  it("11. an outstanding row carries a null amount rather than a guess", () => {
    const out = buildBillingBranch(bills, ctx).outstandingStudents;
    assert.equal(out.length, 1);
    assert.equal(out[0].billId, "B2");
    assert.equal(out[0].amount, null);
  });
});

describe("Finance · per class", () => {
  const bills = [
    bill({ id: "B1", studentId: "s2", classId: "c1", status: "Paid", paidDate: "2026-07-06" }),
    bill({ id: "B2", studentId: "s12", classId: "c1", status: "Unpaid" }),
    bill({ id: "B3", studentId: "s9", classId: "c2", fee: 750_000, status: "Unpaid" }),
  ];
  const ctx = resolution([student("s2"), student("s12"), student("s9")], [klass("c1"), klass("c2")]);

  it("12. groups bills by class with names, colours and totals", () => {
    const perClass = buildBillingBranch(bills, ctx).perClass;
    assert.deepEqual(perClass.map((p) => p.classId), ["c1", "c2"]);
    assert.equal(perClass[0].billed, 1_600_000);
    assert.equal(perClass[0].knownCollected, 800_000);
    assert.equal(perClass[1].billed, 750_000);
  });

  it("13. per-class billed sums to the month's billed", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.perClass.reduce((s, p) => s + p.billed, 0), b.billed);
  });

  it("14. each class carries its own listable rows", () => {
    const perClass = buildBillingBranch(bills, ctx).perClass;
    assert.deepEqual(perClass[0].rows.map((r) => r.billId), ["B1", "B2"]);
    assert.deepEqual(perClass[1].rows.map((r) => r.billId), ["B3"]);
  });

  it("15. an unrecorded amount marks only its own class incomplete", () => {
    const withLegacy = [...bills,
      bill({ id: "B4", studentId: "s9", classId: "c3", fee: 700_000, status: "Partially Paid", paidDate: "2026-07-01" })];
    const b = buildBillingBranch(withLegacy, resolution(ctx.students as Student[], [klass("c1"), klass("c2"), klass("c3")]));
    const c1 = b.perClass.find((p) => p.classId === "c1")!;
    const c3 = b.perClass.find((p) => p.classId === "c3")!;
    assert.equal(c1.knownCollected, 800_000);
    assert.equal(c1.amountsComplete, true);
    assert.equal(c3.knownCollected, 0);
    assert.equal(c3.unknownAmount, 700_000);
    assert.equal(c3.amountsComplete, false);
    // The month is incomplete because c3 is, and still reports every other
    // class's money rather than reporting nothing.
    assert.equal(b.amountsComplete, false);
    assert.equal(b.knownCollected, 800_000);
    assert.equal(b.unknownAmountBills, 1);
  });

  it("15b. each class carries its own live/historical split of the gap", () => {
    // Two incomplete partials in one class: one student still exists, one does
    // not. They are two different sentences on screen, so they are two counts.
    const mixed = [
      bill({ id: "B5", studentId: "s2", classId: "c1", fee: 700_000, status: "Partially Paid", paidDate: "2026-07-01" }),
      bill({ id: "B6", studentId: "s99", classId: "c1", fee: 700_000, status: "Partially Paid", paidDate: "2026-07-01" }),
    ];
    const b = buildBillingBranch(mixed, resolution([student("s2")], [klass("c1")]));
    const c1 = b.perClass.find((p) => p.classId === "c1")!;
    assert.equal(c1.unknownAmountBills, 2);
    assert.equal(c1.unknownLiveAmountBills, 1);
    assert.equal(c1.unknownHistoricalAmountBills, 1);
    assert.equal(b.unknownLiveAmountBills, 1);
    assert.equal(b.unknownHistoricalAmountBills, 1);
    // …and the ghost half still raises no row and discloses no identity.
    assert.deepEqual(c1.rows.map((r) => r.billId), ["B5"]);
    assert.equal(c1.hiddenRecords, 1);
    assert.ok(!JSON.stringify(b).includes("s99"));
  });
});

describe("Finance · a student billed in two classes", () => {
  // The production s3 case: enrolled in c2 and c5, two bills in one month.
  const bills = [
    bill({ id: "B-c2-s3-2026-07", studentId: "s3", classId: "c2", fee: 750_000, status: "Unpaid" }),
    bill({ id: "B-c5-s3-2026-07", studentId: "s3", classId: "c5", fee: 1_500_000, status: "Unpaid" }),
  ];
  const ctx = resolution([student("s3")], [klass("c2"), klass("c5", { fee: 1_500_000 })]);

  it("16. both bills raise their own row", () => {
    assert.equal(buildBillingBranch(bills, ctx).rows.length, 2);
  });

  it("17. both count independently — neither is a duplicate", () => {
    assert.equal(buildBillingBranch(bills, ctx).billed, 2_250_000);
    assert.equal(buildBillingBranch(bills, ctx).counts.unpaid, 2);
  });

  it("18. and the student appears once per class in the outstanding list", () => {
    const out = buildBillingBranch(bills, ctx).outstandingStudents;
    assert.deepEqual(out.map((o) => o.classId), ["c2", "c5"]);
    assert.deepEqual(out.map((o) => o.amount), [750_000, 1_500_000]);
  });
});

describe("Finance · ghosts count and are never named", () => {
  const bills = [
    bill({ id: "B-live", studentId: "s2", classId: "c1", status: "Unpaid" }),
    bill({ id: "B-ghost-1", studentId: "s8", classId: "c1", status: "Unpaid" }),
    bill({ id: "B-ghost-2", studentId: "s14", classId: "c2", fee: 750_000, status: "Paid", paidDate: "2026-07-01" }),
  ];
  const ctx = resolution([student("s2")], [klass("c1"), klass("c2")]);

  it("19. ghost bills are in the month's billed", () => {
    assert.equal(buildBillingBranch(bills, ctx).billed, 2_350_000);
  });

  it("20. …and in collected, outstanding and the status counts", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.knownCollected, 750_000, "the ghost's Paid bill still counts as collected");
    assert.equal(b.knownOutstanding, 1_600_000);
    assert.equal(b.amountsComplete, true, "a ghost bill is not an incomplete one");
    assert.deepEqual(b.counts, { paid: 1, partiallyPaid: 0, unpaid: 2, total: 3 });
  });

  it("21. …and in the per-class totals", () => {
    const perClass = buildBillingBranch(bills, ctx).perClass;
    assert.equal(perClass.find((p) => p.classId === "c1")!.billed, 1_600_000);
    assert.equal(perClass.find((p) => p.classId === "c2")!.billed, 750_000);
  });

  it("22. but they raise NO row", () => {
    assert.deepEqual(buildBillingBranch(bills, ctx).rows.map((r) => r.billId), ["B-live"]);
  });

  it("23. and no outstanding-student entry — a ghost cannot be chased", () => {
    const out = buildBillingBranch(bills, ctx).outstandingStudents;
    assert.deepEqual(out.map((o) => o.billId), ["B-live"]);
  });

  it("24. hiddenRecords is what the design's +N more renders", () => {
    assert.equal(buildBillingBranch(bills, ctx).hiddenRecords, 2);
  });

  it("25. …and is reported per class as well", () => {
    const perClass = buildBillingBranch(bills, ctx).perClass;
    assert.equal(perClass.find((p) => p.classId === "c1")!.hiddenRecords, 1);
    assert.equal(perClass.find((p) => p.classId === "c2")!.hiddenRecords, 1);
  });

  it("26. no deleted-student id, name or placeholder reaches the payload", () => {
    const json = JSON.stringify(buildBillingBranch(bills, ctx));
    assert.ok(!json.includes("s8"), "a ghost student id must not be emitted");
    assert.ok(!json.includes("s14"));
    assert.ok(!json.includes("B-ghost"), "a ghost bill id must not be emitted");
    assert.ok(!/deleted/i.test(json), "no placeholder row");
  });

  it("27. a class whose bills are ALL ghosts still totals, and lists nothing", () => {
    const b = buildBillingBranch(bills, resolution([], [klass("c1"), klass("c2")]));
    assert.equal(b.billed, 2_350_000);
    assert.equal(b.rows.length, 0);
    assert.equal(b.hiddenRecords, 3);
    assert.equal(b.perClass.length, 2, "the classes still report their money");
  });
});

describe("Finance · parent linkage is informational", () => {
  const bills = [
    bill({ id: "B1", studentId: "s5", classId: "c1", status: "Unpaid" }),
    bill({ id: "B2", studentId: "s2", classId: "c1", status: "Unpaid" }),
    bill({ id: "B3", studentId: "s7", classId: "c1", status: "Unpaid" }),
  ];
  const ctx = resolution(
    [
      student("s5", { parentId: "p1" }),   // resolves
      student("s2", { parentId: "" }),     // never had one
      student("s7", { parentId: "p404" }), // points at nothing
    ],
    [klass("c1")],
    ["p1"]
  );

  it("28. parentLinked is true when the parent resolves", () => {
    assert.equal(buildBillingBranch(bills, ctx).rows.find((r) => r.billId === "B1")!.parentLinked, true);
  });

  it("29. false when the student has no parentId", () => {
    assert.equal(buildBillingBranch(bills, ctx).rows.find((r) => r.billId === "B2")!.parentLinked, false);
  });

  it("30. false when the parentId resolves to nothing — that is not a link", () => {
    assert.equal(buildBillingBranch(bills, ctx).rows.find((r) => r.billId === "B3")!.parentLinked, false);
  });

  it("31. a missing parent blocks nothing — every row is still listed", () => {
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.rows.length, 3);
    assert.equal(b.outstandingStudents.length, 3);
  });

  it("32. the outstanding list carries parentLinked too", () => {
    const out = buildBillingBranch(bills, ctx).outstandingStudents;
    assert.deepEqual(out.map((o) => o.parentLinked), [true, false, false]);
  });

  it("33. NO parent name, phone or email reaches the payload", () => {
    const withContact = resolution(
      [student("s5", { parentId: "p1", parentName: "Nguyen Van A", phone: "0900000000" })],
      [klass("c1")], ["p1"]
    );
    const json = JSON.stringify(buildBillingBranch([bills[0]], withContact));
    assert.ok(!json.includes("Nguyen Van A"), "no parent name");
    assert.ok(!json.includes("0900000000"), "no phone");
    assert.ok(!json.includes("parentName"));
    assert.ok(!json.includes("parentId"), "not even the id");
  });
});

describe("Finance · outstanding is Unpaid and Partially Paid only", () => {
  const bills = [
    bill({ id: "B-paid", studentId: "s2", classId: "c1", status: "Paid", paidDate: "2026-07-01" }),
    bill({ id: "B-unpaid", studentId: "s5", classId: "c1", status: "Unpaid" }),
    bill({ id: "B-partial", studentId: "s7", classId: "c1", fee: 700_000, status: "Partially Paid", paidDate: "2026-07-01", paidAmount: 200_000 }),
  ];
  const ctx = resolution([student("s2"), student("s5"), student("s7")], [klass("c1")]);

  it("34. a Paid bill owes nothing and is not listed", () => {
    const out = buildBillingBranch(bills, ctx).outstandingStudents;
    assert.ok(!out.some((o) => o.billId === "B-paid"));
  });

  it("35. Unpaid owes the whole fee", () => {
    const o = buildBillingBranch(bills, ctx).outstandingStudents.find((x) => x.billId === "B-unpaid")!;
    assert.equal(o.amount, 800_000);
  });

  it("36. a recorded partial owes fee − paidAmount", () => {
    const o = buildBillingBranch(bills, ctx).outstandingStudents.find((x) => x.billId === "B-partial")!;
    assert.equal(o.amount, 500_000);
  });

  it("37. every outstanding row names its month", () => {
    for (const o of buildBillingBranch(bills, ctx).outstandingStudents) {
      assert.equal(o.month, MONTH);
    }
  });
});

describe("Finance · a fee is never normalised", () => {
  it("38. the c6 divergence flows through exactly as stored", () => {
    // The bill says 1,800,000; the class today says 18,000,000. A bill's fee is
    // a historical snapshot, so it is summed and shown at its own value and the
    // disagreement is surfaced rather than reconciled.
    const bills = [bill({ id: "B-c6", studentId: "s11", classId: "c6", fee: 1_800_000, status: "Unpaid" })];
    const ctx = resolution([student("s11")], [klass("c6", { fee: 18_000_000 })]);
    const b = buildBillingBranch(bills, ctx);
    assert.equal(b.billed, 1_800_000);
    assert.equal(b.rows[0].fee, 1_800_000);
    assert.equal(b.outstandingStudents[0].amount, 1_800_000);
    assert.notEqual(b.billed, 18_000_000);
  });

  it("39. no class fee reaches a Billing figure at all", () => {
    const json = JSON.stringify(buildBillingBranch(
      [bill({ id: "B-c6", studentId: "s11", classId: "c6", fee: 1_800_000 })],
      resolution([student("s11")], [klass("c6", { fee: 18_000_000 })])
    ));
    assert.ok(!json.includes("18000000"));
  });
});

/* ====================================================== the service's source */

describe("Finance service · a read is a read", () => {
  it("40. imports no lesson lifecycle", () => {
    assert.ok(!SERVICE.includes("advanceLessonLifecycle"));
    assert.ok(!SERVICE.includes("./lifecycle"));
  });

  it("41. imports no reconciler and no generator", () => {
    for (const banned of ["./reconciler", "reconcileClass", "./recurrence", "ensureRegularLessons", "./generate", "deriveData"]) {
      assert.ok(!SERVICE.includes(banned), `finance-service.ts must not reference ${banned}`);
    }
  });

  it("42. never calls repo.getAll", () => {
    assert.ok(!SERVICE.includes("getAll"));
    assert.ok(!SERVICE.includes("./repo"));
  });

  it("43. builds no dashboard", () => {
    assert.ok(!SERVICE.includes("./dashboard"));
    assert.ok(!SERVICE.includes("buildDashboard"));
  });

  it("44. holds no clock of its own", () => {
    assert.ok(!SERVICE.includes("new Date"));
    assert.ok(!SERVICE.includes("Date.now"));
    assert.ok(SERVICE.includes("CURRENT_MONTH") && SERVICE.includes("TODAY_ISO"));
  });

  it("45. does not use FINANCE_MONTHS as a runtime contract", () => {
    assert.ok(!SERVICE.includes("FINANCE_MONTHS"));
  });
});

describe("Finance service · the write surface", () => {
  it("46. the ONLY write verb is one updateOne", () => {
    const updates = SERVICE.match(/updateOne\(/g) ?? [];
    assert.equal(updates.length, 1, "exactly one updateOne, in recordPayment");
  });

  it("47. no create, insert, delete, replace, bulk or upsert exists", () => {
    for (const banned of [
      "insertMany", "insertOne", "deleteOne", "deleteMany", "updateMany",
      "replaceOne", "bulkWrite", "findOneAndUpdate", "findOneAndDelete",
      "upsert", "create(", ".save(",
    ]) {
      assert.ok(!SERVICE.includes(banned), `finance-service.ts must not use ${banned}`);
    }
  });

  it("48. only BillingModel is ever written", () => {
    // Every other model appears only in a read position.
    for (const model of ["StudentModel", "ClassModel", "ParentModel", "LessonModel", "AttendanceModel"]) {
      assert.ok(SERVICE.includes(model), `${model} is read`);
      assert.ok(
        !new RegExp(`${model}\\.(updateOne|updateMany|deleteOne|deleteMany|insertMany|insertOne|bulkWrite|create)`).test(SERVICE),
        `${model} must never be written`
      );
    }
    assert.ok(/BillingModel\.updateOne\(/.test(SERVICE), "the one write is on BillingModel");
  });

  it("49. Homework, Review and Activity are not reachable at all", () => {
    for (const model of ["HomeworkModel", "ReviewModel", "ActivityModel"]) {
      assert.ok(!SERVICE.includes(model), `finance-service.ts must not touch ${model}`);
    }
  });

  it("50. declares and creates no index", () => {
    for (const banned of ["createIndex", "dropIndex", ".index(", "ensureIndex", "syncIndexes"]) {
      assert.ok(!SERVICE.includes(banned), `finance-service.ts must not use ${banned}`);
    }
  });

  it("51. never reads or writes Student.balance", () => {
    assert.ok(!/\bbalance\b/.test(SERVICE));
  });

  it("52. the update's $set can only carry payment fields", () => {
    // Ownership is absent from the planned write by construction; this pins the
    // literal keys the service assembles.
    const set = /const set: Partial<Billing> = \{([\s\S]*?)\};/.exec(SERVICE);
    assert.ok(set, "the $set is built from a named object");
    for (const owned of ["studentId", "classId", "month", "fee", "id:"]) {
      assert.ok(!set![1].includes(owned), `$set must not carry ${owned}`);
    }
    for (const allowed of ["status", "paidDate", "notes"]) {
      assert.ok(set![1].includes(allowed), `$set carries ${allowed}`);
    }
  });

  it("53. a missing bill and a ghost bill return the SAME violation", () => {
    const misses = SERVICE.match(/violation: "bill-missing"/g) ?? [];
    assert.ok(misses.length >= 2, "both branches answer bill-missing");
    assert.ok(!/violation: "ghost/.test(SERVICE), "no distinct ghost code exists");
  });

  it("54. student status never gates the write", () => {
    assert.ok(!/student\.status/.test(SERVICE));
    assert.ok(!SERVICE.includes('"Archived"'));
  });
});

describe("Finance service · narrow queries", () => {
  it("55. every collection is queried by id, month or a lesson-id set", () => {
    assert.ok(/BillingModel\.find\(\{ month \}\)/.test(SERVICE), "bills are scoped to the month");
    assert.ok(/StudentModel\.find\(\{ id: \{ \$in:/.test(SERVICE));
    assert.ok(/ClassModel\.find\(\{ id: \{ \$in:/.test(SERVICE));
    assert.ok(/ParentModel\.find\(\{ id: \{ \$in:/.test(SERVICE));
    assert.ok(/AttendanceModel\.find\(\{ lessonId: \{ \$in:/.test(SERVICE));
  });

  it("56. lessons are fetched over a date range, not wholesale", () => {
    assert.ok(/LessonModel\.find\(\{ date: \{ \$gte:/.test(SERVICE));
  });

  it("57. no model is fetched with an empty filter", () => {
    assert.ok(!/Model\.find\(\)/.test(SERVICE), "no unfiltered collection dump");
  });

  it("58. parents are projected to the id alone", () => {
    assert.ok(/ParentModel\.find[\s\S]{0,120}select\("id -_id"\)/.test(SERVICE));
  });
});

describe("Finance service · the month window", () => {
  it("59. the window is twelve months, and the trend six", () => {
    assert.ok(/FINANCE_MONTH_WINDOW = 12/.test(SERVICE));
    assert.ok(/FINANCE_TREND_MONTHS = 6/.test(SERVICE));
  });

  it("60. the server returns the window in the payload", () => {
    assert.ok(/months: financeMonthOptions\(/.test(SERVICE));
  });

  it("61. and the app clock, so the client keeps none", () => {
    assert.ok(/appClock: TODAY_ISO/.test(SERVICE));
    assert.equal(TODAY_ISO, "2026-07-10", "the fixed app clock this suite assumes");
  });
});

describe("Finance service · revenue stays independent", () => {
  it("62. revenue comes from computeRevenue and is not reimplemented", () => {
    assert.ok(SERVICE.includes("computeRevenue"));
    assert.ok(!SERVICE.includes("perLessonValue"), "no second copy of the formula");
    assert.ok(!/regularScheduled/.test(SERVICE));
  });

  it("63. no bill is passed into the revenue computation", () => {
    const call = /const revenueInput = \{([^}]*)\}/.exec(SERVICE);
    assert.ok(call, "the revenue input is a named object");
    assert.ok(!call![1].includes("bill"), "revenueInput must not carry bills");
    assert.deepEqual(
      call![1].split(",").map((s) => s.trim()).filter(Boolean),
      ["classes", "students", "lessons", "attendance"]
    );
  });

  it("64. only the lesson-derived branch is called revenue", () => {
    // The DTO's tuition branch uses billed / collected / outstanding.
    assert.ok(/billing: FinanceBillingBranch/.test(SERVICE));
    assert.ok(!/revenue: FinanceBillingBranch/.test(SERVICE));
    assert.ok(!/billedRevenue|tuitionRevenue|collectedRevenue/.test(SERVICE));
  });
});

describe("Finance · the pure builder stays pure", () => {
  const CORE = code("src", "lib", "billing.ts");

  it("65. buildBillingBranch reaches no database", () => {
    for (const banned of ["BillingModel", "dbConnect", "mongoose", "./models", "server-only"]) {
      assert.ok(!CORE.includes(banned), `billing.ts must not reference ${banned}`);
    }
  });

  it("66. and resolves nothing itself — the caller supplies the answers", () => {
    assert.ok(/resolution: BillingResolution/.test(CORE));
    assert.ok(/livingParentIds: ReadonlySet<string>/.test(CORE));
  });
});
