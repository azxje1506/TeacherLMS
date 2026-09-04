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
  BILL_MANY, BILL_ONE, HISTORICAL_NOTE_MANY, HISTORICAL_NOTE_ONE,
  HISTORICAL_PARTIAL_MANY, HISTORICAL_PARTIAL_ONE, NOT_DETERMINED, NOT_RECORDED,
  NO_BILLING_BODY, NO_BILLING_TITLE, PARTIAL_NOTE_MANY, PARTIAL_NOTE_ONE,
  STATUS_LABEL, UNKNOWN_SEGMENT, barWidth, billingState, billsLabel, donutArcs,
  financeNoteStyle, historicalNote, historicalPartialNote, money, partialNote,
  percent, rankByCollected, sortByOutstanding, statusBadgeStyle, trendGeometry,
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

  it("22. only per-BILL amounts can be unknown, and those go through money()", () => {
    // The aggregates report confirmed money and are formatted directly; the
    // three values that can still be null all belong to ONE bill — a student
    // row's Paid and Remaining, and an outstanding row's amount — and none of
    // them may be formatted with a bare fmt.vnd, which would print "NaNđ".
    assert.ok(!/fmt\.vnd\(r\.collected\)/.test(OVERVIEW));
    assert.ok(!/fmt\.vnd\(r\.outstanding\)/.test(OVERVIEW));
    assert.ok(!/fmt\.vnd\(s\.amount\)/.test(OVERVIEW));
    assert.ok(/money\(r\.collected, fmt, notRecorded\)/.test(OVERVIEW));
    assert.ok(/money\(r\.outstanding, fmt, notDetermined\)/.test(OVERVIEW));
    assert.ok(/money\(s\.amount, fmt, notDetermined\)/.test(OVERVIEW));
  });

  it("23. the collection bar is not drawn at zero when the ratio is unknown", () => {
    assert.equal(barWidth(null, 1_000_000), null, "unknown part -> no bar");
    assert.equal(barWidth(500_000, 0), null, "zero denominator -> no bar");
    assert.equal(barWidth(500_000, 1_000_000), "50%");
    assert.equal(barWidth(0, 1_000_000), "0%", "a known zero IS a zero-width bar");
  });

  it("24. …and each segment is drawn only when it has a width", () => {
    // The bar itself is no longer all-or-nothing: it always renders, with a
    // third neutral segment standing for the part of the month whose split
    // nobody recorded. A zero-width segment is simply not drawn.
    assert.ok(!/proportionKnown/.test(OVERVIEW), "the all-or-nothing branch is gone");
    assert.ok(/\{collectedW && <div/.test(OVERVIEW));
    assert.ok(/\{outstandingW && <div/.test(OVERVIEW));
    assert.ok(/\{unknownW && <div data-testid="fin-bar-unknown"/.test(OVERVIEW));
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

describe("Finance Overview · the three summary tiles", () => {
  /** The tile row, sliced from its own grid to its closing tag. */
  function tileRow(): string {
    const at = OVERVIEW.indexOf('className="ov-grid fin-tiles"');
    assert.ok(at > 0, "the tile row is identifiable");
    return OVERVIEW.slice(at, OVERVIEW.indexOf("\n        </div>", at));
  }

  it("31. two billing counts and one lesson-revenue tile", () => {
    for (const label of ["Paid students", "Unpaid students"]) {
      assert.ok(tileRow().includes(`t("${label}")`), label);
    }
    // The third is a component, so its label lives in its own definition.
    assert.ok(tileRow().includes("<LessonRevenueTile "), "the lesson-revenue tile is in the row");
    assert.ok(OVERVIEW.includes('t("Lesson revenue")'), "and it carries the comp's label");
    const tiles = [...tileRow().matchAll(/<Tile |<LessonRevenueTile /g)];
    assert.equal(tiles.length, 3, "exactly three tiles, and no fourth");
  });

  it("31b. Partially paid is in the summary ABOVE, and only there", () => {
    // The same word and the same number, twice on one screen, ten pixels apart:
    // two copies of a count are not two facts, and the reader spends the
    // difference checking they match. The summary keeps it, because that is
    // where the money it qualifies is.
    assert.ok(!tileRow().includes('t("Partially paid")'), "no duplicate tile");
    assert.ok(!/counts\.partiallyPaid/.test(tileRow()), "and no duplicate count");
    const legend = /className="fin-summary-legend"[\s\S]*?\n        <\/div>/.exec(OVERVIEW)!;
    assert.ok(/\{t\("Partially paid"\)\} <b/.test(legend[0]), "it survives in the money summary");
    assert.equal((OVERVIEW.match(/t\("Partially paid"\)/g) ?? []).length, 1, "rendered once on the tab");
    // The status badge's own label is a different thing and is untouched.
    assert.equal(STATUS_LABEL["Partially Paid"], "Partially paid");
    // …and the key stays in the dictionary, because the summary still uses it.
    assert.ok(raw("src", "lib", "i18n-vi.json").includes('"Partially paid"'));
  });

  it("32. the lesson-revenue tile keeps the comp's informational caption", () => {
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

  it("35. the row declares three tracks and reflows through .ov-grid", () => {
    // No fourth track left behind, so nothing renders a gap where the removed
    // tile was; the shared utility still supplies the breakpoints.
    assert.ok(/className="ov-grid fin-tiles"/.test(OVERVIEW));
    assert.ok(/gridTemplateColumns: "repeat\(3,minmax\(0,1fr\)\)"[^}]*\}\}>\s*<Tile/.test(OVERVIEW));
    assert.ok(!/repeat\(4,minmax\(0,1fr\)\)/.test(OVERVIEW), "no four-track row survives");
    assert.ok(!/<Tile[^>]*value=\{""\}|placeholder/i.test(tileRow()), "no empty placeholder tile");
  });

  it("35b. and the odd tile spans rather than sitting beside a gap at 620px", () => {
    // Three tiles in the shared utility's two columns leave one alone on the
    // last row. The convention is the app's own — .att-summary does exactly
    // this with its fifth card — and it is scoped to .fin-tiles because
    // .ov-grid is shared with the Dashboard's six-across strip.
    assert.ok(/\.fin-tiles>:last-child\{grid-column:1 \/ -1\}/.test(financeBlock()));
    const css = raw("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.ok(/\.ov-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important\}/.test(css),
      "the shared utility's mobile count is untouched");
    assert.ok(/className="ov-grid"/.test(read_dashboard()), "and the Dashboard still uses it unchanged");
    function read_dashboard() { return raw("src", "app", "(app)", "dashboard", "page.tsx"); }
  });
});

describe("Finance Overview · top performing classes", () => {
  const cls = (
    classId: string, className: string,
    knownCollected: number, knownOutstanding: number, amountsComplete = true
  ) => ({ classId, className, billed: 1_000_000, knownCollected, knownOutstanding, amountsComplete });

  it("36. ranks by confirmed collected money, highest first", () => {
    const ranked = rankByCollected([
      cls("c1", "Alpha", 300_000, 700_000),
      cls("c2", "Beta", 900_000, 100_000),
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c2", "c1"]);
  });

  it("37. a class with an unrecorded amount is RANKED, not exiled", () => {
    // It used to be dropped from the ranking and listed underneath with
    // `No data`, which said a class that had provably collected 300,000đ had no
    // figure at all. It is placed on what it can prove.
    const ranked = rankByCollected([
      cls("c1", "Alpha", 300_000, 0, false),
      cls("c2", "Beta", 900_000, 100_000),
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c2", "c1"]);
    assert.equal(ranked.length, 2, "every class is placed");
  });

  it("38. …on a FLOOR, and never on an invented zero or half", () => {
    // Its real collected total may be higher; it is never lower. Ranking it as
    // zero would bury a class that had collected almost everything, and that is
    // still not done — it is ranked on the money, not on the completeness.
    const ranked = rankByCollected([
      cls("c1", "Alpha", 700_000, 0, false),
      cls("c2", "Beta", 100_000, 900_000),
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c1", "c2"], "700,000 outranks 100,000");
  });

  it("39. and the screen marks a floor rather than presenting it as a total", () => {
    assert.ok(!/data-testid="fin-unrankable-class"/.test(OVERVIEW), "no second list any more");
    assert.ok(!/unknown\.map/.test(OVERVIEW));
    assert.ok(/!c\.amountsComplete && <span data-testid="fin-at-least"/.test(OVERVIEW));
    assert.ok(/fmt\.vnd\(c\.knownCollected\)/.test(OVERVIEW));
  });

  it("40. ranking is deterministic on ties", () => {
    const a = rankByCollected([cls("c2", "Beta", 500, 0), cls("c1", "Alpha", 500, 0)]);
    const b = rankByCollected([cls("c1", "Alpha", 500, 0), cls("c2", "Beta", 500, 0)]);
    assert.deepEqual(a.map((c) => c.classId), b.map((c) => c.classId));
    assert.deepEqual(a.map((c) => c.classId), ["c1", "c2"]);
  });

  it("41. revenue-by-class sorts by confirmed outstanding, highest first", () => {
    const sorted = sortByOutstanding([
      cls("c1", "Alpha", 500, 100),
      cls("c2", "Beta", 0, 0, false),
      cls("c3", "Gamma", 200, 900),
    ]);
    assert.deepEqual(sorted.map((c) => c.classId), ["c3", "c1", "c2"]);
    assert.equal(sorted.length, 3, "no class is dropped for being incomplete");
  });
});

describe("Finance Overview · the per-student class grid", () => {
  it("42. carries exactly the six columns the data supports", () => {
    for (const h of ["Student", "Monthly fee", "Paid", "Remaining", "Status", "Paid date"]) {
      assert.ok(OVERVIEW.includes(`t("${h}")`), h);
    }
  });

  it("43. Paid and Remaining are the server's collected and outstanding", () => {
    assert.ok(/money\(r\.collected, fmt, notRecorded\)/.test(OVERVIEW));
    assert.ok(/money\(r\.outstanding, fmt, notDetermined\)/.test(OVERVIEW));
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
      "Revenue, analytics and student payments for",
      "No revenue recorded for", "No billing records for",
      "No billing records match these filters for", "No outstanding tuition for",
      "Couldn't load finance", "collected", "paid", "partial", "unpaid",
      HISTORICAL_NOTE_ONE, HISTORICAL_NOTE_MANY,
      PARTIAL_NOTE_ONE, PARTIAL_NOTE_MANY,
      HISTORICAL_PARTIAL_ONE, HISTORICAL_PARTIAL_MANY,
      NO_BILLING_TITLE, NO_BILLING_BODY,
      NOT_RECORDED, NOT_DETERMINED, UNKNOWN_SEGMENT, BILL_ONE, BILL_MANY,
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
    assert.deepEqual(Object.keys(financeNoteStyle).sort(), ["color", "fontSize", "lineHeight"]);
    assert.equal(financeNoteStyle.color, "var(--muted-2)", "muted, like every other caption");
    assert.ok(!("cursor" in financeNoteStyle));
    assert.ok(!("textDecoration" in financeNoteStyle));

    const sites = [...OVERVIEW.matchAll(/data-testid="fin-historical-note"([\s\S]{0,400}?)<\/div>/g)];
    assert.equal(sites.length, 2, "both sites are readable");
    for (const [, body] of sites) {
      assert.ok(!/onClick|onKeyDown|onMouseDown|role=|tabIndex/.test(body), "no interaction");
      assert.ok(!/<button|<a\b/.test(body), "not a control");
      assert.ok(!/cursor: "pointer"/.test(body));
      assert.ok(!/textDecoration/.test(body));
      assert.ok(body.includes("financeNoteStyle"), "it reuses the one style");
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
    assert.ok(!/Deleted student|Unknown student|Former student/i.test(list![0]), "no placeholder person");
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
    assert.equal((OVERVIEW.match(/className="fin-tpc-label"/g) ?? []).length, 1, "one ranking list");
    assert.ok(/className="fin-tpc-label" style=\{\{ display: "none" \}\}>\{t\("Collected"\)\}/.test(OVERVIEW));
    assert.ok(/\.fin-tpc-label\{[\s\S]*?display:inline !important/.test(financeBlock()));
  });

  it("115. every class is ranked on the money it can prove", () => {
    // The mobile restack does not decide the ordering, and the ordering is now
    // one list: a class with an unrecorded amount is placed on its confirmed
    // collected total rather than removed from the ranking.
    const ranked = rankByCollected([
      { classId: "a", className: "A", billed: 10, knownCollected: 4, knownOutstanding: 6, amountsComplete: true },
      { classId: "b", className: "B", billed: 10, knownCollected: 0, knownOutstanding: 0, amountsComplete: false },
      { classId: "c", className: "C", billed: 10, knownCollected: 9, knownOutstanding: 1, amountsComplete: true },
    ]);
    assert.deepEqual(ranked.map((c) => c.classId), ["c", "a", "b"]);
    assert.ok(!/data-testid="fin-unrankable-class"/.test(OVERVIEW), "no second list");
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

/* =============================== Gate 6 — the known-amount money contract
 *
 * TWO ROUNDS OF PRODUCTION REVIEW GOT US HERE, and the second overturned the
 * first. Round one made `No data` unambiguous by splitting it in three: a real
 * `0đ`, an `Insufficient data` label, and an empty-month state. Round two found
 * the middle one was answering the wrong question — a month where 8,550,000đ
 * had demonstrably been collected reported nothing at all, because ONE bill of
 * 700,000đ had no recorded amount. Arithmetically defensible, useless to a
 * teacher, and it hid twelve knowable figures behind one unknowable one.
 *
 * The contract now reports the money it can stand behind and states the gap
 * separately:
 *
 *     knownCollected + knownOutstanding + unknownAmount === billed
 *
 * always, by construction. `unknownAmount` is the FEE of every bill whose split
 * nobody recorded — not a payment, not a debt, not an estimate of either.
 *
 * Nothing is inferred anywhere: no half, no zero substituted for an unknown, no
 * backfill. What changed is which true things are shown, not what is true.
 * ====================================================================== */

describe("Gate 6 · the aggregate identity", () => {
  it("124. the three parts always sum to billed", () => {
    // Asserted here as well as in tests/billing.test.ts because it is the
    // property the SCREEN depends on: a bar drawn from three widths that do not
    // total the whole is a picture of a month that does not add up.
    assert.ok(/knownCollected \+ knownOutstanding \+ unknownAmount === billed/.test(
      raw("src", "lib", "billing.ts")
    ), "the identity is stated where it is enforced");
    // And it is enforced by construction: each bill adds its fee to billed, and
    // then adds that same fee to exactly one of the three buckets.
    const src = code("src", "lib", "billing.ts");
    assert.ok(/billed \+= bill\.fee;/.test(src));
    assert.ok(/knownCollected \+= collected;/.test(src));
    assert.ok(/knownOutstanding \+= bill\.fee - collected;/.test(src));
    assert.ok(/unknownAmount \+= bill\.fee;/.test(src));
  });

  it("125. `amountsComplete` is exactly `unknownAmountBills === 0`", () => {
    const src = code("src", "lib", "billing.ts");
    assert.ok(/const amountsComplete = unknownAmountBills === 0;/.test(src));
    // Equality of the two known buckets with billed is guaranteed only then.
    assert.ok(/knownOutstanding \+= bill\.fee - collected;/.test(src));
    assert.ok(/unknownAmount \+= bill\.fee;/.test(src), "the whole fee, never a split");
  });

  it("126. a KNOWN ZERO is still `0đ`, and is not an unknown", () => {
    assert.equal(money(0, fmt, NOT_RECORDED), "0đ");
    assert.notEqual(money(0, fmt, NOT_RECORDED), NOT_RECORDED);
    assert.equal(percent(0, NOT_DETERMINED), "0%");
  });

  it("127. nothing is inferred — no half, no substitute zero, no backfill", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/fee\s*\/\s*2|\*\s*0\.5/.test(src), `${name} must infer no partial`);
    }
    const billing = code("src", "lib", "billing.ts");
    assert.ok(!/fee\s*\/\s*2|\*\s*0\.5/.test(billing), "and neither does the domain");
    assert.ok(!/paidAmount/.test(code("src", "lib", "calc.ts")), "the dead 50% helper stays deleted");
  });
});

describe("Gate 6 · the KPIs show the money that is known", () => {
  it("128. collected and outstanding are always real amounts", () => {
    // They used to be replaced wholesale by a label. Both now format a number
    // that the month can prove, at every level of completeness.
    assert.ok(/value=\{fmt\.vnd\(billing\.knownCollected\)\}/.test(OVERVIEW));
    assert.ok(/value=\{fmt\.vnd\(billing\.knownOutstanding\)\}/.test(OVERVIEW));
    assert.ok(!/money\(billing\.(?:collected|knownCollected)/.test(OVERVIEW), "no unknown branch left");
  });

  it("129. no aggregate anywhere is replaced by a label", () => {
    // The `Insufficient data` constant is deleted rather than left unused: an
    // exported label meaning "this total cannot be given" would invite exactly
    // the substitution this contract removed.
    assert.ok(!ALL_UI.includes("Insufficient data"), "the label is gone from the UI");
    assert.ok(!raw("src", "components", "finance", "finance-ui.ts").includes("INSUFFICIENT_DATA"));
    assert.ok(!raw("src", "lib", "i18n-vi.json").includes('"Insufficient data"'), "and from the dictionary");
    // Per-class figures too: the class card formats its own confirmed money.
    assert.ok(/fmt\.vnd\(c\.knownCollected\)/.test(OVERVIEW));
    assert.ok(/fmt\.vnd\(c\.knownOutstanding\)/.test(OVERVIEW));
  });

  it("130. EXPECTED stays exact and unbranched", () => {
    assert.ok(/value=\{fmt\.vnd\(billing\.billed\)\}/.test(OVERVIEW));
    assert.ok(!/money\(billing\.billed/.test(OVERVIEW), "Σ fee is never unknown");
  });

  it("131. `x of y bills paid` counts bills SETTLED IN FULL", () => {
    // A partial that moved real money does not raise x — its money is already
    // inside the figure above it. The caption is a statement about bills.
    assert.ok(/\$\{billing\.counts\.paid\} \$\{t\("of"\)\} \$\{billing\.counts\.total\} \$\{t\("bills paid"\)\}/.test(OVERVIEW));
    const src = code("src", "lib", "billing.ts");
    assert.ok(/if \(bill\.status === "Paid"\) counts\.paid\+\+;/.test(src));
    assert.equal((src.match(/counts\.paid\+\+/g) ?? []).length, 1, "incremented in one place only");
    assert.ok(/Partially Paid"\) counts\.partiallyPaid\+\+/.test(src), "a partial has its own counter");
    // And the caption is no longer replaced when amounts are incomplete: both
    // facts are true and they are shown as two lines, not one.
    assert.ok(/caption=\{`\$\{billing\.counts\.paid\}/.test(OVERVIEW));
    assert.ok(/note=\{<IncompleteNotes scope=\{billing\}/.test(OVERVIEW));
  });
});

describe("Gate 6 · the collection rate is not rendered at all", () => {
  it("132. no percentage of expected revenue reaches the screen", () => {
    // It was the Money Summary's fourth metric and earned its place least: a
    // percentage of expected revenue tells a teacher nothing they can act on,
    // and with one unrecorded partial it could not even be stated plainly —
    // it had to be shown as a floor with a sentence explaining the arithmetic.
    for (const [name, src] of UI_FILES) {
      assert.ok(!/collectionRate/.test(src), `${name} must not read the rate`);
      assert.ok(!/At least|Ít nhất/.test(src), `${name} must not render a floor percentage`);
      assert.ok(!/of expected collected|Based on recorded payment/.test(src), `${name}`);
    }
    assert.ok(!/data-testid="fin-rate"/.test(ALL_UI), "no rate value");
    assert.ok(!/data-testid="fin-rate-basis"/.test(ALL_UI), "no basis line");
  });

  it("133. and its copy is deleted, not left exported or in the dictionary", () => {
    // A label nothing renders is a label a future edit rediscovers and reuses.
    const helpers = raw("src", "components", "finance", "finance-ui.ts");
    assert.ok(!/export const AT_LEAST_PERCENT/.test(helpers));
    assert.ok(!/export const RATE_BASIS/.test(helpers));
    assert.ok(!/export function rateText/.test(helpers));
    const vi = raw("src", "lib", "i18n-vi.json");
    for (const key of ["At least {X}%", "Based on recorded payment amounts.", "of expected collected"]) {
      assert.ok(!vi.includes(`"${key}"`), `the dictionary must not keep "${key}"`);
    }
  });

  it("134. no dead slot, placeholder or disabled metric is left behind", () => {
    assert.ok(!/fin-metric-rate|fin-rate/.test(OVERVIEW));
    assert.ok(!/visibility: "hidden"|display: "none"[^}]*rate/i.test(OVERVIEW));
    assert.ok(!/disabled/.test(OVERVIEW), "nothing is drawn inert in its place");
    // …and the backend keeps the figure, deliberately. It is correct, cheap and
    // tested, and ripping it out of the domain to chase one UI decision this
    // late would be churn in the service contract for no gain.
    assert.ok(/collectionRate/.test(code("src", "lib", "billing.ts")), "the DTO still carries it");
    assert.ok(/collectionRate: number \| null;/.test(code("src", "lib", "billing.ts")));
  });
});

describe("Gate 6 · the Money summary is three metrics", () => {
  it("135. Collected, Outstanding and Partially paid — and nothing else", () => {
    const legend = /className="fin-summary-legend"[\s\S]*?\n        <\/div>/.exec(OVERVIEW);
    assert.ok(legend, "the metric row is readable");
    const metrics = [...legend[0].matchAll(/className="fin-metric"/g)];
    assert.equal(metrics.length, 4, "three, plus the Unknown slice when a month has one");
    assert.ok(/\{t\("Collected"\)\} <b/.test(legend[0]));
    assert.ok(/\{t\("Outstanding"\)\} <b/.test(legend[0]));
    assert.ok(/\{t\("Partially paid"\)\} <b/.test(legend[0]));
    assert.ok(!/collectionRate|At least/.test(legend[0]), "and no rate");
  });

  it("136. Partially paid is a COUNT of bills, never money", () => {
    // How many bills are stuck half-settled is a different question from how
    // much money they represent — and for the legacy ones that money is exactly
    // what nobody recorded, so a figure here would have to be invented.
    assert.ok(/billsLabel\(billing\.counts\.partiallyPaid, t\)/.test(OVERVIEW));
    assert.ok(/data-testid="fin-metric-partial"/.test(OVERVIEW));
    assert.equal(billsLabel(1, en), "1 bill");
    assert.equal(billsLabel(3, en), "3 bills");
    assert.equal(billsLabel(0, en), "0 bills");
    const vi = (x: string) => translate(x, "vi");
    assert.equal(billsLabel(1, vi), "1 hóa đơn");
    assert.equal(billsLabel(3, vi), "3 hóa đơn");
    // It is not formatted as VND, and it is not a percentage.
    assert.ok(!/fmt\.vnd\(billing\.counts/.test(OVERVIEW));
    assert.ok(!billsLabel(3, en).includes("đ"));
    assert.ok(!billsLabel(3, en).includes("%"));
    // The label is the app's existing one, not a new term.
    assert.equal(translate("Partially paid", "vi"), "Trả một phần");
    assert.equal(STATUS_LABEL["Partially Paid"], "Partially paid", "the same words the badge uses");
  });

  it("137. the layout says three, rather than being a row that lost one", () => {
    // A flex row that used to hold four would leave the three where they fell.
    assert.ok(/gridTemplateColumns: hasUnknownSlice \? "repeat\(4,minmax\(0,auto\)\)" : "repeat\(3,minmax\(0,auto\)\)"/.test(OVERVIEW));
    assert.ok(/display: "grid"/.test(OVERVIEW));
  });
});

describe("Gate 6 · the proportion bar has a third segment", () => {
  it("138. it is always drawn, and it always adds up", () => {
    // It used to disappear entirely when one amount was missing, leaving a
    // blank track where four fifths of a real proportion could have been.
    assert.ok(/barWidth\(billing\.knownCollected, billing\.billed\)/.test(OVERVIEW));
    assert.ok(/barWidth\(billing\.knownOutstanding, billing\.billed\)/.test(OVERVIEW));
    assert.ok(/barWidth\(billing\.unknownAmount, billing\.billed\)/.test(OVERVIEW));
    assert.ok(!/proportionKnown/.test(OVERVIEW), "no all-or-nothing branch survives");
  });

  it("139. the third segment is neutral, not an alarm", () => {
    const seg = /data-testid="fin-bar-unknown"[^/]*\/>/.exec(OVERVIEW);
    assert.ok(seg, "the segment is readable");
    assert.ok(/var\(--muted-2\)/.test(seg[0]), "muted");
    assert.ok(!/var\(--accent\)|var\(--amber\)|red|danger/i.test(seg[0]), "not a warning colour");
  });

  it("140. and it earns a legend entry only when there is a slice to name", () => {
    // Keyed on the AMOUNT, not on the record count: barWidth returns "0%" for a
    // zero part, which is truthy, so a month whose unrecorded bills happened to
    // total nothing would otherwise draw a segment for a slice that is not there.
    assert.ok(/const hasUnknownSlice = billing\.unknownAmount > 0;/.test(OVERVIEW));
    assert.ok(/unknownW = hasUnknownSlice \? barWidth/.test(OVERVIEW));
    assert.ok(/\{hasUnknownSlice && \(\s*<div className="fin-metric" data-testid="fin-legend-unknown"/.test(OVERVIEW));
    assert.ok(OVERVIEW.includes("t(UNKNOWN_SEGMENT)"));
    assert.ok(/fmt\.vnd\(billing\.unknownAmount\)/.test(OVERVIEW), "labelled with its own amount");
    assert.equal(UNKNOWN_SEGMENT, "Unknown");
    // The bar itself survives the rate's removal: it decomposes the billed
    // total, which is a different job from scoring the month out of 100.
    assert.ok(/data-testid="fin-bar-unknown"/.test(OVERVIEW));
  });
});

describe("Gate 6 · why a scope is incomplete, in the teacher's words", () => {
  it("141. two counts, because they are two different situations", () => {
    // An unrecorded partial for a student who still exists is something a
    // teacher can go and settle. The same gap on a record whose student is gone
    // is closed history. Same defect, different sentence.
    assert.equal(PARTIAL_NOTE_MANY, "{N} partial payments do not have a recorded amount.");
    assert.equal(HISTORICAL_PARTIAL_MANY, "{N} historical payments do not have a recorded amount.");
    assert.equal(partialNote(2, en), "2 partial payments do not have a recorded amount.");
    assert.equal(historicalPartialNote(2, en), "2 historical payments do not have a recorded amount.");
    assert.equal(partialNote(1, en), "1 partial payment does not have a recorded amount.");
    assert.equal(historicalPartialNote(1, en), "1 historical payment does not have a recorded amount.");
    assert.notEqual(PARTIAL_NOTE_MANY, HISTORICAL_PARTIAL_MANY);
  });

  it("142. the split comes from the service, not from the screen", () => {
    const billing = code("src", "lib", "billing.ts");
    assert.ok(/unknownLiveAmountBills/.test(billing));
    assert.ok(/unknownHistoricalAmountBills/.test(billing));
    assert.ok(/if \(resolvedStudentIds\.has\(b\.studentId\)\) unknownLiveAmountBills\+\+;/.test(billing));
    assert.ok(/else unknownHistoricalAmountBills\+\+;/.test(billing));
    assert.ok(/if \(!hasUnknownAmount\(b\)\) continue;/.test(billing), "only unrecorded partials count");
    // The UI reads the counts and derives neither.
    assert.ok(!/(?:const|let|var)\s+unknownLiveAmountBills/.test(ALL_UI));
  });

  it("143. it never claims to know WHY a student is missing", () => {
    // Deleted, stopped studying, waived, cleaned up — the model proves none of
    // them, so no copy asserts any of them.
    for (const claim of [
      "stopped studying", "no longer enrolled", "waived", "exempt", "dropped out",
      "left the class", "deleted",
    ]) {
      assert.ok(!ALL_UI.toLowerCase().includes(claim), `must not claim "${claim}"`);
      assert.ok(!HISTORICAL_PARTIAL_MANY.toLowerCase().includes(claim));
      assert.ok(!HISTORICAL_NOTE_MANY.toLowerCase().includes(claim));
    }
    assert.ok(!raw("src", "lib", "i18n-vi.json").includes("nghỉ học"), "nor in Vietnamese");
  });

  it("144. one component renders both, muted and inert, never at zero", () => {
    assert.ok(/function IncompleteNotes/.test(OVERVIEW), "one definition");
    // Sliced to the next top-level declaration: the component's own parameter
    // type ends with a line-initial "}", so a lazy match on that stops at the
    // signature and proves nothing about the body.
    const at = OVERVIEW.indexOf("function IncompleteNotes");
    assert.ok(at > 0);
    const body = OVERVIEW.slice(at, OVERVIEW.indexOf("\nconst cardStyle", at) + 1 || undefined)
      .slice(0, OVERVIEW.slice(at).indexOf("\n\n") + 1 || undefined);
    assert.ok(/scope\.unknownLiveAmountBills === 0 && scope\.unknownHistoricalAmountBills === 0\) return null/.test(body),
      "nothing is drawn when there is nothing to explain");
    assert.ok(body.includes("financeNoteStyle"), "the one neutral caption style");
    assert.ok(!/onClick|role=|tabIndex|cursor: "pointer"|<button|<a\b/.test(body), "inert");
    assert.ok(!/var\(--accent\)|var\(--amber\)|Warning|Error/i.test(body), "not an alarm");
    assert.equal(financeNoteStyle.color, "var(--muted-2)");
  });

  it("145. it appears beside every figure it qualifies", () => {
    // Both KPI cards, the money summary, and a class's expanded detail.
    assert.ok((OVERVIEW.match(/<IncompleteNotes scope=/g) ?? []).length >= 4);
    assert.ok(/<IncompleteNotes scope=\{scope\}/.test(OVERVIEW), "the per-class detail");
  });
});

describe("Gate 6 · per-student rows name the two missing facts", () => {
  it("146. Paid says nothing was recorded; Remaining says it cannot be worked out", () => {
    assert.equal(NOT_RECORDED, "Not recorded");
    assert.equal(NOT_DETERMINED, "Not determined");
    assert.ok(/money\(r\.collected, fmt, notRecorded\)/.test(OVERVIEW));
    assert.ok(/money\(r\.outstanding, fmt, notDetermined\)/.test(OVERVIEW));
    const vi = (x: string) => translate(x, "vi");
    assert.equal(vi(NOT_RECORDED), "Chưa ghi nhận");
    assert.equal(vi(NOT_DETERMINED), "Chưa xác định");
    assert.notEqual(vi(NOT_RECORDED), vi(NOT_DETERMINED), "a cause is not its consequence");
  });

  it("147. and a complete row still shows its exact split", () => {
    // Paid → fee / 0, Unpaid → 0 / fee, known partial → amount / fee-amount.
    // Read out of the pure helpers the row is built from.
    const billing = code("src", "lib", "billing.ts");
    assert.ok(/case "Paid":\s*return bill\.fee;|status === "Paid"[\s\S]{0,60}bill\.fee/.test(billing));
    assert.ok(/collected === null \? null : bill\.fee - collected/.test(billing));
    assert.equal(money(0, fmt, NOT_RECORDED), "0đ", "a settled row's Remaining is a real zero");
  });

  it("148. an outstanding row's unknown amount is field-specific too", () => {
    assert.ok(/money\(s\.amount, fmt, notDetermined\)/.test(OVERVIEW));
  });
});

describe("Gate 6 · a month with no billing records", () => {
  it("149. it gets an explicit empty state, not a screen of zeroes", () => {
    assert.ok(/if \(billingState\(billing\) === "empty"\)/.test(OVERVIEW));
    assert.ok(/data-testid="fin-billing-empty"/.test(OVERVIEW));
    assert.ok(OVERVIEW.includes("t(NO_BILLING_TITLE)"));
    assert.ok(OVERVIEW.includes("t(NO_BILLING_BODY)"));
    assert.equal(NO_BILLING_TITLE, "No tuition data for this month");
    assert.equal(NO_BILLING_BODY, "There are no billing records for this month yet.");
    assert.equal(billingState({ counts: { total: 0 }, unknownAmountBills: 0 }), "empty");
    assert.equal(billingState({ counts: { total: 14 }, unknownAmountBills: 1 }), "insufficient");
    assert.equal(billingState({ counts: { total: 14 }, unknownAmountBills: 0 }), "known");
  });

  it("150. and NOTHING else is on it — the lesson-revenue tile is gone", () => {
    // It was left there on the reasoning that lessons were taught even where no
    // bill was raised. On a screen with nothing else on it that tile is not
    // context, it is a lone unexplained figure under an empty state.
    const empty = /if \(billingState\(billing\) === "empty"\)[\s\S]*?^  \}/m.exec(OVERVIEW);
    assert.ok(empty, "the empty branch is readable");
    assert.ok(!/LessonRevenueTile/.test(empty[0]), "no lesson-revenue tile beneath it");
    assert.ok(!/partialNote|IncompleteNotes|unknownAmountBills/.test(empty[0]), "and no incomplete note");
    assert.ok(!/fin-historical-note/.test(empty[0]));
    assert.ok(!/Everyone has paid|No outstanding tuition/.test(empty[0]), "and no false reassurance");
    // The tile still exists for months that have billing beside it.
    assert.equal((OVERVIEW.match(/<LessonRevenueTile /g) ?? []).length, 1);
    assert.ok(/function LessonRevenueTile/.test(OVERVIEW));
  });

  it("151. the Payments tab tells its two empty reasons apart", () => {
    assert.ok(/const monthIsEmpty = billingState\(data\.billing\) === "empty"/.test(PAYMENTS));
    assert.ok(/monthIsEmpty \? t\(NO_BILLING_TITLE\) : t\("No payment records"\)/.test(PAYMENTS));
    assert.ok(/No billing records match these filters for/.test(PAYMENTS), "the filter case survives");
  });
});

describe("Gate 6 · Billing and Revenue stay separate", () => {
  it("152. the Revenue analytics empty state is untouched", () => {
    assert.ok(/data-testid="fin-revenue-empty"/.test(ANALYTICS));
    assert.ok(ANALYTICS.includes('t("No revenue recorded for")'));
    assert.ok(ANALYTICS.includes('t("Complete lessons to start tracking revenue for this month.")'));
    assert.ok(/revenue\.total <= 0/.test(ANALYTICS), "and it keys on revenue, not on bills");
  });

  it("153. no Billing copy leaks into Revenue analytics", () => {
    for (const key of [
      NO_BILLING_TITLE, NO_BILLING_BODY, NOT_RECORDED, NOT_DETERMINED,
      PARTIAL_NOTE_ONE, PARTIAL_NOTE_MANY, UNKNOWN_SEGMENT,
    ]) {
      assert.ok(!ANALYTICS.includes(key), `Revenue analytics must not say "${key}"`);
    }
    assert.ok(!/billingState|unknownAmountBills|knownCollected|billing\./.test(ANALYTICS));
    assert.ok(/emptyLabel=\{t\("No data"\)\}/.test(ANALYTICS), "it keeps its own generic label");
  });
});

describe("Gate 6 · the mobile Money summary is a stack, not a wrap", () => {
  it("154. one metric per row, and the column count is what changes", () => {
    // The component declares the grid and its own desktop track count, so the
    // mobile rule overrides exactly one thing. Wrapping is deliberately not the
    // mechanism at either width: what wraps is whatever happens not to fit, so
    // two short metrics share a line and the split changes with the language.
    const rule = /\.fin-summary-legend\{([^}]*)\}/.exec(financeBlock());
    assert.ok(rule, "the legend is restacked at 620px");
    assert.ok(/grid-template-columns:minmax\(0,1fr\) !important/.test(rule[1]), "exactly one column");
    assert.ok(!/flex-wrap:wrap/.test(rule[1]), "not a wrap-based layout");
    assert.ok(!/flexWrap: "wrap"/.test(/className="fin-summary-legend"[\s\S]{0,400}/.exec(OVERVIEW)![0]),
      "and the desktop declaration does not wrap either");
  });

  it("155. every metric is addressable as its own block", () => {
    // Collected, Outstanding, Partially paid, and Unknown where a month has a
    // slice: each is a .fin-metric, so no two can share a row by accident.
    assert.ok(financeBlock().includes(".fin-metric"), "the hook is styled at the breakpoint");
    const metrics = (OVERVIEW.match(/className="fin-metric"/g) ?? []).length;
    assert.equal(metrics, 4, "collected, outstanding, partially paid, unknown");
  });

  it("156. and it introduces no overflow workaround", () => {
    const block = financeBlock();
    assert.ok(!/overflow-x/.test(block), "still no fourth scroll region");
    assert.ok(!/100vw/.test(block));
    assert.equal([...ALL_UI.matchAll(/overflowX: "auto"/g)].length, 3, "still exactly three");
  });
});

describe("Gate 6 · what did not change", () => {
  it("157. no Billing arithmetic is done in the browser", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/knownCollected\s*\+\s*knownOutstanding|billed\s*-\s*known/.test(src), `${name} recomputes nothing`);
    }
    assert.ok(!/(?:const|let|var)\s+unknownAmountBills\s*=/.test(ALL_UI));
    assert.ok(!/unknownAmountBills\s*\+\+/.test(ALL_UI));
  });

  it("158. no mutation, no dashboard, no clock — still", () => {
    for (const [name, src] of UI_FILES) {
      assert.ok(!/\/api\/finance\/\$\{|method: "PATCH"/.test(src), `${name} must not mutate`);
      assert.ok(!/api\/dashboard/.test(src), `${name} must not call the writing endpoint`);
      assert.ok(!src.includes("new Date"), `${name} must not construct a Date`);
    }
  });

  it("159. the stored statuses and the write rules are untouched", () => {
    assert.equal(STATUS_LABEL["Partially Paid"], "Partially paid");
    assert.equal(STATUS_LABEL["Paid"], "Paid");
    assert.equal(STATUS_LABEL["Unpaid"], "Unpaid");
    const billing = code("src", "lib", "billing.ts");
    assert.ok(/"amount-required"/.test(billing), "a new partial still requires its amount");
    assert.ok(/"amount-out-of-range"/.test(billing), "strictly between zero and the fee");
    // A row with no recorded amount is still Partially Paid, with its stored date.
    assert.ok(/statusBadgeStyle\(r\.status\)/.test(OVERVIEW));
    assert.ok(/r\.paidDate \? fmt\.dateLabel\(r\.paidDate\)/.test(OVERVIEW));
  });

  it("160. the two deferred decisions are written down, not left in a transcript", () => {
    const billing = raw("src", "lib", "billing.ts");
    assert.ok(/Amount paid/.test(billing), "the future payment form's contract");
    assert.ok(/READ-ONLY remaining figure/.test(billing));
    assert.ok(/billingApplicability: "Billable" \| "Waived"/.test(billing), "the waiver deferral");
    assert.ok(/must not be overloaded/.test(billing), "and why Unpaid may not stand in for it");
    // Waived is not in the model, and no status was added for it.
    assert.ok(!/"Waived"/.test(code("src", "lib", "types.ts")), "no Waived status shipped");
  });

  it("161. every new key is translated", () => {
    const vi = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;
    const expected: Record<string, string> = {
      [NOT_RECORDED]: "Chưa ghi nhận",
      [NOT_DETERMINED]: "Chưa xác định",
      [UNKNOWN_SEGMENT]: "Chưa xác định",
      [BILL_ONE]: "hóa đơn",
      [BILL_MANY]: "hóa đơn",
      [HISTORICAL_PARTIAL_MANY]: "Có {N} khoản thanh toán lịch sử chưa ghi nhận số tiền.",
      [PARTIAL_NOTE_MANY]: "Có {N} khoản thanh toán một phần chưa ghi nhận số tiền.",
    };
    for (const [k, v] of Object.entries(expected)) assert.equal(vi[k], v, k);
    // The placeholder survives translation; it is filled afterwards.
    assert.ok(vi[HISTORICAL_PARTIAL_MANY].includes("{N}"));
    // And "Partially paid" is reused, not reinvented as a Finance-only term.
    assert.equal(vi["Partially paid"], "Trả một phần");
  });
});

describe("Gate 6 · the month control on a phone", () => {
  it("162. it gets a row of its own under the title", () => {
    // The heading is a space-between row. On a phone the title took the width
    // it needed and the control kept its 150px floor in whatever was left,
    // pinned to the top-right corner — a desktop affordance shrunk rather than
    // a mobile one, with the smallest tap target where the thumb reaches last.
    assert.ok(/className="fin-head"/.test(PAGE), "the heading is addressable");
    assert.ok(/className="fin-head-controls"/.test(PAGE));
    const block = financeBlock();
    assert.ok(/\.fin-head-controls\{[^}]*flex:1 0 100% !important/.test(block), "a full-width row of its own");
  });

  it("163. and the select fills that row's content width", () => {
    // A two-track grid — 1fr for the select, auto for the refresh button — so
    // the select takes the width the content column has rather than whatever
    // the button leaves over.
    const block = financeBlock();
    assert.ok(/\.fin-head-controls\{[^}]*display:grid !important/.test(block));
    assert.ok(/\.fin-head-controls\{[^}]*grid-template-columns:minmax\(0,1fr\) auto !important/.test(block));
    assert.ok(/\.fin-month\{min-width:0 !important\}/.test(block), "it may shrink past its 150px floor");
    assert.ok(/className="fin-month"/.test(PAGE));
  });

  it("164. 100% of the CONTENT column, never the viewport", () => {
    // A viewport width inside .app-main's padding pushes the page wider than
    // the phone, which is the one thing the responsive pass exists to prevent.
    assert.ok(!/100vw/.test(financeBlock()));
    assert.ok(!/100vw/.test(ALL_UI));
    assert.ok(!/overflow-x/.test(financeBlock()), "and it grows no scroll region");
    assert.equal([...ALL_UI.matchAll(/overflowX: "auto"/g)].length, 3, "still exactly three");
  });

  it("165. the duplicated label goes, the accessible name stays", () => {
    assert.ok(/className="fin-head-month-label"/.test(PAGE));
    assert.ok(/\.fin-head-month-label\{display:none !important\}/.test(financeBlock()));
    // The Select keeps the same ariaLabel at every width, so what is hidden is
    // a second visible copy of the name, not the name.
    assert.ok(/ariaLabel=\{t\("Month"\)\}/.test(PAGE));
    assert.equal((PAGE.match(/<Select\b/g) ?? []).length, 1, "one month selector, rendered once");
  });

  it("166. desktop and tablet keep the compact arrangement", () => {
    // Every rule is inside the 620px block (see the breakpoint contract), and
    // the inline desktop declaration is untouched: the same flex row, the same
    // 150px floor, the same right-hand alignment.
    assert.ok(/<div className="fin-head" style=\{\{ display: "flex", alignItems: "flex-end", justifyContent: "space-between"/.test(PAGE));
    assert.ok(/className="fin-month" style=\{\{ minWidth: 150 \}\}/.test(PAGE));
    const css = raw("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const q of ["(max-width:1100px)", "(max-width:860px) and (min-width:621px)"]) {
      const start = css.indexOf(`@media ${q}{`);
      let depth = 0, i = start + `@media ${q}`.length;
      for (; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) break;
      }
      assert.ok(!css.slice(start, i).includes(".fin-"), `${q} must not style Finance`);
    }
  });

  it("167. it is a LAYOUT change and nothing else", () => {
    // Same one Select, same server-supplied window, same handler. No browser
    // clock appeared, and no second month implementation came with it.
    assert.ok(/data\?\.months/.test(PAGE), "the window is still the payload's");
    assert.ok(/months\.map\(\(m\) => \(\{ value: m/.test(PAGE));
    assert.ok(/onChange=\{setMonth\}/.test(PAGE));
    for (const [name, src] of UI_FILES) {
      assert.ok(!src.includes("new Date"), `${name} must not construct a Date`);
      assert.ok(!src.includes("Date.now"), `${name} must not read a wall clock`);
      assert.ok(!src.includes("getMonth"), `${name} must not derive a month`);
    }
    assert.ok(!/FINANCE_MONTHS|monthWindow|buildMonths/.test(ALL_UI), "no second window implementation");
  });
});
