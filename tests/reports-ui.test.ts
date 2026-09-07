/* Reports — the screen, and the things it must never draw.
 *
 * Run with:  npm test
 *
 * NO BROWSER AND NO RENDER. This project ships no DOM test runner; every UI
 * suite here — tests/finance-ui.test.ts, tests/reviews-ui.test.ts,
 * tests/responsive-components.test.ts — works by exercising the PURE helpers a
 * component calls and scanning the component source for what only exists as
 * markup. This suite does the same, and the same limitation applies: a human
 * still re-verifies on a device.
 *
 * THE SCAN HALF IS THE POINT FOR REPORTS, because this gate's hardest rules are
 * all absences: no Generate button, no Excel control, no sixth report type, no
 * Reviews document, no browser clock, no client-side recomputation, no `0%`
 * where the payload says `none`, no PDF or Print yet. None of those is
 * expressible as a function call, and every one is a thing a future edit could
 * quietly reintroduce.
 *
 * THE RESPONSIVE HALF reads the stylesheet and the components as text and checks
 * that the approved rules can actually WIN — Gate 4.4D proved an inline
 * `display` beats a media query and leaves correct-looking CSS inert, and the
 * Reports design is almost entirely inline-styled, so that is the specific trap
 * this file is watching for.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ALL, monthChoices, nextClassValue, nextStudentValue, renderSummaryValue,
  renderValue, reportQuery, reportYears, scopeSupport, snapPeriod, yearOf,
} from "../src/components/reports/reports-ui";
import { REPORT_TITLE, REPORT_TYPES, type ReportValue } from "../src/lib/reports";
import { createFormat, DEFAULT_REGIONAL } from "../src/lib/format";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

/** A file's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. Lifted from tests/attendance.test.ts.
 *
 * IT MATTERS MORE HERE THAN ANYWHERE. Almost every rule this gate defends is an
 * ABSENCE — no Generate button, no Excel, no jsPDF, no browser clock — and the
 * comments in those very files name each one in order to explain why it is
 * absent. Scanning the raw text would therefore fail on the explanation rather
 * than on the code, which is exactly what happened when this suite was first
 * run. JSX `{/* … *\/}` comments go with them. */
function code(...parts: string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE = code("src", "app", "(app)", "reports", "page.tsx");
const CONTROLS = code("src", "components", "reports", "report-controls.tsx");
const SHEET = code("src", "components", "reports", "report-sheet.tsx");
const UI = code("src", "components", "reports", "reports-ui.ts");
const API = code("src", "components", "reports", "api.ts");
/** The stylesheet, comment-free for the same reason: its own prose explains the
 * 300px track that the phone block must not contain. */
const CSS = code("src", "app", "globals.css");
const ALL_UI = [PAGE, CONTROLS, SHEET, UI, API];

const fmt = createFormat(DEFAULT_REGIONAL, "en");
/** The identity translator: English source strings are the dictionary keys, so
 * this is exactly what `useSettings().t` does when the language is English. */
const en = (x: string) => x;

/** The twelve-month window ending at the application month. */
const MONTHS = [
  "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02",
  "2026-01", "2025-12", "2025-11", "2025-10", "2025-09", "2025-08",
];

/** Just the Reports section of the stylesheet.
 *
 * SCOPED DELIBERATELY. `globals.css` already carries a `(max-width:767px)` block
 * for the app header and several at 620px, and a helper that took the FIRST
 * match would assert against somebody else's rules — which is exactly what this
 * suite did on its first run, passing a 767px test by reading the header's
 * block. Slicing to the Reports section makes every responsive assertion below
 * be about Reports, and doubles as a guarantee that these rules live together
 * rather than scattered through the file. */
const REPORTS_CSS = (() => {
  // The section is FOUND in the raw file, because its banner is itself a
  // comment, and only then stripped — locating it in the stripped text would be
  // looking for the one thing stripping removes.
  const raw = read("src", "app", "globals.css");
  const start = raw.indexOf("Reports  (Sprint 10 Gate 4)");
  assert.notEqual(start, -1, "the Reports CSS section is missing");
  const end = raw.indexOf("@theme inline", start);
  assert.notEqual(end, -1);
  return raw.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, " ");
})();

/** The body of one `@media` block within a scope, by its exact condition. */
function mediaBlock(condition: string, scope: string = REPORTS_CSS): string {
  const head = `@media ${condition}{`;
  const start = scope.indexOf(head);
  assert.notEqual(start, -1, `no @media ${condition} block in this scope`);
  let depth = 0;
  for (let i = start + head.length - 1; i < scope.length; i++) {
    if (scope[i] === "{") depth++;
    else if (scope[i] === "}") {
      depth--;
      if (depth === 0) return scope.slice(start + head.length, i);
    }
  }
  throw new Error(`unterminated @media ${condition}`);
}

/** One CSS rule's declarations, by selector. */
function rule(selector: string, scope: string = CSS): string {
  const i = scope.indexOf(`\n${selector}{`);
  assert.notEqual(i, -1, `no rule for ${selector}`);
  const start = scope.indexOf("{", i);
  return scope.slice(start + 1, scope.indexOf("}", start));
}

/* ==================================================================== page */

describe("Reports · the page replaced the placeholder", () => {
  it("1. the page is no longer the module placeholder", () => {
    assert.ok(!PAGE.includes("ModulePlaceholder"), "the placeholder is gone");
    assert.ok(PAGE.includes('data-screen-label="Reports"'));
  });

  it("2. …and the placeholder component still serves the module that needs it", () => {
    const settings = read("src", "app", "(app)", "settings", "page.tsx");
    assert.ok(settings.includes("ModulePlaceholder"), "Settings is untouched");
    assert.ok(existsSync(path.join(process.cwd(), "src", "components", "module-placeholder.tsx")));
  });

  it("3. carries the design's own title and subtitle", () => {
    assert.ok(PAGE.includes('t("Reports")'));
    assert.ok(PAGE.includes('t("Generate, preview and export financial & academic reports.")'));
  });

  it("4. draws no Generate button", () => {
    for (const src of ALL_UI) {
      assert.ok(!/Generate report/.test(src), "the Dashboard link is the only 'Generate report'");
      assert.ok(!/onClick=\{[^}]*generate/i.test(src));
    }
    // The Dashboard's control is still a link to this screen, and still a link.
    const dash = code("src", "app", "(app)", "dashboard", "page.tsx");
    assert.ok(/<Link href="\/reports"[\s\S]{0,300}Generate report/.test(dash));
  });

  it("5. draws no Excel control and no CSV anything", () => {
    for (const src of ALL_UI) {
      assert.ok(!/Excel/.test(src), "Excel is deferred and is not drawn, not even disabled");
      assert.ok(!/\bCSV\b/.test(src), "CSV is out of scope");
      assert.ok(!/xlsx/i.test(src));
    }
  });

  it("6. names no Performance Summary and no Reviews document", () => {
    for (const src of ALL_UI) {
      for (const banned of [
        "Performance Summary", "Monthly Progress Report", "MonthlyReviewReportView",
        "review-report", "monthly-review-report", "radar", "skillBars",
      ]) {
        assert.ok(!src.includes(banned), `Reports UI must not mention ${banned}`);
      }
    }
  });

  it("7. holds no clock of its own", () => {
    for (const src of ALL_UI) {
      assert.ok(!src.includes("new Date("), "a browser clock is not the app clock");
      assert.ok(!src.includes("Date.now"));
      assert.ok(!src.includes("getFullYear"), "the year list is derived from the window");
    }
    assert.ok(!UI.includes("FINANCE_MONTHS"));
    // The one app-clock reference is the shared constant the server reads too,
    // used to seed the first request before the window arrives.
    assert.ok(PAGE.includes("CURRENT_MONTH"));
  });

  it("8. recomputes no domain figure", () => {
    for (const src of ALL_UI) {
      for (const banned of [
        "computeRevenue", "buildBillingBranch", "attendanceRate", "homeworkCompletion",
        "collectedFor", "outstandingFor", "totalsFor", "resolveRoster",
      ]) {
        assert.ok(!src.includes(banned), `the client must not call ${banned}`);
      }
    }
    assert.ok(!UI.includes("Math.round"), "no arithmetic in the presentation layer");
    assert.ok(!SHEET.includes("reduce("), "the sheet totals nothing");
  });
});

/* =============================================================== selector */

describe("Reports · the report-type selector", () => {
  it("9. offers exactly five types, in the domain's own order", () => {
    assert.equal(REPORT_TYPES.length, 5);
    assert.ok(CONTROLS.includes("REPORT_TYPES.map"), "the list is mapped, never restated");
    assert.ok(!/"monthly-revenue"/.test(CONTROLS), "the UI keeps no second copy of the keys");
    assert.ok(!/"Attendance Summary"/.test(CONTROLS), "titles come from REPORT_TITLE");
  });

  it("10. labels every option through i18n", () => {
    assert.ok(/t\(REPORT_TITLE\[k\]\)/.test(CONTROLS));
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    for (const k of REPORT_TYPES) assert.ok(dict[REPORT_TITLE[k]], REPORT_TITLE[k]);
  });

  it("11. the default is the first authorised type, not a literal", () => {
    assert.ok(PAGE.includes("REPORT_TYPES[0]"));
    assert.equal(REPORT_TYPES[0], "monthly-revenue");
  });

  it("12. a type change keeps the period and clears only what became invalid", () => {
    // Class Revenue -> Monthly Revenue: the class is meaningless, so it goes.
    assert.equal(nextClassValue("monthly-revenue", "c1"), ALL);
    // Student Payment -> Class Revenue: the class survives, the student does not.
    assert.equal(nextClassValue("class-revenue", "c1"), "c1");
    assert.equal(nextStudentValue("class-revenue", "s1", [{ id: "s1", name: "Emma" }]), ALL);
    // …and within the three per-person reports both survive.
    assert.equal(nextClassValue("attendance-summary", "c1"), "c1");
    assert.equal(nextStudentValue("attendance-summary", "s1", [{ id: "s1", name: "Emma" }]), "s1");
    // The period is never touched by a type change: the handler's own body
    // names setType, setClassId and setStudentId, and nothing else.
    const body = PAGE.slice(PAGE.indexOf("const onType"), PAGE.indexOf("const onYear"));
    assert.ok(body.includes("setType(next)"));
    assert.ok(!body.includes("setPeriod"), "a type change leaves the period alone");
  });
});

/* ================================================================= period */

describe("Reports · Month and Year are two views of one canonical period", () => {
  it("13. both controls exist, as designed", () => {
    assert.ok(CONTROLS.includes('t("Month")'));
    assert.ok(CONTROLS.includes('t("Year")'));
  });

  it("14. the state is a single YYYY-MM", () => {
    assert.ok(/useState<string>\(CURRENT_MONTH\)/.test(PAGE));
    assert.ok(!/setYear\(/.test(PAGE), "the year is not state; it is read off the period");
    assert.ok(CONTROLS.includes("yearOf(period)"));
  });

  it("15. years derive only from the server-owned window", () => {
    assert.deepEqual(reportYears(MONTHS), ["2026", "2025"]);
    assert.deepEqual(reportYears(["2026-01"]), ["2026"]);
    assert.ok(CONTROLS.includes("reportYears(months)"));
    // No year is offered that holds no selectable month.
    for (const y of reportYears(MONTHS)) {
      assert.ok(MONTHS.some((m) => yearOf(m) === y), `${y} holds a month`);
    }
  });

  it("16. all twelve months are offered, with out-of-window ones disabled", () => {
    const y2025 = monthChoices(MONTHS, "2025");
    assert.equal(y2025.length, 12, "the list keeps its shape");
    // The window reaches back to 2025-08, so Jan–Jul 2025 are unavailable.
    assert.deepEqual(y2025.filter((c) => !c.disabled).map((c) => c.number), [8, 9, 10, 11, 12]);
    assert.deepEqual(y2025.filter((c) => c.disabled).map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);

    const y2026 = monthChoices(MONTHS, "2026");
    assert.deepEqual(y2026.filter((c) => !c.disabled).map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(y2026.filter((c) => c.disabled).map((c) => c.number), [8, 9, 10, 11, 12]);
  });

  it("17. the disabled state reaches the shared Select", () => {
    assert.ok(/disabled:\s*c\.disabled/.test(CONTROLS));
    const select = read("src", "components", "ui", "select.tsx");
    assert.ok(/disabled\?: boolean/.test(select), "the Select supports a per-option disabled");
  });

  it("18. the snap rule: a month valid in the new year is kept", () => {
    /* A TWELVE-MONTH WINDOW NEVER CONTAINS THE SAME MONTH NUMBER TWICE — 2025
     * holds Aug–Dec and 2026 holds Jan–Jul — so the "kept" branch is not
     * reachable with the real window, and proving it needs a wider one. That is
     * a fact about the window, not about the rule, and the rule still has to be
     * right if the window ever changes. */
    const wide = ["2026-07", "2026-03", "2025-07", "2025-03"];
    assert.equal(snapPeriod(wide, "2026-07", "2025"), "2025-07", "July stays July");
    assert.equal(snapPeriod(wide, "2025-03", "2026"), "2026-03", "March stays March");
  });

  it("19. the snap rule: an invalid month resolves to the newest valid one", () => {
    // July 2025 is outside the window, so switching year from 2026-07 snaps.
    assert.equal(snapPeriod(MONTHS, "2026-07", "2025"), "2025-12");
    // December 2026 is outside the window (the app month is July 2026).
    assert.equal(snapPeriod(MONTHS, "2025-12", "2026"), "2026-07");
  });

  it("20. the snap rule never produces a period the server did not offer", () => {
    for (const year of reportYears(MONTHS)) {
      for (const m of MONTHS) {
        assert.ok(MONTHS.includes(snapPeriod(MONTHS, m, year)), `${m} -> ${year}`);
      }
    }
  });

  it("21. the page routes a year change through the snap rule", () => {
    assert.ok(/onYear\s*=\s*\(year: string\)\s*=>\s*setPeriod\(snapPeriod\(months, period, year\)\)/.test(PAGE));
  });
});

/* ================================================================== scope */

describe("Reports · scope controls obey the approved matrix", () => {
  it("22. the matrix comes from the domain, not a UI copy", () => {
    assert.ok(UI.includes("REPORT_SCOPE[type]"));
    assert.ok(!/class:\s*(true|false),\s*student:/.test(CONTROLS), "no second matrix in the UI");
  });

  it("23. Monthly Revenue disables both scope controls", () => {
    assert.deepEqual(scopeSupport("monthly-revenue"), { class: false, student: false });
  });

  it("24. Class Revenue enables Class and disables Student", () => {
    assert.deepEqual(scopeSupport("class-revenue"), { class: true, student: false });
  });

  it("25. the three per-person reports enable both", () => {
    for (const t of ["student-payment", "attendance-summary", "homework-summary"] as const) {
      assert.deepEqual(scopeSupport(t), { class: true, student: true }, t);
    }
  });

  it("26. an inapplicable control is disabled and still rendered", () => {
    assert.ok(/disabled=\{!support\.class\}/.test(CONTROLS));
    assert.ok(/disabled=\{!support\.student\}/.test(CONTROLS));
    // Never hidden: the designed layout does not change because a filter does not apply.
    assert.ok(!/support\.class\s*&&\s*</.test(CONTROLS), "the Class control is never conditionally rendered");
    assert.ok(!/support\.student\s*&&\s*</.test(CONTROLS), "the Student control is never conditionally rendered");
  });

  it("27. a disabled control shows its sentinel, so rail and sheet agree", () => {
    assert.ok(/value=\{support\.class \? classId : ALL\}/.test(CONTROLS));
    assert.ok(/value=\{support\.student \? studentId : ALL\}/.test(CONTROLS));
  });

  it("28. both selects offer the sentinel option", () => {
    assert.ok(CONTROLS.includes('t("All classes")'));
    assert.ok(CONTROLS.includes('t("All students")'));
  });

  it("29. the student list is the server's, already roster-filtered", () => {
    assert.ok(CONTROLS.includes("options.students.map"));
    assert.ok(!CONTROLS.includes("studentIds"), "the client resolves no roster");
    const service = read("src", "lib", "reports-service.ts");
    assert.ok(/resolveRoster\(rosterIds, docs\)/.test(service), "the server resolves it");
  });

  it("30. choosing a class returns an out-of-roster student to the sentinel", () => {
    const roster = [{ id: "s1", name: "Emma" }, { id: "s2", name: "Liam" }];
    assert.equal(nextStudentValue("student-payment", "s1", roster), "s1");
    assert.equal(nextStudentValue("student-payment", "s9", roster), ALL, "not on this roster");
    assert.equal(nextStudentValue("student-payment", ALL, roster), ALL);
    assert.ok(/if \(id !== classId\) setStudentId\(ALL\)/.test(PAGE));
  });

  it("31. a sentinel is omitted from the request, never sent empty", () => {
    assert.equal(reportQuery("monthly-revenue", "2026-07", ALL, ALL), "type=monthly-revenue&month=2026-07");
    assert.equal(
      reportQuery("student-payment", "2026-07", "c1", "s1"),
      "type=student-payment&month=2026-07&classId=c1&studentId=s1"
    );
    assert.ok(!reportQuery("class-revenue", "2026-07", ALL, ALL).includes("classId"));
  });

  it("32. no status filter is added anywhere", () => {
    for (const src of ALL_UI) {
      assert.ok(!/"Archived"/.test(src), "Reports adds no status filter");
      assert.ok(!/status.*filter/i.test(src));
    }
  });
});

/* ============================================================== rendering */

describe("Reports · the generic value renderer", () => {
  const v = (x: ReportValue) => renderValue(x, fmt, en);

  it("33. money goes through the app's own formatter", () => {
    assert.equal(v({ kind: "money", amount: 1_600_000 }), "1,600,000đ");
    assert.ok(!UI.includes("đ"), "the currency symbol lives in the formatter");
  });

  it("34. counts, percents and hours use the app's own units", () => {
    assert.equal(v({ kind: "count", value: 4 }), "4");
    assert.equal(v({ kind: "percent", value: 75 }), "75%");
    assert.equal(v({ kind: "hours", value: 4 }), "4h");
  });

  it("35. text passes through and a term is translated", () => {
    assert.equal(v({ kind: "text", value: "Emma Chen" }), "Emma Chen");
    assert.equal(v({ kind: "term", key: "Partially Paid" }), "Partially Paid");
  });

  it("36. `none` is No data — never zero, never a dash, never blank", () => {
    assert.equal(v({ kind: "none" }), "No data");
    assert.notEqual(v({ kind: "none" }), "0");
    assert.notEqual(v({ kind: "none" }), "0đ");
    assert.notEqual(v({ kind: "none" }), "0%");
    assert.notEqual(v({ kind: "none" }), "");
  });

  it("37. every cell on the sheet goes through the one renderer", () => {
    const renders = SHEET.match(/renderValue\(|renderSummaryValue\(/g) ?? [];
    assert.equal(renders.length, 2, "one tile call and one cell call — and no third path");
    assert.ok(!/\.amount\b/.test(SHEET), "the sheet never reads a raw amount itself");
    assert.ok(!/\.kind === "money"/.test(SHEET), "the sheet branches on no value kind");
  });
});

describe("Reports · a floor is never printed as an exact figure", () => {
  it("38. a floor carries the qualifier in front of it", () => {
    assert.equal(renderSummaryValue({ kind: "percent", value: 65 }, true, fmt, en), "At least 65%");
    assert.equal(renderSummaryValue({ kind: "percent", value: 65 }, false, fmt, en), "65%");
    assert.equal(renderSummaryValue({ kind: "percent", value: 65 }, undefined, fmt, en), "65%");
  });

  it("39. an unknown is not a floor of anything", () => {
    assert.equal(renderSummaryValue({ kind: "none" }, true, fmt, en), "No data");
  });

  it("40. the qualifier is translated", () => {
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    assert.ok(dict["At least"], "the floor qualifier is in the dictionary");
    assert.ok(dict["Collection rate"]);
    assert.ok(dict["Couldn't load report"]);
    assert.ok(dict["Loading report…"]);
  });

  it("41. the sheet passes the server's own floor flag, and invents none", () => {
    assert.ok(/renderSummaryValue\(s\.value, s\.floor, fmt, t\)/.test(SHEET));
    assert.ok(!/floor\s*=\s*(true|!)/.test(SHEET), "the UI never decides a figure is a floor");
  });
});

/* ================================================== financial honesty (UI) */

describe("Reports · the Student Payment sheet stays honest", () => {
  it("42. the incomplete-amounts fact is stated, in Finance's own words", () => {
    assert.ok(SHEET.includes("partialNote"), "reuses the translated Billing sentence");
    assert.ok(/completeness && !data\.completeness\.amountsComplete/.test(SHEET));
  });

  it("43. hidden records are stated as a Finance fact, not as '+N more'", () => {
    assert.ok(SHEET.includes("historicalNote"));
    assert.ok(!SHEET.includes("+N more"), "Sprint 9 replaced that affordance deliberately");
    for (const banned of ["ghost", "deleted", "hidden student", "placeholder row"]) {
      assert.ok(!SHEET.toLowerCase().includes(banned.toLowerCase()) || SHEET.includes("no longer resolves"),
        `the copy describes the teacher's books, not our storage (${banned})`);
    }
  });

  it("44. the hidden count is only shown when the domain supplied one", () => {
    assert.ok(/typeof data\.hiddenRecords === "number" && data\.hiddenRecords > 0/.test(SHEET));
    // A single `=` would be an assignment; the `===` above is a read. The
    // negative lookahead is what keeps this from matching its own guard.
    assert.ok(!/hiddenRecords\s*=[^=]/.test(SHEET), "the UI assigns no count of its own");
    assert.ok(!SHEET.includes(".filter("), "the sheet counts nothing itself");
  });

  it("45. no half-fee inference exists anywhere in the Reports UI", () => {
    for (const src of ALL_UI) {
      for (const banned of ["fee / 2", "fee/2", "* 0.5", "/ 2"]) {
        assert.ok(!src.includes(banned), `the deleted 50% partial rule must not return via ${banned}`);
      }
    }
  });

  it("46. the parent indication is the app's existing wording, and rows only", () => {
    assert.ok(SHEET.includes('t("No linked parent")'));
    assert.ok(/row\.parentLinked === false/.test(SHEET), "shown only when the flag is explicitly false");
  });

  it("47. no parent contact detail is rendered anywhere", () => {
    for (const src of ALL_UI) {
      for (const leak of ["parentName", "parentPhone", "parent.phone", "parent.email", "address"]) {
        assert.ok(!src.includes(leak), `a report must not render ${leak}`);
      }
    }
  });

  it("48. the indicator rides on the row flag, so only the reports that carry it show it", () => {
    // The DTO sets `parentLinked` on Student Payment rows alone; the sheet has
    // no report-type branch, so it cannot show the line anywhere else.
    assert.ok(!/type === "student-payment"/.test(SHEET), "the sheet branches on no report type");
    const domain = read("src", "lib", "reports.ts");
    const parentLines = domain.match(/parentLinked:/g) ?? [];
    assert.equal(parentLines.length, 1, "exactly one builder sets it");
  });
});

/* ==================================================== attendance & homework */

describe("Reports · attendance and homework stay honest on screen", () => {
  it("49. a `none` rate renders No data, not 0%", () => {
    assert.equal(renderValue({ kind: "none" }, fmt, en), "No data");
  });

  it("50. coverage is shown where the domain supplied it, and only there", () => {
    assert.ok(/data\.coverage &&/.test(SHEET));
    assert.ok(SHEET.includes('t("Registers taken")'));
    assert.ok(/coverage\.registersTaken\}\/\{data\.coverage\.lessonsCompleted/.test(SHEET));
  });

  it("51. no copy claims unrecorded attendance was present or absent", () => {
    for (const src of ALL_UI) {
      for (const banned of ["assumed present", "treated as present", "not recorded means", "counted as absent"]) {
        assert.ok(!src.toLowerCase().includes(banned), banned);
      }
    }
  });

  it("52. a numeric homework zero is rendered as the number the domain gave", () => {
    // The Gate 3 limitation: an all-`Assigned` month reports the helper's own 0,
    // because Homework publishes no denominator on its aggregate. The UI renders
    // that number and does not dress it up.
    assert.equal(renderValue({ kind: "percent", value: 0 }, fmt, en), "0%");
    // …and adds no sentence claiming a denominator the domain never supplied.
    for (const src of ALL_UI) {
      for (const banned of ["of graded work", "graded", "marked work", "denominator", "eligible outcomes"]) {
        assert.ok(!src.toLowerCase().includes(banned),
          `future copy must not turn the fallback zero into a stronger claim (${banned})`);
      }
    }
  });

  it("53. the UI invents no homework denominator", () => {
    for (const src of ALL_UI) {
      assert.ok(!src.includes("Assigned"), "the UI restates no homework status rule");
    }
  });
});

/* ===================================================== states and fetching */

describe("Reports · loading, empty and error are three different things", () => {
  it("54. empty stays inside the document, as the design's own block", () => {
    assert.ok(SHEET.includes('t("No data for this selection")'));
    assert.ok(SHEET.includes('t("Adjust the month, class or student filters to populate this report.")'));
    assert.ok(/data\.empty \?/.test(SHEET), "empty is a branch of the sheet, not a replacement for it");
  });

  it("55. an empty month is not an error and not a zero", () => {
    // The error card is the page's, and it is reached only from `isError`.
    assert.ok(/!isLoading && isError &&/.test(PAGE));
    assert.ok(!/empty[\s\S]{0,80}rp-state/.test(PAGE), "emptiness never renders the error card");
  });

  it("56. the loading copy does not claim a generation is happening", () => {
    assert.ok(PAGE.includes('t("Loading report…")'));
    for (const src of ALL_UI) {
      assert.ok(!/Generating/i.test(src), "nothing is generated and nothing is written");
      assert.ok(!/Creating report/i.test(src));
    }
  });

  it("57. the three states are mutually exclusive", () => {
    assert.ok(/\{isLoading && <ReportSkeleton \/>\}/.test(PAGE));
    assert.ok(/\{!isLoading && isError &&/.test(PAGE));
    assert.ok(/\{!isLoading && !isError && data && <ReportSheet/.test(PAGE));
  });

  it("58. changing a filter does not blank the sheet", () => {
    assert.ok(PAGE.includes("placeholderData: keepPreviousData"));
    assert.ok(/aria-busy=\{isFetching/.test(PAGE), "the in-flight cue is quiet, not destructive");
  });

  it("59. retrying a failed read re-reads and writes nothing", () => {
    assert.ok(/onClick=\{\(\) => refetch\(\)\}/.test(PAGE));
    assert.ok(!PAGE.includes("useMutation"));
    assert.ok(!PAGE.includes("invalidateQueries"));
  });

  it("60. the client fetches only its own read-only endpoint", () => {
    assert.ok(API.includes("/api/reports?"));
    for (const src of ALL_UI) {
      assert.ok(!src.includes("/api/dashboard"), "that GET writes");
      assert.ok(!src.includes("/api/lessons"), "that GET generates");
      assert.ok(!src.includes("/api/finance"));
      assert.ok(!src.includes("/api/reviews"));
      for (const verb of ['method: "POST"', 'method: "PATCH"', 'method: "DELETE"', 'method: "PUT"']) {
        assert.ok(!src.includes(verb), `Reports writes nothing (${verb})`);
      }
    }
  });

  it("61. the payload type comes from the server module", () => {
    assert.ok(/import type \{ ReportPayload, ReportType \} from "@\/lib\/reports"/.test(API));
  });
});

/* ============================================================= the document */

describe("Reports · the document sheet", () => {
  it("62. reuses the shared document primitives", () => {
    assert.ok(SHEET.includes('className="report-sheet rp-sheet"'));
    assert.ok(SHEET.includes('className="rp-head"'));
    assert.ok(SHEET.includes('className="rp-foot"'));
    assert.ok(/rp-block/.test(SHEET));
  });

  it("63. does not import or alter the Reviews document component", () => {
    assert.ok(!SHEET.includes("MonthlyReviewReportView"));
    const reviewSheet = read("src", "components", "reviews", "monthly-review-report.tsx");
    assert.ok(reviewSheet.includes("report-sheet rvc-sheet"), "Reviews keeps its own sheet class");
  });

  it("64. carries neutral branding and names no author", () => {
    assert.ok(SHEET.includes('"English Tutor LMS"'));
    for (const banned of ["Sarah", "English Studio", "Prepared by", "Teacher OS"]) {
      assert.ok(!SHEET.includes(banned), `the reference's demo branding is not contract (${banned})`);
    }
  });

  it("65. `Generated on` is the application day off the payload", () => {
    assert.ok(/t\("Generated on"\)\} \{fmt\.dateLabel\(data\.appClock\)/.test(SHEET));
    assert.ok(!SHEET.includes("generatedAt"), "no persisted timestamp is implied");
  });

  it("66. the table is a real table, with header scope", () => {
    assert.ok(/<table className="rp-table">/.test(SHEET));
    assert.ok(/<th key=\{c\.key\} scope="col"/.test(SHEET));
    assert.ok(/<thead>/.test(SHEET) && /<tbody>/.test(SHEET));
  });

  it("67. column count and order come from the payload, never from the screen", () => {
    assert.ok(/data\.columns\.map/.test(SHEET));
    assert.ok(/row\.cells\.map/.test(SHEET));
    assert.ok(!/columns\.slice/.test(SHEET), "no column is dropped to fit a width");
  });

  it("68. every visible string is translated", () => {
    // Any bare quoted sentence in JSX would be untranslated copy.
    const bare = SHEET.match(/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</g) ?? [];
    assert.deepEqual(bare, [], `untranslated copy: ${bare.join(" | ")}`);
  });
});

/* ================================================================= no PDF */

describe("Reports · Gate 4 ships no export and no print", () => {
  it("69. no PDF machinery is imported or referenced", () => {
    for (const src of ALL_UI) {
      for (const banned of ["jspdf", "jsPDF", "renderReviewPdf", "review-pdf", "ReportPdf", "buildReviewPdfDocument"]) {
        assert.ok(!src.includes(banned), `PDF is Gate 5 (${banned})`);
      }
    }
  });

  it("70. nothing prints", () => {
    for (const src of ALL_UI) {
      assert.ok(!src.includes("window.print"), "Print is Gate 5");
      assert.ok(!src.includes("print-report"), "the Reports print scope is Gate 5");
      assert.ok(!src.includes("beforeprint"));
      assert.ok(!src.includes("afterprint"));
    }
  });

  it("71. no print CSS was added for Reports", () => {
    const printBlock = mediaBlock("print", CSS);
    assert.ok(!printBlock.includes("print-report"), "no Reports print scope yet");
    assert.ok(printBlock.includes("body.print-review"), "the Reviews print path is untouched");
  });

  it("72. no file is downloaded", () => {
    for (const src of ALL_UI) {
      for (const banned of ["createObjectURL", "download", "Blob(", "a.click()"]) {
        assert.ok(!src.includes(banned), `no download logic in Gate 4 (${banned})`);
      }
    }
  });

  it("73. the rail is structurally ready for the action block", () => {
    // Gate 5 adds the block at the foot of the rail; nothing about the layout
    // has to change to receive it.
    assert.ok(CONTROLS.includes('className="rp-rail no-print"'),
      "the rail already carries the design's own no-print marker");
  });
});

/* ============================================================== responsive */

describe("Reports · responsive layout can actually win", () => {
  it("74. the grid is a class, not an inline style", () => {
    assert.ok(PAGE.includes('className="rp-grid"'));
    assert.ok(!/style=\{\{[^}]*gridTemplateColumns/.test(PAGE),
      "an inline grid template would beat every media query below");
  });

  it("75. no element carrying a Reports layout class also carries inline style", () => {
    /* Gate 4.4D: an inline `display` beat a media query and left two correct
     * responsive fixes inert. The rule that actually prevents it is narrower
     * than "no inline styles anywhere" — a retry button may legitimately be
     * `display:inline-flex`, because no media query needs to move it. What must
     * never happen is an element whose LAYOUT the stylesheet owns also stating
     * that layout inline. So: every element carrying one of the responsive
     * classes has a className and nothing else. */
    const markup = PAGE + CONTROLS + SHEET;
    for (const cls of ["rp-grid", "rp-rail", "rp-period", "rp-preview", "rp-stats",
      "rp-table-wrap", "rp-sheet"]) {
      const re = new RegExp(`className="[^"]*${cls}[^"]*"[^>]*style=`, "g");
      assert.ok(!re.test(markup), `.${cls} must not also carry an inline style`);
    }
    // …and the four properties a media query would have to fight are inline nowhere.
    for (const [name, src] of [["page", PAGE], ["controls", CONTROLS], ["sheet", SHEET]] as const) {
      for (const prop of ["gridTemplateColumns", 'position: "sticky"', "overflowX", "float:"]) {
        assert.ok(!src.includes(prop), `${name} must not declare ${prop} inline`);
      }
    }
  });

  it("76. desktop is the design's two-column composition", () => {
    const grid = rule(".rp-grid");
    assert.ok(grid.includes("grid-template-columns:300px minmax(0,1fr)"), "the designed rail width");
    assert.ok(grid.includes("gap:var(--gap)"));
    assert.ok(grid.includes("align-items:start"));
  });

  it("77. the rail is the comp's card, sticky on desktop", () => {
    const rail = rule(".rp-rail");
    assert.ok(rail.includes("position:sticky"));
    assert.ok(rail.includes("top:16px"), "the reference's own offset");
    assert.ok(rail.includes("min-width:0"), "it may shrink rather than define a floor");
  });

  it("78. below 768 the grid stacks and the hard track is gone", () => {
    const phone = mediaBlock("(max-width:767px)");
    assert.ok(/\.rp-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(phone),
      "one column, and no 300px track");
    assert.ok(!phone.includes("300px"), "the hard track must not survive here");
  });

  it("79. …and the sticky goes with the two-column layout that justified it", () => {
    const phone = mediaBlock("(max-width:767px)");
    assert.ok(/\.rp-rail\{position:static/.test(phone));
  });

  it("80. at 620 and below the period pair stacks", () => {
    const small = mediaBlock("(max-width:620px)");
    assert.ok(/\.rp-period\{grid-template-columns:minmax\(0,1fr\)\}/.test(small));
    // …and the shared sheet already tightens its own padding at this width.
    assert.ok(/\.report-sheet\{padding:22px 18px !important/.test(CSS));
  });

  it("81. the table scrolls inside a bounded wrapper, never the page", () => {
    const wrap = rule(".rp-table-wrap");
    assert.ok(wrap.includes("overflow-x:auto"));
    assert.ok(wrap.includes("max-width:100%"), "bounded by its column");
    assert.ok(SHEET.includes('className="rp-block rp-table-wrap"'));
    // Nothing in Reports puts a horizontal scroller on the page or the body.
    for (const src of ALL_UI) {
      assert.ok(!/overflowX:\s*"auto"/.test(src));
    }
    assert.ok(!/\.rp-grid\{[^}]*overflow-x/.test(CSS), "the page never scrolls sideways");
    assert.ok(!/\.rp-preview\{[^}]*overflow-x/.test(CSS));
  });

  it("82. the scroller is keyboard reachable", () => {
    assert.ok(/tabIndex=\{0\}/.test(SHEET));
    assert.ok(/role="region"/.test(SHEET));
    assert.ok(/aria-label=\{t\(data\.title\)\}/.test(SHEET));
  });

  it("83. every layout class in the markup has a rule behind it", () => {
    for (const cls of ["rp-grid", "rp-rail", "rp-period", "rp-preview", "rp-sheet",
      "rp-stats", "rp-stat", "rp-table", "rp-table-wrap", "rp-note", "rp-empty",
      "rp-state", "rp-sk", "rp-no-parent"]) {
      assert.ok(CSS.includes(`.${cls}`), `.${cls} has no rule in globals.css`);
    }
  });

  it("84. …and every Reports rule has markup using it", () => {
    const markup = PAGE + CONTROLS + SHEET;
    for (const cls of ["rp-grid", "rp-rail", "rp-period", "rp-preview", "rp-stats",
      "rp-stat", "rp-table-wrap", "rp-note", "rp-empty", "rp-state"]) {
      assert.ok(markup.includes(cls), `.${cls} has a rule but no markup`);
    }
  });

  it("85. the shell's own breakpoints are untouched", () => {
    const shell = mediaBlock("(max-width:860px) and (min-width:621px)", CSS);
    assert.ok(!shell.includes("rp-"), "Reports adds nothing to the shell's tablet band");
    assert.ok(!mediaBlock("(max-width:1100px)", CSS).includes("rp-"), "and nothing at 1100");
  });
});

/* ================================================================== theme */

describe("Reports · theme and accessibility", () => {
  it("86. the document keeps the shared light-locked palette", () => {
    // `.report-sheet` redeclares the tokens; Reports adds no theme rule of its own.
    assert.ok(/\.report-sheet\{\s*--bg:/.test(CSS));
    assert.ok(!/\.rp-sheet\{[^}]*--fg:/.test(CSS), "the sheet's palette is not re-declared");
    assert.ok(!/\[data-theme="dark"\] \.rp-/.test(CSS), "no Reports-specific dark rule");
  });

  it("87. the document's own blocks use the sheet's inherited tokens", () => {
    const tile = rule(".rp-stat");
    assert.ok(tile.includes("var(--border)"), "inherits the sheet's light border");
    assert.ok(!/#[0-9a-f]{6}/i.test(tile), "no literal colour is baked into a Reports block");
  });

  it("88. the page around the document follows the app theme", () => {
    const rail = rule(".rp-rail");
    assert.ok(rail.includes("background:var(--card)"));
    assert.ok(rail.includes("border:1px solid var(--border)"));
  });

  it("89. every Select carries an accessible label", () => {
    const selects = CONTROLS.match(/<Select/g) ?? [];
    const labels = CONTROLS.match(/ariaLabel=\{t\(/g) ?? [];
    assert.equal(selects.length, 5, "type, month, year, class, student");
    assert.equal(labels.length, 5, "each one is named");
  });

  it("90. there is no clickable non-button", () => {
    assert.ok(!/<div[^>]*onClick/.test(PAGE + CONTROLS + SHEET));
    assert.ok(!/<span[^>]*onClick/.test(PAGE + CONTROLS + SHEET));
  });

  it("91. the waiting state is announced", () => {
    assert.ok(/aria-live="polite"/.test(PAGE));
  });
});
