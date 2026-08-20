/* The form-control contract: one field family, and a date field with a
 * visible empty state.
 *
 * Run with:  npm test
 *
 * WHY THIS FILE EXISTS. Gate 5 Phase 0 reported the shared Select as looking
 * wrong. It was not: `Select` is 38px tall at 13px type with 11px of inset, and
 * that is exactly what student-, parent- and class-drawer state for their text
 * inputs. What was wrong was the Homework drawer, which was built under the S1
 * waiver and picked 13.5px type at 12px of inset for its own fields — so on that
 * ONE screen the Select sat beside inputs a half-point larger and a pixel
 * further in, and read as a foreign control. The fix was to correct the outlier,
 * not the primitive five other screens depend on.
 *
 * The rest of the file holds the two genuinely shared defects that the same
 * report surfaced: a hover rule on the Select trigger that did not yield to
 * focus (so an open Select kept its hover fill, and on a touch device kept it
 * for as long as it was open), and a date input with no empty state at all.
 *
 * NO DOM. Same limitation as its siblings: assertions read the components and
 * the stylesheet as text. What they CAN do is keep every control in the family
 * stating the SAME numbers, so a future screen cannot quietly diverge the way
 * the Homework drawer did — that divergence is the entire bug this file guards.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("src", "app", "globals.css");
const SELECT = read("src", "components", "ui", "select.tsx");
const DATE_FIELD = read("src", "components", "ui", "date-field.tsx");
const VI = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;

/** The four drawers that draw the app's forms. */
const DRAWERS = {
  homework: read("src", "components", "homework", "homework-drawer.tsx"),
  students: read("src", "components", "students", "student-drawer.tsx"),
  parents: read("src", "components", "parents", "parent-drawer.tsx"),
  classes: read("src", "components", "classes", "class-drawer.tsx"),
};

/** Every rule that applies at every viewport, wherever it sits in the file.
 *
 * The interaction-state helpers (`.ring:focus` and friends) are declared AFTER
 * the breakpoints — deliberately, so they win on specificity ties — so a slice
 * taken at the first `@media` would miss them and report a rule that is present
 * as absent. Stripping the media blocks asks the question actually being asked:
 * does this apply unconditionally? */
const UNCONDITIONAL = (() => {
  let out = "";
  for (let i = 0; i < CSS.length; ) {
    const at = CSS.indexOf("@media", i);
    if (at === -1) { out += CSS.slice(i); break; }
    out += CSS.slice(i, at);
    let depth = 0, j = CSS.indexOf("{", at);
    for (; j < CSS.length; j++) {
      if (CSS[j] === "{") depth++;
      else if (CSS[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
})();

/** Source with block comments removed — so an assertion about the CODE is never
 * satisfied, or defeated, by prose describing it. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ========================================================== the field family */

describe("Form controls — one field family, one set of numbers", () => {
  it("1. every drawer's text input states the same geometry", () => {
    /* This is the assertion that would have caught the fault. The Homework
     * drawer stated 13.5px/12px against three drawers' 13px/11px, and nothing
     * anywhere compared them — so the divergence was invisible in review and
     * only showed up as "the Select looks wrong" on a device. */
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.match(
        src,
        /width: "100%", minWidth: 0, maxWidth: "100%", height: 38, padding: "0 11px"/,
        `${name}-drawer's field must state the family geometry`
      );
      assert.match(src, /fontSize: 13, fontFamily: "inherit", outline: "none"/, `${name}-drawer's field type size`);
      assert.match(src, /borderRadius: 9/, `${name}-drawer's field radius`);
    }
  });

  it("2. no drawer states a size of its own", () => {
    // The specific numbers the Homework drawer used. Naming them keeps the
    // regression legible rather than asserting a bare negative.
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.ok(!src.includes('height: 38, padding: "0 12px"'), `${name}-drawer must not re-inset its fields`);
      assert.ok(!src.includes("fontSize: 13.5, fontFamily"), `${name}-drawer must not resize its field type`);
    }
  });

  it("3. every textarea is derived from its drawer's field, not restated", () => {
    // Derivation is what makes the family reach multi-line controls: change
    // `field` and the textarea follows, instead of drifting a release later.
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.match(
        src,
        /\.\.\.field\(false\), height: "auto", minHeight: 76, padding: "10px 12px",[\s\S]{0,40}lineHeight: 1\.5, resize: "vertical"/,
        `${name}-drawer's textarea must derive from field`
      );
    }
  });

  it("4. the shared Select already matches that family", () => {
    /* The primitive was never the problem, and this records why: it states the
     * family's own numbers. If a future change to the family forgets the
     * Select, this fails rather than the Select silently becoming the outlier. */
    assert.match(SELECT, /width: "100%", height, padding: "0 11px"/);
    assert.match(SELECT, /height = 38/, "the default height is the family's");
    assert.match(SELECT, /borderRadius: 9/);
    assert.match(SELECT, /fontSize: 13,/);
    assert.match(SELECT, /background: "var\(--card\)"/);
  });

  it("5. the Select's border language is the family's, error state included", () => {
    // Resting --border, invalid --accent — the same two tokens, in the same
    // order, that every drawer's `field(invalid)` uses.
    assert.match(SELECT, /border: `1px solid \$\{invalid \? "var\(--accent\)" : "var\(--border\)"\}`/);
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.match(src, /border: `1px solid \$\{invalid \? "var\(--accent\)" : "var\(--border\)"\}`/, `${name}-drawer`);
    }
  });

  it("6. focus is the same treatment on a Select as on an input", () => {
    // Both opt into `.ring`, and `.ring:focus` is the single place the accent
    // border and the 3px ring are stated.
    assert.match(SELECT, /className="ring"/);
    assert.match(UNCONDITIONAL, /\.ring:focus\{border-color:var\(--accent\) !important;box-shadow:0 0 0 3px var\(--ring\) !important\}/);
  });

  it("7. no system-blue state survives on any control in the family", () => {
    /* Two places a UA paints its own colour into these forms: the outline on a
     * focused trigger, and the segment highlight inside a date input. Both are
     * answered in the app's tokens. */
    assert.match(UNCONDITIONAL, /input:focus-visible, textarea:focus-visible, \.ring:focus-visible\{outline:none\}/);
    // The three datetime-edit selectors are ONE grouped rule, so only the last
    // of them is followed by the declaration block.
    assert.match(UNCONDITIONAL, /-webkit-datetime-edit-day-field:focus,/);
    assert.match(UNCONDITIONAL, /-webkit-datetime-edit-year-field:focus\{background:var\(--accent-soft\);color:var\(--accent\)/);
    assert.match(UNCONDITIONAL, /button:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
  });

  it("8. placeholders are one tone across the family", () => {
    /* The Select paints its placeholder --muted-2. Text inputs were falling
     * through to the UA default — a different grey at a different opacity — so
     * the same empty field read differently depending on which control the
     * design happened to reach for. */
    assert.match(SELECT, /color: current \? "var\(--fg\)" : "var\(--muted-2\)"/);
    assert.match(UNCONDITIONAL, /::placeholder\{color:var\(--muted-2\);opacity:1\}/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?color:var\(--muted-2\)/);
  });
});

/* ============================================================= Select states */

describe("Select — every interaction state belongs to the app", () => {
  it("9. hover yields to focus, exactly as the input rule does", () => {
    /* The reported open-state fault. `input:hover` has always been guarded with
     * :not(:focus); the trigger rule was not, so an OPEN Select kept its hover
     * fill — and on a touch device, where :hover sticks after the tap that
     * opened it, it kept that fill for as long as the listbox was open. */
    assert.match(UNCONDITIONAL, /\[data-cs-trigger\]:hover:not\(:focus\)\{border-color:var\(--muted-2\) !important;background:var\(--hover\) !important\}/);
    assert.ok(
      !/\[data-cs-trigger\]:hover\{/.test(UNCONDITIONAL),
      "an unguarded trigger hover would win over the focused state again"
    );
    // The rule it is now symmetrical with.
    assert.match(UNCONDITIONAL, /input:not\(\[type=range\]\):hover:not\(:focus\)/);
  });

  it("10. the open listbox is exactly as wide as its trigger", () => {
    // left/right pinned to the trigger's own box: the control cannot change
    // width between closed and open, and cannot push the drawer sideways.
    assert.match(SELECT, /position: "absolute", top: "calc\(100% \+ 6px\)", left: 0, right: 0/);
    assert.match(SELECT, /position: "relative"/, "the wrapper must be the positioning context");
  });

  it("11. neither the trigger's value nor a row can overflow it", () => {
    const ellipsis = SELECT.split('overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"').length - 1;
    assert.equal(ellipsis, 2, "the trigger's value and each option row must both clip");
  });

  it("12. the chevron never moves", () => {
    // flex:none keeps it out of the shrink that clips the label beside it.
    assert.match(SELECT, /flex: "none", color: "var\(--muted-2\)"/);
    assert.match(SELECT, /justifyContent: "space-between"/);
  });

  it("13. the selected row is stated in the app's accent tokens", () => {
    assert.match(SELECT, /background: on \? "var\(--accent-soft\)" : "transparent"/);
    assert.match(SELECT, /color: on \? "var\(--accent\)" : "var\(--fg\)"/);
  });

  it("14. the trigger is a real listbox control", () => {
    // The states above are only worth checking if assistive tech sees the same
    // control a sighted user does.
    for (const attr of ['aria-haspopup="listbox"', "aria-expanded={open}", 'role="listbox"', 'role="option"', "aria-selected={on}"]) {
      assert.ok(SELECT.includes(attr), `Select must set ${attr}`);
    }
  });

  it("15. no consumer overrides the family height", () => {
    /* `height` is a prop, so it COULD diverge. Today nothing passes it, and
     * this is what would say so if a screen started to. */
    const consumers = [
      ...Object.values(DRAWERS),
      read("src", "app", "(app)", "homework", "page.tsx"),
      read("src", "app", "(app)", "students", "page.tsx"),
      read("src", "components", "lessons", "calendar-ui.tsx"),
    ];
    for (const src of consumers) {
      const selects = src.split("<Select").length - 1;
      if (!selects) continue;
      assert.ok(!/<Select[^/>]*height=\{/.test(src), "a Select must not restate the family height");
    }
  });

  it("16. Select has no disabled state, and no consumer asks for one", () => {
    /* Recorded rather than invented. The design has no disabled Select and
     * nothing in the app needs one — the two disabled controls in Classes are
     * buttons. Adding one would be new API for a state nothing renders, which
     * PROJECT_RULES puts off until a design exists for it. If a consumer ever
     * passes `disabled`, this fails and the state gets designed first. */
    assert.ok(!/disabled/.test(SELECT), "Select must not grow a disabled state unasked");
    const consumers = [...Object.values(DRAWERS), read("src", "components", "lessons", "calendar-ui.tsx")];
    for (const src of consumers) assert.ok(!/<Select[^/>]*disabled/.test(src));
  });
});

/* ================================================================ DateField */

describe("DateField — a native date input with a visible empty state", () => {
  it("17. the app draws the placeholder, because the input cannot", () => {
    /* `<input type="date">` does not support the placeholder attribute, and
     * what it draws while empty is the UA's business — Chrome prints
     * "mm/dd/yyyy", mobile Safari prints nothing. That is why this is markup
     * and not a CSS `content` trick on a control that has nothing to style. */
    assert.match(DATE_FIELD, /className="date-ph"/);
    assert.match(UNCONDITIONAL, /\.date-field\{position:relative;display:block\}/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?position:absolute/);
  });

  it("18. the placeholder is inset exactly like the field's own text", () => {
    // 1px of border plus the family's 11px of padding. If the family's inset
    // ever moves, this is what says the placeholder did not move with it.
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?left:1px/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?padding-inline-start:11px/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?font-size:13px/);
    for (const src of Object.values(DRAWERS)) assert.match(src, /padding: "0 11px"/);
  });

  it("19. the UA's own empty hint is hidden only while it would collide", () => {
    // Empty AND unfocused. Focus hands the field straight back so a keyboard
    // user types against segments they can see.
    assert.match(UNCONDITIONAL, /\.date-field\[data-empty="1"\]>input:not\(:focus\)\{color:transparent\}/);
    assert.match(UNCONDITIONAL, /\.date-field\[data-empty="1"\]>input:focus~\.date-ph\{opacity:0\}/);
  });

  it("20. the placeholder never intercepts a tap", () => {
    // It sits over the control, so the picker would be unreachable without it.
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?pointer-events:none/);
  });

  it("21. the native input is still the control", () => {
    /* No calendar, no parsing, no value of its own — the whole point. It stays
     * type=date, so the platform picker, the value contract, the payload and
     * the validation are all untouched. */
    assert.match(DATE_FIELD, /type="date"/);
    // codeOf: an assertion about the CODE must not be satisfied — or defeated —
    // by the prose that describes it.
    assert.ok(!/useState|useEffect|Calendar|parse|format/i.test(codeOf(DATE_FIELD)), "DateField must hold no state or date logic");
    assert.match(DATE_FIELD, /\{\.\.\.inputProps\}/, "it must forward the form's registration");
  });

  it("22. emptiness comes from the form, never from local state", () => {
    /* A reset() — which every drawer does when it opens for a different record
     * — changes the value with no event this component could observe, so local
     * state would go stale exactly when a teacher reopened the drawer. */
    assert.match(DATE_FIELD, /empty: boolean/);
    assert.match(DRAWERS.homework, /const dueDate = useWatch\(\{ control, name: "dueDate" \}\)/);
    assert.match(DRAWERS.homework, /empty=\{!dueDate\}/);
    assert.match(DRAWERS.students, /empty=\{!birthday\}/);
    assert.match(DRAWERS.students, /const birthday = useWatch\(\{ control, name: "birthday" \}\)/);
  });

  it("23. the guidance reaches a screen reader too", () => {
    // Described-by, not labelled-by: the <label> already names the field, and
    // the description drops away once there is a value to announce instead.
    assert.match(DATE_FIELD, /aria-describedby=\{empty \? describedBy : undefined\}/);
    assert.match(DATE_FIELD, /id=\{describedBy\}/);
    assert.match(DRAWERS.homework, /htmlFor="hw-due"/);
    assert.match(DRAWERS.students, /htmlFor="st-birthday"/);
    assert.match(DRAWERS.students, /id="st-birthday"/);
  });

  it("24. every date input in the app goes through the primitive", () => {
    /* The fix has to be the shared one. A bare type=date left anywhere would be
     * a field that still looks empty when it is empty. */
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.ok(!src.includes('type="date"'), `${name}-drawer must use DateField, not a bare date input`);
    }
    assert.match(DRAWERS.homework, /<DateField/);
    assert.match(DRAWERS.students, /<DateField/);
  });

  it("25. the copy is the product's own, and translated", () => {
    /* "Pick a due date" has been in the dictionary since S1 with nowhere to be
     * shown, because a native date input has no placeholder to put it in. */
    assert.match(DRAWERS.homework, /placeholder=\{t\("Pick a due date"\)\}/);
    assert.match(DRAWERS.students, /placeholder=\{t\("Pick a birthday"\)\}/);
    assert.equal(VI["Pick a due date"], "Chọn hạn nộp");
    assert.equal(VI["Pick a birthday"], "Chọn ngày sinh");
  });

  it("26. the date control still takes its width from its container", () => {
    // The v3 contract, restated here because DateField now wraps it: a wrapper
    // that established a width of its own would put the drawer's horizontal
    // scroll straight back.
    assert.match(UNCONDITIONAL, /input\[type="date"\]\{[^}]*min-width:0/);
    assert.match(UNCONDITIONAL, /input\[type="date"\]\{[^}]*max-width:100%/);
    assert.match(UNCONDITIONAL, /\.date-field\{position:relative;display:block\}/);
    assert.ok(!/\.date-field\{[^}]*width:/.test(UNCONDITIONAL), "the wrapper must not state a width");
  });
});
