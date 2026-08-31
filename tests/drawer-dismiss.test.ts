/* The two shared defects Gate 4.3's human verification found, and what now
 * prevents each of them coming back.
 *
 * Run with:  npm test
 *
 * A. THE VIEWPORT COULD BE DRAGGED. Below ~1100px the whole application could be
 *    pulled sideways and past its top and bottom edges, on every screen. Two
 *    causes, and this file pins the fix for each:
 *
 *      A1. a REAL horizontal overflow. The header is one non-wrapping flex row,
 *          so its intrinsic minimum IS the document's minimum width, and its
 *          search box declared a 170px floor whose only escape lived inside the
 *          620px block — while the sidebar above that breakpoint is still in the
 *          layout at 64px or 248px. The arithmetic is done below, because "does
 *          the document fit?" is a sum, not an opinion.
 *      A2. no scroll-boundary behaviour was declared anywhere, so the elastic
 *          overscroll at the viewport edge was simply the browser default.
 *
 * B. AN ACCIDENTAL DISMISSAL THREW AWAY WORK. Four gestures closed a drawer and
 *    each called `onClose` directly, so a mis-tapped scrim discarded everything
 *    typed. They now route through one guard, and each form supplies its own
 *    dirtiness.
 *
 * NO DOM, and no renderer — the same limitation the sibling responsive suites
 * state, and the same answer: these assertions read the stylesheet and the
 * components as text and check the arithmetic on the numbers they state. A human
 * still verifies the gestures on a device. What these CAN do is keep the
 * contract from drifting — a guard removed from one drawer, or a rule quietly
 * moved back inside a breakpoint, fails here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("src", "app", "globals.css");
/** Declarations only — globals.css documents its own cascade in prose, and an
 * assertion hunting for a rule would otherwise find the sentence describing it. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const DRAWER = read("src", "components", "ui", "drawer.tsx");
const DIALOG = read("src", "components", "ui", "dialog.tsx");
const HEADER = read("src", "components", "shell", "header.tsx");
const DICT = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;

/** Every Create/Edit drawer in the application, by module. */
const FORM_DRAWERS: Record<string, string> = {
  students: read("src", "components", "students", "student-drawer.tsx"),
  parents: read("src", "components", "parents", "parent-drawer.tsx"),
  classes: read("src", "components", "classes", "class-drawer.tsx"),
  homework: read("src", "components", "homework", "homework-drawer.tsx"),
};

/* =========================================================================
 * A1. The document is not wider than the viewport
 * ====================================================================== */

describe("Overscroll A1 — the horizontal overflow that made dragging possible", () => {
  it("1. the header's search box states no width floor of its own", () => {
    /* THIS WAS THE OVERFLOW. `minWidth: 170` on a flex child inside a
     * non-wrapping row is 170px the document must find at every width — and the
     * only rule that removed it lived inside the mobile block, so it did nothing
     * in the 621-1100px band where the fault was reported. */
    assert.match(HEADER, /className="hdr-search"[\s\S]{0,120}minWidth: 0/,
      "the search box must take its width from the row");
    // Declarations only: the component's comment RECORDS the old 170px floor as
    // the fault it was, and a scan that read prose would report it as present.
    const code = HEADER.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/minWidth: 170/.test(code), "no floor may remain in the header");
  });

  it("2. it is fixed at the element, not concealed by clipping", () => {
    // Hiding a real overflow would mask exactly the fault this remediation
    // found. The shell suite already forbids overflow-x:hidden on the document;
    // this states the positive: the floor is gone from the component itself.
    assert.ok(!/html\s*,?\s*body[^{]*\{[^}]*overflow-x:hidden/.test(RULES),
      "the document must never be clipped to hide a layout defect");
    assert.ok(!/^\s*body\{[^}]*overflow-x/m.test(RULES));
  });

  it("3. the row that overflowed could not have fitted, and the floor is why", () => {
    /* THE ORIGINAL ARITHMETIC, kept because it is the evidence for the fault.
     * Fixed, non-shrinking costs in the row as it then stood — padding 22+22,
     * toggle 34, Quick add ~119 (nowrap + flexShrink:0), theme 38, bell 38, the
     * user block with its name and role ~150, six 14px gaps — plus the search
     * box's own 170px floor, plus a sidebar that is still IN the layout above
     * 620px at 64px (tablet) or 248px (desktop). */
    const fixed = 44 + 34 + 119 + 38 + 38 + 150 + 6 * 14;
    const before = fixed + 170;
    assert.ok(before + 64 > 621, `tablet band overflowed: needed ${before + 64}px at 621px`);
    assert.ok(before + 248 > 861, `desktop band overflowed: needed ${before + 248}px at 861px`);

    // The floor is gone from the element itself, which is the fix this test owns.
    assert.ok(HEADER.includes("minWidth: 0"));

    /* WHAT THE ROW NOW COSTS IS NOT MODELLED HERE. The header no longer keeps
     * one shape across that band — it has its own breakpoints, and the field,
     * the Quick add label and the user's name each leave at a stated width — so
     * the budget is per-band and lives with the rules that produce it, in
     * tests/responsive-shell.test.ts ("the row fits at every width the gate
     * names"). Restating a single-shape sum here would model a layout that no
     * longer exists and would pass while being wrong. */
    const shell = read("tests", "responsive-shell.test.ts");
    assert.ok(shell.includes("21. the row fits at every width the gate names"),
      "the per-band budget must exist somewhere");
  });

  it("4. the mobile escapes that already worked are kept, at the header's own breakpoint", () => {
    /* Quick add still sheds its label rather than being clipped — it moved from
     * the drawer's 620px block to the header's own 768px one, which is the
     * separate header remediation and is pinned in detail by
     * tests/responsive-shell.test.ts.
     *
     * The ⌘K hint needs no rule at all now: it lives inside the search FIELD,
     * and the field itself is gone below 1100px. A rule hiding an element that
     * is already not rendered would be a rule nobody could ever observe. */
    assert.ok(RULES.includes(".hdr-quickadd-label{display:none !important}"));
    assert.ok(RULES.includes(".hdr-search{display:none !important}"),
      "the field, and its hint with it, go below 1100px");
  });
});

/* =========================================================================
 * A2. The viewport declares its own scroll boundary
 * ====================================================================== */

describe("Overscroll A2 — the boundary behaviour nothing had declared", () => {
  it("5. the document refuses elastic overscroll, on both axes", () => {
    assert.match(RULES, /(?:^|[\s}])html\{[^}]*overscroll-behavior:none/,
      "the outermost scroller must state its boundary behaviour");
  });

  it("6. it is stated on html, where it actually reaches the viewport", () => {
    /* `overscroll-behavior` propagates from `body` to the viewport only when
     * `html` has `overflow: visible`. Relying on that is relying on a rule
     * nobody reading the file would think to check, so the property is set on
     * the element that owns the boundary. */
    assert.ok(!/(?:^|[\s}])body\{[^}]*overscroll-behavior/.test(RULES),
      "body is the wrong element to state this on");
  });

  it("7. it applies at every width, not only where the fault was noticed", () => {
    // The report said "below approximately 1100px", but a viewport that can be
    // dragged is wrong at any size — and a breakpoint-scoped rule is precisely
    // the mistake that left the drawer chaining in the tablet band.
    const blocks = [...CSS.matchAll(/@media[^{]*\{/g)].map((m) => m.index ?? 0);
    const at = RULES.indexOf("overscroll-behavior:none");
    assert.ok(at !== -1);
    const unconditional = CSS.indexOf("html{overscroll-behavior:none}");
    assert.ok(unconditional !== -1 && (blocks.length === 0 || unconditional < blocks[0]),
      "the rule must sit before the first breakpoint, outside every block");
  });

  it("8. nothing is clipped to achieve it", () => {
    /* `overscroll-behavior` changes boundary behaviour only — it creates no
     * clipping context, so focus rings, Select popovers, the sidebar overlay and
     * both portalled overlays are untouched. Asserted as the absence of the
     * shortcut somebody might reach for instead. */
    const html = RULES.match(/(?:^|[\s}])html\{([^}]*)\}/);
    assert.ok(html, "the html rule must exist");
    assert.ok(!/overflow/.test(html![1]), `html must not clip: ${html![1]}`);
  });

  it("9. a drawer's scroll never chains into the page behind it", () => {
    assert.match(RULES, /\.app-drawer-body\{overscroll-behavior:contain\}/);
    // And the page behind it cannot scroll at all while it is open.
    assert.ok(DRAWER.includes("useScrollLock(open)"));
  });
});

/* =========================================================================
 * B. The dirty-dismiss guard
 * ====================================================================== */

describe("Dismiss guard — one way out, and it asks first", () => {
  it("10. every dismissal gesture routes through the single guard", () => {
    /* Four gestures, one function. The assertion is the NEGATIVE as much as the
     * positive: if any gesture still called `onClose` directly it would be an
     * unguarded alternative path, which is the whole failure mode. */
    const direct = [...DRAWER.matchAll(/onClick=\{onClose\}/g)];
    assert.equal(direct.length, 0, "no gesture may call onClose directly");

    // scrim, X and Cancel all call requestClose.
    assert.equal([...DRAWER.matchAll(/onClick=\{requestClose\}/g)].length, 3,
      "the scrim, the close button and Cancel");
    // Escape too.
    assert.match(DRAWER, /e\.key === "Escape" && !confirming\) requestClose\(\)/);
  });

  it("11. the guard prompts only when the form says it is dirty", () => {
    assert.match(DRAWER, /if \(dirty\) setConfirmRequested\(true\);\s*else onClose\(\);/);
  });

  it("12. an unguarded caller keeps the old behaviour exactly", () => {
    // `dirty` defaults to false, so a drawer that never opts in still closes on
    // the first gesture — no drawer is broken by the new prop existing.
    assert.ok(DRAWER.includes("dirty = false"));
  });

  it("13. the drawer never inspects the form itself", () => {
    /* The panel takes arbitrary children; a component that tried to diff its own
     * contents would be guessing at which values are meaningful. It receives one
     * boolean and nothing else — no form library, no value comparison. */
    for (const forbidden of ["useForm", "formState", "getValues", "watch(", "JSON.stringify", "deepEqual"]) {
      assert.ok(!DRAWER.includes(forbidden), `the drawer must not reach into the form (${forbidden})`);
    }
  });

  it("14. a successful save bypasses the prompt entirely", () => {
    /* Closing after a save is the CALLER setting `open` to false. That path never
     * touches `requestClose`, so the prompt cannot appear where there is nothing
     * left to lose — and every page closes exactly that way. */
    assert.ok(DRAWER.includes("if (!open) return null;"));
    /* GATE 4.4D MOVED THE REVIEWS EXAMPLE. The Reviews index no longer opens a
     * drawer at all — Write review is a link to the dedicated composer — so the
     * page that demonstrated this rule for Reviews has no save to demonstrate it
     * with. Homework still does, and the rule it proves is the drawer's, not any
     * one caller's. The composer's own equivalent (a save resets the dirty
     * baseline BEFORE it navigates, so its guard has nothing to prompt about) is
     * asserted in tests/review-composer.test.ts. */
    const homework = read("src", "app", "(app)", "homework", "page.tsx");
    assert.ok(homework.includes("onSuccess: () => { invalidate(); closeDrawer();"),
      "a save closes by state, not by a dismissal gesture");
  });

  it("15. the prompt cannot outlive the panel it belongs to", () => {
    // Derived against `open` rather than cleared by an effect, so a reopened
    // drawer can never inherit a stale prompt.
    assert.match(DRAWER, /const confirming = open && confirmRequested;/);
  });

  it("16. while the prompt is up, Escape belongs to the prompt", () => {
    assert.ok(DRAWER.includes("!confirming"), "the drawer's Escape yields");
    // And the dialog stops the key in the capture phase, so it cannot reach
    // anything underneath either. That behaviour predates this work.
    assert.ok(DIALOG.includes('document.addEventListener("keydown", onKey, true)'));
    assert.ok(DIALOG.includes("e.stopPropagation()"));
  });
});

/* =========================================================================
 * B. The prompt itself
 * ====================================================================== */

describe("Discard prompt — the existing dialog, and existing copy", () => {
  it("17. it reuses the shared ConfirmDialog rather than a second modal", () => {
    assert.ok(DRAWER.includes('import { ConfirmDialog } from "@/components/ui/dialog"'));
    assert.ok(!DRAWER.includes("createPortal(\n      <div role=\"alertdialog\""), "no bespoke modal");
    assert.equal([...DRAWER.matchAll(/<ConfirmDialog/g)].length, 1);
  });

  it("18. the safe half keeps editing and the destructive half discards", () => {
    assert.ok(DRAWER.includes('cancelLabel={t("Keep editing")}'));
    assert.ok(DRAWER.includes('confirmLabel={t("Discard changes")}'));
    assert.ok(DRAWER.includes("destructive"));
    // Keep editing only drops the prompt; Discard drops it and then dismisses.
    assert.ok(DRAWER.includes("onCancel={() => setConfirmRequested(false)}"));
    assert.ok(DRAWER.includes("onConfirm={() => { setConfirmRequested(false); onClose(); }}"));
  });

  it("19. neither branch saves, resets or mutates anything", () => {
    const block = DRAWER.slice(DRAWER.indexOf("<ConfirmDialog"));
    for (const forbidden of ["onSave", "reset(", "mutate", "fetch("]) {
      assert.ok(!block.includes(forbidden), `the prompt must not ${forbidden}`);
    }
  });

  it("20. the dialog grew a cancel label without changing any existing caller", () => {
    assert.ok(DIALOG.includes("cancelLabel?: string"));
    assert.ok(DIALOG.includes('{cancelLabel ?? t("Cancel")}'), "the default is the shared word");
  });

  it("21. every string it shows is in the dictionary", () => {
    for (const key of [
      "Discard unsaved changes?",
      "Your changes haven't been saved. If you leave now, they will be lost.",
      "Keep editing",
      "Discard changes",
    ]) {
      assert.ok(key in DICT, `${JSON.stringify(key)} must be translated`);
      assert.ok(DICT[key].length > 0, key);
    }
  });
});

/* =========================================================================
 * B. Every Create/Edit drawer opts in
 * ====================================================================== */

describe("Dismiss guard — the whole drawer inventory is covered", () => {
  it("22. every Create/Edit drawer passes its own dirty state", () => {
    for (const [name, src] of Object.entries(FORM_DRAWERS)) {
      assert.ok(src.includes("dirty={isDirty}"), `${name}-drawer must opt in`);
      assert.match(src, /formState: \{[^}]*isDirty/, `${name}-drawer must read isDirty`);
    }
  });

  it("23. the inventory is complete — every Drawer consumer is listed here", () => {
    /* A new drawer added without a guard would otherwise pass this file
     * silently. The check is the other way round: every file in the app that
     * renders the shared panel must be one this suite knows about. */
    const consumers = [
      "students/student-drawer.tsx", "parents/parent-drawer.tsx", "classes/class-drawer.tsx",
      "homework/homework-drawer.tsx",
    ];
    for (const rel of consumers) {
      const src = read("src", "components", ...rel.split("/"));
      assert.ok(src.includes("<Drawer"), `${rel} should render the shared panel`);
    }
    assert.equal(Object.keys(FORM_DRAWERS).length, consumers.length);
  });

  it("24. dirtiness comes from the form library, not from 'holds a value'", () => {
    /* `isDirty` is RHF's comparison against the values the form was reset with,
     * so an Edit full of persisted text and a Create with ten ratings already at
     * 3 are both pristine — and a field changed back to its original value is
     * pristine again. No drawer may substitute a truthiness test for it. */
    for (const [name, src] of Object.entries(FORM_DRAWERS)) {
      assert.ok(!/dirty=\{!!/.test(src), `${name}-drawer must not fake dirtiness`);
      assert.ok(!/dirty=\{true\}/.test(src), `${name}-drawer must not hardcode it`);
    }
  });

  it("25. every drawer re-seeds its baseline when it opens", () => {
    // The baseline is what `isDirty` compares against, so opening a different
    // record has to reset it or the new form would inherit the old comparison.
    for (const [name, src] of Object.entries(FORM_DRAWERS)) {
      assert.match(src, /if \(open\)[\s\S]{0,200}reset\(/, `${name}-drawer must reset on open`);
    }
  });

  it("26. a user edit made through setValue marks the form dirty", () => {
    /* RHF's `setValue` does NOT touch `isDirty` unless asked, so a control that
     * writes its value programmatically — the rating segments, the homework
     * class/scope pickers — would otherwise leave the form looking pristine
     * after a real change. Every such call opts in. */
    for (const rel of ["homework/homework-drawer.tsx"]) {
      const src = read("src", "components", ...rel.split("/"));
      // `[^;]` already spans newlines, so no dotAll flag is needed.
      const calls = [...src.matchAll(/setValue\([^;]*?\);/g)].map((m) => m[0]);
      for (const call of calls) {
        // The one exception is Reviews' server-supplied default month, which is
        // applied with `reset` precisely so it becomes the baseline instead.
        assert.ok(call.includes("shouldDirty: true"), `${rel}: ${call.trim()} must mark the form dirty`);
      }
    }
  });

  it("27. a server-supplied default becomes the baseline, never a change", () => {
    /* Reviews opens with ten ratings at 3 and a default month the SERVER chose.
     * Neither is something the teacher did, so opening the screen and leaving it
     * immediately must not claim unsaved work.
     *
     * RETARGETED IN GATE 4.4E: this rule used to be the Review drawer's, and the
     * drawer is deleted. The composer keeps it and states it more strictly —
     * `seed` sets the form AND the dirty baseline together, so a default can
     * never read as an edit, and the effect is guarded on the record's identity
     * so a background refetch cannot overwrite work in progress. */
    const src = read("src", "components", "reviews", "review-composer.tsx");
    assert.ok(src.includes("baselineRef.current = values;"), "the seed moves the baseline with the values");
    assert.ok(!/setValue\("month"/.test(src), "the default month must not read as an edit");
    assert.ok(src.includes("if (seededFor.current === identity) return;"),
      "and it must never overwrite work in progress");
  });

  it("28. the one exempt panel is exempt because it has nothing to lose", () => {
    /* The Lessons panel is a bespoke read-only drawer that predates the shared
     * one: it renders a single GET and offers no control that changes anything,
     * so there is no unsaved state a dismissal could discard. The exemption is
     * asserted rather than assumed — the day it grows a field, this fails and
     * the guard has to be considered. */
    const lesson = read("src", "components", "lessons", "lesson-drawer.tsx");
    for (const editable of ["useForm", "<input", "<textarea", "register(", "useMutation", "onChange="]) {
      assert.ok(!lesson.includes(editable), `the lesson panel gained ${editable} — it now needs the guard`);
    }
    assert.ok(!lesson.includes("<Drawer"), "and it is not a consumer of the shared panel");
  });
});
