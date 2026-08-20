/* Component-level mobile geometry.
 *
 * Run with:  npm test
 *
 * WHY THIS FILE EXISTS, NEXT TO responsive-shell.test.ts. That file holds the
 * SHELL's contract: the sidebar costs no layout width on a phone, the header
 * fits rather than defining a width, the content column is the whole viewport.
 * All of it passed, and manual verification of Gate 5 Phase 0 still failed —
 * because the fault had moved one layer in. Components inside that now-correct
 * column were still stating a DESKTOP shape: a five-column KPI grid, a two-up
 * statistics pair, a four-button action row, a form control reporting its own
 * intrinsic width, and a sticky footer whose negative margins were measured
 * against desktop padding.
 *
 * Six screens were reported. They are five repeated shapes, and the fix is five
 * rules in globals.css rather than six screen patches. What this file holds
 * still is that each rule exists, that every screen showing one of those shapes
 * is actually opted in to it, and — this is the part that regressed last time —
 * that no screen quietly keeps a desktop-only floor.
 *
 * NO DOM, same as its sibling. This project ships no browser harness, so these
 * assertions read the stylesheet and the components as text and check the
 * arithmetic on the numbers those files state. That is a real limitation and it
 * is why a human still re-verifies on a device. What they CAN do is keep the
 * contract from drifting: a class in the markup with no rule behind it, or a
 * rule with no markup using it, fails here rather than on someone's phone.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("src", "app", "globals.css");

const ATT_INDEX = read("src", "app", "(app)", "attendance", "page.tsx");
const ATT_DETAIL = read("src", "app", "(app)", "attendance", "[lessonId]", "page.tsx");
const CLASS_DETAIL = read("src", "app", "(app)", "classes", "[id]", "page.tsx");
const DASHBOARD = read("src", "app", "(app)", "dashboard", "page.tsx");
const LESSONS = read("src", "app", "(app)", "lessons", "page.tsx");
const HW_DRAWER = read("src", "components", "homework", "homework-drawer.tsx");

/** The body of one `@media` block, by its exact condition text. */
function mediaBlock(condition: string): string {
  const head = `@media ${condition}{`;
  const start = CSS.indexOf(head);
  assert.notEqual(start, -1, `no @media ${condition} block in globals.css`);
  let depth = 0;
  for (let i = start + head.length - 1; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) return CSS.slice(start + head.length, i);
    }
  }
  throw new Error(`unterminated @media ${condition}`);
}

const MOBILE = mediaBlock("(max-width:620px)");
/** Everything before the first breakpoint — the rules that apply at every size. */
const DESKTOP = CSS.slice(0, CSS.indexOf("@media (max-width:1100px)"));

/** The content box a phone actually gives a screen, read from the stylesheet's
 * own mobile padding rather than from a number restated here. */
function contentWidth(viewport: number): number {
  const m = MOBILE.match(/\.app-main\{padding:\d+px (\d+)px/);
  assert.ok(m, "the mobile block must state main's padding");
  return viewport - Number(m[1]) * 2;
}

const PHONES = [360, 375, 390, 414];

/* ============================================================ A. drawer form */

describe("Drawer forms — every control takes its width from the panel", () => {
  it("1. the date field's intrinsic width floor is removed", () => {
    /* This is the whole of the Due date fault. A native date control lays out
     * its own segments plus a picker indicator and reports THAT as its size, so
     * width:100% cannot take it below the floor, and iOS ignores the width
     * outright until the UA appearance is off. Inside a column flex container
     * the floor becomes the form's width and the panel gains a horizontal axis
     * — which is what "the drawer can still be dragged sideways" was. */
    assert.match(DESKTOP, /input\[type="date"\]\{[^}]*appearance:none/);
    assert.match(DESKTOP, /input\[type="date"\]\{[^}]*min-width:0/);
    assert.match(DESKTOP, /input\[type="date"\]\{[^}]*max-width:100%/);
  });

  it("2. the fix is stated outside any breakpoint", () => {
    // A control that defines its own width is wrong at every size. Had this
    // lived in the mobile block it would have read as a phone workaround.
    assert.ok(!MOBILE.includes('input[type="date"]'), "must not be a mobile-only patch");
  });

  it("3. the open/focus state is painted in the form's own tokens", () => {
    /* The border and ring already come from `.ring:focus`. The SEGMENT the
     * caret sits in is the UA's system highlight — a blue block in a form whose
     * entire active language is --accent. That was the "incorrect active
     * styling" report, and it is repainted rather than left to disagree. */
    assert.match(DESKTOP, /-webkit-datetime-edit-day-field:focus/);
    assert.match(DESKTOP, /-webkit-datetime-edit-year-field:focus\{[^}]*var\(--accent-soft\)/);
  });

  it("4. the fix is shared, not a Homework exception", () => {
    // Both date fields in the app are reached by the one element selector, and
    // neither screen carries a rule of its own.
    const withDates = ["homework/homework-drawer.tsx", "students/student-drawer.tsx"];
    for (const rel of withDates) {
      const src = read("src", "components", ...rel.split("/"));
      assert.ok(src.includes('type="date"'), `${rel} should hold a date field`);
    }
    assert.ok(!/#hw-due/.test(CSS), "no Homework-only selector may exist");
  });

  it("5. no field in a drawer form states a width of its own", () => {
    /* The sibling controls were never the fault, but they are why the fault was
     * visible: they all sized to 100% of the panel, so the one that did not
     * stood out as wider. They now say so explicitly. */
    const forms = [
      "homework/homework-drawer.tsx", "students/student-drawer.tsx",
      "parents/parent-drawer.tsx", "classes/class-drawer.tsx",
    ];
    for (const rel of forms) {
      const src = read("src", "components", ...rel.split("/"));
      assert.match(src, /width: "100%", minWidth: 0, maxWidth: "100%"/, `${rel} field style`);
    }
  });

  it("6. the form itself cannot be forced wider than the panel", () => {
    assert.ok(HW_DRAWER.includes('flexDirection: "column", minWidth: 0'));
    assert.match(MOBILE, /\.app-drawer-body form\{min-width:0\}/);
  });
});

/* ================================================== B/C. attendance KPI grids */

describe("Attendance — KPI grids state a mobile column count", () => {
  it("7. the index statistics pair stacks", () => {
    assert.match(MOBILE, /\.att-stats\{grid-template-columns:minmax\(0,1fr\) !important\}/);
    assert.ok(ATT_INDEX.includes('className="att-stats"'));
  });

  it("8. the loading skeleton settles into the same shape", () => {
    // A skeleton in a desktop grid that resolves into a stacked one is a jump
    // the teacher sees on every load, so both grids carry the class.
    const uses = ATT_INDEX.split('className="att-stats"').length - 1;
    assert.equal(uses, 2, "the real grid and the skeleton must both opt in");
  });

  it("9. the This month card can fit its ring beside its tiles on a phone", () => {
    /* The arithmetic the stack exists for. The card is 20px padded a side, the
     * ring is a 96px non-shrinking element and the gap beside it is 18px; what
     * remains has to hold two tiles. Unstacked, the card was ~40% of the content
     * box and this came out negative — which is what "the card breaks" was. */
    const RING = 96, GAP = 18, CARD_PAD = 20 * 2, TILE_GAP = 8;
    for (const phone of PHONES) {
      const tiles = contentWidth(phone) - CARD_PAD - RING - GAP;
      const perTile = (tiles - TILE_GAP) / 2;
      assert.ok(perTile >= 80, `at ${phone}px each KPI tile gets ${perTile}px`);
    }
  });

  it("10. the tile grid is a flex child that may shrink", () => {
    // Without min-width:0 a flex child is floored at its content's size, so the
    // tiles — not the space available — would decide the card's width.
    assert.ok(ATT_INDEX.includes('flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)"'));
  });

  it("11. the register's five KPI cards go to two columns", () => {
    assert.match(MOBILE, /\.att-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important\}/);
    assert.ok(ATT_DETAIL.includes('className="att-summary"'));
  });

  it("12. the odd fifth card spans rather than sitting beside a gap", () => {
    /* Five cards in two columns leave one alone on the last row. The odd one is
     * Attendance rate — the only card carrying --card-2, which is the design's
     * own "this is the total" surface — so spanning it follows the design's
     * convention rather than inventing one. */
    assert.match(MOBILE, /\.att-summary>:last-child\{grid-column:1 \/ -1\}/);
    const summary = ATT_DETAIL.slice(ATT_DETAIL.indexOf('className="att-summary"'));
    const rateCard = summary.indexOf('background: "var(--card-2)"');
    const listEnd = summary.indexOf("student list");
    assert.ok(rateCard > 0 && rateCard < listEnd, "the --card-2 card must be the last one");
  });

  it("13. two columns are readable at every supported width", () => {
    for (const phone of PHONES) {
      const perCard = (contentWidth(phone) - 10) / 2;   // one 10px gap
      assert.ok(perCard >= 140, `at ${phone}px each KPI card gets ${perCard}px`);
    }
  });

  it("14. nothing is made to fit by shrinking type", () => {
    // The KPI figure and its label keep the sizes the design gives them; only
    // the column count changes.
    assert.ok(ATT_DETAIL.includes("fontSize: 22, fontWeight: 700"));
    assert.ok(!/\.att-summary[^}]*font-size/.test(MOBILE), "no font-size in the mobile rule");
    assert.ok(!/\.att-stats[^}]*font-size/.test(MOBILE));
  });
});

/* ============================================== C. the register's action bar */

describe("Attendance register — a sticky, safe-area-aware action bar", () => {
  it("15. the save bar's bleed matches the padding actually in force", () => {
    /* The bar bleeds to the edges of the content area with negative margins.
     * They were -32/-48 — <main>'s DESKTOP padding — while the mobile block sets
     * 14/40, so the bar was 36px wider than the viewport and the PAGE scrolled
     * sideways because of its own footer. The numbers are checked against each
     * other rather than restated here. */
    const desktopBleed = ATT_DETAIL.match(/margin: "0 (-\d+)px (-\d+)px"/);
    assert.ok(desktopBleed, "the component must state its desktop bleed");
    assert.equal(desktopBleed[1], "-32", "desktop bleed must match desktop side padding");
    assert.equal(desktopBleed[2], "-48", "desktop bleed must match desktop bottom padding");

    const pad = MOBILE.match(/\.app-main\{padding:(\d+)px (\d+)px (\d+)px/);
    assert.ok(pad, "the mobile block must state main's padding");
    const bleed = MOBILE.match(/\.act-bar\{[\s\S]*?margin:0 -(\d+)px -(\d+)px !important/);
    assert.ok(bleed, "the mobile block must restate the bleed");
    assert.equal(bleed[1], pad[2], "side bleed must equal mobile side padding");
    assert.equal(bleed[2], pad[3], "bottom bleed must equal mobile bottom padding");
  });

  it("16. the bar accounts for the home indicator", () => {
    assert.match(MOBILE, /\.act-bar\{[\s\S]*?env\(safe-area-inset-bottom\)/);
  });

  it("17. Save takes the content width instead of a far corner", () => {
    assert.match(MOBILE, /\.act-bar>\.act-bar-cta\{flex:1 0 100% !important/);
    assert.ok(ATT_DETAIL.includes('className="btn-primary act-bar-cta"'));
    assert.ok(ATT_DETAIL.includes('className="act-bar-meta"'), "the status line takes its own line");
    assert.ok(ATT_DETAIL.includes('className="act-bar"'));
  });

  it("18. the bar is sticky, so it can never cover the content above it", () => {
    /* A sticky element stays in flow and reserves its own space; a fixed one
     * would sit over the last student row. This is why no bottom padding has to
     * be guessed to compensate for the bar's height. */
    const bar = ATT_DETAIL.slice(ATT_DETAIL.indexOf('className="act-bar"'), ATT_DETAIL.indexOf('className="act-bar"') + 220);
    assert.match(bar, /position: "sticky", bottom: 0/);
    assert.ok(!bar.includes('position: "fixed"'));
  });

  it("19. save semantics are untouched", () => {
    // Presentation only: the same mutation, the same complete-register payload,
    // the same dirty test. Nothing here is an Attendance rule.
    assert.ok(ATT_DETAIL.includes("saveAttendanceRegister(lessonId, submitFrom(rows, draft))"));
    assert.ok(ATT_DETAIL.includes("onClick={() => save.mutate()}"));
    assert.ok(ATT_DETAIL.includes("disabled={save.isPending}"));
  });

  it("20. the status control and the note stop holding desktop floors", () => {
    assert.match(MOBILE, /\.att-seg\{[\s\S]*?flex:1 0 100% !important;min-width:0 !important/);
    assert.match(MOBILE, /\.att-note\{flex:1 0 100% !important;min-width:0 !important\}/);
    assert.ok(ATT_DETAIL.includes('className="att-seg"'));
    assert.ok(ATT_DETAIL.includes('className="ring att-note"'));
  });

  it("21. the status segments fit the boxes they are given", () => {
    /* The segments are nowrap and equal-width, so each box has to hold the
     * longest label outright — a label that does not fit does not wrap, it
     * clips. Four across one phone line gives ~70px against the ~75px "Excused"
     * needs, which is why the control goes 2x2 here rather than buying five
     * pixels back off its padding. */
    assert.match(MOBILE, /\.att-seg\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    const LONGEST = "Excused".length * 7.5 + 22;   // ~12.5px type + 11px padding a side
    for (const phone of PHONES) {
      const perSegment = (contentWidth(phone) - 36 - 6) / 2;   // row padding + one gap
      assert.ok(perSegment >= LONGEST, `at ${phone}px a segment gets ${perSegment}px, needs ${LONGEST}`);
    }
  });
});

/* ================================================== D. the class action row */

describe("Classes detail — the action row has a mobile hierarchy", () => {
  it("22. the row wraps at the button boundary", () => {
    assert.match(MOBILE, /\.act-row\{flex-wrap:wrap !important\}/);
    assert.ok(CLASS_DETAIL.includes('className="act-row"'));
  });

  it("23. the primary action stays visible and owns a line", () => {
    assert.match(MOBILE, /\.act-row>\.act-primary\{flex:1 0 100% !important\}/);
    assert.ok(CLASS_DETAIL.includes('className="act-primary"'));
  });

  it("24. Edit stays directly accessible, beside the status action", () => {
    assert.match(MOBILE, /\.act-row>\.act-secondary\{flex:1 1 auto !important/);
    // Edit, plus whichever of Archive / Restore the class's status offers.
    const secondary = CLASS_DETAIL.split("act-secondary").length - 1;
    assert.equal(secondary, 3, "Edit, Archive and Restore must all be secondary");
  });

  it("25. Delete stays the fixed-size icon action it already was", () => {
    /* It is the destructive action and it carries no label, so it was never the
     * thing that wrapped. It keeps its 36px icon button and its tooltip name —
     * demoting it further would have cost it its accessible label. */
    assert.ok(CLASS_DETAIL.includes('aria-label={t("Delete")}'));
    assert.ok(CLASS_DETAIL.includes('className="icon-danger"'));
    assert.ok(!CLASS_DETAIL.includes('className="icon-danger act-'), "no responsive class on Delete");
  });

  it("26. no label may be the thing that wraps", () => {
    // The row breaks; the words inside a button do not.
    assert.match(CLASS_DETAIL, /const headBtn: React\.CSSProperties = \{[\s\S]*?whiteSpace: "nowrap"/);
  });

  it("27. lifecycle behaviour is untouched", () => {
    // Presentation only — the same three handlers, unchanged.
    assert.ok(CLASS_DETAIL.includes('onClick={() => setStatus("Archived")}'));
    assert.ok(CLASS_DETAIL.includes('onClick={() => setStatus("Active")}'));
    assert.ok(CLASS_DETAIL.includes("onClick={() => setConfirm(true)}"));
  });
});

/* ============================================ E/F. the shared metadata row */

describe("Metadata rows — one shape, one rule, three screens", () => {
  const ROWS: [string, string][] = [
    ["dashboard Today's classes", DASHBOARD],
    ["lessons list", LESSONS],
    ["attendance Recent lessons", ATT_INDEX],
  ];

  it("28. the rule exists and moves the trailing group to its own line", () => {
    assert.match(MOBILE, /\.meta-row\{flex-wrap:wrap !important\}/);
    assert.match(MOBILE, /\.meta-row>\.meta-trail\{[\s\S]*?flex:1 0 100% !important/);
    assert.match(MOBILE, /\.meta-row>\.meta-trail\{[\s\S]*?min-width:0 !important/);
  });

  it("29. every screen showing this shape is opted in", () => {
    // This is the assertion that would have caught the v2 miss: a rule only one
    // of three identical rows uses is not a shared pattern.
    for (const [name, src] of ROWS) {
      assert.ok(src.includes("meta-row"), `${name} must use the shared row`);
      assert.ok(src.includes('className="meta-trail" style={{ display: "contents" }}'), `${name} must group its trail`);
    }
  });

  it("30. the desktop row is the same layout it always was", () => {
    /* display:contents makes the wrapper draw no box at all, so above the
     * breakpoint the trailing children are still direct flex items of the row,
     * in their original order. That is why this costs the desktop nothing, and
     * it is why a wrapper was preferred over restructuring the row. */
    assert.ok(!DESKTOP.includes(".meta-row"), "no meta-row rule outside the breakpoint");
    assert.ok(!DESKTOP.includes(".meta-trail"));
  });

  it("31. the title still gets the whole first line", () => {
    // The primary text block is the only growable child on line 1, and it has to
    // be allowed to shrink below its content or the row overflows instead.
    for (const [name, src] of ROWS) {
      assert.ok(src.includes("flex: 1, minWidth: 0"), `${name} title block needs min-width:0`);
    }
  });

  it("32. the class name has room to render without wrapping", () => {
    /* What the report actually described: the name wrapping to three lines
     * because the trailing group had taken the width. With the trail on its own
     * line, line 1 is the date tile, the colour rule and the name. */
    const TILE = 46, RULE = 3, GAPS = 14 * 2, ROW_PAD = 18 * 2;
    for (const phone of PHONES) {
      const forName = contentWidth(phone) - ROW_PAD - TILE - RULE - GAPS;
      assert.ok(forName >= 200, `at ${phone}px the class name gets ${forName}px`);
    }
  });

  it("33. nothing was solved by shrinking type", () => {
    for (const [name, src] of ROWS) {
      assert.ok(src.includes("fontSize: 13.5, fontWeight: 600"), `${name} keeps its title size`);
    }
    assert.ok(!/\.meta-(row|trail)[^}]*font-size/.test(MOBILE));
  });
});

/* ---------------------------------------------------------- honest limits */

describe("Components — overflow is solved, not hidden", () => {
  it("34. no component reaches for overflow-x:hidden", () => {
    /* Clipping is how a broken geometry survives a screenshot. The single
     * permitted use stays the drawer panel, whose own geometry is correct — the
     * same exception responsive-shell.test.ts already holds. */
    const offenders = [...CSS.matchAll(/([^{}]+)\{[^}]*overflow-x:hidden[^}]*\}/g)].map((m) => m[1].trim());
    for (const selector of offenders) {
      assert.ok(selector.includes(".app-drawer"), `overflow-x:hidden on "${selector}" would hide the fault`);
    }
  });

  it("35. every responsive class in the markup has a rule behind it", () => {
    // A class with no rule is a fix that silently does nothing — which is the
    // failure mode this whole remediation is a second attempt at.
    const classes = [
      "att-stats", "att-summary", "att-seg", "att-note",
      "act-bar", "act-bar-meta", "act-bar-cta",
      "act-row", "act-primary", "act-secondary",
      "meta-row", "meta-trail",
    ];
    const markup = [ATT_INDEX, ATT_DETAIL, CLASS_DETAIL, DASHBOARD, LESSONS].join("\n");
    for (const c of classes) {
      assert.ok(MOBILE.includes(`.${c}`), `.${c} has no rule in the mobile block`);
      assert.ok(markup.includes(c), `.${c} has a rule but no markup uses it`);
    }
  });

  it("36. every rule lives inside the mobile breakpoint", () => {
    // Desktop must be reachable only through the code it already had.
    for (const c of ["att-stats", "att-summary", "att-seg", "act-bar", "act-row", "meta-row"]) {
      assert.ok(!DESKTOP.includes(`.${c}`), `.${c} must not apply above the breakpoint`);
    }
  });
});
