/* DateField: exactly one visible text layer, in every state and every engine.
 *
 * Run with:  npm test
 *
 * WHY THIS FILE IS NOT MORE STRING ASSERTIONS. The v6 regression was not a
 * missing rule — the rule was there, spelled correctly, and a test that grepped
 * for it passed while desktop Chrome showed two overlapping labels. What was
 * wrong was the OUTCOME of the cascade on one engine. So this file does not ask
 * "is the declaration present"; it works out which declaration WINS for a given
 * element in a given state, and then asserts the thing that actually matters:
 * how many text layers a user can see.
 *
 * WHAT IT IS. A small cascade resolver over globals.css — selector matching,
 * specificity, source order, media gating — applied to a three-node model of the
 * control: the native input, its ::-webkit-datetime-edit text layer, and the
 * app's placeholder span.
 *
 * WHAT IT IS NOT, AND THIS MATTERS. It is not a browser. It cannot discover a
 * new engine quirk; it can only hold the engines' KNOWN differences still. Those
 * differences are written down explicitly in ENGINES below, as the assumptions
 * they are:
 *
 *   - whether the engine exposes ::-webkit-* pseudo-elements at all, and
 *   - whether `color` on the input inherits into its shadow text layer.
 *
 * That second line is the whole bug. WebKit inherits it, so `color:transparent`
 * hid the native hint and the iPhone looked right. Chromium paints the empty
 * date sub-fields from its own UA stylesheet, so the inherited transparent never
 * reached them and "mm/dd/yyyy" stayed visible under "Pick a due date". A human
 * still has to confirm the assumption on a real browser — but if someone later
 * removes the opacity rule and leaves only the colour one, this fails here
 * rather than on a reviewer's screen.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
const CSS = read("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const DATE_FIELD = read("src", "components", "ui", "date-field.tsx");

/* ------------------------------------------------------------------ parsing */

interface Rule { media: string | null; selector: string; decls: Record<string, string>; order: number }

function parse(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;

  const body = (text: string, media: string | null) => {
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls: Record<string, string> = {};
      for (const d of m[2].split(";")) {
        const i = d.indexOf(":");
        if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
      for (const sel of m[1].split(",")) rules.push({ media, selector: sel.trim(), decls, order: order++ });
    }
  };

  // Split top-level @media blocks out, then parse each region in source order.
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at === -1) { body(css.slice(i), null); break; }
    body(css.slice(i, at), null);
    const open = css.indexOf("{", at);
    let depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    body(css.slice(open + 1, j), css.slice(at + 6, open).trim());
    i = j + 1;
  }
  return rules;
}

const RULES = parse(CSS);

/** The stylesheet as it stood in v4: the opacity suppression removed, leaving
 * only the colour one. Test 1 runs the whole model against this to prove the
 * model can still FAIL — and that it fails on Chromium and not on WebKit, which
 * is precisely how the regression was reported. */
const V4_RULES = parse(CSS.replace(
  '.date-field[data-empty="1"]>input:not(:focus)::-webkit-datetime-edit{opacity:0}',
  ""
));

/* ----------------------------------------------------------------- matching */

interface Node {
  tag: string;
  classes: string[];
  attrs: Record<string, string>;
  states: string[];            // :focus, :hover, …
  parent?: Node;
  prevSiblings?: Node[];
  pseudoEl?: string;           // the element IS this pseudo of its owner
}

/** Split a compound selector into simple parts, ignoring separators nested in
 * ( ) or [ ]. */
function simples(compound: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let k = 0; k < compound.length; k++) {
    const c = compound[k];
    const opening = c === "(" || c === "[";
    const closing = c === ")" || c === "]";
    /* Two things this has to get right, both of which it got wrong first time:
     * the test runs at the depth BEFORE an opening bracket is counted, or
     * `input[type="date"]` never splits; and `(` is NOT a boundary, or
     * `:not(:focus)` breaks into ":not" + "(:focus)" and silently matches
     * nothing. A matcher that quietly matches nothing makes every rule look
     * absent, which is the most useless failure mode available. */
    const boundary = depth === 0 && (c === "." || c === ":" || c === "[");
    if (boundary && cur) { out.push(cur); cur = ""; }
    if (opening) depth++;
    if (closing) depth--;
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function matchesCompound(compound: string, node: Node): boolean {
  // A pseudo-element suffix must agree with what the node actually is.
  const peMatch = compound.match(/::[-\w]+$/);
  if ((peMatch?.[0].slice(2) ?? undefined) !== node.pseudoEl) return false;
  const rest = peMatch ? compound.slice(0, -peMatch[0].length) : compound;

  /* Everything left of `::…` describes the ORIGINATING element, not the
   * pseudo-element, so `:not()` has to be evaluated against the element with
   * the pseudo constraint dropped. Leaving it on made `:not(:focus)` always
   * true — the inner `:focus` could never match a node carrying a
   * pseudo-element — so the suppression rule stayed on while focused and the
   * field went blank instead of handing back the native segments. */
  const owner: Node = { ...node, pseudoEl: undefined };

  for (const part of simples(rest)) {
    if (part.startsWith("::")) continue;
    if (part.startsWith(".")) { if (!node.classes.includes(part.slice(1))) return false; }
    else if (part.startsWith("[")) {
      const a = part.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!a) return false;
      if (!(a[1] in node.attrs)) return false;
      if (a[2] !== undefined && node.attrs[a[1]] !== a[2]) return false;
    } else if (part.startsWith(":not(")) {
      if (matchesCompound(part.slice(5, -1), owner)) return false;
    } else if (part.startsWith(":")) {
      const name = part.slice(1);
      if (name === "focus-visible") { if (!node.states.includes("focus-visible")) return false; }
      else if (!node.states.includes(name)) return false;
    } else if (part !== "*") {
      if (part !== node.tag) return false;
    }
  }
  return true;
}

function matches(selector: string, node: Node): boolean {
  const parts = selector.split(/\s*([>~+])\s*/).filter(Boolean);
  let i = parts.length - 1;
  let current: Node | undefined = node;
  if (!matchesCompound(parts[i], current)) return false;
  i--;
  /* Walk EVERY combinator, not just the nearest one. Checking only the last
   * would let `.date-field[data-empty="1"]>input:focus~.date-ph` match a
   * wrapper whose data-empty is "0" — the model would then agree with a
   * stylesheet that does not say what it thinks it says. */
  while (i > 0) {
    const combinator = parts[i];
    const before = parts[i - 1];
    if (combinator === ">") {
      if (!current?.parent || !matchesCompound(before, current.parent)) return false;
      current = current.parent;
    } else if (combinator === "~" || combinator === "+") {
      const sibling: Node | undefined = (current?.prevSiblings ?? []).find((s: Node) => matchesCompound(before, s));
      if (!sibling) return false;
      current = sibling;
    } else return false;
    i -= 2;
  }
  return true;
}

function specificity(selector: string): number {
  const s = selector.replace(/::[-\w]+/g, "");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\b)[\w-]+/g) ?? []).length
    + (s.match(/:not\(/g) ?? []).length;   // :not() takes its argument's weight; every argument here is one simple
  const els = (s.match(/(^|[\s>~+])[a-z]+/g) ?? []).length;
  return ids * 10000 + cls * 100 + els;
}

/** The winning value of `prop` for `node`, under the given media features. */
function resolve(prop: string, node: Node, media: (m: string) => boolean, rules: Rule[] = RULES): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const r of rules) {
    if (!(prop in r.decls)) continue;
    if (r.media && !media(r.media)) continue;
    if (!matches(r.selector, node)) continue;
    const spec = specificity(r.selector);
    const important = r.decls[prop].includes("!important");
    const key = { spec: spec + (important ? 1000000 : 0), order: r.order, value: r.decls[prop].replace("!important", "").trim() };
    if (!best || key.spec > best.spec || (key.spec === best.spec && key.order > best.order)) best = key;
  }
  return best?.value;
}

/* ------------------------------------------------------------- the model */

/** The two engine behaviours that decide this bug. Assumptions, stated. */
const ENGINES = {
  webkit:   { webkitPseudos: true,  colourInheritsIntoTextLayer: true },
  chromium: { webkitPseudos: true,  colourInheritsIntoTextLayer: false },
  gecko:    { webkitPseudos: false, colourInheritsIntoTextLayer: true },
};

interface State { empty: boolean; focused: boolean; forcedColors?: boolean }

function build(state: State) {
  const media = (m: string) => (m.includes("forced-colors:active") ? !!state.forcedColors : false);
  const wrapper: Node = { tag: "div", classes: ["date-field"], attrs: { "data-empty": state.empty ? "1" : "0" }, states: [] };
  const input: Node = {
    tag: "input", classes: ["ring"], attrs: { type: "date" },
    states: state.focused ? ["focus", "focus-visible"] : [], parent: wrapper,
  };
  const textLayer: Node = { ...input, pseudoEl: "-webkit-datetime-edit" };
  const placeholder: Node = { tag: "span", classes: ["date-ph"], attrs: {}, states: [], parent: wrapper, prevSiblings: [input] };
  return { media, input, textLayer, placeholder };
}

/** Can the user see the browser's own date text? */
function nativeTextVisible(state: State, engine: keyof typeof ENGINES, rules: Rule[] = RULES): boolean {
  const { media, input, textLayer } = build(state);
  const e = ENGINES[engine];
  if (e.webkitPseudos && resolve("opacity", textLayer, media, rules) === "0") return false;
  if (e.colourInheritsIntoTextLayer && resolve("color", input, media, rules) === "transparent") return false;
  return true;
}

/** Can the user see the app's placeholder? React renders it only when empty. */
function placeholderVisible(state: State, rules: Rule[] = RULES): boolean {
  if (!state.empty) return false;                       // date-field.tsx: {empty && <span …>}
  const { media, placeholder } = build(state);
  if (resolve("display", placeholder, media, rules) === "none") return false;
  return resolve("opacity", placeholder, media, rules) !== "0";
}

const layers = (state: State, engine: keyof typeof ENGINES, rules: Rule[] = RULES) =>
  (nativeTextVisible(state, engine, rules) ? 1 : 0) + (placeholderVisible(state, rules) ? 1 : 0);

const ENGINE_NAMES = Object.keys(ENGINES) as (keyof typeof ENGINES)[];

/* ------------------------------------------------------------------- tests */

describe("DateField — the resolver itself is trustworthy", () => {
  it("1. it reproduces the reported bug from the v4 stylesheet", () => {
    /* A model that cannot fail is worth nothing. This runs the SAME model over
     * the same stylesheet with one line removed — the v4 state — and requires
     * it to reproduce the report exactly: two overlapping layers on Chromium,
     * one on WebKit and one on Gecko. If it did not, the passes below would
     * mean nothing, because they would be passes a broken sheet also earns.
     *
     * It also pins WHY the report read as "desktop broken, mobile fine": the
     * split is WebKit-versus-Chromium, not phone-versus-laptop. Android Chrome
     * was showing the overlap too; nobody had looked. */
    const empty = { empty: true, focused: false };
    assert.equal(layers(empty, "chromium", V4_RULES), 2, "v4 must overlap on Chromium");
    assert.equal(layers(empty, "webkit", V4_RULES), 1, "v4 looked right on WebKit — hence 'mobile is fine'");
    assert.equal(layers(empty, "gecko", V4_RULES), 1, "v4 was fine on Gecko, which inherits the colour");

    // ...and the fix is what closes it, on the same model, same state.
    assert.equal(layers(empty, "chromium"), 1, "the shipped sheet must fix Chromium");
  });

  it("2. it resolves a known cascade correctly", () => {
    // Sanity checks against rules whose winner is obvious by inspection.
    const { media, input, placeholder } = build({ empty: true, focused: false });
    assert.equal(resolve("min-width", input, media), "0", "input[type=date] sets min-width:0");
    assert.equal(resolve("color", placeholder, media), "var(--muted-2)", ".date-ph takes the placeholder tone");
    assert.equal(resolve("position", placeholder, media), "absolute");
  });

  it("3. specificity beats source order, and !important beats both", () => {
    assert.ok(specificity('.date-field[data-empty="1"]>input:not(:focus)') > specificity('input[type="date"]'));
    const { media, input } = build({ empty: true, focused: true });
    // .ring:focus carries !important and must win the input's border-color.
    assert.equal(resolve("border-color", input, media), "var(--accent)");
  });
});

describe("DateField — one visible text layer, every state, every engine", () => {
  it("4. empty + unfocused shows the app placeholder and nothing else", () => {
    /* The reported regression. Chromium is the case that used to be 2. */
    for (const engine of ENGINE_NAMES) {
      const state = { empty: true, focused: false };
      assert.equal(layers(state, engine), 1, `${engine}: expected exactly one text layer`);
      assert.equal(placeholderVisible(state), true, `${engine}: the placeholder must be the visible one`);
      assert.equal(nativeTextVisible(state, engine), false, `${engine}: the native hint must be suppressed`);
    }
  });

  it("5. empty + focused hands the field to the platform, alone", () => {
    // The keyboard user has to see the segments they are typing into, so the
    // native layer comes back — and the placeholder steps aside in the same rule.
    for (const engine of ENGINE_NAMES) {
      const state = { empty: true, focused: true };
      assert.equal(layers(state, engine), 1, `${engine}`);
      assert.equal(nativeTextVisible(state, engine), true, `${engine}: segments must be visible while typing`);
      assert.equal(placeholderVisible(state), false, `${engine}: the placeholder must not overlap them`);
    }
  });

  it("6. a selected value is shown once, focused or not", () => {
    for (const engine of ENGINE_NAMES) {
      for (const focused of [false, true]) {
        const state = { empty: false, focused };
        assert.equal(layers(state, engine), 1, `${engine} focused=${focused}`);
        assert.equal(nativeTextVisible(state, engine), true, `${engine}: the value must never be hidden`);
        assert.equal(placeholderVisible(state), false, `${engine}: no placeholder over a value`);
      }
    }
  });

  it("7. clearing back to empty returns the placeholder cleanly", () => {
    /* Reset is not a separate code path — `empty` is derived from the form's
     * value on every render — so the state after a reset IS state 4. What this
     * pins is that nothing about having previously held a value can persist:
     * the same inputs give the same answer. */
    for (const engine of ENGINE_NAMES) {
      const afterReset = { empty: true, focused: false };
      assert.equal(layers(afterReset, engine), 1, `${engine}`);
      assert.deepEqual(
        [nativeTextVisible(afterReset, engine), placeholderVisible(afterReset)],
        [false, true],
        `${engine}: a reopened drawer must look like a fresh one`
      );
    }
  });

  it("8. forced colours still show exactly one layer", () => {
    /* The OS owns `color` here, so colour-based suppression cannot work and
     * Firefox would show its hint under ours. The app's placeholder stands down
     * and the platform's is the single representation — and the Chromium
     * suppression is lifted with it, so the answer is never ZERO either. */
    for (const engine of ENGINE_NAMES) {
      const state = { empty: true, focused: false, forcedColors: true };
      assert.equal(layers(state, engine), 1, `${engine}: forced-colors`);
      assert.equal(placeholderVisible(state), false, `${engine}: the app layer stands down`);
      assert.equal(nativeTextVisible(state, engine), true, `${engine}: the platform layer must remain`);
    }
  });

  it("9. no state, on any engine, ever shows zero or two layers", () => {
    // The contract as a whole, swept rather than spot-checked.
    for (const engine of ENGINE_NAMES) {
      for (const empty of [true, false]) {
        for (const focused of [true, false]) {
          for (const forcedColors of [true, false]) {
            const n = layers({ empty, focused, forcedColors }, engine);
            assert.equal(n, 1, `${engine} empty=${empty} focused=${focused} forced=${forcedColors} showed ${n}`);
          }
        }
      }
    }
  });
});

describe("DateField — what suppression must not cost", () => {
  it("10. the picker icon is never hidden with the text", () => {
    /* ::-webkit-calendar-picker-indicator is a SIBLING of
     * ::-webkit-datetime-edit in the shadow tree, not a descendant, so the
     * opacity that hides the text cannot reach it. This asserts the resolver
     * agrees: the indicator keeps its own opacity in the suppressed state. */
    const { media, input } = build({ empty: true, focused: false });
    const indicator: Node = { ...input, pseudoEl: "-webkit-calendar-picker-indicator" };
    assert.equal(resolve("opacity", indicator, media), ".5", "the icon keeps the design's opacity");
    assert.notEqual(resolve("opacity", indicator, media), "0");
    assert.equal(resolve("cursor", indicator, media), "pointer");
  });

  it("11. the input stays interactive and focusable while suppressed", () => {
    // Nothing may set display/visibility/pointer-events on the input itself —
    // suppression is of the TEXT, never of the control.
    const { media, input } = build({ empty: true, focused: false });
    for (const prop of ["display", "visibility", "pointer-events"]) {
      const v = resolve(prop, input, media);
      assert.ok(v === undefined || (v !== "none" && v !== "hidden"), `input must not be ${prop}:${v}`);
    }
    // The placeholder is the layer that must never swallow a click.
    assert.equal(resolve("pointer-events", build({ empty: true, focused: false }).placeholder, media), "none");
  });

  it("12. the focus ring is unaffected by the suppression", () => {
    const { media, input } = build({ empty: true, focused: true });
    assert.equal(resolve("box-shadow", input, media), "0 0 0 3px var(--ring)");
    assert.equal(resolve("border-color", input, media), "var(--accent)");
  });

  it("13. suppression is scoped to the empty state only", () => {
    // A rule that leaked into the filled state would hide a real value.
    const filled = build({ empty: false, focused: false });
    assert.notEqual(resolve("color", filled.input, filled.media), "transparent");
    assert.notEqual(resolve("opacity", filled.textLayer, filled.media), "0");
  });

  it("14. the component still owns label and description semantics", () => {
    // The visual work above must not have quietly changed what is announced.
    assert.match(DATE_FIELD, /aria-describedby=\{empty \? describedBy : undefined\}/);
    assert.match(DATE_FIELD, /type="date"/);
    assert.ok(!/aria-hidden/.test(DATE_FIELD), "the placeholder is described, not hidden from AT");
  });
});
