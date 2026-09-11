/* Sprint 13 Gate 4 — the Student Profile Attendance TAB.
 *
 * Run with:  npm test
 *
 * THIS SUITE IS ABOUT THE SCREEN. The read model's arithmetic is proved by
 * tests/student-attendance.test.ts, which executes it; what has to be checked
 * here is different and mostly cannot be executed, because the component is a
 * client module with React Query and next/navigation at the top and the runner
 * cannot import it. So the contract is SCANNED, the technique every UI suite in
 * this repository uses — and the scans are written to name what would actually
 * go wrong rather than to describe what the file happens to contain.
 *
 * THE POSITIVE ASSERTION LANDS HERE. Gate 2.1 banked the bounded-branch guard in
 * tests/reviews-ui.test.ts #83 and deliberately left the positive half unwritten,
 * because at contract-banking time no branch existed to assert. Section 1 is that
 * half, made in the gate that makes it true: Attendance branches, Homework does
 * NOT yet, and Classes and Finance never will.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
/* EXECUTED, not scanned: #45 runs the shipped formatter so "no records" and
 * "attended nothing" are proved distinct rather than asserted to be. */
import { rateLabel } from "../src/components/attendance/attendance-ui";

function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
function code(...parts: string[]): string {
  return raw(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TAB = code("src", "components", "attendance", "student-attendance.tsx");
const TAB_RAW = raw("src", "components", "attendance", "student-attendance.tsx");
const PROFILE = code("src", "app", "(app)", "students", "[id]", "page.tsx");
const API = code("src", "components", "attendance", "api.ts");
const CSS = raw("src", "app", "globals.css");
const VI = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* =========================================================================
 * 1. The positive branch contract — Gate 2.1's unwritten half
 * ====================================================================== */

describe("Student Profile — the Attendance branch now exists", () => {
  it("1. Attendance has its own branch, and renders the component", () => {
    assert.ok(PROFILE.includes('tab === "Attendance" ? ('), "the branch Gate 2.1 left unwritten");
    assert.ok(PROFILE.includes("<StudentAttendance studentId={id} />"), "and it renders the tab component");
    assert.ok(
      PROFILE.includes('import { StudentAttendance } from "@/components/attendance/student-attendance"'),
      "imported from the Attendance module, which owns the data"
    );
  });

  it("2. Homework now has its own branch too — Gate 5 built it", () => {
    /* This clause was the inverse in Gate 4 ("Homework does NOT yet have a
     * branch"), and it was retired in the gate that made it false. What it
     * protected has not changed: the owned set is bounded, and #3 below still
     * proves the two tabs that must NEVER branch do not. */
    assert.ok(PROFILE.includes('tab === "Homework" ? ('), "the Homework branch exists");
    assert.ok(PROFILE.includes("<StudentHomework studentId={id} />"), "and renders its component");
  });

  it("3. Classes and Finance never gain a branch", () => {
    /* Not "not yet": the imported design supplies them no tab body at all, so
     * under Missing UI Specification they are permanent fallbacks. */
    for (const unowned of ["Classes", "Finance"]) {
      assert.ok(!PROFILE.includes(`tab === "${unowned}"`), `${unowned} has no design and must never branch`);
    }
  });

  it("4. the fallback panel survives, and the tab list is untouched", () => {
    assert.ok(PROFILE.includes('t("arrives in a later sprint")'), "the comp's own later-sprint panel");
    assert.equal(
      [...PROFILE.matchAll(/const TABS = \["Overview", "Attendance", "Homework", "Reviews", "Classes", "Finance"\]/g)].length,
      1, "six entries, in the comp's order, unchanged"
    );
    assert.ok(PROFILE.includes('tab === "Overview" ? ('), "Overview still branches first");
    assert.ok(PROFILE.includes('tab === "Reviews" ? ('), "Reviews still branches");
  });

  it("5. the branch set is exactly the tabs a sprint has shipped", () => {
    /* The same bounded shape tests/reviews-ui.test.ts #83 states, asserted here
     * from the other side: #83 bounds what MAY branch, this pins what DOES. */
    const branched = [...PROFILE.matchAll(/tab === "([A-Za-z]+)" \? \(/g)].map((m) => m[1]);
    assert.deepEqual(branched, ["Overview", "Reviews", "Attendance", "Homework"],
      "four tabs branch, and that is the final count");
  });

  it("6. the page gained no attendance RULE of its own", () => {
    /* INVERTED IN GATE 6.3, DELIBERATELY, AND IN THE GATE THAT MADE IT FALSE.
     *
     * As banked in Gate 4 this also forbade `attendanceKeys`,
     * `fetchStudentAttendance` and `rateLabel`, because at that point the page
     * had no business knowing the tab existed. Gate 6.3 gave the Overview tile
     * the authoritative figure — it had been rendering the stale stored
     * `Student.attendance` beside the tab's derived one — and doing that means
     * naming the module's own reader and key. That is a READER and a FORMATTER,
     * not a rule.
     *
     * WHAT THIS GUARD HAS ALWAYS PROTECTED IS UNCHANGED: the page knows no
     * attendance SEMANTICS. It cannot name a status, cannot reach the endpoint
     * except through the module's client, and cannot carry the counting rule or
     * the status colours. Those clauses are the original, word for word. */
    for (const forbidden of [
      "/api/attendance",
      "Present", "Excused", "ATTENDANCE_COLORS", "ATTENDANCE_DISPLAY_ORDER",
      "studentAttendanceRate", "Math.round",
    ]) {
      assert.ok(!PROFILE.includes(forbidden), `${forbidden} belongs to the tab, not the page`);
    }
    /* And the positive half of the same invariant: what the page DOES hold is the
     * module's own reader, on the tab's own key, formatted by the shared helper —
     * never a second copy of any of the three. */
    assert.ok(PROFILE.includes("attendanceKeys.student(id)"));
    assert.ok(PROFILE.includes("fetchStudentAttendance(id)"));
    assert.ok(PROFILE.includes("rateLabel("));
  });
});

/* =========================================================================
 * 2. The tab consumes the server read model and derives nothing
 * ====================================================================== */

describe("Attendance tab — one endpoint, no client arithmetic", () => {
  it("7. it calls the Gate 3 endpoint through the module's own fetcher", () => {
    assert.ok(API.includes("/api/attendance/student/${studentId}"), "the client names the endpoint once");
    assert.ok(TAB.includes("fetchStudentAttendance(studentId)"));
    assert.ok(TAB.includes("attendanceKeys.student(studentId)"));
    /* `\b` matters: `refetch(` is the retry button and is legitimate. What must
     * not appear is a bare `fetch(` — the tab requesting on its own instead of
     * through the module's one named fetcher. */
    assert.ok(!/\bfetch\(/.test(TAB), "the tab never opens a request itself");
  });

  it("8. the query key sits under [\"attendance\"], not under [\"students\"]", () => {
    /* So marking a register refreshes an open profile tab, and renaming a student
     * does not refetch their whole attendance history. */
    assert.ok(API.includes('student: (studentId: string) => ["attendance", "student", studentId] as const'));
  });

  it("9. NO DOMAIN FIGURE IS RECOMPUTED IN THE BROWSER", () => {
    /* The rate, the monthly rates, the counts and all three lists are the
     * server's answers. A second copy of any of those rules here is how one fact
     * becomes two numbers across two tabs. */
    for (const forbidden of ["Math.round", "reduce(", "filter(", "sort(", "/ 100", "* 100"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden}: the tab must not derive domain values`);
    }
    /* Status equality DOES appear, and legitimately: it chooses which of the
     * four server-supplied counts a tile shows, exactly as the shipped
     * Attendance index does. What matters is that it selects rather than
     * counts — so every one of those comparisons must resolve to a
     * `data.counts.*` read and never to an accumulation. */
    for (const m of TAB.matchAll(/status === "(\w+)"/g)) {
      const after = TAB.slice((m.index ?? 0), (m.index ?? 0) + 220);
      assert.ok(after.includes("data.counts."), `${m[1]}: must select a server count, not compute one`);
    }
  });

  it("10. it reads the payload's own fields rather than rebuilding them", () => {
    for (const field of [
      "data.rate", "data.counts", "data.monthly", "data.timeline",
      "data.absences", "data.lates", "data.hasRecords",
    ]) {
      assert.ok(TAB.includes(field), `${field} is consumed as supplied`);
    }
  });

  it("11. the timeline is rendered in the order it arrives", () => {
    assert.ok(/data\.timeline\.map\(/.test(TAB), "mapped straight, never sorted");
    assert.ok(!/data\.timeline[\s\S]{0,40}\.sort\(/.test(TAB));
  });
});

/* =========================================================================
 * 3. States — loading, error, empty, and the three that must not blur
 * ====================================================================== */

describe("Attendance tab — its four states stay distinct", () => {
  it("12. loading renders a skeleton, inside the tab, with no values", () => {
    assert.ok(TAB.includes("if (isLoading) return <SkeletonTab />;"));
    assert.ok(TAB.includes("function SkeletonTab()"));
    const skeleton = TAB.slice(TAB.indexOf("function SkeletonTab()"));
    /* `\b` matters here too: "200%" in the shimmer gradient contains "0%" but is
     * a background size, not a figure. A standalone 0% is what must never show. */
    assert.ok(!/\b0%/.test(skeleton), "a skeleton must not show 0%");
    assert.ok(!skeleton.includes("rateLabel"), "and renders no rate at all");
    assert.ok(!skeleton.includes("data."), "and cannot read data it does not have");
    assert.ok(skeleton.includes('aria-hidden="true"'), "decorative shimmer is not announced");
  });

  it("13. loading holds the loaded layout, so revealing data does not move the tablist", () => {
    assert.equal([...TAB.matchAll(/className="sp-split"/g)].length, 2,
      "the skeleton and the loaded tab use the same split");
  });

  it("14. error is inline, retryable, and NEVER an empty analytics shell", () => {
    assert.ok(TAB.includes("if (isError || !data)"));
    assert.ok(TAB.includes('t("Couldn\'t load attendance")'));
    assert.ok(TAB.includes("onClick={() => refetch()}"), "a retry path, as the Reviews tab has");
    assert.ok(TAB.includes('t("Try again")'));
    /* The failure branch returns before anything else is drawn, so a failed
     * request cannot be rendered as "this student has no attendance" — a claim
     * about their record rather than about the network. */
    assert.ok(
      TAB.indexOf("if (isError || !data)") < TAB.indexOf("if (!data.hasRecords)"),
      "error is decided before empty"
    );
    assert.ok(!TAB.includes("?? []"), "no fallback empty list papers over a failure");
  });

  it("15. the whole-tab empty state is the comp's, and is the server's verdict", () => {
    assert.ok(TAB.includes("if (!data.hasRecords)"), "the server decides what empty means");
    assert.ok(TAB.includes('t("No attendance recorded for this student yet.")'));
    assert.ok(TAB.includes('border: "1px dashed var(--border)"'), "the comp's dashed empty panel");
    /* It RETURNS. Nothing partial is drawn beside it — no headline, no chart, no
     * timeline over a student with no record. */
    const empty = TAB.slice(TAB.indexOf("if (!data.hasRecords)"));
    assert.ok(empty.indexOf("return (") < empty.indexOf("sp-split"), "the empty state returns early");
  });

  it("16. a null rate is never printed as 0%", () => {
    /* `rateLabel` is the shared helper that renders `null` as the app's em dash.
     * The tab must go through it for BOTH the headline and every month. */
    assert.ok(TAB.includes("rateLabel(data.rate)"), "the headline figure");
    assert.ok(TAB.includes("rateLabel(m.rate)"), "and every monthly point");
    /* One template literal builds "<n>%" from a rate, and it is the BAR HEIGHT —
     * a CSS length, not a figure anybody reads. Pinning it exactly is what keeps
     * this guard honest: a second one would be a displayed percentage that never
     * went through `rateLabel`, which is exactly how 0% comes back for a null
     * month. */
    const pctTemplates = [...TAB.matchAll(/\$\{[^}]*rate[^}]*\}%/g)].map((m) => m[0]);
    assert.deepEqual(pctTemplates, ["${m.rate ?? 0}%"], "the only one is the bar's CSS height");
    assert.ok(!TAB.includes('"0%"') && !TAB.includes("'0%'"), "0% is never a literal");
  });
});

/* =========================================================================
 * 4. What the tab draws
 * ====================================================================== */

describe("Attendance tab — the comp's own content", () => {
  it("17. the four counts use the shared order and the shared colours", () => {
    assert.ok(TAB.includes("ATTENDANCE_DISPLAY_ORDER.map"), "Present, Late, Absent, Excused");
    assert.ok(TAB.includes("ATTENDANCE_COLORS[status]"));
    for (const c of ["data.counts.present", "data.counts.late", "data.counts.absent", "data.counts.excused"]) {
      assert.ok(TAB.includes(c), `${c} is rendered`);
    }
  });

  it("18. colour is never the only signal — every status is also named", () => {
    assert.ok(TAB.includes("{t(status)}"), "the four tiles carry their labels");
    assert.ok(TAB.includes("{t(e.status)}"), "timeline rows name their status");
    assert.ok(TAB.includes("{t(a.status)}"), "absence rows name theirs");
    assert.ok(TAB.includes("function badgeStyle(status: AttendanceStatus)"), "a pill, not a bare colour");
  });

  it("19. six monthly points render in the order supplied, with text values", () => {
    assert.ok(TAB.includes("data.monthly.map"), "no slicing, no re-ordering, no padding");
    assert.ok(TAB.includes("fmt.monthShort(m.month)"), "each bar is labelled with its month");
    assert.ok(TAB.includes("rateLabel(m.rate)"), "and with its value, as text");
  });

  it("20. a null month draws the minimum stub and claims nothing", () => {
    assert.ok(TAB.includes("height: `${m.rate ?? 0}%`"), "no height for no value");
    assert.ok(TAB.includes("minHeight: 4"), "the design's own minimum stub");
  });

  it("21. the chart's bars are decoration, and are not announced twice", () => {
    /* Every figure the bars encode is already written underneath in text, so the
     * bar row is hidden from assistive technology rather than read out as noise. */
    const chart = TAB.slice(TAB.indexOf("data.monthly.map"));
    assert.ok(chart.indexOf('aria-hidden="true"') < chart.indexOf("rateLabel(m.rate)"),
      "the bar is hidden, the text value is not");
    assert.ok(!TAB.includes("recharts") && !TAB.includes("chart.js") && !TAB.includes("d3"),
      "no chart library — the comp's own lightweight approach");
  });

  it("22. timeline rows carry class, status and the lesson's date", () => {
    assert.ok(TAB.includes("{e.className}"));
    assert.ok(TAB.includes("badgeStyle(e.status)"));
    assert.ok(TAB.includes("fmt.dateLabel(e.date)"), "formatted through the regional preference");
  });

  it("23. Excused can never reach the absences card", () => {
    /* The server sends `absences` already filtered to `Absent`. The tab applies
     * NO filter of its own, so there is no second rule to get wrong — which is
     * the whole reason this is checked as an absence of code. */
    assert.ok(TAB.includes("data.absences.map"), "rendered as supplied");
    assert.ok(!/data\.absences[\s\S]{0,60}filter\(/.test(TAB), "no client filter over absences");
    assert.ok(!TAB.includes("Excused\" ||"), "and no status test that could admit Excused");
  });

  it("24. both side cards have their own empty state, with the comp's copy", () => {
    assert.ok(TAB.includes("data.absences.length === 0"));
    assert.ok(TAB.includes('t("No absences on record. 🎉")'));
    assert.ok(TAB.includes("data.lates.length === 0"));
    assert.ok(TAB.includes('t("No late arrivals on record.")'));
  });

  it("25. a note is shown only when one was recorded", () => {
    assert.ok(TAB.includes("entry.note ?"), "no dangling separator with nothing after it");
    assert.ok(TAB.includes("function noteLine("));
  });
});

/* =========================================================================
 * 5. The responsive contract
 * ====================================================================== */

describe("Attendance tab — the split is the stylesheet's", () => {
  it("26. .sp-split exists and the CSS owns its desktop template", () => {
    assert.ok(/\.sp-split\{[^}]*grid-template-columns:minmax\(0,1\.6fr\) minmax\(0,1fr\)/.test(CSS.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " ")).replace(/\n\s*/g, "")),
      "the comp's ratio, declared in the stylesheet");
  });

  it("27. the element carries a CLASS and no inline grid template", () => {
    /* THE TRAP THIS PREVENTS: an inline `grid-template-columns` beats every media
     * and container rule written against it, and this repository has shipped that
     * dead rule more than once. */
    assert.ok(TAB.includes('className="sp-split"'));
    assert.ok(!TAB.includes("gridTemplateColumns: \"minmax(0,1.6fr)"), "the split is never inline");
    assert.ok(!/gridTemplateColumns[^,}]*1\.6fr/.test(TAB));
  });

  it("28. it collapses on a CONTAINER query anchored to the profile screen", () => {
    assert.ok(CSS.includes('[data-screen-label="Student profile"]{container-type:inline-size;container-name:sp-page}'));
    assert.ok(/@container sp-page \(max-width:600px\)\{[\s\S]*?\.sp-split\{grid-template-columns:minmax\(0,1fr\)\}/.test(CSS),
      "one column when the tab's own width is short");
    /* 600 IS THIS TAB'S OWN NUMBER, not Reports'. Borrowing 667 would have
     * broken tests/reports-ui.test.ts #107 and #116, which pin it as the file's
     * single occurrence — so the threshold is derived from this content instead
     * and those two banked guards stay exactly as they were. */
    assert.equal((CSS.match(/max-width:667px/g) ?? []).length, 1, "Reports' threshold is still unique");
  });

  it("29. the container is declared for screen only", () => {
    const at = CSS.indexOf('[data-screen-label="Student profile"]{container-type');
    const before = CSS.slice(0, at);
    assert.ok(before.lastIndexOf("@media screen{") > before.lastIndexOf("}\n@media"),
      "layout containment must not reach a printed page");
  });

  it("30. NO NEW VIEWPORT BREAKPOINT was introduced", () => {
    /* The allowlist in tests/finance-ui.test.ts #122 is not loosened, and could
     * not be by this block: 667 is a CONTAINER width, not a viewport one. */
    for (const m of CSS.matchAll(/@media \(max-width:(\d+)px\)/g)) {
      assert.ok(["620", "767", "860", "1099", "1100"].includes(m[1]), `unexpected breakpoint ${m[1]}`);
    }
    assert.ok(!CSS.includes("@media (max-width:600px)"), "600 is a container query, not a media one");
  });

  it("31. no horizontal-scroll escape hatch was added", () => {
    assert.ok(!TAB.includes("overflowX"), "cards must fit, not scroll sideways");
    assert.ok(!TAB.includes("100vw"), "no viewport-width element inside the shell");
    assert.ok(TAB.includes("minWidth: 0"), "grid children may shrink instead of overflowing");
    assert.ok(TAB.includes("textOverflow: \"ellipsis\""), "long class names ellipse");
  });
});

/* =========================================================================
 * 6. Translations, accessibility, and the deferred feature
 * ====================================================================== */

describe("Attendance tab — translations, semantics and scope", () => {
  it("32. every string it renders already has a Vietnamese entry", () => {
    /* Gate 1 found these twelve keys ported and unread. This is the sprint that
     * gives them a reader, and no thirteenth key is invented. */
    for (const key of [
      "No attendance recorded for this student yet.", "Monthly attendance",
      "Attendance timeline", "Recent absences", "Recent late arrivals",
      "No absences on record. 🎉", "No late arrivals on record.",
      "Attendance", "Present", "Late", "Absent", "Excused",
      "Couldn't load attendance", "Try again",
    ]) {
      assert.ok(TAB_RAW.includes(key), `the tab renders "${key}"`);
      assert.ok(typeof VI[key] === "string" && VI[key].length > 0, `"${key}" has a Vietnamese entry`);
    }
  });

  it("33. it introduces no second translation source", () => {
    assert.ok(TAB.includes("useSettings()"), "the one store");
    assert.ok(!TAB.includes("i18n-vi.json") && !TAB.includes("translate("));
    assert.ok(!/const\s+\w+\s*=\s*\{[^}]*"vi"\s*:/.test(TAB), "no local dictionary");
  });

  it("34. the tablist is untouched — this sprint is not a tab-semantics refactor", () => {
    assert.ok(!TAB.includes('role="tab'), "the tab body declares no tablist role");
    assert.equal([...PROFILE.matchAll(/role="tablist"/g)].length, 1, "still exactly one, unchanged");
    assert.ok(PROFILE.includes('role="tab"'), "and the tabs are as they were");
  });

  it("35. sections are labelled, and headings describe them", () => {
    assert.equal([...TAB.matchAll(/<section /g)].length, 5, "summary, chart, timeline, absences, lates");
    assert.equal([...TAB.matchAll(/aria-label=\{t\(/g)].length, 5, "each names itself");
    assert.ok([...TAB.matchAll(/<h3 /g)].length >= 4, "and the visible headings are headings");
  });

  it("36. it adds no focus handling of its own", () => {
    /* The shared `:focus-visible` treatment is the app's, and Sprint 12 already
     * settled the stuck-ring behaviour. A tab that installed its own outline or
     * focus effect would be re-opening a closed defect. */
    for (const forbidden of ["outline:", "onFocus", "onBlur", "tabIndex", ":focus"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} is the shared layer's business`);
    }
  });

  it("37. Homework, Finance and the deferred payment slip are all absent", () => {
    for (const forbidden of [
      "Homework", "homework", "Billing", "billing", "payment", "Payment",
      "slip", "QR", "qr", "jsPDF", "print",
    ]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} is not this tab's business`);
    }
  });
});

/* =========================================================================
 * 7. Gate 6 — the four-up tile row is the stylesheet's too
 * ====================================================================== */

describe("Attendance tab — the summary tiles collapse on room (Gate 6)", () => {
  it("38. the tile row carries a CLASS and no inline grid template", () => {
    /* THE DEFECT THIS PINS. The comp writes the row as an inline
     * `repeat(4,1fr)` — a hard-coded DESKTOP column count — and an inline
     * declaration beats every container rule ever written against it, so the
     * count could never change on a narrow screen. It is the IDENTICAL fault
     * globals.css already records against the two Attendance screens: "hard-code
     * a desktop column count inline, so the count never changed on a phone". */
    assert.equal([...TAB.matchAll(/className="sp-tiles"/g)].length, 2,
      "the live row AND the skeleton, so revealing the data does not reshape the row");
    assert.ok(!/gridTemplateColumns/.test(TAB), "no inline grid template survives in this tab");
  });

  it("39. the CSS owns the tile template, and no track can refuse to shrink", () => {
    const flat = CSS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, "");
    assert.ok(flat.includes(".sp-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}"),
      "the comp's four columns, with the automatic minimum size removed");
    /* WHY `minmax(0,…)` AND NOT `1fr`. A `1fr` track is `minmax(auto,1fr)`, and
     * that `auto` is the grid item's AUTOMATIC MINIMUM SIZE: the track refuses to
     * go below its own min-content, so four tiles of 24px padding around an
     * unbreakable word are a floor the row cannot go under. Gate 6.1 MEASURED
     * what that costs, in Chrome, at 320px: tracks of 47/78/44/61px instead of
     * four equal ones, and grid scrollWidth 260 over clientWidth 250. The spill
     * lands in the card padding — it does NOT scroll the page. */
    assert.ok(!flat.includes(".sp-tiles{display:grid;grid-template-columns:repeat(4,1fr)"),
      "never a bare 1fr track");
    assert.ok(/\.sp-tiles\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(CSS),
      "4 -> 2 on a narrow container, the .att-summary treatment");
  });

  it("40. it rides the EXISTING container query and adds no threshold", () => {
    assert.equal((CSS.match(/@container sp-page/g) ?? []).length, 1,
      "still exactly one Student Profile container query");
    const block = CSS.slice(CSS.indexOf("@container sp-page (max-width:600px){"));
    const body = block.slice(0, block.indexOf("\n}"));
    assert.ok(body.includes(".sp-split{grid-template-columns:minmax(0,1fr)}"));
    assert.ok(body.includes(".sp-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}"),
      "the tiles collapse in the same block, at the same number");
    for (const m of CSS.matchAll(/@media \(max-width:(\d+)px\)/g)) {
      assert.ok(["620", "767", "860", "1099", "1100"].includes(m[1]), `unexpected breakpoint ${m[1]}`);
    }
  });

  it("41. the tile label may break rather than push the card wide", () => {
    /* The last line of defence, and the one that does not depend on a font
     * metric: whatever the label resolves to in whatever language, a single long
     * word wraps inside its tile instead of widening it. */
    assert.ok(TAB.includes('overflowWrap: "anywhere"'),
      "a single long word must wrap rather than overflow its tile");
  });
});

/* =========================================================================
 * 8. Gate 6.3 — the Overview tile reads the SAME answer the tab does
 *
 * The profile used to show two different attendance numbers ten pixels apart:
 * the Overview tile rendered `Student.attendance`, a STORED field nothing derives
 * from a register, while the tab rendered the derived figure. Gate 6.2 proved the
 * tab was right. This section pins that the tile now asks the same question.
 * ====================================================================== */

describe("Student Profile — one attendance answer, not two (Gate 6.3)", () => {
  it("42. the Overview tile NO LONGER reads the stale stored field", () => {
    /* THE DEFECT THIS PINS. `Student.attendance` is written in exactly one place
     * in the codebase — the pass-through in `students.ts` — and the demo dataset
     * ships it frozen. Rendering it as live attendance is what made one screen
     * state two different facts. The FIELD may stay on the model; presenting it
     * as an attendance measurement may not. */
    assert.ok(!/student\.attendance/.test(PROFILE),
      "the page must not read Student.attendance for the attendance metric");
    assert.ok(!/\$\{student\.attendance\}/.test(PROFILE), "and certainly not interpolate it");
  });

  it("43. it reads the authoritative read model, on the TAB'S OWN query key", () => {
    /* ONE CACHE ENTRY, NOT TWO REQUESTS. Sharing `attendanceKeys.student(id)`
     * with the tab is what makes the two surfaces incapable of disagreeing, and
     * it is also why opening the tab costs no second fetch and why the register
     * save that already invalidates ["attendance"] refreshes this tile. */
    assert.ok(PROFILE.includes("attendanceKeys.student(id)"), "the tab's key, reused");
    assert.ok(PROFILE.includes("fetchStudentAttendance(id)"), "and the tab's reader");
    assert.ok(/<Stat label=\{t\("Attendance"\)\} value=\{rateLabel\(attendance\.data\?\.rate \?\? null\)\}/.test(PROFILE),
      "the tile renders the server's rate through the shared formatter, and nothing else");
  });

  it("44. the page derives NO attendance arithmetic of its own", () => {
    /* A second copy of the counting rule in the page is exactly how one fact
     * becomes two numbers again. The page may format; it may not compute. */
    for (const f of ["Math.round", "reduce(", "/ 100", "* 100", "studentAttendanceRate"]) {
      assert.ok(!PROFILE.includes(f), `${f} is the read model's business, not the page's`);
    }
  });

  it("45. null renders as the app's no-value mark — never 0%", () => {
    /* `rateLabel` is the shipped formatter and it is executed here rather than
     * described: "nothing was recorded" and "they attended nothing" are different
     * facts and must not collapse into the same glyph. */
    assert.equal(rateLabel(null), "—", "no records is the em dash");
    assert.equal(rateLabel(0), "0%", "a real zero is still a real answer");
    assert.equal(rateLabel(100), "100%");
    assert.notEqual(rateLabel(null), "0%", "the two must never coincide");
  });
});
