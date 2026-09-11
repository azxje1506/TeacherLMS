/* Sprint 13 Gate 5 — the Student Profile Homework TAB.
 *
 * Run with:  npm test
 *
 * THIS SUITE IS ABOUT THE SCREEN. The read model's arithmetic is proved by
 * tests/student-homework.test.ts, which executes it. What matters here cannot
 * mostly be executed — the component is a client module with React Query at the
 * top and the runner cannot import it — so the contract is SCANNED, and the
 * scans are written to name what would actually go wrong.
 *
 * THE THREE THINGS THIS TAB IS EASIEST TO GET WRONG, and which therefore get
 * their own sections:
 *
 *   - "no outcome yet" is not "no homework". A student whose work is all still
 *     `Assigned` has `completionRate: null` and real assignments. Showing them
 *     the empty state would be false, and showing them 0% would be an assessment
 *     nobody made (section 4).
 *   - `Total` includes `Assigned`, so it is LARGER than `completed + late +
 *     missing`. Deriving it from the other three would quietly delete the
 *     unmarked work (section 5).
 *   - `missing` and `late` are the SERVER'S lists. Rebuilding them by filtering
 *     the timeline would disagree with it the first time a student had more than
 *     twenty assignments, because the two are capped differently (section 6).
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
function code(...parts: string[]): string {
  return raw(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TAB = code("src", "components", "homework", "student-homework.tsx");
const TAB_RAW = raw("src", "components", "homework", "student-homework.tsx");
const ATT_TAB = code("src", "components", "attendance", "student-attendance.tsx");
const PROFILE = code("src", "app", "(app)", "students", "[id]", "page.tsx");
const API = code("src", "components", "homework", "api.ts");
const CSS = raw("src", "app", "globals.css");
const VI = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* =========================================================================
 * 1. Branch ownership — the set is now complete
 * ====================================================================== */

describe("Student Profile — the Homework branch now exists", () => {
  it("1. Homework has its own branch and renders the component", () => {
    assert.ok(PROFILE.includes('tab === "Homework" ? ('));
    assert.ok(PROFILE.includes("<StudentHomework studentId={id} />"));
    assert.ok(
      PROFILE.includes('import { StudentHomework } from "@/components/homework/student-homework"'),
      "imported from the Homework module, which owns the data"
    );
  });

  it("2. Attendance still branches — Gate 4 is not disturbed", () => {
    assert.ok(PROFILE.includes('tab === "Attendance" ? ('));
    assert.ok(PROFILE.includes("<StudentAttendance studentId={id} />"));
  });

  it("3. the owned branch set is exactly four, in order", () => {
    const branched = [...PROFILE.matchAll(/tab === "([A-Za-z]+)" \? \(/g)].map((m) => m[1]);
    assert.deepEqual(branched, ["Overview", "Reviews", "Attendance", "Homework"]);
  });

  it("4. Classes and Finance never gain a branch, and the fallback survives", () => {
    for (const unowned of ["Classes", "Finance"]) {
      assert.ok(!PROFILE.includes(`tab === "${unowned}"`), `${unowned} has no design and must never branch`);
    }
    assert.ok(PROFILE.includes('t("arrives in a later sprint")'), "the comp's later-sprint panel");
  });

  it("5. the six-entry TABS array is unchanged", () => {
    assert.equal(
      [...PROFILE.matchAll(/const TABS = \["Overview", "Attendance", "Homework", "Reviews", "Classes", "Finance"\]/g)].length,
      1
    );
  });

  it("6. the page owns no homework state, query or rule", () => {
    for (const forbidden of [
      "homeworkKeys", "fetchStudentHomework", "/api/homework", "completionRate",
      "submissions", "homeworkBadgeStyle", "SCOPE_LABEL",
    ]) {
      assert.ok(!PROFILE.includes(forbidden), `${forbidden} belongs to the tab, not the page`);
    }
  });
});

/* =========================================================================
 * 2. Query ownership
 * ====================================================================== */

describe("Homework tab — one endpoint, no client arithmetic", () => {
  it("7. it calls the Gate 3 endpoint through the module's own fetcher", () => {
    assert.ok(API.includes("/api/homework/student/${studentId}"), "the client names the endpoint once");
    assert.ok(TAB.includes("fetchStudentHomework(studentId)"));
    assert.ok(TAB.includes("homeworkKeys.student(studentId)"));
    assert.ok(!/\bfetch\(/.test(TAB), "the tab never opens a request itself (refetch is the retry)");
  });

  it("8. the query key sits under [\"homework\"], not under [\"students\"]", () => {
    assert.ok(API.includes('student: (studentId: string) => ["homework", "student", studentId] as const'));
  });

  it("9. NO DOMAIN FIGURE IS RECONSTRUCTED IN THE BROWSER", () => {
    for (const forbidden of ["Math.round", "reduce(", "filter(", "sort(", "/ 100", "* 100"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden}: the tab must not derive domain values`);
    }
  });

  it("10. it reads the payload's own fields rather than rebuilding them", () => {
    for (const field of [
      "data.completionRate", "data.counts", "data.timeline",
      "data.missing", "data.late", "data.hasRecords",
    ]) {
      assert.ok(TAB.includes(field), `${field} is consumed as supplied`);
    }
  });
});

/* =========================================================================
 * 3. States — and the one that must never become another
 * ====================================================================== */

describe("Homework tab — its four states stay distinct", () => {
  it("11. loading is a skeleton, inside the tab, showing no values", () => {
    assert.ok(TAB.includes("if (isLoading) return <SkeletonTab />;"));
    const skeleton = TAB.slice(TAB.indexOf("function SkeletonTab()"));
    assert.ok(!/\b0%/.test(skeleton), "no fake percentage");
    assert.ok(!skeleton.includes("data."), "it cannot read data it does not have");
    assert.ok(!skeleton.includes("rateLabel"), "and renders no rate");
    assert.ok(skeleton.includes('aria-hidden="true"'), "decorative shimmer is not announced");
  });

  it("12. loading holds the loaded layout, so revealing data does not move the tablist", () => {
    assert.equal([...TAB.matchAll(/className="sp-split"/g)].length, 2,
      "the skeleton and the loaded tab use the same split");
  });

  it("13. ERROR CAN NEVER BECOME EMPTY", () => {
    assert.ok(TAB.includes("if (isError || !data)"));
    assert.ok(TAB.includes('t("Couldn\'t load homework")'));
    assert.ok(TAB.includes("onClick={() => refetch()}"), "a retry path");
    assert.ok(TAB.includes('t("Try again")'));
    /* The failure branch returns before `hasRecords` is consulted, so a failed
     * request cannot render "No homework assigned to this student yet." — a claim
     * about the record rather than about the network. */
    assert.ok(
      TAB.indexOf("if (isError || !data)") < TAB.indexOf("if (!data.hasRecords)"),
      "error is decided first"
    );
    assert.ok(!TAB.includes("?? []"), "no fallback empty list papers over a failure");
    assert.ok(!TAB.includes("?? 0"), "and no fallback zero");
  });

  it("14. the whole-tab empty state is the comp's, and is the SERVER'S verdict", () => {
    assert.ok(TAB.includes("if (!data.hasRecords)"), "hasRecords decides it");
    assert.ok(TAB.includes('t("No homework assigned to this student yet.")'));
    assert.ok(TAB.includes('border: "1px dashed var(--border)"'), "the comp's dashed panel");
    assert.ok(TAB.includes('t("Assign homework")'), "with the comp's own action");
    assert.ok(TAB.includes('href="/homework"'), "which opens the screen that owns the verb");
  });
});

/* =========================================================================
 * 4. The Assigned-only case — "no outcome yet" is not "no homework"
 * ====================================================================== */

describe("Homework tab — an Assigned-only student is NOT empty", () => {
  it("15. the empty state is never inferred from a null completion rate", () => {
    /* THE CONTRACT CASE. A student can have total > 0, completionRate null and
     * completed/late/missing all zero, because every assignment is still
     * `Assigned`. They were given work; nobody has marked it. Branching the
     * whole tab on the rate would tell them they have no homework, which is
     * false — so `hasRecords` is the ONLY thing the empty state may read. */
    /* PINNED AS AN EXACT CONDITION, not as an absence of text. An earlier form
     * sliced the file between two landmarks and asked whether `completionRate`
     * appeared inside — and mutation-testing showed it FAILED OPEN: widening the
     * condition to `!data.hasRecords || data.completionRate === null` moved the
     * opening landmark, the slice collapsed, and the assertion passed while the
     * defect was live. Reading the condition itself cannot fail that way. */
    const emptyCond = /if \(([^)]*hasRecords[^)]*)\) \{/.exec(TAB);
    assert.ok(emptyCond, "the empty state branches on hasRecords");
    assert.equal(emptyCond![1].trim(), "!data.hasRecords", "and on nothing else");

    /* And no branch anywhere may key off the rate or the total: both are true of
     * a student who has work nobody has marked yet. */
    for (const cond of [...TAB.matchAll(/if \(([^)]*)\)/g)].map((m) => m[1])) {
      assert.ok(!cond.includes("completionRate"), `the rate must not gate a branch: if (${cond})`);
      assert.ok(!cond.includes("counts.total"), `nor the total: if (${cond})`);
    }
  });

  it("16. a null rate renders the no-value state, never 0%", () => {
    assert.ok(TAB.includes("rateLabel(data.completionRate)"), "the shared em-dash formatter");
    assert.ok(!TAB.includes('"0%"') && !TAB.includes("'0%'"), "0% is never a literal");
    const pctTemplates = [...TAB.matchAll(/\$\{[^}]*(?:Rate|rate)[^}]*\}%/g)].map((m) => m[0]);
    assert.deepEqual(pctTemplates, [], "no hand-built percent string anywhere");
  });

  it("17. a null rate draws no arc — a zero-length ring is not a zero score", () => {
    assert.ok(TAB.includes("data.completionRate !== null &&"), "the arc is conditional");
    assert.ok(TAB.includes("ringDash(data.completionRate)"), "and uses the server's rate when there is one");
    assert.ok(!TAB.includes("ringDash(0)"));
  });

  it("18. the percentage is text, not only a ring", () => {
    const ring = TAB.slice(TAB.indexOf("<svg"), TAB.indexOf("</section>"));
    assert.ok(ring.includes('aria-hidden="true"'), "the svg is decoration");
    assert.ok(TAB.indexOf('aria-hidden="true"') < TAB.indexOf("rateLabel(data.completionRate)"),
      "and the readable figure sits outside it");
  });
});

/* =========================================================================
 * 5. Counts — Total includes Assigned
 * ====================================================================== */

describe("Homework tab — the four counts", () => {
  it("19. all four render, each from its own server field", () => {
    assert.ok(TAB.includes("data.counts[tile.key]"), "each tile reads its own count");
    const keys = [...TAB.matchAll(/key: "(total|completed|late|missing)"/g)].map((m) => m[1]);
    assert.deepEqual(keys, ["total", "completed", "late", "missing"], "the comp's order");
  });

  it("20. TOTAL IS NEVER DERIVED from the other three", () => {
    /* `Total` counts every assignment addressed to the student, `Assigned`
     * included, so it is legitimately larger than completed + late + missing.
     * Summing the others would delete the unmarked work from the screen. */
    assert.ok(!/completed\s*\+\s*late/.test(TAB), "no sum of the outcome counts");
    assert.ok(!/counts\.completed\s*\+/.test(TAB));
    assert.ok(!TAB.includes("outcomeTotal"), "the denominator is not rendered as a count");
  });

  it("21. each tile names its status in text, not only in colour", () => {
    assert.ok(TAB.includes("{t(tile.label)}"), "the label travels with the value");
    assert.ok(TAB.includes('label: "Total"') && TAB.includes('label: "Completed"'));
    assert.ok(TAB.includes('label: "Late"') && TAB.includes('label: "Missing"'));
  });
});

/* =========================================================================
 * 6. The three lists
 * ====================================================================== */

describe("Homework tab — timeline, missing and late", () => {
  it("22. the timeline renders in the order it arrives", () => {
    assert.ok(/data\.timeline\.map\(/.test(TAB));
    assert.ok(!/data\.timeline[\s\S]{0,40}\.(sort|filter)\(/.test(TAB), "never re-ordered or filtered");
  });

  it("23. each row uses the payload's own field names", () => {
    for (const field of ["h.title", "h.className", "h.scope", "h.dueDate", "h.status", "h.homeworkId"]) {
      assert.ok(TAB.includes(field), `${field} comes from the read model`);
    }
  });

  it("24. the row status is the STUDENT'S, and no assignment status is consulted", () => {
    assert.ok(TAB.includes("homeworkBadgeStyle(h.status)"), "the pill carries the student's outcome");
    assert.ok(TAB.includes("{t(h.status)}"), "and names it in text");
    /* The submissions map never crosses the wire, so the browser cannot read
     * another student's key or mistake an assignment's own status for a person's
     * result — it is handed an outcome, not a map. */
    /* The word "submissions" DOES appear, inside the empty-state copy "No late
     * submissions." — so a bare string search would be a false alarm. What must
     * never appear is an ACCESS to the map: a subscript or a property read. */
    assert.ok(!/submissions\s*\[/.test(TAB), "no submissions map is indexed");
    assert.ok(!/\.submissions\b/.test(TAB), "and none is read as a property");
    assert.ok(!/\bhw\.status\b/.test(TAB), "an assignment's own status is never the student's result");
  });

  it("25. Missing and Late render the SERVER'S lists, not a filtered timeline", () => {
    assert.ok(TAB.includes("data.missing.map"), "the server's missing list");
    assert.ok(TAB.includes("data.late.map"), "the server's late list");
    /* Rebuilding either from the timeline would disagree with it as soon as a
     * student had more than twenty assignments — the two are capped differently
     * on purpose. */
    /* Status comparison DOES exist, once, in the decorative `dotColor` helper
     * defined below the component — that picks a colour for a dot the badge
     * already names in text. Nothing in the RENDER may compare a status, because
     * that is how a list gets rebuilt. Splitting on the helper's definition is
     * what makes the distinction, rather than a fragile whole-file regex. */
    const beforeDotHelper = TAB.slice(0, TAB.indexOf("function dotColor"));
    assert.ok(beforeDotHelper.length > 0, "the helper is defined after the component");
    assert.ok(!/status === "/.test(beforeDotHelper),
      "no status comparison anywhere in the render");
  });

  it("26. both side cards carry the comp's own empty copy", () => {
    assert.ok(TAB.includes("data.missing.length === 0"));
    assert.ok(TAB.includes('t("Nothing missing. 🎉")'));
    assert.ok(TAB.includes("data.late.length === 0"));
    assert.ok(TAB.includes('t("No late submissions.")'));
  });

  it("27. the scope label is the shared one, not a second vocabulary", () => {
    assert.ok(TAB.includes("SCOPE_LABEL[h.scope]"), "the drawer and this row say the same word");
    assert.ok(!TAB.includes('"Entire class"') && !TAB.includes('"Individual student"'),
      "the strings are not restated here");
  });
});

/* =========================================================================
 * 7. Responsive — Gate 4's rule, reused untouched
 * ====================================================================== */

describe("Homework tab — it adds no responsive rule of its own", () => {
  it("28. it reuses .sp-split", () => {
    assert.ok(TAB.includes('className="sp-split"'));
    assert.ok(!TAB.includes("gridTemplateColumns: \"minmax(0,1.6fr)"), "the split is never inline");
    assert.ok(!/gridTemplateColumns[^,}]*1\.6fr/.test(TAB));
  });

  it("29. globals.css gained no second container query or breakpoint", () => {
    assert.equal((CSS.match(/@container sp-page/g) ?? []).length, 1, "one Student Profile container query");
    assert.equal((CSS.match(/container-name:sp-page/g) ?? []).length, 1, "declared once");
    assert.equal((CSS.match(/\.sp-split\{/g) ?? []).length, 2, "the base rule and its collapse, unchanged");
    for (const m of CSS.matchAll(/@media \(max-width:(\d+)px\)/g)) {
      assert.ok(["620", "767", "860", "1099", "1100"].includes(m[1]), `unexpected breakpoint ${m[1]}`);
    }
    assert.equal((CSS.match(/max-width:667px/g) ?? []).length, 1, "Reports' threshold still unique");
  });

  it("30. no horizontal-scroll escape hatch was added", () => {
    assert.ok(!TAB.includes("overflowX"), "cards must fit, not scroll sideways");
    assert.ok(!TAB.includes("100vw"));
    assert.ok(TAB.includes("minWidth: 0"), "grid children may shrink");
    assert.ok(TAB.includes('textOverflow: "ellipsis"'), "long titles ellipse");
  });
});

/* =========================================================================
 * 8. Translations, semantics, and scope
 * ====================================================================== */

describe("Homework tab — translations, semantics and scope", () => {
  it("31. every string it renders has a Vietnamese entry", () => {
    for (const key of [
      "No homework assigned to this student yet.", "Assign homework", "Homework timeline",
      "Missing homework", "Late homework", "Nothing missing. 🎉", "No late submissions.",
      "Total", "Completed", "Late", "Missing", "Due", "completed",
      "Homework completion", "Couldn't load homework", "Try again",
      "Entire class", "Individual student",
    ]) {
      assert.ok(typeof VI[key] === "string" && VI[key].length > 0, `"${key}" has a Vietnamese entry`);
    }
  });

  it("32. the ring's sub-label is the sibling of Attendance's, not a new pattern", () => {
    /* The comp draws "attended" under the Attendance ring and "completed" under
     * this one. `attended` was already in the dictionary; `completed` is its
     * missing twin and is the ONE key this gate added. */
    assert.ok(TAB_RAW.includes('t("completed")'));
    assert.equal(VI["completed"], "đã hoàn thành");
    assert.equal(VI["attended"], "đã tham dự", "the sibling it was modelled on is untouched");
  });

  it("33. it introduces no second translation source", () => {
    assert.ok(TAB.includes("useSettings()"));
    assert.ok(!TAB.includes("i18n-vi.json") && !TAB.includes("translate("));
  });

  it("34. sections are labelled and headings identify the groups", () => {
    assert.equal([...TAB.matchAll(/<section /g)].length, 4, "ring, timeline, missing, late");
    assert.equal([...TAB.matchAll(/aria-label=\{t\(/g)].length, 4);
    assert.ok([...TAB.matchAll(/<h3 /g)].length >= 3, "the visible headings are headings");
  });

  it("35. it adds no focus model of its own", () => {
    for (const forbidden of ["outline:", "onFocus", "onBlur", "tabIndex", ":focus"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} is the shared layer's business`);
    }
  });

  it("36. the tablist is untouched", () => {
    assert.ok(!TAB.includes('role="tab'), "the tab body declares no tablist role");
    assert.equal([...PROFILE.matchAll(/role="tablist"/g)].length, 1);
  });

  it("37. no submission writer, no Payment Slip, no print path", () => {
    for (const forbidden of [
      "createHomework", "updateHomework", "deleteHomework", "useMutation",
      "Billing", "billing", "payment", "Payment", "QR", "jsPDF", "print", "slip",
    ]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} is not this tab's business`);
    }
  });

  it("38. the ATTENDANCE tab was not touched by this gate", () => {
    /* Gate 5 introduces the second tab and must not generalise the first. The
     * Attendance component still reads its own endpoint and still renders its own
     * sections; nothing here was hoisted out of it. */
    assert.ok(ATT_TAB.includes("fetchStudentAttendance(studentId)"));
    assert.ok(ATT_TAB.includes("data.absences.map") && ATT_TAB.includes("data.lates.map"));
    assert.ok(ATT_TAB.includes('className="sp-split"'));
    assert.ok(!ATT_TAB.includes("student-homework"), "the two tabs share no component");
  });
});

/* =========================================================================
 * 8. Gate 6 — the four-up tile row, on BOTH tabs
 * ====================================================================== */

describe("Homework tab — the summary tiles collapse on room (Gate 6)", () => {
  it("39. the tile row carries a CLASS and no inline grid template", () => {
    /* The comp's inline `repeat(4,1fr)` is a hard-coded DESKTOP column count,
     * and an inline declaration beats every container rule written against it.
     * This tab is the worse of the two: its longest label, "Completed", is a
     * single unbreakable word, so its four tiles have the higher floor. */
    assert.equal([...TAB.matchAll(/className="sp-tiles"/g)].length, 2,
      "the live row AND the skeleton, so the shape does not change on reveal");
    assert.ok(!/gridTemplateColumns/.test(TAB), "no inline grid template survives in this tab");
  });

  it("40. BOTH tabs collapse, from ONE rule — the fix was not written twice", () => {
    /* The two tabs draw the same row, so they share the one class. A second
     * per-tab copy of the template is the duplication PROJECT_RULES forbids, and
     * it would be free to drift. */
    assert.ok(ATT_TAB.includes('className="sp-tiles"'), "Attendance uses it too");
    assert.ok(!/gridTemplateColumns/.test(ATT_TAB), "and carries no inline template either");
    assert.equal((CSS.match(/\.sp-tiles\{/g) ?? []).length, 2, "the base rule and its collapse, and no more");
  });

  it("41. no new container query, container name or viewport breakpoint", () => {
    assert.equal((CSS.match(/@container sp-page/g) ?? []).length, 1, "one Student Profile container query");
    assert.equal((CSS.match(/container-name:sp-page/g) ?? []).length, 1, "declared once");
    assert.equal((CSS.match(/\.sp-split\{/g) ?? []).length, 2, "Gate 4's two rules, unchanged");
    assert.ok(!CSS.includes("@media (max-width:600px)"), "600 stays a container width, never a viewport one");
    for (const m of CSS.matchAll(/@media \(max-width:(\d+)px\)/g)) {
      assert.ok(["620", "767", "860", "1099", "1100"].includes(m[1]), `unexpected breakpoint ${m[1]}`);
    }
  });

  it("42. still no horizontal-scroll escape hatch on either tab", () => {
    /* The fix had to make the row FIT. Solving it with a sideways scroller would
     * be the same defect wearing a scrollbar — the rule tests/finance-ui.test.ts
     * #123 already holds the rest of the app to. */
    for (const tab of [TAB, ATT_TAB]) {
      assert.ok(!tab.includes("overflowX"), "cards must fit, not scroll sideways");
      assert.ok(!tab.includes("100vw"), "no viewport-width element inside the shell");
    }
    assert.ok(TAB.includes('overflowWrap: "anywhere"'), "a long label wraps inside its tile");
  });
});

/* =========================================================================
 * 9. Gate 6.3 — the completion ring tolerates a long localized label
 * ====================================================================== */

describe("Homework tab — the ring label stays inside the ring (Gate 6.3)", () => {
  it("43. the label is BOUNDED and may wrap, so a long translation cannot reach the stroke", () => {
    /* THE DEFECT THIS PINS, measured in Chrome before the fix: the comp's single
     * English word inks 47px and clears the ring easily, but `đã hoàn thành`
     * inks 64px on one line and its corners reach 37.3px from the ring centre —
     * past the 36.9px of clear interior an r=40 ring with a 9-wide stroke
     * leaves. It ran under the green stroke. Bounded, it wraps to two centred
     * lines inking 36px, worst corner 28.1px, comfortably inside. */
    const label = TAB.slice(TAB.indexOf('{t("completed")}') - 400, TAB.indexOf('{t("completed")}') + 40);
    assert.ok(/maxWidth: 64/.test(label), "a width bound derived from the ring's own geometry");
    assert.ok(/textAlign: "center"/.test(label), "wrapped lines stay centred on the ring");
    assert.ok(/lineHeight: 1\.2/.test(label), "and two lines stay tight enough to fit");
  });

  it("44. ONE layout path for every language — no locale branch", () => {
    /* The trap this forbids: fixing Vietnamese with Vietnamese-specific markup,
     * which leaves English on a different code path and the next translation
     * broken again. The bound is geometric and applies to whatever the
     * dictionary returns. */
    for (const forbidden of ['lang ===', 'lang ==', '"vi"', "'vi'", "đã hoàn thành", "locale"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} would make the ring language-specific`);
    }
    assert.equal([...TAB.matchAll(/\{t\("completed"\)\}/g)].length, 1,
      "one label, rendered once, through the dictionary");
  });

  it("45. the ring's geometry and its no-value behaviour are UNCHANGED", () => {
    /* Gate 6.3 is a label-layout fix. The arc, its maths and the null case are
     * Gate 5's and must not move. */
    assert.ok(TAB.includes('r="40"'), "the comp's r=40");
    assert.ok(TAB.includes('strokeWidth="9"'), "and its stroke");
    assert.ok(TAB.includes("ringDash(data.completionRate)"), "the shared donut maths, still");
    assert.ok(TAB.includes("data.completionRate !== null &&"), "null draws NO arc at all");
    assert.ok(TAB.includes("rateLabel(data.completionRate)"), "and shows the shared em dash");
    assert.ok(/fontSize: 21/.test(TAB), "the percentage keeps its size — hierarchy is not traded away");
  });

  it("46. the fix is presentation only — no completion semantics moved", () => {
    for (const forbidden of ["Math.round", "reduce(", ".filter(", "completed +", "+ late"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} would recompute the measure`);
    }
  });
});
