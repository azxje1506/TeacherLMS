/* Reports — the pure module: five types, one document, and nothing invented.
 *
 * Run with:  npm test
 *
 * PURE, like every other suite here. `src/lib/reports.ts` holds no clock, reaches
 * no database and carries no `server-only` marker, so every rule it embodies is
 * exercised directly over plain values.
 *
 * WHAT THIS SUITE DEFENDS, above everything else:
 *
 *  - EXACTLY FIVE TYPES. `Performance Summary` is not one of them and the
 *    Reviews-owned Monthly Progress Report is not reachable from here.
 *  - EACH REPORT'S MONTH IS ITS OWNING DOMAIN'S. Moving a `paidDate` must not
 *    move a bill between report months; moving `Billing.month` must. The same
 *    pair of assertions is made for attendance's legacy mirror date and for
 *    homework's creation date. Reports must not become a third interpretation.
 *  - NOTHING IS GUESSED. An unrecorded partial payment reaches the sheet as
 *    `No data` — never zero, never half. There is a source scan asserting the
 *    deleted `fee / 2` rule has not crept back in through this module.
 *  - BILLING AND REVENUE CANNOT MEET. The revenue builders' input type has no
 *    room for a bill and the payment builder's has no room for a lesson, so the
 *    separation is a type error rather than a convention.
 *  - GHOSTS COUNT AND ARE NEVER NAMED, per owning domain, with no cross-domain
 *    filter of Reports' own.
 *
 * Guarantees not expressible as a function call — no database import, no clock,
 * no invented count — are asserted by scanning the source, the technique
 * tests/billing.ts and tests/attendance.test.ts already use.
 *
 * NOTHING HERE TOUCHES THE PRODUCTION DATABASE. Same fixed calendar as the other
 * suites — app clock 2026-07-10, application month 2026-07.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  NO_DATA, REPORT_ERROR, REPORT_MONTH_WINDOW, REPORT_SCOPE, REPORT_TITLE, REPORT_TYPES,
  STUDIO_SCOPE,
  buildAttendanceSummaryBody, buildClassRevenueBody, buildHomeworkSummaryBody,
  buildMonthlyRevenueBody, buildStudentPaymentBody,
  checkReportScope, isReportType, reportMonthOptions,
  type ReportBody, type ReportScope, type ReportType, type ReportValue,
} from "../src/lib/reports";
import type {
  AttendanceRecord, Billing, Homework, Klass, Lesson, Student,
} from "../src/lib/types";

const CLOCK = "2026-07-10";
const APP_MONTH = "2026-07";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE = code("src", "lib", "reports.ts");

/* ------------------------------------------------------------------ fixtures */

function klass(over: Partial<Klass> = {}): Klass {
  return {
    id: "c1", name: "Little Explorers · A1", type: "group", level: "A1", fee: 800_000,
    classroom: "Room 1", status: "Active", studentIds: ["s1", "s2"], notes: "",
    schedule: [], color: "#d14242", ...over,
  };
}

function student(over: Partial<Student> = {}): Student {
  return {
    id: "s1", name: "Emma Chen", first: "Emma", last: "Chen", initials: "EC",
    status: "Active", parentId: "p1", classes: 1, attendance: 100, notes: "",
    avatarColor: "#d14242",
    ...over,
  } as Student;
}

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1", classId: "c1", type: "regular", date: "2026-07-02", start: "09:00",
    duration: 60, status: "Completed", classroom: "Room 1", notes: "",
    ...over,
  } as Lesson;
}

function register(lessonId: string, entries: Record<string, string>): AttendanceRecord {
  return {
    id: `a-${lessonId}`, lessonId, date: "1970-01-01",
    entries: Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, { status: v, note: "" }])
    ),
  } as unknown as AttendanceRecord;
}

function bill(over: Partial<Billing> = {}): Billing {
  return {
    id: "B-c1-s1-2026-07", studentId: "s1", classId: "c1", month: "2026-07",
    fee: 800_000, status: "Paid", paidDate: "2026-07-05", notes: "",
    ...over,
  } as Billing;
}

function homework(over: Partial<Homework> = {}): Homework {
  return {
    id: "h1", title: "Unit 3", description: "", classId: "c1", lessonId: null,
    scope: "class", studentId: null, dueDate: "2026-07-08", status: "Completed",
    submissions: { s1: "Completed", s2: "Missing" }, teacherNotes: "",
    createdAt: "2026-07-01",
    ...over,
  };
}

/** Four regular lessons in July, all Completed, two students enrolled. */
function revenueFixture() {
  const classes = [klass()];
  const students = [student({ id: "s1" }), student({ id: "s2", name: "Liam Park" })];
  const lessons = [
    lesson({ id: "l1", date: "2026-07-02" }),
    lesson({ id: "l2", date: "2026-07-09" }),
    lesson({ id: "l3", date: "2026-07-16" }),
    lesson({ id: "l4", date: "2026-07-23" }),
  ];
  return { classes, students, lessons, attendance: [] as AttendanceRecord[] };
}

const cellsOf = (b: ReportBody, i: number): ReportValue[] => b.rows[i].cells;
const tile = (b: ReportBody, label: string) => b.summary.find((s) => s.label === label);

function scopeOf(over: Partial<ReportScope> = {}): ReportScope {
  return { ...STUDIO_SCOPE, ...over };
}

/* ============================================================== report types */

describe("Reports · exactly five types", () => {
  it("1. authorises five, in selector order", () => {
    assert.deepEqual([...REPORT_TYPES], [
      "monthly-revenue", "class-revenue", "student-payment",
      "attendance-summary", "homework-summary",
    ]);
    assert.equal(REPORT_TYPES.length, 5);
  });

  it("2. accepts all five", () => {
    for (const t of REPORT_TYPES) assert.ok(isReportType(t), t);
  });

  it("3. refuses Performance Summary in every spelling", () => {
    for (const t of [
      "performance-summary", "performance", "Performance Summary", "performanceSummary",
    ]) {
      assert.ok(!isReportType(t), `${t} is not an authorised report type`);
    }
  });

  it("4. refuses the Reviews-owned Monthly Progress Report", () => {
    for (const t of [
      "monthly-progress", "monthly-progress-report", "Monthly Progress Report",
      "review", "reviews", "monthly-review",
    ]) {
      assert.ok(!isReportType(t), `${t} is Reviews-owned and is not a Reports type`);
    }
  });

  it("5. refuses an unknown type, and fails closed on a non-string", () => {
    for (const t of ["", "revenue", "excel", "csv", "unknown", null, undefined, 7, {}, []]) {
      assert.ok(!isReportType(t));
    }
  });

  it("6. names no Performance Summary or Reviews document anywhere in the module", () => {
    for (const banned of [
      "Performance Summary", "performance", "Monthly Progress Report",
      "radar", "skills", "goals", "parentNotes", "reviewAverage",
    ]) {
      assert.ok(!CORE.includes(banned), `reports.ts must not mention ${banned}`);
    }
  });

  it("7. every type has a title, and the titles are the design's own strings", () => {
    assert.deepEqual(Object.keys(REPORT_TITLE).sort(), [...REPORT_TYPES].sort());
    assert.equal(REPORT_TITLE["monthly-revenue"], "Monthly Revenue Report");
    assert.equal(REPORT_TITLE["class-revenue"], "Class Revenue Report");
    assert.equal(REPORT_TITLE["student-payment"], "Student Payment Report");
    assert.equal(REPORT_TITLE["attendance-summary"], "Attendance Summary");
    assert.equal(REPORT_TITLE["homework-summary"], "Homework Summary");
  });

  it("8. every title is a key the shipped dictionary already carries", () => {
    const dict = JSON.parse(
      readFileSync(path.join(process.cwd(), "src", "lib", "i18n-vi.json"), "utf8")
    ) as Record<string, string>;
    for (const t of REPORT_TYPES) {
      assert.ok(dict[REPORT_TITLE[t]], `${REPORT_TITLE[t]} must already be translated`);
    }
  });

  it("9. the type list is declared once — nothing else keeps a second copy", () => {
    const service = code("src", "lib", "reports-service.ts");
    const route = code("src", "app", "api", "reports", "route.ts");

    // The one array of keys lives here. A dispatcher's `case` labels are not a
    // second list: TypeScript checks the switch against `ReportType`, so a sixth
    // type is a compile error rather than a silently unhandled branch.
    assert.ok(/REPORT_TYPES = \[/.test(CORE));
    for (const [name, src] of [["service", service], ["route", route]] as const) {
      assert.ok(!/REPORT_TYPES\s*=|TYPES\s*=\s*\[/.test(src),
        `the ${name} must not declare its own type list`);
      assert.ok(!/REPORT_TITLE\s*[:=]\s*\{/.test(src),
        `the ${name} must not restate the titles`);
      assert.ok(!/REPORT_SCOPE\s*[:=]\s*\{/.test(src),
        `the ${name} must not restate scope applicability`);
    }

    // The route validates through the shared guard rather than its own strings.
    assert.ok(route.includes("isReportType"));
    assert.ok(!/"monthly-revenue"/.test(route), "the route names no type key of its own");

    // Selector-facing metadata is derivable from this module alone.
    for (const t of REPORT_TYPES) {
      assert.ok(REPORT_TITLE[t] && REPORT_SCOPE[t], `${t} carries its own title and scope`);
    }
  });
});

/* ============================================================= month window */

describe("Reports · the reporting window is server-owned", () => {
  it("10. is exactly twelve months", () => {
    assert.equal(REPORT_MONTH_WINDOW, 12);
    assert.equal(reportMonthOptions(APP_MONTH).length, 12);
  });

  it("11. is newest first and includes the application month", () => {
    const months = reportMonthOptions(APP_MONTH);
    assert.equal(months[0], APP_MONTH);
    const sorted = [...months].sort().reverse();
    assert.deepEqual(months, sorted, "newest first");
  });

  it("12. is the application month plus the previous eleven", () => {
    assert.deepEqual(reportMonthOptions("2026-07"), [
      "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02",
      "2026-01", "2025-12", "2025-11", "2025-10", "2025-09", "2025-08",
    ]);
  });

  it("13. crosses a year boundary correctly", () => {
    const months = reportMonthOptions("2026-01");
    assert.equal(months[0], "2026-01");
    assert.equal(months[1], "2025-12");
    assert.equal(months[11], "2025-02");
    assert.equal(months.length, 12);
  });

  it("14. offers no future month", () => {
    for (const app of ["2026-07", "2026-01", "2025-12"]) {
      for (const m of reportMonthOptions(app)) assert.ok(m <= app, `${m} is after ${app}`);
    }
  });

  it("15. holds no clock and no hardcoded demo month", () => {
    assert.ok(!CORE.includes("new Date("), "no clock of its own");
    assert.ok(!CORE.includes("Date.now"), "no clock of its own");
    assert.ok(!CORE.includes("FINANCE_MONTHS"), "the seed's window is never a runtime window");
    assert.ok(!CORE.includes("CURRENT_MONTH"), "the application month is an argument");
    assert.ok(!CORE.includes("TODAY_ISO"), "the application day is an argument");
    assert.ok(!/20\d\d-\d\d/.test(CORE), "no hardcoded month appears in the module");
  });

  it("16. the window is derived, not enumerated", () => {
    assert.ok(CORE.includes("shiftMonth"), "months come from the shared shifter");
  });
});

/* =================================================================== scopes */

describe("Reports · scope applicability", () => {
  it("17. Monthly Revenue is studio-wide only", () => {
    assert.deepEqual(REPORT_SCOPE["monthly-revenue"], { class: false, student: false });
    assert.deepEqual(checkReportScope("monthly-revenue", null, null), { ok: true });
    assert.deepEqual(checkReportScope("monthly-revenue", "c1", null),
      { ok: false, violation: "class-not-applicable" });
    assert.deepEqual(checkReportScope("monthly-revenue", null, "s1"),
      { ok: false, violation: "student-not-applicable" });
  });

  it("18. Class Revenue takes a class and refuses a student", () => {
    assert.deepEqual(REPORT_SCOPE["class-revenue"], { class: true, student: false });
    assert.deepEqual(checkReportScope("class-revenue", null, null), { ok: true });
    assert.deepEqual(checkReportScope("class-revenue", "c1", null), { ok: true });
    assert.deepEqual(checkReportScope("class-revenue", null, "s1"),
      { ok: false, violation: "student-not-applicable" });
    assert.deepEqual(checkReportScope("class-revenue", "c1", "s1"),
      { ok: false, violation: "student-not-applicable" });
  });

  it("19. the three per-person reports take all four combinations", () => {
    for (const t of ["student-payment", "attendance-summary", "homework-summary"] as ReportType[]) {
      assert.deepEqual(REPORT_SCOPE[t], { class: true, student: true }, t);
      assert.deepEqual(checkReportScope(t, null, null), { ok: true }, `${t} studio`);
      assert.deepEqual(checkReportScope(t, "c1", null), { ok: true }, `${t} class`);
      assert.deepEqual(checkReportScope(t, null, "s1"), { ok: true }, `${t} student`);
      assert.deepEqual(checkReportScope(t, "c1", "s1"), { ok: true }, `${t} student-in-class`);
    }
  });

  it("20. an omitted filter is the sentinel, never a complaint", () => {
    for (const t of REPORT_TYPES) {
      assert.deepEqual(checkReportScope(t, null, null), { ok: true }, t);
    }
  });

  it("21. two types never collapse into each other under a filter", () => {
    // A class-scoped Monthly Revenue would BE Class Revenue, so it is refused.
    assert.equal(checkReportScope("monthly-revenue", "c1", null).ok, false);
    assert.equal(checkReportScope("class-revenue", "c1", null).ok, true);
  });

  it("22. an unresolvable class and student are refused the same way a guess is", () => {
    assert.equal(REPORT_ERROR["class-missing"].status, 404);
    assert.equal(REPORT_ERROR["student-missing"].status, 404);
    // One message each: a ghost and a genuine miss are indistinguishable.
    assert.equal(REPORT_ERROR["class-missing"].message, "Class not found");
    assert.equal(REPORT_ERROR["student-missing"].message, "Student not found");
  });

  it("23. every violation has a deterministic status", () => {
    for (const [key, v] of Object.entries(REPORT_ERROR)) {
      assert.ok([404, 422].includes(v.status), `${key} -> ${v.status}`);
      assert.ok(v.message.length > 0);
    }
  });
});

/* ========================================================== monthly revenue */

describe("Reports · Monthly Revenue delegates to the revenue engine", () => {
  it("24. reports the engine's own total and its by-type split", () => {
    const body = buildMonthlyRevenueBody("2026-07", revenueFixture());
    // 4 regular lessons, 2 students, fee 800,000 -> 8 shares of 200,000.
    assert.deepEqual(tile(body, "Total revenue")!.value, { kind: "money", amount: 1_600_000 });
    assert.equal(body.rows.length, 3);
    assert.deepEqual(cellsOf(body, 0), [{ kind: "term", key: "Regular" }, { kind: "money", amount: 1_600_000 }]);
  });

  it("25. the three type rows sum exactly to the total", () => {
    const body = buildMonthlyRevenueBody("2026-07", revenueFixture());
    const total = (tile(body, "Total revenue")!.value as { amount: number }).amount;
    const sum = body.rows.reduce((s, r) => s + (r.cells[1] as { amount: number }).amount, 0);
    assert.equal(sum, total, "the engine's invariant survives the report");
  });

  it("26. carries teaching hours, which is canonical", () => {
    const body = buildMonthlyRevenueBody("2026-07", revenueFixture());
    assert.deepEqual(tile(body, "Teaching hours")!.value, { kind: "hours", value: 4 });
  });

  it("27. does not correct or clamp a stored fee anomaly", () => {
    // c6 stores 18,000,000 where its own bills store 1,800,000. Exact as stored.
    const data = revenueFixture();
    data.classes = [klass({ id: "c6", fee: 18_000_000, studentIds: ["s1"] })];
    data.lessons = data.lessons.map((l) => ({ ...l, classId: "c6" }));
    const body = buildMonthlyRevenueBody("2026-07", data);
    assert.deepEqual(tile(body, "Total revenue")!.value,
      { kind: "money", amount: 18_000_000 },
      "the anomalous fee is reported exactly as stored");
  });

  it("28. carries no billing field of any kind", () => {
    const body = buildMonthlyRevenueBody("2026-07", revenueFixture());
    assert.equal(body.completeness, undefined);
    assert.equal(body.hiddenRecords, undefined);
    const labels = body.summary.map((s) => s.label).join(" ");
    for (const banned of ["Collected", "Outstanding", "Total billable", "Collection rate"]) {
      assert.ok(!labels.includes(banned), `a revenue report must not show ${banned}`);
    }
  });
});

/* ============================================================ class revenue */

describe("Reports · Class Revenue reads the engine's own per-class rows", () => {
  const data = () => {
    const base = revenueFixture();
    base.classes = [klass(), klass({ id: "c2", name: "Grammar Stars · B1", fee: 750_000, studentIds: ["s1"] })];
    base.lessons = [
      ...base.lessons,
      lesson({ id: "m1", classId: "c2", date: "2026-07-03" }),
      lesson({ id: "m2", classId: "c2", date: "2026-07-10" }),
    ];
    return base;
  };

  it("29. all classes: every row the engine reported, in its order", () => {
    const body = buildClassRevenueBody("2026-07", data(), null);
    assert.equal(body.rows.length, 2);
    const amounts = body.rows.map((r) => (r.cells[1] as { amount: number }).amount);
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a), "highest first, the engine's order");
    assert.deepEqual(tile(body, "Total revenue")!.value, { kind: "money", amount: 2_350_000 });
  });

  it("30. one class: the engine's own integer for that class, unmodified", () => {
    const all = buildClassRevenueBody("2026-07", data(), null);
    const one = buildClassRevenueBody("2026-07", data(), "c2");
    assert.equal(one.rows.length, 1);
    const fromAll = all.rows.find((r) => r.key === "c2")!.cells[1];
    assert.deepEqual(one.rows[0].cells[1], fromAll, "selection, not a second calculation");
    assert.deepEqual(tile(one, "Total revenue")!.value, fromAll);
  });

  it("31. a class that earned nothing is empty, not a zero row", () => {
    const body = buildClassRevenueBody("2026-07", data(), "c9");
    assert.equal(body.rows.length, 0);
    assert.equal(body.empty, true);
  });

  it("32. derives no per-student revenue", () => {
    const body = buildClassRevenueBody("2026-07", data(), null);
    assert.deepEqual(body.columns.map((c) => c.key), ["class", "amount"]);
  });

  it("33. does not normalise c6", () => {
    const d = data();
    d.classes = [klass({ id: "c6", fee: 18_000_000, studentIds: ["s1"] })];
    d.lessons = revenueFixture().lessons.map((l) => ({ ...l, classId: "c6" }));
    const body = buildClassRevenueBody("2026-07", d, "c6");
    assert.deepEqual(body.rows[0].cells[1], { kind: "money", amount: 18_000_000 });
  });
});

/* ========================================================== student payment */

describe("Reports · Student Payment preserves every Sprint 9 semantic", () => {
  const resolution = (over: Partial<{ students: Student[]; classes: Klass[]; parents: string[] }> = {}) => ({
    students: over.students ?? [student({ id: "s1" }), student({ id: "s2", name: "Liam Park", parentId: "" })],
    classes: over.classes ?? [klass()],
    livingParentIds: new Set(over.parents ?? ["p1"]),
  });

  it("34. the honesty identity holds on the sheet", () => {
    const bills = [
      bill({ id: "b1", studentId: "s1", status: "Paid", fee: 800_000 }),
      bill({ id: "b2", studentId: "s2", status: "Unpaid", fee: 800_000, paidDate: null }),
      bill({ id: "b3", studentId: "s1", status: "Partially Paid", fee: 700_000, paidDate: "2026-07-06" }),
    ];
    const body = buildStudentPaymentBody(bills, resolution());
    const billed = (tile(body, "Total billable")!.value as { amount: number }).amount;
    const collected = (tile(body, "Collected")!.value as { amount: number }).amount;
    const outstanding = (tile(body, "Outstanding")!.value as { amount: number }).amount;
    const unknown = (tile(body, "Not recorded")!.value as { amount: number }).amount;
    assert.equal(collected + outstanding + unknown, billed);
  });

  it("35. an unrecorded partial is No data — never zero, never half", () => {
    const bills = [bill({ id: "b3", status: "Partially Paid", fee: 700_000, paidDate: "2026-07-06" })];
    const body = buildStudentPaymentBody(bills, resolution());
    const [, , fee, collected, outstanding] = body.rows[0].cells;
    assert.deepEqual(fee, { kind: "money", amount: 700_000 });
    assert.deepEqual(collected, NO_DATA, "never 0đ");
    assert.deepEqual(outstanding, NO_DATA, "never 350,000đ");
    assert.notDeepEqual(collected, { kind: "money", amount: 350_000 });
    assert.notDeepEqual(collected, { kind: "money", amount: 0 });
  });

  it("36. a recorded partial reports exactly what was recorded", () => {
    const bills = [bill({ status: "Partially Paid", fee: 700_000, paidAmount: 250_000, paidDate: "2026-07-06" })];
    const body = buildStudentPaymentBody(bills, resolution());
    assert.deepEqual(body.rows[0].cells[3], { kind: "money", amount: 250_000 });
    assert.deepEqual(body.rows[0].cells[4], { kind: "money", amount: 450_000 });
  });

  it("37. an incomplete collection rate is flagged as a floor", () => {
    const incomplete = buildStudentPaymentBody(
      [bill({ status: "Partially Paid", fee: 700_000, paidDate: "2026-07-06" })],
      resolution()
    );
    assert.equal(tile(incomplete, "Collection rate")!.floor, true);
    assert.equal(incomplete.completeness!.amountsComplete, false);
    assert.equal(incomplete.completeness!.unknownAmountBills, 1);

    const complete = buildStudentPaymentBody([bill({ status: "Paid" })], resolution());
    assert.equal(tile(complete, "Collection rate")!.floor, false);
    assert.equal(complete.completeness!.amountsComplete, true);
  });

  it("38. the unrecorded slice is named only when there is one", () => {
    const complete = buildStudentPaymentBody([bill({ status: "Paid" })], resolution());
    assert.equal(tile(complete, "Not recorded"), undefined);
  });

  it("39. Partially paid is a COUNT of bills, never an amount", () => {
    const body = buildStudentPaymentBody(
      [
        bill({ id: "b1", status: "Partially Paid", fee: 700_000, paidDate: "2026-07-06" }),
        bill({ id: "b2", status: "Partially Paid", fee: 800_000, paidDate: "2026-07-06" }),
      ],
      resolution()
    );
    assert.deepEqual(tile(body, "Partially paid")!.value, { kind: "count", value: 2 });
  });

  it("40. ghost bills count in every total and raise no row", () => {
    const bills = [
      bill({ id: "b1", studentId: "s1", status: "Paid", fee: 800_000 }),
      bill({ id: "b9", studentId: "gone", status: "Paid", fee: 500_000 }),
    ];
    const body = buildStudentPaymentBody(bills, resolution());
    assert.deepEqual(tile(body, "Total billable")!.value, { kind: "money", amount: 1_300_000 },
      "a deletion must not move a closed month's figures");
    assert.equal(body.rows.length, 1, "a row is a person");
    assert.equal(body.hiddenRecords, 1, "Billing's own count, passed through");
    assert.ok(!JSON.stringify(body).includes("gone"), "no ghost id reaches the payload");
  });

  it("41. surfaces Billing's hiddenRecords and derives no count of its own", () => {
    assert.ok(CORE.includes("branch.hiddenRecords"), "the count is the domain's");
    assert.ok(!/hiddenRecords:\s*\w+\.filter/.test(CORE), "Reports counts nothing itself");
  });

  it("42. carries the parent indication, and no parent contact data", () => {
    const bills = [
      bill({ id: "b1", studentId: "s1" }),
      bill({ id: "b2", studentId: "s2" }),
    ];
    const body = buildStudentPaymentBody(bills, resolution());
    assert.equal(body.rows.find((r) => r.key === "b1")!.parentLinked, true);
    assert.equal(body.rows.find((r) => r.key === "b2")!.parentLinked, false);
    const json = JSON.stringify(body);
    for (const leak of ["phone", "email", "address", "relationship", "parentName"]) {
      assert.ok(!json.includes(leak), `a report must not carry ${leak}`);
    }
  });

  it("43. a dangling parentId is not a link, and blocks nothing", () => {
    const body = buildStudentPaymentBody(
      [bill({ studentId: "s1" })],
      resolution({ parents: [] })
    );
    assert.equal(body.rows[0].parentLinked, false);
    assert.equal(body.empty, false, "a missing parent never blocks generation");
  });

  it("44. carries no revenue figure, and no lesson can reach it", () => {
    const body = buildStudentPaymentBody([bill()], resolution());
    const labels = body.summary.map((s) => s.label).join(" ");
    assert.ok(!labels.includes("Total revenue"));
    assert.ok(!labels.includes("Teaching hours"));
    assert.ok(!JSON.stringify(body).toLowerCase().includes("revenue"));
  });

  it("45. no half-fee inference exists anywhere in the module", () => {
    for (const banned of ["fee / 2", "fee/2", "* 0.5", "/ 2)", "Math.round(b.fee"]) {
      assert.ok(!CORE.includes(banned), `the deleted 50% partial rule must not return via ${banned}`);
    }
  });
});

/* ================================================================ attendance */

describe("Reports · Attendance Summary", () => {
  const data = () => {
    const base = revenueFixture();
    base.attendance = [
      register("l1", { s1: "Present", s2: "Absent" }),
      register("l2", { s1: "Present", s2: "Late" }),
    ];
    return base;
  };

  it("46. studio-wide reports the index's own rate and per-class rows", () => {
    const body = buildAttendanceSummaryBody("2026-07", data(), CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Attendance rate")!.value, { kind: "percent", value: 75 });
    assert.deepEqual(tile(body, "Registers taken")!.value, { kind: "count", value: 4 });
    assert.equal(body.rows.length, 1);
    assert.deepEqual(body.rows[0].cells[0], { kind: "text", value: "Little Explorers · A1" });
  });

  it("47. an empty denominator is No data, never 0%", () => {
    const empty = { ...revenueFixture(), attendance: [] as AttendanceRecord[] };
    const body = buildAttendanceSummaryBody("2026-07", empty, CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Attendance rate")!.value, NO_DATA);
    assert.notDeepEqual(tile(body, "Attendance rate")!.value, { kind: "percent", value: 0 });
    assert.equal(body.empty, true);
  });

  it("48. Present, Late and Excused all count as attended; only Absent withholds", () => {
    const d = revenueFixture();
    d.attendance = [register("l1", { s1: "Late", s2: "Excused" })];
    const body = buildAttendanceSummaryBody("2026-07", d, CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Attendance rate")!.value, { kind: "percent", value: 100 });
  });

  it("49. one student carries the coverage pair its own helper returns", () => {
    const body = buildAttendanceSummaryBody("2026-07", data(), CLOCK,
      scopeOf({ kind: "student", studentId: "s2", studentName: "Liam Park" }));
    assert.deepEqual(tile(body, "Attendance rate")!.value, { kind: "percent", value: 50 });
    assert.deepEqual(body.coverage, { registersTaken: 2, lessonsCompleted: 4 });
  });

  it("50. coverage appears only where the owning helper supplies it", () => {
    const studio = buildAttendanceSummaryBody("2026-07", data(), CLOCK, scopeOf());
    assert.equal(studio.coverage, undefined, "Reports invents no coverage of its own");
  });

  it("51. one class with no stored register is No data, not 0%", () => {
    const d = { ...revenueFixture(), attendance: [] as AttendanceRecord[] };
    const body = buildAttendanceSummaryBody("2026-07", d, CLOCK,
      scopeOf({ kind: "class", classId: "c1", className: "Little Explorers · A1" }));
    assert.deepEqual(tile(body, "Attendance rate")!.value, NO_DATA);
    assert.equal(body.empty, true);
  });

  it("52. a class's rows name only its resolvable roster", () => {
    const d = data();
    d.classes = [klass({ studentIds: ["s1", "s2", "gone"] })];
    const body = buildAttendanceSummaryBody("2026-07", d, CLOCK,
      scopeOf({ kind: "class", classId: "c1", className: "Little Explorers · A1" }));
    assert.ok(!JSON.stringify(body).includes("gone"), "an unresolvable roster id is never a row");
    assert.equal(body.rows.length, 2);
  });

  it("53. never applies revenue's everyone-present assumption", () => {
    // l3 and l4 are Completed with no register. Revenue treats those students as
    // present; the attendance metric counts stored entries only.
    const body = buildAttendanceSummaryBody("2026-07", data(), CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Registers taken")!.value, { kind: "count", value: 4 },
      "four stored entries, not eight assumed ones");
  });
});

/* ================================================================== homework */

describe("Reports · Homework Summary", () => {
  const students = [{ id: "s1", name: "Emma Chen" }, { id: "s2", name: "Liam Park" }];

  it("54. Completed and Late are done; Missing is not", () => {
    const hw = [homework({ submissions: { s1: "Completed", s2: "Late" } })];
    const body = buildHomeworkSummaryBody("2026-07", hw, students);
    assert.deepEqual(tile(body, "Homework completion")!.value, { kind: "percent", value: 100 });
  });

  it("55. Assigned is excluded from the measure entirely", () => {
    const hw = [
      homework({ id: "h1", submissions: { s1: "Completed", s2: "Assigned" } }),
    ];
    const body = buildHomeworkSummaryBody("2026-07", hw, students);
    assert.deepEqual(tile(body, "Homework completion")!.value, { kind: "percent", value: 100 },
      "s2's Assigned outcome is neither done nor failed");
    assert.equal(body.rows.length, 1, "a student with no eligible outcome raises no row");
  });

  it("56. a student with no eligible outcome renders No data, never 0%", () => {
    const hw = [homework({ submissions: { s1: "Missing", s2: "Assigned" } })];
    const body = buildHomeworkSummaryBody("2026-07", hw, students);
    const row = body.rows.find((r) => r.key === "s1")!;
    assert.deepEqual(row.cells[1], { kind: "percent", value: 0 }, "s1 genuinely did none");
    assert.equal(body.rows.find((r) => r.key === "s2"), undefined, "s2 has nothing to measure");
  });

  it("57. a sparse month is honestly empty", () => {
    const body = buildHomeworkSummaryBody("2026-03", [], students);
    assert.equal(body.empty, true);
    assert.deepEqual(tile(body, "Homework completion")!.value, NO_DATA);
    assert.deepEqual(body.rows, []);
  });

  it("58. ghost outcomes stay in the aggregate and name nobody", () => {
    const hw = [homework({ submissions: { s1: "Completed", gone: "Missing" } })];
    const body = buildHomeworkSummaryBody("2026-07", hw, students);
    assert.deepEqual(tile(body, "Homework completion")!.value, { kind: "percent", value: 50 },
      "the deleted student's Missing still counts, as Homework already counts it");
    assert.equal(body.rows.length, 1);
    assert.ok(!JSON.stringify(body).includes("gone"));
  });

  it("59. supplies no hidden count, because Homework publishes none", () => {
    const hw = [homework({ submissions: { s1: "Completed", gone: "Missing" } })];
    const body = buildHomeworkSummaryBody("2026-07", hw, students);
    assert.equal(body.hiddenRecords, undefined,
      "where the owning domain supplies no count, Reports shows none");
  });
});

/* ========================================================== month ownership */

describe("Reports · each report's month is its owning domain's", () => {
  it("60. Revenue follows Lesson.date", () => {
    const july = revenueFixture();
    const august = { ...july, lessons: july.lessons.map((l) => ({ ...l, date: l.date.replace("2026-07", "2026-08") })) };
    assert.ok((tile(buildMonthlyRevenueBody("2026-07", july), "Total revenue")!.value as { amount: number }).amount > 0);
    assert.equal((tile(buildMonthlyRevenueBody("2026-07", august), "Total revenue")!.value as { amount: number }).amount, 0);
    assert.ok((tile(buildMonthlyRevenueBody("2026-08", august), "Total revenue")!.value as { amount: number }).amount > 0);
  });

  it("61. Student Payment follows Billing.month — a paidDate never moves a bill", () => {
    const resolution = { students: [student({ id: "s1" })], classes: [klass()], livingParentIds: new Set(["p1"]) };
    // The service queries by `month`; the pure builder is given that scope. What
    // is asserted here is that no paidDate anywhere changes what the body reports.
    const augustPayment = buildStudentPaymentBody(
      [bill({ month: "2026-07", paidDate: "2026-08-20" })], resolution
    );
    const julyPayment = buildStudentPaymentBody(
      [bill({ month: "2026-07", paidDate: "2026-07-02" })], resolution
    );
    assert.deepEqual(tile(augustPayment, "Total billable")!.value, tile(julyPayment, "Total billable")!.value);
    assert.deepEqual(tile(augustPayment, "Collected")!.value, tile(julyPayment, "Collected")!.value);
    assert.equal(augustPayment.rows.length, julyPayment.rows.length);
  });

  it("62. …and Billing.month is what the query filters on, never paidDate", () => {
    const service = code("src", "lib", "reports-service.ts");
    assert.ok(/const query[\s\S]{0,120}\{ month \}/.test(service), "bills are selected by month");
    assert.ok(!service.includes("paidDate"), "paidDate is neither queried nor selected");
  });

  it("63. Attendance follows the Lesson, never AttendanceRecord.date", () => {
    const d = revenueFixture();
    // Every register carries a legacy mirror date in 1970; the lessons are July.
    d.attendance = [register("l1", { s1: "Present", s2: "Present" })];
    const body = buildAttendanceSummaryBody("2026-07", d, CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Attendance rate")!.value, { kind: "percent", value: 100 },
      "the lesson wins; the mirror date is never read");
    assert.ok(!CORE.includes("rec.date") && !CORE.includes(".date"),
      "reports.ts reads no record date at all");
  });

  it("64. …and moving the owning Lesson moves the metric", () => {
    const d = revenueFixture();
    d.attendance = [register("l1", { s1: "Present", s2: "Present" })];
    const moved = { ...d, lessons: d.lessons.map((l) => l.id === "l1" ? { ...l, date: "2026-08-02" } : l) };
    const body = buildAttendanceSummaryBody("2026-07", moved, CLOCK, scopeOf());
    assert.deepEqual(tile(body, "Attendance rate")!.value, NO_DATA);
  });

  it("65. Homework follows the due date, never createdAt", () => {
    const students = [{ id: "s1", name: "Emma Chen" }];

    // Created in March, due in July: it is July's, and the creation date is
    // irrelevant to that.
    const backdated = [homework({ dueDate: "2026-07-08", createdAt: "2026-03-01", submissions: { s1: "Completed" } })];
    const body = buildHomeworkSummaryBody("2026-07", backdated, students);
    assert.deepEqual(tile(body, "Homework completion")!.value, { kind: "percent", value: 100 });
    assert.equal(body.rows.length, 1);

    // Created in July, due in August: it is August's. Asked for July it raises no
    // row and contributes no outcome; asked for August it does both.
    const moved = [homework({ dueDate: "2026-08-08", createdAt: "2026-07-01", submissions: { s1: "Completed" } })];
    const july = buildHomeworkSummaryBody("2026-07", moved, students);
    assert.deepEqual(july.rows, [], "an assignment due in August raises no July row");
    assert.deepEqual(tile(july, "Students")!.value, { kind: "count", value: 0 });

    const august = buildHomeworkSummaryBody("2026-08", moved, students);
    assert.equal(august.rows.length, 1, "moving the due date moves the assignment");
    assert.deepEqual(tile(august, "Homework completion")!.value, { kind: "percent", value: 100 });
  });

  it("65b. …and the query selects on the due date, never on createdAt", () => {
    const service = code("src", "lib", "reports-service.ts");
    assert.ok(/dueDate:\s*\{\s*\$gte/.test(service), "assignments are selected by due date");
    assert.ok(!service.includes("createdAt"), "creation date is neither queried nor selected");
  });

  it("66. …and nothing consults today's date to settle a homework outcome", () => {
    assert.ok(!CORE.includes("createdAt"), "creation date is never read");
    assert.ok(!CORE.includes("overdue"), "a date passing settles nothing");
  });

  it("67. Reports states no month rule of its own", () => {
    assert.ok(!CORE.includes("startsWith(month)"), "no month membership test is restated here");
    assert.ok(!CORE.includes("slice(0, 7)"), "no month is derived from a date here");
  });
});

/* ================================================================ purity */

describe("Reports · the pure module stays pure", () => {
  it("68. has no server-only marker, so the test runner can load it", () => {
    assert.ok(!CORE.includes("server-only"));
  });

  it("69. reaches no database, model or connection", () => {
    for (const banned of [
      "mongoose", "dbConnect", "Model", "findOne(", ".lean(", "./models", "./db",
    ]) {
      assert.ok(!CORE.includes(banned), `reports.ts must not reference ${banned}`);
    }
  });

  it("70. contains no write verb of any kind", () => {
    for (const banned of [
      "updateOne", "updateMany", "insertOne", "insertMany", "deleteOne", "deleteMany",
      "replaceOne", "bulkWrite", "findOneAndUpdate", "save(", "createIndex",
    ]) {
      assert.ok(!CORE.includes(banned), `reports.ts must not use ${banned}`);
    }
  });

  it("71. performs no I/O and no fetching", () => {
    for (const banned of ["fetch(", "readFile", "writeFile", "localStorage", "process.env"]) {
      assert.ok(!CORE.includes(banned));
    }
  });

  it("72. persists nothing and carries no lifecycle of its own", () => {
    for (const banned of [
      "generatedAt", "reportId", "reportStatus", "fileUrl", "downloadUrl", "cache",
      "Draft", "Published", "Issued", "Sent", "Final", "history",
    ]) {
      assert.ok(!CORE.includes(banned), `a report is generated, never stored — ${banned}`);
    }
    // The one `status` in the module is a BILL's, passed through as a term.
    assert.ok(CORE.includes("term(r.status)"));
  });

  it("73. imports only the owner domains it delegates to", () => {
    const imports = [...CORE.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["./attendance", "./billing", "./finance", "./reviews", "./types"]);
  });

  it("74. reimplements none of the arithmetic it reports", () => {
    // Every figure comes from a named owner-domain helper.
    for (const helper of [
      "computeRevenue", "teachingHours", "buildBillingBranch",
      "buildAttendanceIndex", "studentAttendanceRate",
      "homeworkCompletion", "studentHomeworkCompletion", "resolveRoster",
    ]) {
      assert.ok(CORE.includes(helper), `reports.ts must delegate to ${helper}`);
    }
    // …and states no formula of its own.
    assert.ok(!/\/\s*total\s*\)\s*\*\s*100/.test(CORE), "no percentage is computed here");
    assert.ok(!CORE.includes("Math.round("), "no rounding happens here");
  });

  it("75. the DTO carries raw figures, not rendered strings", () => {
    assert.ok(!CORE.includes("toLocaleString"), "formatting is the client's");
    assert.ok(!CORE.includes("đ"), "no currency symbol is baked into the read model");
    assert.ok(!CORE.includes("%\""), "no percent sign is baked into the read model");
  });
});
