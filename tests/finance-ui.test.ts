/* Finance — the screen, and the things it must never draw.
 *
 * Run with:  npm test
 *
 * NO BROWSER AND NO RENDER. This project has no DOM test runner; every UI suite
 * here — tests/reviews-ui.test.ts, tests/homework-ui.test.ts,
 * tests/responsive-components.test.ts — works by exercising the PURE helpers a
 * component calls and scanning the component source for what only exists as
 * markup. This suite does the same.
 *
 * The scan half is the point for Finance, because the sprint's hardest rules are
 * all absences: no Method column, no payment control, no ghost identity, no
 * `0đ` where the amount is unknown, no `/api/dashboard`, no browser clock. None
 * of those is expressible as a function call, and every one of them is a thing a
 * future edit could quietly reintroduce.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HISTORICAL_NOTE_MANY, HISTORICAL_NOTE_ONE, STATUS_LABEL, barWidth, donutArcs,
  historicalNote, historicalNoteStyle, money, percent, rankByCollected,
  sortByOutstanding, statusBadgeStyle, trendGeometry,
} from "../src/components/finance/finance-ui";
import { createFormat, DEFAULT_REGIONAL, EM } from "../src/lib/format";
import { translate } from "../src/lib/i18n";
import { MOBILE_QUERY } from "../src/lib/use-media-query";

const fmt = createFormat(DEFAULT_REGIONAL, "en");
const NO_DATA = "No data";
/** The identity translator: English source strings are the dictionary keys, so
 * this is exactly what `useSettings().t` does when the language is English. */
const en = (x: string) => x;

function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
function code(...parts: string[]): string {
  return raw(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The body of the ONE `@media (max-width:620px)` block that holds Finance's
 * rules, brace-matched to its own closing brace and stripped of comments.
 *
 * globals.css carries several blocks per breakpoint — six at 620px now — so
 * slicing on the query alone reads whichever came first and would happily prove
 * something about the shell's block instead. This finds the block that actually
 * contains `.fin-`, and stops where that block does. */
function financeBlock(): string {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const open = "@media (max-width:620px){";
  for (let from = 0; ; ) {
    const start = css.indexOf(open, from);
    assert.ok(start >= 0, "no 620px block in globals.css contains a .fin- rule");
    let depth = 0;
    let i = start + open.length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    const body = css.slice(start + open.length, i);
    if (body.includes(".fin-")) return body.replace(/\/\*[\s\S]*?\*\//g, " ");
    from = start + open.length;
  }
}

const PAGE_PATH = ["src", "app", "(app)", "finance", "page.tsx"];
const PAGE = code(...PAGE_PATH);
const OVERVIEW = code("src", "components", "finance", "finance-overview.tsx");
const ANALYTICS = code("src", "components", "finance", "finance-analytics.tsx");
const PAYMENTS = code("src", "components", "finance", "finance-payments.tsx");
const CHARTS = code("src", "components", "finance", "finance-charts.tsx");
const CLIENT = code("src", "components", "finance", "api.ts");
const HELPERS = code("src", "components", "finance", "finance-ui.ts");
const CLASS_DETAIL = code("src", "app", "(app)", "classes", "[id]", "page.tsx");

/** Every file that makes up the Finance presentation layer. */
const UI_FILES: Array<[string, string]> = [
  ["page", PAGE], ["overview", OVERVIEW], ["analytics", ANALYTICS],
  ["payments", PAYMENTS], ["charts", CHARTS], ["client", CLIENT], ["helpers", HELPERS],
];
const ALL_UI = UI_FILES.map(([, src]) => src).join("\n");

/* ============================================================ the page shell */

describe("Finance page · the placeholder is gone", () => {
  it("1. the page no longer renders ModulePlaceholder", () => {
    assert.ok(!PAGE.includes("ModulePlaceholder"), "/finance must not be a placeholder");
    assert.ok(!raw(...PAGE_PATH).includes("This module isn't available yet"));
  });

  it("2. it renders a real screen with the comp's own label", () => {
    assert.ok(/data-screen-label="Finance"/.test(PAGE));
    assert.ok(PAGE.includes('t("Finance")'));
  });

  it("3. the three tabs exist, in the comp's order", () => {
    const tabs = /const TABS = \[([^\]]*)\]/.exec(PAGE);
    assert.ok(tabs, "TABS is declared");
    assert.deepEqual(
      tabs![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean),
      ["Overview", "Revenue analytics", "Payments"]
    );
  });

  it("4. the tab strip is a real tablist", () => {
    assert.ok(/role="tablist"/.test(PAGE));
    assert.ok(/role="tab"/.test(PAGE));
    assert.ok(/aria-selected=\{tab === tb\}/.test(PAGE));
  });

  it("5. each tab renders its own component and they are never mixed", () => {
    assert.ok(/tab === "Overview" && <FinanceOverview/.test(PAGE));
    assert.ok(/tab === "Revenue analytics" && <FinanceAnalytics/.test(PAGE));
    assert.ok(/tab === "Payments" && <FinancePayments/.test(PAGE));
  });

  it("6. loading, error and retry states exist", () => {
    assert.ok(PAGE.includes("isLoading"));
    assert.ok(PAGE.includes("isError"));
    assert.ok(PAGE.includes('t("Try again")'));
    assert.ok(PAGE.includes('t("Couldn\'t load finance")'));
  });
});

describe("Finance page · the month selector", () => {
  it("7. a month selector exists and reuses the app's Select", () => {
    assert.ok(/from "@\/components\/ui\/select"/.test(PAGE));
    assert.ok(/ariaLabel=\{t\("Month"\)\}/.test(PAGE));
  });

  it("8. its options are the SERVER's month list", () => {
    assert.ok(/data\?\.months/.test(PAGE), "the window comes from the payload");
    assert.ok(/months\.map\(\(m\) => \(\{ value: m/.test(PAGE));
  });

  it("9. the browser computes no month window", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!src.includes("new Date"), `${name} must not construct a Date`);
      assert.ok(!src.includes("Date.now"), `${name} must not read a wall clock`);
      assert.ok(!src.includes("getMonth"), `${name} must not derive a month`);
      assert.ok(!src.includes("getFullYear"), `${name} must not derive a year`);
    }
  });

  it("10. the initial month is the application month, not a browser one", () => {
    assert.ok(/useState<string>\(CURRENT_MONTH\)/.test(PAGE));
    assert.ok(/from "@\/lib\/constants"/.test(PAGE));
  });

  it("11. changing month refetches that month only — the key carries it", () => {
    assert.ok(/queryKey: financeKeys\.month\(month\)/.test(PAGE));
    assert.ok(/queryFn: \(\) => fetchFinanceMonth\(month\)/.test(PAGE));
  });
});

/* ================================================== the read-only guarantee */

describe("Finance UI · nothing here writes", () => {
  it("12. no Finance UI file mentions the payment mutation route", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\/api\/finance\/\$\{/.test(src), `${name} must not build a PATCH url`);
      assert.ok(!src.includes("PATCH"), `${name} must not name PATCH`);
      assert.ok(!src.includes("recordPayment"), `${name} must not call recordPayment`);
    }
  });

  it("13. there is no mutation hook anywhere in Finance", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!src.includes("useMutation"), `${name} must not use useMutation`);
      assert.ok(!src.includes("invalidateQueries"), `${name} has nothing to invalidate`);
    }
  });

  it("14. the client module exposes exactly one function, and it is a GET", () => {
    const exported = [...CLIENT.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(exported, ["fetchFinanceMonth"]);
    assert.ok(!/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(CLIENT));
  });

  it("15. no Finance UI file reaches /api/dashboard", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!src.includes("/api/dashboard"), `${name} must not call the writing GET`);
      assert.ok(!src.includes("buildDashboard"), `${name} must not build a dashboard`);
    }
  });

  it("16. no lifecycle, reconciler or generator is reachable from the UI", () => {
    for (const banned of ["advanceLessonLifecycle", "reconcile", "ensureRegularLessons", "deriveData"]) {
      assert.ok(!ALL_UI.includes(banned), `no Finance UI file may reference ${banned}`);
    }
  });
});

/* =========================================================== the money rule */

describe("Finance UI · No data is never 0đ", () => {
  it("17. a known amount formats as money", () => {
    assert.equal(money(800_000, fmt, NO_DATA), "800,000đ");
  });

  it("18. zero is a real zero — Unpaid genuinely collected nothing", () => {
    assert.equal(money(0, fmt, NO_DATA), "0đ");
  });

  it("19. null is No data, and not 0đ", () => {
    assert.equal(money(null, fmt, NO_DATA), NO_DATA);
    assert.notEqual(money(null, fmt, NO_DATA), "0đ");
  });

  it("20. undefined is No data too", () => {
    assert.equal(money(undefined, fmt, NO_DATA), NO_DATA);
  });

  it("21. an unknown rate is No data, not 0%", () => {
    assert.equal(percent(null, NO_DATA), NO_DATA);
    assert.equal(percent(0, NO_DATA), "0%");
    assert.equal(percent(72, NO_DATA), "72%");
  });

  it("22. every unknown-capable amount on screen goes through money()", () => {
    // collected / outstanding / an outstanding row's amount are the three that
    // can be null. None may be formatted with a bare fmt.vnd.
    assert.ok(!/fmt\.vnd\(billing\.collected\)/.test(OVERVIEW));
    assert.ok(!/fmt\.vnd\(billing\.outstanding\)/.test(OVERVIEW));
    assert.ok(!/fmt\.vnd\(c\.collected\)/.test(OVERVIEW));
    assert.ok(!/fmt\.vnd\(s\.amount\)/.test(OVERVIEW));
    assert.ok(/money\(billing\.collected, fmt, noData\)/.test(OVERVIEW));
    assert.ok(/money\(billing\.outstanding, fmt, noData\)/.test(OVERVIEW));
  });

  it("23. the collection bar is not drawn at zero when the ratio is unknown", () => {
    assert.equal(barWidth(null, 1_000_000), null, "unknown part -> no bar");
    assert.equal(barWidth(500_000, 0), null, "zero denominator -> no bar");
    assert.equal(barWidth(500_000, 1_000_000), "50%");
    assert.equal(barWidth(0, 1_000_000), "0%", "a known zero IS a zero-width bar");
  });

  it("24. …and the overview renders a neutral state instead", () => {
    assert.ok(/proportionKnown/.test(OVERVIEW));
    assert.ok(/data-testid="fin-bar-unknown"/.test(OVERVIEW));
    assert.ok(/\{proportionKnown && \(/.test(OVERVIEW), "the segments are conditional");
  });

  it("25. no UI file infers half a fee", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/fee\s*\/\s*2/.test(src), `${name} must not halve a fee`);
      assert.ok(!/\*\s*0?\.5/.test(src), `${name} must not scale money by 0.5`);
    }
  });

  it("26. an absent paid date is an em dash, not No data", () => {
    // A bill that was never paid has no date. That is an ABSENCE, not an
    // unknown, and the app already has one character for it.
    assert.ok(PAYMENTS.includes("EM"));
    assert.equal(EM, "—");
  });
});

/* ================================================================ overview */

describe("Finance Overview · the KPI row", () => {
  it("27. all three KPI cards exist with the comp's own labels", () => {
    for (const label of ["Expected revenue", "Collected revenue", "Outstanding balance"]) {
      assert.ok(OVERVIEW.includes(`t("${label}")`), label);
    }
  });

  it("28. the labels are the comp's and are not renamed to tuition", () => {
    assert.ok(!/Expected tuition|Collected tuition|Outstanding tuition/.test(ALL_UI));
  });

  it("29. Expected reads billed, and is always knowable", () => {
    assert.ok(/value=\{fmt\.vnd\(billing\.billed\)\}/.test(OVERVIEW));
  });

  it("30. the KPI row uses the app's .kpi-grid escape, not a raw 3-column grid", () => {
    assert.ok(/className="kpi-grid"/.test(OVERVIEW));
  });
});

describe("Finance Overview · the four summary tiles", () => {
  it("31. three billing counts and one lesson-revenue tile", () => {
    for (const label of ["Paid students", "Partially paid", "Unpaid students", "Lesson revenue"]) {
      assert.ok(OVERVIEW.includes(`t("${label}")`), label);
    }
  });

  it("32. the fourth tile keeps the comp's informational caption", () => {
    assert.ok(OVERVIEW.includes('t("completed lessons · informational")'));
  });

  it("33. …and its dashed treatment, which is what distinguishes it", () => {
    const tile = /data-testid="fin-lesson-revenue"[\s\S]{0,200}/.exec(OVERVIEW);
    assert.ok(tile, "the tile is identifiable");
    assert.ok(tile![0].includes("1px dashed"), "the comp draws this one dashed");
  });

  it("34. it is the ONLY value on Overview that comes from revenue", () => {
    const revenueReads = [...OVERVIEW.matchAll(/revenue\.\w+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(revenueReads)], ["revenue.total"]);
  });

  it("35. the tiles reflow through .ov-grid rather than a raw repeat(4)", () => {
    assert.ok(/className="ov-grid"/.test(OVERVIEW));
  });
});

describe("Finance Overview · top performing classes", () => {
  const cls = (classId: string, className: string, collected: number | null, outstanding: number | null) =>
    ({ classId, className, billed: 1_000_000, collected, outstanding });

  it("36. ranks known collected values, highest first", () => {
    const { ranked } = rankByCollected([
      cls("c1", "Alpha", 300_000, 700_000),
      cls("c2", "Beta", 900_000, 100_000),
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c2", "c1"]);
  });

  it("37. a class whose collected is unknown is NOT ranked", () => {
    const { ranked, unknown } = rankByCollected([
      cls("c1", "Alpha", 300_000, 700_000),
      cls("c2", "Beta", null, null),
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c1"]);
    assert.deepEqual(unknown.map((c) => c.classId), ["c2"]);
  });

  it("38. …and is NOT given a zero, which would bury it at the bottom", () => {
    const { ranked } = rankByCollected([
      cls("c1", "Alpha", 100, 0),
      cls("c2", "Beta", null, null),
    ]);
    assert.ok(!ranked.some((c) => c.classId === "c2"), "not placed at all");
    assert.equal(ranked.length, 1);
  });

  it("39. …and is still shown, with No data — unplaceable is not absent", () => {
    assert.ok(/data-testid="fin-unrankable-class"/.test(OVERVIEW));
    assert.ok(/unknown\.map/.test(OVERVIEW));
  });

  it("40. ranking is deterministic on ties", () => {
    const a = rankByCollected([cls("c2", "Beta", 500, 0), cls("c1", "Alpha", 500, 0)]);
    const b = rankByCollected([cls("c1", "Alpha", 500, 0), cls("c2", "Beta", 500, 0)]);
    assert.deepEqual(a.ranked.map((c) => c.classId), b.ranked.map((c) => c.classId));
    assert.deepEqual(a.ranked.map((c) => c.classId), ["c1", "c2"]);
  });

  it("41. revenue-by-class sorts by outstanding, unknowns last", () => {
    const sorted = sortByOutstanding([
      cls("c1", "Alpha", 500, 100),
      cls("c2", "Beta", null, null),
      cls("c3", "Gamma", 200, 900),
    ]);
    assert.deepEqual(sorted.map((c) => c.classId), ["c3", "c1", "c2"]);
  });
});

describe("Finance Overview · the per-student class grid", () => {
  it("42. carries exactly the six columns the data supports", () => {
    for (const h of ["Student", "Monthly fee", "Paid", "Remaining", "Status", "Paid date"]) {
      assert.ok(OVERVIEW.includes(`t("${h}")`), h);
    }
  });

  it("43. Paid and Remaining are the server's collected and outstanding", () => {
    assert.ok(/money\(r\.collected, fmt, noData\)/.test(OVERVIEW));
    assert.ok(/money\(r\.outstanding, fmt, noData\)/.test(OVERVIEW));
  });

  it("44. it is wrapped in a LOCAL horizontal scroll region", () => {
    // Gate 1 called the comp's unprotected six-column grid the screen's worst
    // overflow risk. It is wrapped in the same container the comp uses for its
    // own Payments table, so the scrolling is the grid's and not the page's.
    const grid = /function ClassStudentGrid[\s\S]*?minWidth: 640/.exec(OVERVIEW);
    assert.ok(grid, "the grid declares a min-width inside a wrapper");
    assert.ok(grid![0].includes('overflowX: "auto"'));
  });

  it("45. no status is inferred — the badge reads the stored value", () => {
    assert.ok(/statusBadgeStyle\(r\.status\)/.test(OVERVIEW));
    assert.equal(STATUS_LABEL["Partially Paid"], "Partially paid", "the comp's casing");
    assert.equal(STATUS_LABEL["Paid"], "Paid");
    assert.equal(STATUS_LABEL["Unpaid"], "Unpaid");
  });

  it("46. the badge has a distinct treatment per status", () => {
    const seen = new Set(
      ["Paid", "Partially Paid", "Unpaid"].map((s) => JSON.stringify(statusBadgeStyle(s)))
    );
    assert.equal(seen.size, 3, "three statuses, three treatments");
  });
});

/* ================================================================= ghosts */

describe("Finance UI · ghosts are never named", () => {
  it("47. no placeholder row for a deleted person exists anywhere", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/Deleted student|Unknown student|Former student/i.test(src), `${name}`);
    }
  });

  it("48. NO Finance surface renders the comp's `+N more` any more", () => {
    // Gate 5.5's first finding. `+4 more` under an actionable list of students
    // who owe money reads as a control: press it, see four more people to chase.
    // There are no more people — those records belong to students who no longer
    // exist — so the affordance promised something the screen can never do. It
    // is gone from every Finance file, in both languages: the dictionary key it
    // rendered through is not used here at all any more.
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\+\{[^}]*\}\s*\{t\("more"\)\}/.test(src), `${name} must not render +N more`);
      assert.ok(!/t\("more"\)/.test(src), `${name} must not use the "more" key`);
      assert.ok(!/fin-hidden-more/.test(src), `${name} must not keep the disclosure hook`);
    }
  });

  it("49. the count is disclosed as a SENTENCE about historical accounting", () => {
    // The fact is still told — the totals really are larger than the rows — but
    // as a statement about the books rather than as a control. `{N}` is filled
    // AFTER translation so each language places the number by its own grammar.
    assert.equal(
      HISTORICAL_NOTE_MANY,
      "{N} historical payment records no longer have student information."
    );
    assert.equal(historicalNote(2, en), "2 historical payment records no longer have student information.");
    // Pluralised, so one record never reads as "1 records".
    assert.equal(historicalNote(1, en), "1 historical payment record no longer has student information.");
    assert.ok(!historicalNote(1, en).includes("records"));
  });

  it("50. it appears ONLY beside an aggregate, and never inside a people list", () => {
    // Where it may appear: the month's money summary, and one class's expanded
    // student detail — the two places where a total and the rows beneath it are
    // on screen together and visibly disagree. Nowhere else.
    assert.equal([...ALL_UI.matchAll(/data-testid="fin-historical-note"/g)].length, 2);
    assert.equal((OVERVIEW.match(/data-testid="fin-historical-note"/g) ?? []).length, 2);
    assert.ok(/\{billing\.hiddenRecords > 0 && \(/.test(OVERVIEW), "the month's own count");
    assert.ok(/\{hidden > 0 && \(/.test(OVERVIEW), "the class's own count");

    // Outstanding students is a worklist of live students a teacher acts on.
    const outstanding = /Outstanding students[\s\S]*?Top performing classes/.exec(OVERVIEW);
    assert.ok(outstanding, "the outstanding students panel is findable");
    assert.ok(!/fin-historical-note/.test(outstanding![0]), "no note inside the list");
    assert.ok(!/hiddenRecords/.test(outstanding![0]), "no count inside the list");

    // Payments is a read-only table of live students' bills. It discloses
    // nothing, so it can never imply that more rows could be loaded.
    assert.ok(!/hiddenRecords/.test(PAYMENTS), "the Payments tab discloses nothing");
    assert.ok(!/fin-historical-note/.test(PAYMENTS));

    // Top performing classes is a ranking card with no student rows to
    // reconcile against, so it stays free of the explanation too.
    const top = /Top performing classes[\s\S]*?Revenue by class/.exec(OVERVIEW);
    assert.ok(top, "the ranking card is findable");
    assert.ok(!/fin-historical-note|hiddenRecords/.test(top![0]), "no note on the ranking card");
  });

  it("51. the UI never filters ghosts itself — the server never sent them", () => {
    // A client-side ghost filter would mean the server had disclosed one.
    assert.ok(!/studentName\s*===\s*""/.test(ALL_UI));
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\.filter\([^)]*ghost/i.test(src), `${name} must not filter ghosts`);
    }
  });
});

/* ================================================================ parents */

describe("Finance UI · the missing-parent indication", () => {
  it("52. every surface that names a student who owes money can say it", () => {
    for (const [name, src] of [["overview", OVERVIEW], ["payments", PAYMENTS]] as const) {
      assert.ok(src.includes('t("No linked parent")'), `${name} shows the state`);
      assert.ok(/!\w+\.parentLinked && \(/.test(src), `${name} shows it conditionally`);
    }
  });

  it("53. it is neutral copy, not an error badge", () => {
    const uses = [...OVERVIEW.matchAll(/data-testid="fin-no-parent"[^>]*style=\{\{([^}]*)\}\}/g)];
    assert.ok(uses.length > 0);
    for (const u of uses) {
      assert.ok(/var\(--muted/.test(u[1]), "muted, not accent or red");
      assert.ok(!/accent|--red|border/.test(u[1]), "no badge treatment");
    }
  });

  it("54. no parent contact detail is rendered anywhere", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!src.includes("parentName"), `${name}`);
      assert.ok(!src.includes("parentPhone"), `${name}`);
      assert.ok(!/\bparentId\b/.test(src), `${name}`);
    }
  });

  it("55. no reminder or notification control is drawn", () => {
    for (const banned of ["Send reminder", "Notify", "notification", "mailto:"]) {
      assert.ok(!ALL_UI.includes(banned), `no Finance UI may draw ${banned}`);
    }
  });
});

/* =============================================================== analytics */

describe("Finance Analytics · lesson-derived only", () => {
  it("56. all four designed sections exist", () => {
    for (const label of ["Monthly revenue trend", "Revenue distribution", "Revenue by class", "By lesson type"]) {
      assert.ok(ANALYTICS.includes(`t("${label}")`), label);
    }
  });

  it("57. it reads revenue and never billing", () => {
    assert.ok(!/\bbilling\b/.test(ANALYTICS), "no bill-derived value on this tab");
    assert.ok(/const \{ revenue \} = data/.test(ANALYTICS));
  });

  it("58. byType is rendered, never recomputed", () => {
    assert.ok(/fmt\.vnd\(revenue\.byType\[key\]\)/.test(ANALYTICS));
    assert.ok(!/regular \+ .*makeup/.test(ANALYTICS), "no summing in the browser");
  });

  it("59. the three lesson types are the app's own three", () => {
    const labels = /const TYPE_LABELS[^}]*\}/.exec(ANALYTICS);
    assert.ok(labels);
    for (const key of ["regular", "makeup", "extra"]) assert.ok(labels![0].includes(key));
  });

  it("60. the empty-revenue state is the comp's own", () => {
    assert.ok(/data-testid="fin-revenue-empty"/.test(ANALYTICS));
    assert.ok(ANALYTICS.includes('t("Complete lessons to start tracking revenue for this month.")'));
    assert.ok(ANALYTICS.includes('t("No revenue recorded for")'));
  });

  it("61. the two-column sections collapse through .main-grid", () => {
    const uses = ANALYTICS.match(/className="main-grid"/g) ?? [];
    assert.equal(uses.length, 2, "both analytics rows collapse at <=1100");
  });

  it("62. no c6-style normalisation exists — the chart draws what it is given", () => {
    for (const banned of ["18000000", "1800000", "normalis", "normaliz", "clamp(", "Math.min(c.amount"]) {
      assert.ok(!ANALYTICS.includes(banned), `analytics must not contain ${banned}`);
    }
  });
});

describe("Finance charts · geometry only", () => {
  it("63. the trend maps months to coordinates", () => {
    const g = trendGeometry([
      { month: "2026-02", total: 0 },
      { month: "2026-03", total: 100 },
    ]);
    assert.equal(g.points.length, 2);
    assert.equal(g.points[0].x, 0);
    assert.equal(g.points[1].x, 100);
    assert.equal(g.peak, 100);
    assert.ok(g.points[1].y < g.points[0].y, "a bigger month sits higher");
  });

  it("64. an all-zero series does not divide by zero", () => {
    const g = trendGeometry([
      { month: "2026-02", total: 0 },
      { month: "2026-03", total: 0 },
    ]);
    assert.ok(g.points.every((p) => Number.isFinite(p.y)), "every y is a number");
    assert.equal(g.peak, 0);
  });

  it("65. an empty series produces no path at all", () => {
    const g = trendGeometry([]);
    assert.deepEqual(g.points, []);
    assert.equal(g.line, "");
    assert.equal(g.area, "");
  });

  it("66. a single month is centred rather than at x=NaN", () => {
    const g = trendGeometry([{ month: "2026-07", total: 5 }]);
    assert.equal(g.points[0].x, 50);
  });

  it("67. the donut's arcs sum to the whole ring", () => {
    const { arcs, total } = donutArcs([
      { key: "a", label: "A", color: "#1", value: 300 },
      { key: "b", label: "B", color: "#2", value: 100 },
    ]);
    assert.equal(total, 400);
    assert.equal(arcs.length, 2);
    assert.ok(Math.abs(arcs.reduce((s, a) => s + a.share, 0) - 1) < 1e-9);
  });

  it("68. a zero total produces no arcs — not a full ring of nothing", () => {
    const { arcs, total } = donutArcs([{ key: "a", label: "A", color: "#1", value: 0 }]);
    assert.deepEqual(arcs, []);
    assert.equal(total, 0);
  });

  it("69. the charts are Finance's own — Reviews' are not refactored", () => {
    assert.ok(!CHARTS.includes("components/reviews"), "no import from Reviews");
    assert.ok(!CHARTS.includes("ScoreTrend"));
    assert.ok(!CHARTS.includes("ScoreDonut"));
    const reviewsCharts = code("src", "components", "reviews", "charts.tsx");
    assert.ok(reviewsCharts.includes("export function ScoreTrend"), "Reviews' own chart is untouched");
    assert.ok(reviewsCharts.includes("export function ScoreDonut"));
  });

  it("70. both SVGs scale to their container rather than setting a width", () => {
    assert.ok(/viewBox="0 0 100 100"[\s\S]{0,120}preserveAspectRatio="none"/.test(CHARTS));
    assert.ok(/width: "100%", height: "100%"/.test(CHARTS));
  });
});

/* ================================================================ payments */

describe("Finance Payments · read-only, and short two columns", () => {
  it("71. the Method column does not exist", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\bMethod\b/.test(src), `${name} must not name Method`);
      assert.ok(!src.includes("methodLabel"), `${name}`);
      assert.ok(!src.includes("methodIcon"), `${name}`);
    }
  });

  it("72. no row action is drawn — not even disabled", () => {
    for (const banned of ["Mark as paid", "Mark as unpaid", "Record payment", "Record / edit payment", "Manage payment", "Save payment"]) {
      assert.ok(!ALL_UI.includes(banned), `no Finance UI may draw "${banned}"`);
    }
    assert.ok(!/disabled/.test(PAYMENTS), "and nothing is drawn disabled as a hint");
  });

  it("73. there is no Actions column header", () => {
    assert.ok(!/t\("Actions"\)/.test(PAYMENTS));
  });

  it("74. the five supported columns are present", () => {
    const header = /\[t\("Student"\), t\("Class"\), t\("Monthly fee"\), t\("Status"\), t\("Paid date"\)\]/.exec(PAYMENTS);
    assert.ok(header, "exactly the five columns the data supports");
  });

  it("75. all three filters exist and are composable", () => {
    assert.ok(/const \[status, setStatus\]/.test(PAYMENTS));
    assert.ok(/const \[classId, setClassId\]/.test(PAYMENTS));
    assert.ok(/const \[studentId, setStudentId\]/.test(PAYMENTS));
    const filter = /rows\.filter\(\(r\) =>([\s\S]*?)\),/.exec(PAYMENTS);
    assert.ok(filter, "one predicate combines all three");
    for (const f of ["r.status === status", "r.classId === classId", "r.studentId === studentId"]) {
      assert.ok(filter![1].includes(f), f);
    }
  });

  it("76. filter options are derived from the rows, so a ghost is unofferable", () => {
    assert.ok(/for \(const r of rows\) if \(!seen\.has\(r\.classId\)\)/.test(PAYMENTS));
    assert.ok(/for \(const r of rows\) if \(!seen\.has\(r\.studentId\)\)/.test(PAYMENTS));
  });

  it("77. the status filter offers the three stored statuses and nothing else", () => {
    assert.ok(/BILLING_STATUSES\.map/.test(PAYMENTS));
    assert.ok(!/Overdue|Pending|Refunded/.test(PAYMENTS));
  });

  it("78. no second endpoint was introduced for filtering", () => {
    assert.ok(!PAYMENTS.includes("fetch("), "filters are a view of data in hand");
    assert.ok(!PAYMENTS.includes("useQuery"));
  });

  it("79. the empty-filter state is the comp's own", () => {
    assert.ok(/data-testid="fin-payments-empty"/.test(PAYMENTS));
    assert.ok(PAYMENTS.includes('t("No payment records")'));
    assert.ok(PAYMENTS.includes('t("No billing records match these filters for")'));
  });

  it("80. the table scrolls locally, inside its own wrapper", () => {
    assert.ok(/overflowX: "auto"/.test(PAYMENTS));
    assert.ok(/minWidth: 700/.test(PAYMENTS));
  });
});

/* ============================================================ class detail */

describe("Class detail · the Revenue card is live", () => {
  it("81. the hard-coded zero is gone", () => {
    assert.ok(!/fmt\.vnd\(0\)/.test(CLASS_DETAIL), "no hard-coded 0đ remains");
  });

  it("82. the headline is lesson-derived revenue for this class", () => {
    assert.ok(/revenue\.perClass\.find\(\(r\) => r\.classId === id\)/.test(CLASS_DETAIL));
    assert.ok(/fmt\.vnd\(classRevenue\)/.test(CLASS_DETAIL));
  });

  it("83. Students paid and Unpaid are bill-derived counts", () => {
    assert.ok(/billing\.perClass\.find\(\(b\) => b\.classId === id\)/.test(CLASS_DETAIL));
    assert.ok(/classBilling\.counts\.paid/.test(CLASS_DETAIL));
    assert.ok(/classBilling\.counts\.unpaid/.test(CLASS_DETAIL));
  });

  it("84. it reads /api/finance and never /api/dashboard", () => {
    assert.ok(/fetchFinanceMonth\(CURRENT_MONTH\)/.test(CLASS_DETAIL));
    assert.ok(!CLASS_DETAIL.includes("/api/dashboard"));
    assert.ok(!CLASS_DETAIL.includes("fetchDashboard"));
  });

  it("85. it shares the Finance month's cache key rather than a second one", () => {
    assert.ok(/queryKey: financeKeys\.month\(CURRENT_MONTH\)/.test(CLASS_DETAIL));
  });

  it("86. it invents no second revenue formula", () => {
    for (const banned of ["perLessonValue", "regularScheduled", "computeRevenue", "chargeable"]) {
      assert.ok(!CLASS_DETAIL.includes(banned), `class detail must not contain ${banned}`);
    }
  });

  it("87. it reads no Student.balance", () => {
    assert.ok(!/\bbalance\b/.test(CLASS_DETAIL));
  });

  it("88. it is not a mutation surface for Finance", () => {
    assert.ok(!CLASS_DETAIL.includes("recordPayment"));
    assert.ok(!/\/api\/finance\/\$\{/.test(CLASS_DETAIL));
  });

  it("89. Attendance and Upcoming stay em dashes — other modules own them", () => {
    assert.ok(/label=\{t\("Attendance"\)\} value=\{EM\}/.test(CLASS_DETAIL));
    assert.ok(/label=\{t\("Upcoming"\)\} value=\{EM\}/.test(CLASS_DETAIL));
  });
});

/* ============================================================== vocabulary */

describe("Finance UI · vocabulary and forbidden terms", () => {
  it("90. no bill-derived value is named revenue in code", () => {
    for (const banned of ["billedRevenue", "tuitionRevenue", "collectedRevenue", "outstandingRevenue"]) {
      assert.ok(!ALL_UI.includes(banned), banned);
    }
  });

  it("91. Overdue appears nowhere", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/overdue/i.test(src), `${name} must not mention Overdue`);
    }
  });

  it("92. Invoice, receipt and due date appear nowhere", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/invoice/i.test(src), `${name}`);
      assert.ok(!/receipt/i.test(src), `${name}`);
      assert.ok(!/dueDate|Due date/.test(src), `${name}`);
    }
  });

  it("93. no Finance UI reads Student.balance", () => {
    // The FIELD, not the word: "Outstanding balance" is the comp's own KPI
    // label and "sorted by outstanding balance" its own sentence. What must
    // never appear is a read of the stored Student field, which Finance neither
    // reads nor writes (PROJECT_RULES, Billing).
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\.balance\b/.test(src), `${name} must not read a .balance property`);
      assert.ok(!/\bstudent\.balance\b/i.test(src), `${name}`);
      assert.ok(!/["']balance["']/.test(src), `${name} must not name the field`);
    }
  });

  it("94. the stored enum is never renamed, only labelled", () => {
    assert.deepEqual(Object.keys(STATUS_LABEL).sort(), ["Paid", "Partially Paid", "Unpaid"]);
  });

  it("95. every new dictionary key used by the UI exists in Vietnamese", () => {
    const vi = raw("src", "lib", "i18n-vi.json");
    for (const key of [
      "Total billable", "Money summary", "Last 6 months", "peak", "bills paid",
      "bills have no recorded amount", "Revenue, analytics and student payments for",
      "No revenue recorded for", "No billing records for",
      "No billing records match these filters for", "No outstanding tuition for",
      "Couldn't load finance", "collected", "paid", "partial", "unpaid",
      HISTORICAL_NOTE_ONE, HISTORICAL_NOTE_MANY,
    ]) {
      assert.ok(vi.includes(`"${key}":`), `missing translation: ${key}`);
    }
  });
});

/* =============================================================== responsive */

describe("Finance UI · responsive, statically", () => {
  it("96. the page introduces no global overflow-x workaround", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/overflowX: "hidden"/.test(src), `${name} must not hide overflow`);
      assert.ok(!/width: "100vw"/.test(src), `${name} must not set a viewport width`);
    }
  });

  it("97. every horizontal scroll region is LOCAL, declared, and one of three", () => {
    // Exactly three, each intentional and each scoped to its own element: the
    // Payments table, the per-student class grid, and the tab strip. Nothing
    // else in Finance scrolls sideways, and the PAGE never does.
    const regions = [...ALL_UI.matchAll(/overflowX: "auto"/g)];
    assert.equal(regions.length, 3);
    assert.equal((PAYMENTS.match(/overflowX: "auto"/g) ?? []).length, 1, "the payments table");
    assert.equal((OVERVIEW.match(/overflowX: "auto"/g) ?? []).length, 1, "the per-student grid");
    assert.equal((PAGE.match(/overflowX: "auto"/g) ?? []).length, 1, "the tab strip");

    // The two tables sit beside a min-width, which is what makes the scroll
    // intentional rather than an accident; the tab strip sizes from its tabs.
    assert.ok(/minWidth: 700/.test(PAYMENTS));
    assert.ok(/minWidth: 640/.test(OVERVIEW));
    // …and each is paired with overflowY:hidden, the fix Sprint 8 needed when a
    // bare overflow-x made `visible` compute to `auto` and grew a vertical bar.
    for (const [name, src] of [["payments", PAYMENTS], ["overview", OVERVIEW], ["page", PAGE]] as const) {
      assert.ok(/overflowY: "hidden"/.test(src), `${name} pins the vertical axis too`);
    }
  });

  it("98. the app's existing responsive utilities are reused, not reinvented", () => {
    const css = raw("src", "app", "globals.css");
    for (const util of ["kpi-grid", "ov-grid", "main-grid", "tabstrip"]) {
      assert.ok(ALL_UI.includes(util), `Finance uses .${util}`);
      assert.ok(css.includes(`.${util}`), `.${util} is already defined in globals.css`);
    }
  });

  it("99. Finance's only CSS is one mobile block, and it is all inside it", () => {
    // Gate 5 shipped Finance with no stylesheet of its own. Gate 5.5 adds one
    // block, at the app's existing 620px breakpoint, because three panels are
    // too dense on a phone and no existing utility restacks a flex row.
    //
    // THE INVARIANT IS THE BREAKPOINT, not the absence. Every `.fin-` rule must
    // live inside `@media (max-width:620px)`: a rule outside it would reach
    // desktop and tablet, and tablet already passed its human pass. The desktop
    // half of each hook stays where it always was — inline, in the component.
    const css = raw("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    const block = financeBlock();
    for (const m of css.matchAll(/\.fin-[\w-]+/g)) {
      assert.ok(block.includes(m[0]), `${m[0]} must be declared inside the 620px block`);
    }
    // And nothing in that block reaches outside Finance: no shared class, no
    // element selector, no utility the rest of the app also uses.
    for (const rule of block.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean)) {
      for (const sel of rule.split(",")) {
        assert.ok(sel.trim().startsWith(".fin-"), `the Finance block styles only .fin- hooks, got "${sel.trim()}"`);
      }
    }
  });

  it("100. the tab strip scrolls rather than forcing the page wide", () => {
    assert.ok(/className="tabstrip"/.test(PAGE));
    assert.ok(/overflowX: "auto"/.test(raw(...PAGE_PATH)));
  });

  it("101. nothing sets a width a 375px phone could not meet", () => {
    // The Sprint 7 Gate 5 lesson: the page must not be wider than the phone,
    // and what made it so was elements that DEFINED a width rather than adapting
    // to the one they had. Anything at or above 360px would do that again.
    //
    // Widths BELOW that are fine and are the comp's own: the donut's 132px box
    // sits in a flex-wrap row, and the two scroll regions' min-widths are
    // deliberate and are contained (see 97).
    for (const [name, src] of UI_FILES) {
      for (const m of src.matchAll(/\b(?:min)?[wW]idth: (\d{3,})\b/g)) {
        const px = Number(m[1]);
        const inScrollRegion = px === 700 || px === 640;
        assert.ok(px < 360 || inScrollRegion, `${name}: ${m[0]} is wider than a phone`);
      }
    }
  });

  it("102. every money cell can shrink — nowrap always has an ellipsis beside it", () => {
    // A nowrap monospace amount in an un-ellipsised box is what pushes a card
    // wider than the phone. The KPI value style is the one that matters.
    const kpi = /const kpiValueStyle[\s\S]*?\}\);/.exec(OVERVIEW);
    assert.ok(kpi);
    assert.ok(kpi![0].includes('whiteSpace: "nowrap"'));
    assert.ok(kpi![0].includes('textOverflow: "ellipsis"'));
    assert.ok(kpi![0].includes('overflow: "hidden"'));
  });

  it("103. no mobile-only duplicate of a control exists", () => {
    // There are no actions in Sprint 9, so there is nothing to duplicate — and
    // no second rendering of the filters either.
    const selects = [...PAYMENTS.matchAll(/<Select\b/g)];
    assert.equal(selects.length, 3, "one Select per filter, rendered once");
    const monthSelects = [...PAGE.matchAll(/<Select\b/g)];
    assert.equal(monthSelects.length, 1, "one month selector");
  });

  it("104. the files a responsive pass must cover all exist", () => {
    for (const p of [
      ["src", "app", "(app)", "finance", "page.tsx"],
      ["src", "components", "finance", "api.ts"],
      ["src", "components", "finance", "finance-ui.ts"],
      ["src", "components", "finance", "finance-charts.tsx"],
      ["src", "components", "finance", "finance-overview.tsx"],
      ["src", "components", "finance", "finance-analytics.tsx"],
      ["src", "components", "finance", "finance-payments.tsx"],
    ]) {
      assert.ok(existsSync(path.join(process.cwd(), ...p)), p.join("/"));
    }
  });
});

/* ================================================ Gate 5.5 — the visual pass
 *
 * A human looked at the shipped screen and found four things. One was a
 * WORDING/AFFORDANCE fault at every width — `+4 more` under an actionable list —
 * and three were DENSITY faults on a phone: Outstanding students, Top performing
 * classes and Revenue by class each keep a right-hand money column beside a name
 * column that, at 375px, has nothing left to give.
 *
 * Tablet PASSED. So every fix below is either width-independent copy or lives
 * behind `@media (max-width:620px)`, and the assertions say so explicitly — a
 * rule that leaked upwards would break a breakpoint that was already signed off,
 * which is the one regression this gate cannot afford.
 * ====================================================================== */

describe("Gate 5.5 · the historical note", () => {
  it("105. it translates, and its placeholder survives translation", () => {
    // `{N}` is filled AFTER translation, which is the whole reason the copy
    // carries a placeholder instead of being concatenated around a number:
    // Vietnamese opens with "Có" and English opens with the count itself.
    const vi = (x: string) => translate(x, "vi");
    assert.equal(historicalNote(2, vi), "Có 2 khoản thu lịch sử không còn thông tin học sinh.");
    assert.equal(historicalNote(1, vi), "Có 1 khoản thu lịch sử không còn thông tin học sinh.");
    for (const form of [HISTORICAL_NOTE_ONE, HISTORICAL_NOTE_MANY]) {
      assert.ok(vi(form).includes("{N}"), "the placeholder survives translation");
      assert.notEqual(vi(form), form, "and the sentence is actually translated");
    }
  });

  it("106. the copy is a Finance fact, never a data-model one", () => {
    // The user must read this as something about their books. "ghost",
    // "hidden record", "deleted record" and "database record" all describe our
    // storage, and none of them appears — in either language.
    const vi = (x: string) => translate(x, "vi");
    for (const form of [HISTORICAL_NOTE_ONE, HISTORICAL_NOTE_MANY]) {
      for (const word of ["ghost", "hidden", "deleted", "database"]) {
        assert.ok(!form.toLowerCase().includes(word), `${word} in "${form}"`);
      }
      assert.ok(/historical/.test(form), "it says what it is: historical");
      assert.ok(/\bpayment record/.test(form), "and what kind of record");
      assert.ok(/lịch sử/.test(vi(form)), "the Vietnamese says historical too");
    }
    // Nor does any Finance file put one of those words on screen.
    for (const [name, src] of UI_FILES) {
      assert.ok(!/t\("[^"]*\b(?:ghost|deleted|hidden)\b[^"]*"\)/i.test(src), `${name}`);
    }
  });

  it("107. it is INERT — a caption on a number, not a control", () => {
    // The fault it replaced was an affordance: text that looked pressable and
    // was not. So the replacement carries no cursor, no underline, no link
    // colour, no role, no handler and no focus stop.
    assert.deepEqual(Object.keys(historicalNoteStyle).sort(), ["color", "fontSize", "lineHeight"]);
    assert.equal(historicalNoteStyle.color, "var(--muted-2)", "muted, like every other caption");
    assert.ok(!("cursor" in historicalNoteStyle));
    assert.ok(!("textDecoration" in historicalNoteStyle));

    const sites = [...OVERVIEW.matchAll(/data-testid="fin-historical-note"([\s\S]{0,400}?)<\/div>/g)];
    assert.equal(sites.length, 2, "both sites are readable");
    for (const [, body] of sites) {
      assert.ok(!/onClick|onKeyDown|onMouseDown|role=|tabIndex/.test(body), "no interaction");
      assert.ok(!/<button|<a\b/.test(body), "not a control");
      assert.ok(!/cursor: "pointer"/.test(body));
      assert.ok(!/textDecoration/.test(body));
      assert.ok(body.includes("historicalNoteStyle"), "it reuses the one style");
    }
  });

  it("108. it carries a COUNT and nothing else — no identity can leak", () => {
    // `hiddenRecords` is a number on the payload with no id or name beside it,
    // and both call sites pass exactly that number.
    const calls = [...OVERVIEW.matchAll(/historicalNote\(([^,]+), t\)/g)].map((m) => m[1].trim());
    assert.deepEqual(calls, ["billing.hiddenRecords", "hidden"]);
    assert.ok(!/hiddenStudents|hiddenRows|hiddenNames|ghostRows/.test(ALL_UI));
    // And it is never rendered at zero: a note explaining nothing is clutter.
    assert.ok(!/hiddenRecords >= 0|hidden >= 0/.test(OVERVIEW));
  });
});

describe("Gate 5.5 · Outstanding students on a phone", () => {
  it("109. the row separates identity, metadata and amount", () => {
    // The preferred structure is name + amount on one line, class under the
    // name, parent state under that. The markup is already in that DOM order, so
    // the mobile rule only has to align the row to the TOP — which lifts the
    // amount out of the vertical middle of a three-line block onto the name's
    // own line, and leaves class and parent reading as secondary detail.
    const block = financeBlock();
    for (const hook of ["fin-out-row", "fin-out-name", "fin-out-meta", "fin-out-amount"]) {
      assert.ok(OVERVIEW.includes(hook), `the markup carries .${hook}`);
      assert.ok(block.includes(`.${hook}`), `the mobile block styles .${hook}`);
    }
    assert.ok(/\.fin-out-row\{[^}]*align-items:flex-start !important/.test(block));
    assert.ok(/\.fin-out-amount\{[^}]*align-self:flex-start !important/.test(block));
    // The parent state stays neutral secondary metadata, not an error badge.
    assert.ok(/data-testid="fin-no-parent" className="fin-out-parent"/.test(OVERVIEW));
  });

  it("110. identity WRAPS rather than truncating at 375px", () => {
    // Truncation here is destructive — two students can ellipsis to the same
    // string — and `overflow-wrap:anywhere` is what stops a single long token
    // pushing the card wider than the phone and crowding the amount off it.
    const block = financeBlock();
    const rule = /\.fin-out-name,\.fin-out-meta\{([^}]*)\}/.exec(block);
    assert.ok(rule, "name and meta are released from nowrap together");
    assert.ok(rule![1].includes("white-space:normal !important"));
    assert.ok(rule![1].includes("text-overflow:clip !important"));
    assert.ok(rule![1].includes("overflow-wrap:anywhere"));
    // The desktop half is unchanged: it still ellipsises inside its column.
    assert.ok(/className="fin-out-name"[^>]*whiteSpace: "nowrap"/.test(OVERVIEW));
  });

  it("111. nothing is appended to the list — no +N, no note, no placeholder", () => {
    const list = /className="fin-out-list"[\s\S]*?Top performing classes/.exec(OVERVIEW);
    assert.ok(list, "the list is findable");
    assert.ok(!/\{t\("more"\)\}/.test(list![0]), "no +N more");
    assert.ok(!/fin-historical-note/.test(list![0]), "no historical note row");
    assert.ok(!/hiddenRecords/.test(list![0]), "no hidden count at all");
    assert.ok(!/Deleted|Unknown|Former/i.test(list![0]), "no placeholder person");
  });

  it("112. it grows no scroll region of its own", () => {
    const block = financeBlock();
    assert.ok(!/\.fin-out[^{]*\{[^}]*overflow-x/.test(block), "no local scroller");
    assert.ok(!/\.fin-out[^{]*\{[^}]*min-width:\s*\d{3}/.test(block), "no width a phone cannot pay");
  });
});

describe("Gate 5.5 · Top performing classes on a phone", () => {
  it("113. the row stacks: rank and name first, the amount on its own line", () => {
    const block = financeBlock();
    for (const hook of ["fin-tpc-row", "fin-tpc-name", "fin-tpc-amount", "fin-tpc-label"]) {
      assert.ok(OVERVIEW.includes(hook), `the markup carries .${hook}`);
      assert.ok(block.includes(`.${hook}`), `the mobile block styles .${hook}`);
    }
    // `flex:1 0 100%` is what takes the amount out of the squeeze — a full-width
    // line rather than a third column competing with the class name.
    assert.ok(/\.fin-tpc-amount\{[^}]*flex:1 0 100% !important/.test(block));
    assert.ok(/\.fin-tpc-row\{[^}]*flex-wrap:wrap !important/.test(block));
  });

  it("114. the amount says what it is once it leaves its column", () => {
    // A bare figure needs no label beside a header; alone on a line it does. The
    // word is the card's own existing one, and it is hidden by an INLINE style so
    // switching it on can only ever happen at this breakpoint.
    assert.equal((OVERVIEW.match(/className="fin-tpc-label"/g) ?? []).length, 2, "ranked and unrankable");
    assert.ok(/className="fin-tpc-label" style=\{\{ display: "none" \}\}>\{t\("Collected"\)\}/.test(OVERVIEW));
    assert.ok(/\.fin-tpc-label\{[\s\S]*?display:inline !important/.test(financeBlock()));
  });

  it("115. ranking, unknowns and absences are all unchanged", () => {
    // A presentation change may not move a metric. An unknown collected total is
    // still unrankable, still listed after the ranked ones, and still `No data`
    // rather than a zero — asserted through the helper the card ranks with.
    const { ranked, unknown } = rankByCollected([
      { classId: "a", className: "A", billed: 10, collected: 4, outstanding: 6 },
      { classId: "b", className: "B", billed: 10, collected: null, outstanding: null },
      { classId: "c", className: "C", billed: 10, collected: 9, outstanding: 1 },
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c", "a"]);
    assert.deepEqual(unknown.map((c) => c.classId), ["b"]);
    assert.equal(money(null, fmt, NO_DATA), NO_DATA);
    assert.ok(/data-testid="fin-unrankable-class"/.test(OVERVIEW));
    // And no +N more, and no explanation a ranking card does not need.
    const top = /Top performing classes[\s\S]*?Revenue by class/.exec(OVERVIEW);
    assert.ok(top && !/\{t\("more"\)\}|fin-historical-note/.test(top[0]));
  });
});

describe("Gate 5.5 · Revenue by class on a phone", () => {
  it("116. the collapsed summary becomes a stacked card", () => {
    // The dense part is two 88px money columns beside a flexible name. Below the
    // breakpoint the name takes the first line and the two amounts share the
    // second — each half the row, reading left-to-right under their own labels.
    const block = financeBlock();
    for (const hook of ["fin-class-row", "fin-class-main", "fin-class-name", "fin-class-amt"]) {
      assert.ok(OVERVIEW.includes(hook), `the markup carries .${hook}`);
      assert.ok(block.includes(`.${hook}`), `the mobile block styles .${hook}`);
    }
    assert.ok(/\.fin-class-main\{flex:1 0 calc\(100% - 20px\) !important\}/.test(block));
    assert.ok(/\.fin-class-amt\{[^}]*flex:1 1 0 !important/.test(block));
    assert.ok(/\.fin-class-amt\{[^}]*min-width:0 !important/.test(block), "it may shrink past its 88px floor");
    assert.ok(/\.fin-class-amt\{[^}]*text-align:left !important/.test(block));
  });

  it("117. the pair is addressed by name, never by position", () => {
    // `:first-of-type` would mean "the first <span> child", which is the colour
    // dot — a selector that silently matches nothing at all. Both amounts say
    // which they are, in the markup.
    assert.ok(/className="fin-class-amt fin-class-collected"/.test(OVERVIEW));
    assert.ok(/className="fin-class-amt fin-class-outstanding"/.test(OVERVIEW));
    const block = financeBlock();
    assert.ok(!/:first-of-type|:first-child|:nth-of-type/.test(block), "no positional selector");
    assert.ok(/\.fin-class-collected\{padding-left:20px\}/.test(block));
  });

  it("118. the expand affordance exists on the phone and is decorative", () => {
    // `aria-expanded` on the button states the accordion at every width and is
    // what assistive technology reads. The chevron is for the phone, where there
    // is no hover and no pointer cursor to reveal that the row opens at all.
    assert.ok(/aria-expanded=\{open\}/.test(OVERVIEW), "the state is on the button");
    assert.ok(/className="fin-class-chev" aria-hidden="true" style=\{\{ display: "none"/.test(OVERVIEW));
    assert.ok(/\.fin-class-chev\{display:flex !important\}/.test(financeBlock()));
    // It is inside the button, so it can never become a second control.
    assert.ok(!/fin-class-chev[^>]*onClick/.test(OVERVIEW));
  });

  it("119. the expanded student grid keeps its own local scroll, unchanged", () => {
    // Squeezing six columns into 347px is the density this gate is fixing, not a
    // fix for it. The grid keeps the wrapper and the min-width it has always had,
    // and the mobile block does not touch either.
    const grid = /function ClassStudentGrid[\s\S]*?minWidth: 640/.exec(OVERVIEW);
    assert.ok(grid, "the grid still declares its min-width inside its wrapper");
    assert.ok(grid![0].includes('overflowX: "auto"'));
    assert.ok(grid![0].includes('overflowY: "hidden"'));
    assert.ok(!/fin-scroll/.test(financeBlock()), "the mobile block does not restyle the scroller");
  });

  it("120. the class's historical note lives in the expanded detail", () => {
    // Where the class's aggregate and its student rows are on screen together.
    // The collapsed summary line carries only the three status counts now — a
    // "+N more" appended to them read as a fourth status.
    const summary = /\{c\.counts\.paid\} \{t\("paid"\)\}[\s\S]{0,220}?<\/span>/.exec(OVERVIEW);
    assert.ok(summary, "the status summary is findable");
    assert.ok(!/more|hiddenRecords/.test(summary![0]), "nothing is appended to the counts");
    const detail = /function ClassStudentGrid[\s\S]*$/.exec(OVERVIEW);
    assert.ok(detail && /fin-historical-note/.test(detail[0]), "the note is in the detail");
  });
});

describe("Gate 5.5 · the breakpoint contract", () => {
  it("121. tablet and desktop see none of this", () => {
    // Tablet passed its human pass, so the fixes may not reach it. Every rule is
    // inside the 620px block (99), and the two bands above it are untouched by
    // Finance — no `.fin-` selector appears in either.
    const css = raw("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const q of ["(max-width:1100px)", "(max-width:860px) and (min-width:621px)"]) {
      const start = css.indexOf(`@media ${q}{`);
      assert.ok(start >= 0, `${q} exists`);
      let depth = 0, i = start + `@media ${q}`.length;
      for (; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) break;
      }
      assert.ok(!css.slice(start, i).includes(".fin-"), `${q} must not style Finance`);
    }
  });

  it("122. the mobile block reuses the app's own breakpoint, not a new one", () => {
    assert.ok(MOBILE_QUERY.includes("620"), "the shell's narrow breakpoint is 620px");
    const css = raw("src", "app", "globals.css");
    // Its own block, opened by its own section header, rather than rules smuggled
    // into one of the shell blocks that share this breakpoint.
    const header = css.indexOf("/* ---- Finance, at <=620px");
    assert.ok(header >= 0, "the Finance block states what it is");
    assert.equal(css.slice(header).indexOf("@media "), css.slice(header).indexOf("@media (max-width:620px){"));
    // No Finance rule at any width the app does not already change shape at.
    for (const m of css.matchAll(/@media \(max-width:(\d+)px\)\{/g)) {
      assert.ok(["620", "767", "860", "1099", "1100"].includes(m[1]), `unexpected breakpoint ${m[1]}`);
    }
  });

  it("123. still exactly three horizontal scroll regions, and no new one", () => {
    // The invariant Gate 5 established: the tab strip, the Payments table and the
    // expanded per-student grid. A mobile panel that scrolled sideways instead of
    // restacking would be a fourth, and would be the same density fault wearing a
    // scrollbar.
    assert.equal([...ALL_UI.matchAll(/overflowX: "auto"/g)].length, 3);
    const block = financeBlock();
    assert.ok(!/overflow-x/.test(block), "the mobile block adds no scroll region");
    assert.ok(!/overflow:hidden|overflow-x:hidden/.test(block), "and hides no overflow to fit");
    assert.ok(!/100vw/.test(block), "and defines no viewport width");
  });
});
