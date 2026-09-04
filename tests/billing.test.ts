/* Billing — the pure domain, and what a partial payment is allowed to claim.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. Every rule Billing embodies lives in
 * src/lib/billing.ts as a function over plain values, so it is exercised
 * directly rather than through a database round trip. `checkPaymentWrite` is the
 * important one: it returns the write as DATA precisely so a test can assert
 * which keys it can produce and which it can never produce.
 *
 * THE CENTRAL RULE THIS SUITE DEFENDS is that an unrecorded partial amount is
 * UNKNOWN. The deleted `calc.ts:paidAmount()` returned `fee / 2` for every
 * partial — an invented constant with no rule behind it — and the cases below
 * exist so that no future reading of "collected" can quietly reintroduce it, or
 * substitute zero, or substitute the fee. There is also a source scan asserting
 * the assumption is gone from src/ entirely.
 *
 * Guarantees that are NOT expressible as a function call — that the pure module
 * reaches no database, that no bill-derived helper is named `revenue`, that no
 * Billing index is declared — are asserted by scanning the source, the same
 * technique tests/attendance.test.ts and tests/homework.test.ts already use.
 *
 * NOTHING HERE TOUCHES THE PRODUCTION DATABASE. The figures below are in-memory
 * fixtures shaped from the live collection as audited in Sprint 9 Gate 1, not a
 * connection to it.
 *
 * Same fixed calendar as the other suites — app clock 2026-07-10.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  BILLING_STATUSES,
  billedFor, checkPaymentWrite, collectedFor, hasUnknownAmount, outstandingFor,
  partitionByStudentResolution, totalsByClass, totalsFor,
  type BillLike, type PaymentWriteInput,
} from "../src/lib/billing";
import { billingPaymentSchema } from "../src/lib/schemas";
import type { Billing } from "../src/lib/types";

const CLOCK = "2026-07-10";

/** A module's source with its comments stripped, so a scan tests the CODE and
 * not the prose explaining it. Lifted from tests/attendance.test.ts. */
function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE = code("src", "lib", "billing.ts");

/* ------------------------------------------------------------------ fixtures */

function bill(over: Partial<Billing> = {}): Billing {
  return {
    id: "B-c1-s2-2026-07", studentId: "s2", classId: "c1", month: "2026-07",
    fee: 800_000, status: "Unpaid", paidDate: null, notes: "",
    ...over,
  };
}

const paid = (fee = 800_000) => bill({ status: "Paid", paidDate: "2026-07-06", fee });
const unpaid = (fee = 800_000) => bill({ status: "Unpaid", paidDate: null, fee });
/** A partial that says how much — the only kind a new write may create. */
const partialKnown = (paidAmount: number, fee = 800_000) =>
  bill({ status: "Partially Paid", paidDate: "2026-07-06", fee, paidAmount });
/** A partial that does not — every one of the nine records in production. */
const partialLegacy = (fee = 800_000) =>
  bill({ status: "Partially Paid", paidDate: "2026-07-06", fee });

/* ============================================================== one bill */

describe("Billing · one bill at a time", () => {
  it("1. billed is the fee exactly as stored, never reconciled with the class", () => {
    // The c6 case: the bill says 1,800,000 and the class says 18,000,000 today.
    // A snapshot is read at its own value; correcting stored data is a separate,
    // explicitly authorised act (PROJECT_RULES, Billing).
    assert.equal(billedFor(bill({ fee: 1_800_000 })), 1_800_000);
  });

  it("2. Paid collects exactly the fee", () => {
    assert.equal(collectedFor(paid(750_000)), 750_000);
  });

  it("3. Unpaid collects exactly zero — the one status for which 0 is an answer", () => {
    assert.equal(collectedFor(unpaid()), 0);
  });

  it("4. a partial with a recorded amount collects that amount, exactly", () => {
    assert.equal(collectedFor(partialKnown(300_000)), 300_000);
  });

  it("5. a partial WITHOUT an amount collects null — not 0", () => {
    assert.equal(collectedFor(partialLegacy()), null);
  });

  it("6. …and not half the fee, which is the assumption this replaces", () => {
    const b = partialLegacy(800_000);
    assert.notEqual(collectedFor(b), 400_000);
    assert.notEqual(collectedFor(b), b.fee / 2);
    assert.equal(collectedFor(b), null);
  });

  it("7. …and not the fee either", () => {
    assert.notEqual(collectedFor(partialLegacy(800_000)), 800_000);
  });

  it("8. a partial recorded as an explicit 0 is still 0, not unknown", () => {
    // Distinguishes "absent" from "present and zero". `checkPaymentWrite` refuses
    // to CREATE this, but a reader must not confuse the two if it exists.
    assert.equal(collectedFor({ status: "Partially Paid", fee: 800_000, paidAmount: 0 }), 0);
  });

  it("9. outstanding is exact where collected is known", () => {
    assert.equal(outstandingFor(partialKnown(300_000)), 500_000);
    assert.equal(outstandingFor(paid()), 0);
    assert.equal(outstandingFor(unpaid()), 800_000);
  });

  it("10. outstanding is null where collected is unknown — ignorance propagates", () => {
    assert.equal(outstandingFor(partialLegacy()), null);
  });

  it("11. an unrecognised status fails closed, to null rather than to a number", () => {
    const rogue = { status: "Overdue", fee: 800_000 } as unknown as BillLike;
    assert.equal(collectedFor(rogue), null);
    assert.equal(outstandingFor(rogue), null);
  });

  it("12. hasUnknownAmount names exactly the records a screen must caveat", () => {
    assert.equal(hasUnknownAmount(partialLegacy()), true);
    assert.equal(hasUnknownAmount(partialKnown(1)), false);
    assert.equal(hasUnknownAmount(paid()), false);
    assert.equal(hasUnknownAmount(unpaid()), false);
  });

  it("13. the status vocabulary is exactly three words, and Overdue is not one", () => {
    assert.deepEqual([...BILLING_STATUSES], ["Paid", "Partially Paid", "Unpaid"]);
    assert.ok(!BILLING_STATUSES.includes("Overdue" as never));
  });
});

/* ============================================================== aggregates */

describe("Billing · totals over a scope", () => {
  it("14. bills everything given, and collects what is known", () => {
    const t = totalsFor([paid(800_000), unpaid(750_000), partialKnown(300_000, 700_000)]);
    assert.equal(t.billed, 2_250_000);
    assert.equal(t.collected, 1_100_000);
    assert.equal(t.outstanding, 1_150_000);
    assert.equal(t.unknownAmountBills, 0);
  });

  it("15. billed + outstanding reconcile: billed - collected === outstanding", () => {
    const t = totalsFor([paid(800_000), unpaid(750_000), partialKnown(300_000, 700_000)]);
    assert.equal(t.billed - (t.collected ?? NaN), t.outstanding);
  });

  it("16. ONE unrecorded partial makes the whole scope's collected unknown", () => {
    const t = totalsFor([paid(800_000), unpaid(750_000), partialLegacy(700_000)]);
    assert.equal(t.billed, 2_250_000, "billed is always knowable");
    assert.equal(t.collected, null);
    assert.equal(t.outstanding, null);
    assert.equal(t.unknownAmountBills, 1);
  });

  it("17. …and the known part is not reported as though it were the whole", () => {
    // 800,000 was definitely collected. Reporting it as the total would understate
    // collection by exactly the amount nobody recorded, which is the failure this
    // null exists to prevent.
    const t = totalsFor([paid(800_000), partialLegacy(700_000)]);
    assert.notEqual(t.collected, 800_000);
    assert.equal(t.collected, null);
  });

  it("18. collectionRate is exact where known", () => {
    const t = totalsFor([paid(800_000), unpaid(800_000)]);
    assert.equal(t.collectionRate, 50);
  });

  it("19. collectionRate is null when any amount is unknown", () => {
    assert.equal(totalsFor([paid(800_000), partialLegacy(700_000)]).collectionRate, null);
  });

  it("20. collectionRate is null on a zero denominator — No data, never 0%", () => {
    const t = totalsFor([]);
    assert.equal(t.billed, 0);
    assert.equal(t.collected, 0, "nothing billed and nothing unknown is genuinely zero collected");
    assert.equal(t.collectionRate, null);
  });

  it("21. status counts tally, and total counts every bill", () => {
    const t = totalsFor([paid(), paid(), partialLegacy(), partialKnown(1), unpaid()]);
    assert.deepEqual(t.counts, { paid: 2, partiallyPaid: 2, unpaid: 1, total: 5 });
  });

  it("22. an unrecognised status is counted in total but in no bucket", () => {
    const rogue = { status: "Overdue", fee: 100 } as unknown as BillLike;
    const t = totalsFor([paid(100), rogue]);
    assert.equal(t.counts.total, 2);
    assert.equal(t.counts.paid + t.counts.partiallyPaid + t.counts.unpaid, 1);
  });

  it("23. reproduces the audited production month 2026-02 — 14 bills, all Paid", () => {
    const fees = [800_000, 800_000, 800_000, 800_000, 750_000, 750_000, 750_000, 750_000,
      700_000, 700_000, 700_000, 1_500_000, 1_500_000, 1_800_000];
    const t = totalsFor(fees.map((f) => paid(f)));
    assert.equal(t.counts.total, 14);
    assert.equal(t.billed, 13_100_000);
    assert.equal(t.collected, 13_100_000);
    assert.equal(t.outstanding, 0);
    assert.equal(t.collectionRate, 100);
  });
});

describe("Billing · per class", () => {
  const rows = [
    { ...paid(800_000), classId: "c1" },
    { ...unpaid(800_000), classId: "c1" },
    { ...partialKnown(300_000, 750_000), classId: "c2" },
  ];

  it("24. groups by class and totals each group", () => {
    const byClass = totalsByClass(rows);
    assert.deepEqual(byClass.map((r) => r.classId), ["c1", "c2"]);
    assert.equal(byClass[0].billed, 1_600_000);
    assert.equal(byClass[0].collected, 800_000);
    assert.equal(byClass[1].billed, 750_000);
    assert.equal(byClass[1].collected, 300_000);
  });

  it("25. per-class billed sums exactly to the scope's billed", () => {
    const scope = totalsFor(rows);
    const summed = totalsByClass(rows).reduce((s, r) => s + r.billed, 0);
    assert.equal(summed, scope.billed);
  });

  it("26. an unknown amount poisons only its own class, not the others", () => {
    const withLegacy = [...rows, { ...partialLegacy(700_000), classId: "c3" }];
    const byClass = totalsByClass(withLegacy);
    assert.equal(byClass.find((r) => r.classId === "c1")!.collected, 800_000);
    assert.equal(byClass.find((r) => r.classId === "c3")!.collected, null);
    assert.equal(totalsFor(withLegacy).collected, null, "…but the scope total is unknown");
  });

  it("27. class order is first appearance — no sort is invented", () => {
    const shuffled = [rows[2], rows[0], rows[1]];
    assert.deepEqual(totalsByClass(shuffled).map((r) => r.classId), ["c2", "c1"]);
  });
});

describe("Billing · a student taught in two classes", () => {
  // The production `s3` case: enrolled in c2 (750,000) and c5 (1,500,000), and
  // legitimately billed twice every month. `(studentId, month)` is NOT a key.
  const s3 = [
    { ...paid(750_000), id: "B-c2-s3-2026-07", studentId: "s3", classId: "c2" },
    { ...paid(1_500_000), id: "B-c5-s3-2026-07", studentId: "s3", classId: "c5" },
  ];

  it("28. both bills count independently — neither is a duplicate of the other", () => {
    const t = totalsFor(s3);
    assert.equal(t.counts.total, 2);
    assert.equal(t.billed, 2_250_000);
  });

  it("29. …and they roll up to two separate classes", () => {
    assert.deepEqual(totalsByClass(s3).map((r) => r.classId), ["c2", "c5"]);
  });
});

/* ============================================================== ghosts */

describe("Billing · ghosts are counted and not listed", () => {
  const scope = [
    { ...unpaid(800_000), studentId: "s2" },
    { ...unpaid(800_000), studentId: "s12" },
    { ...unpaid(800_000), studentId: "s8" },  // deleted
    { ...unpaid(750_000), studentId: "s14" }, // deleted
  ];
  const alive = new Set(["s2", "s12"]);

  it("30. the aggregate counts every bill, ghosts included", () => {
    // A student's later deletion must not move a closed month's figures
    // (PROJECT_RULES, Billing — the rule Homework already holds its ghosts to).
    const t = totalsFor(scope);
    assert.equal(t.counts.total, 4);
    assert.equal(t.billed, 3_150_000);
  });

  it("31. the partition names only the students who resolve", () => {
    const p = partitionByStudentResolution(scope, alive);
    assert.deepEqual(p.listable.map((b) => b.studentId), ["s2", "s12"]);
    assert.deepEqual(p.hidden.map((b) => b.studentId), ["s8", "s14"]);
  });

  it("32. hiddenCount is what the design's +N more renders", () => {
    assert.equal(partitionByStudentResolution(scope, alive).hiddenCount, 2);
  });

  it("33. the two halves lose nothing between them", () => {
    const p = partitionByStudentResolution(scope, alive);
    assert.equal(p.listable.length + p.hidden.length, scope.length);
  });

  it("34. totalling the LISTABLE half alone would move the month — which is why callers must not", () => {
    const p = partitionByStudentResolution(scope, alive);
    assert.equal(totalsFor(p.listable).billed, 1_600_000);
    assert.equal(totalsFor(scope).billed, 3_150_000);
    assert.notEqual(totalsFor(p.listable).billed, totalsFor(scope).billed);
  });

  it("35. an empty resolved set hides everything and still counts everything", () => {
    const p = partitionByStudentResolution(scope, new Set());
    assert.equal(p.listable.length, 0);
    assert.equal(p.hiddenCount, 4);
    assert.equal(totalsFor(scope).billed, 3_150_000);
  });
});

/* ============================================================== the write */

describe("Billing · checkPaymentWrite", () => {
  const ok = (input: PaymentWriteInput, fee = 800_000, clock = CLOCK) =>
    checkPaymentWrite(input, { fee }, clock);

  it("36. a missing bill is refused before anything else is judged", () => {
    const r = checkPaymentWrite({ status: "Paid", paidDate: CLOCK }, null, CLOCK);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.violation, "bill-missing");
  });

  it("37. Paid requires a date", () => {
    const r = ok({ status: "Paid", paidDate: null });
    assert.equal(r.ok === false && r.violation, "date-required");
  });

  it("38. Paid stores no amount — its collected value IS the fee", () => {
    const r = ok({ status: "Paid", paidDate: "2026-07-06" });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.write.paidAmount, undefined);
  });

  it("39. Paid refuses an amount rather than ignoring it", () => {
    const r = ok({ status: "Paid", paidDate: "2026-07-06", paidAmount: 400_000 });
    assert.equal(r.ok === false && r.violation, "amount-not-allowed");
  });

  it("40. Unpaid stores neither an amount nor a date", () => {
    const r = ok({ status: "Unpaid", paidDate: null });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.write.paidDate, null);
    assert.equal(r.ok === true && r.write.paidAmount, undefined);
  });

  it("41. Unpaid refuses an amount", () => {
    const r = ok({ status: "Unpaid", paidDate: null, paidAmount: 1 });
    assert.equal(r.ok === false && r.violation, "amount-not-allowed");
  });

  it("42. Unpaid refuses a date", () => {
    const r = ok({ status: "Unpaid", paidDate: "2026-07-06" });
    assert.equal(r.ok === false && r.violation, "date-not-allowed");
  });

  it("43. a new partial MUST state its amount — it is never inferred", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06" });
    assert.equal(r.ok === false && r.violation, "amount-required");
  });

  it("44. a partial's amount must be a whole đồng", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 400_000.5 });
    assert.equal(r.ok === false && r.violation, "amount-not-integer");
  });

  it("45. a partial of 0 is refused — that is Unpaid", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 0 });
    assert.equal(r.ok === false && r.violation, "amount-out-of-range");
  });

  it("46. a negative partial is refused", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: -1 });
    assert.equal(r.ok === false && r.violation, "amount-out-of-range");
  });

  it("47. a partial equal to the fee is refused — that is Paid", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 800_000 });
    assert.equal(r.ok === false && r.violation, "amount-out-of-range");
  });

  it("48. a partial above the fee is refused", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 900_000 });
    assert.equal(r.ok === false && r.violation, "amount-out-of-range");
  });

  it("49. the range is read from the BILL's fee, not from the payload", () => {
    const input: PaymentWriteInput = { status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 900_000 };
    assert.equal(ok(input, 800_000).ok, false, "over an 800,000 bill");
    assert.equal(ok(input, 1_500_000).ok, true, "within a 1,500,000 bill");
  });

  it("50. a valid partial passes its amount through unchanged", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.write.paidAmount, 1);
  });

  it("51. a future paidDate is refused", () => {
    const r = ok({ status: "Paid", paidDate: "2026-07-11" });
    assert.equal(r.ok === false && r.violation, "date-in-future");
  });

  it("52. …including the six shapes production already holds", () => {
    for (const d of ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-19"]) {
      const r = ok({ status: "Paid", paidDate: d });
      assert.equal(r.ok === false && r.violation, "date-in-future", d);
    }
  });

  it("53. today is not the future — the clock itself is accepted", () => {
    assert.equal(ok({ status: "Paid", paidDate: CLOCK }).ok, true);
  });

  it("54. yesterday is accepted — historical correction has no month lock", () => {
    assert.equal(ok({ status: "Paid", paidDate: "2026-02-03" }).ok, true);
  });

  it("55. the clock is an argument, so a test names the day it means", () => {
    const input: PaymentWriteInput = { status: "Paid", paidDate: "2026-07-14" };
    assert.equal(ok(input, 800_000, "2026-07-10").ok, false);
    assert.equal(ok(input, 800_000, "2026-07-20").ok, true);
  });

  it("56. the write carries ONLY payment fields — ownership is unreachable", () => {
    const r = ok({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 1, notes: "cash" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(
        Object.keys(r.write).sort(),
        ["notes", "paidAmount", "paidDate", "status"]
      );
    }
  });

  it("57. student status cannot reach this decision — it is not in the signature", () => {
    // A Trial, Paused or Archived student's tuition is still owed and still
    // settleable (PROJECT_RULES, Billing — a deliberate divergence from Reviews).
    // Arity counts parameters before the first default, so this is `input` and
    // `bill`; `appClock` is defaulted. Either way there is no Student in it.
    assert.equal(checkPaymentWrite.length, 2, "input and bill — no student, no roster");
    assert.ok(!CORE.includes("Archived"), "billing.ts must not name a student status");
    assert.ok(!CORE.includes("StudentStatus"));

    // The module DOES know a Student type, because a row renders a name and an
    // avatar. It knows it as a NARROW PROJECTION that deliberately omits
    // `status`, so no code here — payment or otherwise — can consult one even by
    // accident. That is the rule; "imports nothing called Student" was only ever
    // a proxy for it, and stopped being true when the read model landed.
    const ref = /export type BillingStudentRef = Pick<Student, ([^>]*)>/.exec(CORE);
    assert.ok(ref, "the student projection is declared as a Pick");
    assert.ok(!ref![1].includes("status"), "the projection must not carry status");
    for (const field of ["id", "name", "initials", "avatarColor", "parentId"]) {
      assert.ok(ref![1].includes(`"${field}"`), `the projection carries ${field}`);
    }
    // …and nothing wider than that projection is reachable.
    assert.ok(!/:\s*Student\b/.test(CORE), "no bare Student value is ever held");
  });
});

/* ============================================================== the payload */

describe("Billing · billingPaymentSchema", () => {
  const parse = (v: unknown) => billingPaymentSchema.safeParse(v);

  it("58. accepts the three legal statuses and nothing else", () => {
    for (const status of BILLING_STATUSES) {
      assert.equal(parse({ status, paidDate: "2026-07-06" }).success, true, status);
    }
    assert.equal(parse({ status: "Overdue", paidDate: "2026-07-06" }).success, false);
    assert.equal(parse({ status: "Pending", paidDate: null }).success, false);
  });

  it("59. refuses every ownership field rather than ignoring it", () => {
    for (const field of ["id", "studentId", "classId", "month", "fee"]) {
      const r = parse({ status: "Unpaid", paidDate: null, [field]: "x" });
      assert.equal(r.success, false, `${field} must be refused`);
    }
  });

  it("60. refuses fields a bill has never had", () => {
    for (const field of ["dueDate", "method", "invoiceId", "receiptId", "createdAt", "updatedAt"]) {
      const r = parse({ status: "Unpaid", paidDate: null, [field]: "x" });
      assert.equal(r.success, false, `${field} must be refused`);
    }
  });

  it("61. refuses a malformed date", () => {
    assert.equal(parse({ status: "Paid", paidDate: "06/07/2026" }).success, false);
    assert.equal(parse({ status: "Paid", paidDate: "2026-7-6" }).success, false);
    assert.equal(parse({ status: "Paid", paidDate: "yesterday" }).success, false);
  });

  it("62. normalises an empty date to the null the model stores", () => {
    const r = parse({ status: "Unpaid", paidDate: "" });
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.paidDate, null);
  });

  it("63. an omitted date is null, not undefined", () => {
    const r = parse({ status: "Unpaid" });
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.paidDate, null);
  });

  it("64. refuses a non-integer amount at the payload layer", () => {
    assert.equal(parse({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 1.5 }).success, false);
  });

  it("65. leaves the fee-relative range to checkPaymentWrite, which can see the fee", () => {
    // The payload alone cannot know 900,000 is too much; it parses, and the
    // invariant layer refuses it. Two layers, each answering what it can see.
    assert.equal(parse({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 900_000 }).success, true);
    assert.equal(
      checkPaymentWrite({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 900_000 }, { fee: 800_000 }, CLOCK).ok,
      false
    );
  });
});

/* ============================================================== source scans */

describe("Billing · the pure module stays pure", () => {
  it("66. reaches no database, model or connection", () => {
    for (const banned of ["mongoose", "dbConnect", "BillingModel", "./models", "./repo", "./db"]) {
      assert.ok(!CORE.includes(banned), `billing.ts must not reference ${banned}`);
    }
  });

  it("67. has no server-only marker, so the test runner can load it", () => {
    assert.ok(!CORE.includes("server-only"));
  });

  it("68. performs no I/O and no fetching", () => {
    for (const banned of ["fetch(", "readFileSync", "process.env"]) {
      assert.ok(!CORE.includes(banned), `billing.ts must not use ${banned}`);
    }
  });

  it("69. holds no clock of its own — the app clock is an argument", () => {
    assert.ok(!CORE.includes("new Date"), "no wall clock");
    assert.ok(!CORE.includes("Date.now"), "no wall clock");
    assert.ok(/appClock/.test(CORE), "the clock arrives as a parameter");
  });

  it("70. no bill-derived helper, type or field is named revenue", () => {
    // Gate 2, B1: the UI keeps the design's own labels, and the separation is
    // enforced HERE instead — in the code's vocabulary.
    assert.ok(!/revenue/i.test(CORE), "billing.ts must not use the word revenue in code");
  });

  it("71. declares no Billing index — an index is production DDL, not a feature", () => {
    assert.ok(!CORE.includes(".index("));
    const models = code("src", "lib", "models.ts");
    assert.ok(
      !/BillingSchema\.index\(/.test(models),
      "models.ts must declare no Billing index: autoIndex is on, so a declaration builds it on deploy"
    );
  });

  it("72. reads no Student.balance, in either direction", () => {
    assert.ok(!/\bbalance\b/.test(CORE));
  });
});

describe("Billing · the 50% assumption is gone from the codebase", () => {
  it("73. calc.ts no longer exports paidAmount", () => {
    const calc = code("src", "lib", "calc.ts");
    assert.ok(!/export\s+function\s+paidAmount\b/.test(calc));
    assert.ok(!/fee\s*\/\s*2/.test(calc), "no half-the-fee arithmetic remains in calc.ts");
  });

  it("74. no module in src/ divides a fee by two", () => {
    const roots = ["billing.ts", "calc.ts", "finance.ts", "schemas.ts", "models.ts", "types.ts"];
    for (const f of roots) {
      const src = code("src", "lib", f);
      assert.ok(!/fee\s*\/\s*2/.test(src), `${f} must not halve a fee`);
      assert.ok(!/paidAmount\s*\/\s*2/.test(src), `${f} must not halve an amount`);
      assert.ok(!/\*\s*0?\.5/.test(src), `${f} must not scale money by 0.5`);
    }
  });

  it("75. no reader substitutes a number for an unknown amount", () => {
    // The three wrong answers, asserted as behaviour rather than as source text.
    const b = partialLegacy(800_000);
    for (const wrong of [0, 400_000, 800_000]) {
      assert.notEqual(collectedFor(b), wrong);
    }
  });
});
