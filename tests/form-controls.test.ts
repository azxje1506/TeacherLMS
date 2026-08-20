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

/** Comments stripped, always.
 *
 * globals.css documents its own cascade — it spells out selectors and their
 * specificity in prose so the next reader does not have to re-derive them. That
 * prose is a liability to a test that reads the file as text: an assertion
 * hunting for `.cs-trigger:hover…` will happily find the sentence describing it
 * and report a rule as present that was never written. Every rule lookup in
 * this file therefore runs against the DECLARATIONS only. */
const CSS = read("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
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
     * Select, this fails rather than the Select silently becoming the outlier.
     *
     * v5 moved the trigger's SURFACE — border, radius, background — out of the
     * inline style and into globals.css `.cs-trigger`, so the geometry is
     * checked here and the surface is checked against the stylesheet. */
    assert.match(SELECT, /width: "100%", height, padding: "0 11px"/);
    assert.match(SELECT, /height = 38/, "the default height is the family's");
    assert.match(SELECT, /fontSize: 13,/);
    assert.match(UNCONDITIONAL, /\.cs-trigger\{[\s\S]*?border-radius:9px/);
    assert.match(UNCONDITIONAL, /\.cs-trigger\{[\s\S]*?background:var\(--card\)/);
  });

  it("5. the Select's border language is the family's, error state included", () => {
    // Resting --border, invalid --accent — the same two tokens the drawers'
    // `field(invalid)` uses, now expressed as a state selector rather than a
    // ternary in an inline style.
    assert.match(UNCONDITIONAL, /\.cs-trigger\{[\s\S]*?border:1px solid var\(--border\)/);
    assert.match(UNCONDITIONAL, /\.cs-trigger\[data-invalid="1"\]\{border-color:var\(--accent\)\}/);
    assert.match(SELECT, /data-invalid=\{invalid \? "1" : undefined\}/);
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.match(src, /border: `1px solid \$\{invalid \? "var\(--accent\)" : "var\(--border\)"\}`/, `${name}-drawer`);
    }
  });

  it("6. focus is the same treatment on a Select as on an input", () => {
    // Not the same RULE any more — the trigger needs a state an input does not
    // have — but the same two declarations, from the same two tokens.
    const input = UNCONDITIONAL.match(/\.ring:focus\{([^}]*)\}/);
    assert.ok(input, ".ring:focus must state the app's focus treatment");
    assert.match(input[1], /border-color:var\(--accent\)/);
    assert.match(input[1], /box-shadow:0 0 0 3px var\(--ring\)/);

    const trigger = UNCONDITIONAL.match(/\.cs-trigger:focus,\s*\.cs-trigger\[aria-expanded="true"\]\{([^}]*)\}/);
    assert.ok(trigger, "the trigger's focus/open rule must exist");
    assert.match(trigger[1], /border-color:var\(--accent\)/);
    assert.match(trigger[1], /box-shadow:0 0 0 3px var\(--ring\)/);
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
  it("9. the open state does not depend on :focus", () => {
    /* THE v5 FAULT, and the reason the v4 fix did nothing. The trigger is a
     * <button>, and WebKit does not focus a button when you tap it. Every rule
     * painting the open state was keyed on :focus, so on an iPhone the listbox
     * was open while the trigger was not focused — the accent rule never
     * matched, and the sticky :hover a tap leaves behind won instead. Guarding
     * that hover with :not(:focus) was inert: there was no focus to find.
     *
     * aria-expanded is true whatever the platform decided about focus. */
    assert.match(UNCONDITIONAL, /\.cs-trigger\[aria-expanded="true"\]\{[\s\S]*?border-color:var\(--accent\)/);
    assert.match(SELECT, /aria-expanded=\{open\}/, "the component must publish the state the rule keys on");
  });

  it("10. the hover rule is mutually exclusive with focus AND open", () => {
    /* Specificity says the hover rule (0,4,0) beats focus and open (0,2,0), so
     * it is written so it can never MATCH alongside them rather than relying on
     * losing a tie. That is what stops it latching over the open state again on
     * a platform that hands out :focus differently. */
    // CSS, not UNCONDITIONAL: the hover rule deliberately lives inside a
    // (hover:hover) media query, which is what the next test is about.
    const hover = CSS.match(/(\.cs-trigger:hover[^{]*)\{/);
    assert.ok(hover, "the trigger must have a hover rule");
    assert.match(hover[1], /:not\(:focus\)/, "hover must exclude focus");
    assert.match(hover[1], /:not\(\[aria-expanded="true"\]\)/, "hover must exclude open");
    // And the rule it replaced is gone, !important and all.
    assert.ok(!/\[data-cs-trigger\]:hover/.test(CSS), "the old !important hover rule must be retired");
  });

  it("11. hover is only asked for where there is a pointer", () => {
    /* On a touch screen :hover is not a state, it is a leftover from the last
     * tap. Gating it is what keeps a closed trigger clean after an option is
     * picked, and it is the query .cal-event already uses. */
    const gated = CSS.slice(CSS.indexOf("@media (hover:hover) and (pointer:fine){", CSS.indexOf(".cs-trigger{")));
    assert.match(gated.slice(0, 260), /\.cs-trigger:hover/);
  });

  it("12. no !important is needed anywhere on the trigger", () => {
    /* The !important only ever existed to beat the trigger's own inline border
     * and background. With the surface moved into the stylesheet there is
     * nothing left to outrank — which is the real test that the presentation
     * moved rather than just being fought harder. */
    for (const m of CSS.matchAll(/\.cs-trigger[^{]*\{([^}]*)\}/g)) {
      assert.ok(!m[1].includes("!important"), `.cs-trigger rule must not need !important: ${m[1].trim()}`);
    }

    /* ...and the component must not put the surface back inline, which is what
     * would make !important necessary again. Only the TRIGGER's own style
     * object is examined — the popover below it legitimately states a border and
     * a background of its own. */
    const code = codeOf(SELECT);
    const at = code.indexOf("data-cs-trigger");
    const open = code.indexOf("style={{", at);
    const triggerStyle = code.slice(open, code.indexOf("}}", open));
    for (const prop of ["border:", "borderRadius:", "background:", "outline:"]) {
      assert.ok(!triggerStyle.includes(prop), `the trigger must not restate ${prop} inline`);
    }
    // What it may still state is geometry and the value's own colour.
    assert.match(triggerStyle, /width: "100%", height, padding: "0 11px"/);
    assert.match(triggerStyle, /color: current \? "var\(--fg\)" : "var\(--muted-2\)"/);
  });

  it("13. the UA's own button chrome is switched off", () => {
    // The other route a system-coloured state gets in, and the reason Tailwind's
    // preflight reset of button background/radius has to be restated.
    assert.match(UNCONDITIONAL, /\.cs-trigger\{[\s\S]*?appearance:none/);
    assert.match(UNCONDITIONAL, /\.cs-trigger:focus-visible\{outline:none\}/);
  });

  it("14. the open listbox is exactly as wide as its trigger", () => {
    // left/right pinned to the trigger's own box: the control cannot change
    // width between closed and open, and cannot push the drawer sideways.
    assert.match(SELECT, /position: "absolute", top: "calc\(100% \+ 6px\)", left: 0, right: 0/);
    assert.match(SELECT, /position: "relative"/, "the wrapper must be the positioning context");
  });

  it("15. neither the trigger's value nor a row can overflow it", () => {
    const ellipsis = SELECT.split('overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"').length - 1;
    assert.equal(ellipsis, 2, "the trigger's value and each option row must both clip");
  });

  it("16. the chevron never moves", () => {
    // flex:none keeps it out of the shrink that clips the label beside it.
    assert.match(SELECT, /flex: "none", color: "var\(--muted-2\)"/);
    assert.match(SELECT, /justifyContent: "space-between"/);
  });

  it("17. the selected row is stated in the app's accent tokens", () => {
    assert.match(SELECT, /background: on \? "var\(--accent-soft\)" : "transparent"/);
    assert.match(SELECT, /color: on \? "var\(--accent\)" : "var\(--fg\)"/);
  });

  it("18. the trigger is a real listbox control", () => {
    // The states above are only worth checking if assistive tech sees the same
    // control a sighted user does.
    for (const attr of ['aria-haspopup="listbox"', "aria-expanded={open}", 'role="listbox"', 'role="option"', "aria-selected={on}"]) {
      assert.ok(SELECT.includes(attr), `Select must set ${attr}`);
    }
  });

  it("19. no consumer overrides the family height", () => {
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

  it("20. Select has no disabled state, and no consumer asks for one", () => {
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
  it("21. the app draws the placeholder, because the input cannot", () => {
    /* `<input type="date">` does not support the placeholder attribute, and
     * what it draws while empty is the UA's business — Chrome prints
     * "mm/dd/yyyy", mobile Safari prints nothing. That is why this is markup
     * and not a CSS `content` trick on a control that has nothing to style. */
    assert.match(DATE_FIELD, /className="date-ph"/);
    assert.match(UNCONDITIONAL, /\.date-field\{position:relative;display:block\}/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?position:absolute/);
  });

  it("22. the placeholder is inset exactly like the field's own text", () => {
    // 1px of border plus the family's 11px of padding. If the family's inset
    // ever moves, this is what says the placeholder did not move with it.
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?left:1px/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?padding-inline-start:11px/);
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?font-size:13px/);
    for (const src of Object.values(DRAWERS)) assert.match(src, /padding: "0 11px"/);
  });

  it("23. the UA's own empty hint is hidden only while it would collide", () => {
    // Empty AND unfocused. Focus hands the field straight back so a keyboard
    // user types against segments they can see.
    assert.match(UNCONDITIONAL, /\.date-field\[data-empty="1"\]>input:not\(:focus\)\{color:transparent\}/);
    assert.match(UNCONDITIONAL, /\.date-field\[data-empty="1"\]>input:focus~\.date-ph\{opacity:0\}/);
  });

  it("24. the placeholder never intercepts a tap", () => {
    // It sits over the control, so the picker would be unreachable without it.
    assert.match(UNCONDITIONAL, /\.date-ph\{[\s\S]*?pointer-events:none/);
  });

  it("25. the native input is still the control", () => {
    /* No calendar, no parsing, no value of its own — the whole point. It stays
     * type=date, so the platform picker, the value contract, the payload and
     * the validation are all untouched. */
    assert.match(DATE_FIELD, /type="date"/);
    // codeOf: an assertion about the CODE must not be satisfied — or defeated —
    // by the prose that describes it.
    assert.ok(!/useState|useEffect|Calendar|parse|format/i.test(codeOf(DATE_FIELD)), "DateField must hold no state or date logic");
    assert.match(DATE_FIELD, /\{\.\.\.inputProps\}/, "it must forward the form's registration");
  });

  it("26. emptiness comes from the form, never from local state", () => {
    /* A reset() — which every drawer does when it opens for a different record
     * — changes the value with no event this component could observe, so local
     * state would go stale exactly when a teacher reopened the drawer. */
    assert.match(DATE_FIELD, /empty: boolean/);
    assert.match(DRAWERS.homework, /const dueDate = useWatch\(\{ control, name: "dueDate" \}\)/);
    assert.match(DRAWERS.homework, /empty=\{!dueDate\}/);
    assert.match(DRAWERS.students, /empty=\{!birthday\}/);
    assert.match(DRAWERS.students, /const birthday = useWatch\(\{ control, name: "birthday" \}\)/);
  });

  it("27. the guidance reaches a screen reader too", () => {
    // Described-by, not labelled-by: the <label> already names the field, and
    // the description drops away once there is a value to announce instead.
    assert.match(DATE_FIELD, /aria-describedby=\{empty \? describedBy : undefined\}/);
    assert.match(DATE_FIELD, /id=\{describedBy\}/);
    assert.match(DRAWERS.homework, /htmlFor="hw-due"/);
    assert.match(DRAWERS.students, /htmlFor="st-birthday"/);
    assert.match(DRAWERS.students, /id="st-birthday"/);
  });

  it("28. every date input in the app goes through the primitive", () => {
    /* The fix has to be the shared one. A bare type=date left anywhere would be
     * a field that still looks empty when it is empty. */
    for (const [name, src] of Object.entries(DRAWERS)) {
      assert.ok(!src.includes('type="date"'), `${name}-drawer must use DateField, not a bare date input`);
    }
    assert.match(DRAWERS.homework, /<DateField/);
    assert.match(DRAWERS.students, /<DateField/);
  });

  it("29. the copy is the product's own, and translated", () => {
    /* "Pick a due date" has been in the dictionary since S1 with nowhere to be
     * shown, because a native date input has no placeholder to put it in. */
    assert.match(DRAWERS.homework, /placeholder=\{t\("Pick a due date"\)\}/);
    assert.match(DRAWERS.students, /placeholder=\{t\("Pick a birthday"\)\}/);
    assert.equal(VI["Pick a due date"], "Chọn hạn nộp");
    assert.equal(VI["Pick a birthday"], "Chọn ngày sinh");
  });

  it("30. the date control still takes its width from its container", () => {
    // The v3 contract, restated here because DateField now wraps it: a wrapper
    // that established a width of its own would put the drawer's horizontal
    // scroll straight back.
    assert.match(UNCONDITIONAL, /input\[type="date"\]\{[^}]*min-width:0/);
    assert.match(UNCONDITIONAL, /input\[type="date"\]\{[^}]*max-width:100%/);
    assert.match(UNCONDITIONAL, /\.date-field\{position:relative;display:block\}/);
    assert.ok(!/\.date-field\{[^}]*width:/.test(UNCONDITIONAL), "the wrapper must not state a width");
  });
});
