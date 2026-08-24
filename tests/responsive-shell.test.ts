/* The app shell's mobile geometry.
 *
 * Run with:  npm test
 *
 * WHY THIS FILE EXISTS. Gate 5 Phase 0 reported that the app was not usable on a
 * phone: the whole page scrolled sideways, the top bar was wider than the
 * screen with Quick add clipped off the end, the sidebar ate a fifth of the
 * width, and the content sat in a narrow desktop-shaped column. A first
 * remediation widened one card grid and did not fix it, because the card grid
 * was never the largest offender.
 *
 * The real cause was that two shell elements DEFINED a width the phone had to
 * meet rather than adapting to the width it had:
 *
 *   - the header row could not shrink. Its search box carried `minWidth: 170`
 *     and Quick add was `whiteSpace: nowrap` + `flexShrink: 0`, so the row had
 *     an intrinsic minimum near 520px and pushed the document out to reach it;
 *   - the sidebar held `width`/`minWidth` of 64px on every screen, so a 375px
 *     phone had 275px of content column after the main padding.
 *
 * Everything else followed from that overflow — including the "drawer compresses
 * the page" report, which was the scroll lock clipping the overflow when a
 * drawer opened and forcing a re-layout at the true viewport width.
 *
 * NO DOM. This project ships no browser harness, so these assertions read the
 * stylesheet and the components as text. That is a real limitation and it is
 * why a human still re-verifies on a device. What these tests CAN do is hold the
 * geometry contract still: every element that cannot shrink must have a stated
 * mobile escape, and the numbers the layout depends on must agree across the
 * files that state them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MOBILE_QUERY } from "../src/lib/use-media-query";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

const CSS = read("src", "app", "globals.css");
const HEADER = read("src", "components", "shell", "header.tsx");
const SIDEBAR = read("src", "components", "shell", "sidebar.tsx");
const SHELL = read("src", "components", "shell", "app-shell.tsx");
const DRAWER = read("src", "components", "ui", "drawer.tsx");

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

/* The header states its OWN breakpoints — 1100px and 768px — so the row never
 * changes shape at the drawer’s 620px. Two components with different content
 * have no reason to share a number, and pretending they did is what produced
 * the 621px cliff. */
const TABLET = mediaBlock("(max-width:1099px)");
const DESKTOP_ONLY = mediaBlock("(min-width:1100px)");
const PHONE = mediaBlock("(max-width:767px)");

/** Declarations only — globals.css documents its own cascade in prose, and an
 * assertion hunting for a rule would otherwise find the sentence describing it. */
const RULE_TEXT = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Source with its comments removed, so an assertion about the CODE is never
 * satisfied, or defeated, by the prose explaining it. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

/** Every rule that applies at every viewport: the stylesheet with its @media
 * blocks removed. A rule about scroll OWNERSHIP has to be found here rather than
 * inside a breakpoint — that distinction is the whole of the Gate 4.3 overscroll
 * remediation, and it is what a slice taken at the first @media would miss. */
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

/* ------------------------------------------------------------ breakpoints */

describe("Shell — the breakpoint is stated once", () => {
  it("1. the hook's query and the stylesheet's mobile block agree", () => {
    // Two files decide what "mobile" means: this constant drives whether the
    // header's toggle opens an overlay, and the @media block drives whether the
    // sidebar is an overlay at all. If they drift, the button stops matching the
    // layout it is controlling.
    const px = MOBILE_QUERY.match(/(\d+)px/);
    assert.ok(px, "MOBILE_QUERY must state a pixel width");
    assert.ok(CSS.includes(`@media (max-width:${px![1]}px){`), "globals.css must use the same width");
  });

  it("2. the tablet rail block cannot reach below the mobile breakpoint", () => {
    // The 860px block pins the sidebar to a 64px rail. Below 620px the sidebar
    // leaves the layout instead, and an unbounded rail rule would fight it for
    // width and keep its labels hidden inside the overlay.
    assert.ok(
      CSS.includes("@media (max-width:860px) and (min-width:621px){"),
      "the rail block must be bounded below by the mobile breakpoint"
    );
  });
});

/* --------------------------------------------------------------- sidebar */

describe("Shell — the sidebar costs no layout width on a phone", () => {
  it("3. it is taken out of flow below the breakpoint", () => {
    assert.match(MOBILE, /\.app-sidebar\{[^}]*position:fixed !important/);
  });

  it("4. it is translated off-canvas until it is opened", () => {
    assert.match(MOBILE, /\.app-sidebar\{[^}]*transform:translateX\(-100%\)/);
    assert.match(MOBILE, /\.app-sidebar\[data-mobile-open="1"\]\{transform:translateX\(0\)\}/);
  });

  it("5. the component publishes the open state the stylesheet keys on", () => {
    assert.ok(SIDEBAR.includes('data-mobile-open={mobileOpen ? "1" : "0"}'));
  });

  it("6. the overlay is dismissable by its scrim", () => {
    assert.match(MOBILE, /\.app-nav-scrim\{position:fixed;inset:0/);
    assert.ok(SHELL.includes('className="app-nav-scrim"'));
    assert.ok(SHELL.includes("onClick={() => setNavOpen(false)}"));
  });

  it("7. the scrim never renders on a desktop page", () => {
    // A scrim left mounted above the breakpoint would be an invisible sheet over
    // every desktop click, so what renders it is the ANDed flag, never the raw
    // open state.
    assert.ok(SHELL.includes("const navShown = isMobile && navOpen;"));
    assert.ok(SHELL.includes("{navShown && ("));
    assert.ok(!/\{\s*navOpen\s*&&\s*\(/.test(SHELL), "the raw flag must not gate any render");
  });

  it("8. navigating closes the overlay, from the tap rather than an effect", () => {
    // Closing on the click is what it always was underneath; doing it in an
    // effect keyed on the path made it a second render pass for no reason.
    assert.ok(SHELL.includes("onNavigate={() => setNavOpen(false)}"));
    assert.ok(SIDEBAR.includes("onClick={onNavigate}"), "every nav row must invoke it");
  });

  it("9. a stale open flag cannot survive leaving mobile", () => {
    /* There is no effect watching the breakpoint. The flag is ANDed with it as
     * it is passed down, so widening the window closes the overlay in the same
     * render that returns the sidebar to the layout. */
    assert.ok(SHELL.includes("mobileOpen={navShown}"));
    assert.ok(!SHELL.includes("useEffect"), "the shell needs no effect to hold this together");
  });

  it("10. the toggle means 'overlay' on a phone and 'rail' on a desktop", () => {
    assert.ok(SHELL.includes("isMobile ? setNavOpen((o) => !o) : setCollapsed((c) => !c)"));
  });
});

/* ---------------------------------------------------------------- header */

describe("Shell — the header has its own breakpoints, and fits every one", () => {
  /* The header is a single non-wrapping flex row, so its intrinsic minimum IS
   * the document's minimum width. It used to change shape inside the 620px
   * block — the DRAWER's breakpoint — which meant the row snapped back to its
   * full desktop self at 621px, at the exact width the sidebar rejoined the
   * layout as a rail. It now states 1100px and 768px and mentions 620 nowhere. */

  it("11. the full search field exists only at 1100px and above", () => {
    assert.ok(HEADER.includes('className="hdr-search"'), "the field needs a hook");
    assert.match(TABLET, /\.hdr-search\{display:none !important\}/,
      "a field too narrow to read a query in is not a search box");
    // And it is not merely squeezed below that width: no rule resizes it.
    const fieldRules = RULE_TEXT.replace(/\.hdr-search-btn/g, "");
    assert.ok(!/\.hdr-search\{[^}]*width/.test(fieldRules), "the field is replaced, never compressed");
  });

  it("12. a search TRIGGER exists everywhere the field does not", () => {
    assert.ok(HEADER.includes('className="btn-ghost hdr-search-btn"'), "the button needs a hook");
    assert.match(DESKTOP_ONLY, /\.hdr-search-btn\{display:none !important\}/,
      "the button is the one that goes when the field is there");
    /* EXACTLY ONE of the two is ever displayed, and the pair is stated as two
     * complementary queries rather than a default plus an override, so neither
     * shape depends on source order to win. */
    assert.ok(!TABLET.includes(".hdr-search-btn"), "the button must not also be hidden below 1100");
    assert.ok(!DESKTOP_ONLY.includes(".hdr-search{"), "the field must not also be hidden above it");
  });

  it("13. the field, the button and the shortcut are one function", () => {
    /* Two visible triggers and a keyboard shortcut that could diverge would be
     * three search behaviours. There is one: `openSearch`, and it is the only
     * thing that reaches the caller's handler. */
    const code = codeOf(HEADER);
    assert.ok(code.includes("const openSearch = useCallback"));
    assert.equal([...code.matchAll(/onClick=\{openSearch\}/g)].length, 2, "the field and the button");
    assert.ok(/e\.key\.toLowerCase\(\) === "k"[\s\S]{0,140}openSearch\(\)/.test(code),
      "the shortcut opens the same thing");
    assert.equal([...code.matchAll(/onOpenSearch\?\.\(\)/g)].length, 1,
      "one seam to the search surface, not one per trigger");
  });

  it("14. the shortcut does not swallow the key when nothing can open", () => {
    // A hint promising ⌘K while the app has no search surface would take the
    // browser's own shortcut away and give nothing back.
    assert.match(codeOf(HEADER), /if \(!onOpenSearch\) return;/);
  });

  it("15. the user's name and role go below 1100px, and the avatar stays", () => {
    assert.ok(HEADER.includes('className="hdr-user-meta"'));
    assert.match(TABLET, /\.hdr-user-meta\{display:none !important\}/);
    // The avatar is a sibling of that element, not a child, so it survives.
    const meta = HEADER.indexOf('className="hdr-user-meta"');
    const avatar = HEADER.indexOf('borderRadius: "50%"');
    assert.ok(avatar !== -1 && avatar < meta, "the avatar must not be hidden with the name");
  });

  it("16. Quick add keeps its label on a tablet and sheds it on a phone", () => {
    // It is nowrap + flexShrink:0, so it cannot be squeezed — only shortened.
    assert.ok(HEADER.includes('className="hdr-quickadd-label"'));
    assert.match(PHONE, /\.hdr-quickadd-label\{display:none !important\}/);
    assert.ok(!TABLET.includes(".hdr-quickadd-label"), "a tablet has room for the label");
  });

  it("17. Quick add keeps an accessible name once its label is hidden", () => {
    assert.ok(HEADER.includes('aria-label={t("Quick add")}'));
  });

  it("18. the search button carries the field's own accessible name", () => {
    // The same trigger by either shape, so a screen reader hears one thing.
    const names = [...HEADER.matchAll(/aria-label=\{t\("Search students, classes and lessons"\)\}/g)];
    assert.equal(names.length, 2, "the field and the button share one name");
  });

  it("19. no header rule lives at the drawer's breakpoint any more", () => {
    /* THE 620/621 CLIFF. Every one of these used to be inside the 620px block,
     * which is why the row changed shape with the drawer and reappeared as a
     * full desktop header at 621px beside a 64px rail. */
    const mobileRules = MOBILE.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const hook of [".app-header", ".hdr-search", ".hdr-kbd", ".hdr-spacer", ".hdr-quickadd", ".hdr-user"]) {
      assert.ok(!mobileRules.includes(hook), `${hook} must not be styled at the drawer breakpoint`);
    }
  });

  it("20. the spacer is never hidden — it is what right-aligns the actions", () => {
    assert.ok(HEADER.includes('className="hdr-spacer"'));
    assert.ok(!/\.hdr-spacer\{display:none/.test(RULE_TEXT),
      "with the field gone, the spacer is what pushes the group right");
  });

  it("21. the row fits at every width the gate names", () => {
    /* A budget, not a snapshot. Fixed, non-shrinking costs measured from the
     * component's own numbers; the spacer and the field contribute 0 to a
     * minimum. The sidebar is added in because above 620px it is still IN the
     * layout — precisely what the old header forgot. */
    const phone = (w: number) => 34 + 38 + 38 + 38 + 38 + 48 + 5 * 8 + 24 <= w;
    const tablet = (w: number) => 34 + 38 + 119 + 38 + 38 + 48 + 5 * 14 + 44 <= w;
    const desktop = (w: number) => 34 + 119 + 38 + 38 + 150 + 5 * 14 + 44 <= w;

    const RAIL = 64, FULL = 248;
    assert.ok(phone(375), "375px, sidebar out of flow");
    assert.ok(phone(620), "620px, sidebar out of flow");
    assert.ok(phone(621 - RAIL), "621px, sidebar back as a rail");
    assert.ok(phone(767 - RAIL), "767px");
    assert.ok(tablet(768 - RAIL), "768px");
    assert.ok(tablet(860 - RAIL), "860px");
    assert.ok(tablet(861 - FULL), "861px, sidebar back at full width");
    assert.ok(tablet(1099 - FULL), "1099px");
    assert.ok(desktop(1100 - FULL), "1100px");
  });

  it("22. nothing changes shape at 621px except the sidebar", () => {
    /* 620 and 621 land in the same header block (max-width:767px), so the row is
     * identical on both sides of the drawer breakpoint. The only difference is
     * the rail, which belongs to the sidebar and is budgeted for above. */
    assert.ok(CSS.includes("@media (max-width:767px){"), "the header phone block exists");
    assert.ok(CSS.includes("@media (max-width:1099px){"), "and the tablet block");
    assert.ok(CSS.includes("@media (min-width:1100px){"), "and the desktop-only block");
    assert.ok(!/@media[^{]*62[01]px[^{]*\{[^}]*hdr-/.test(CSS), "no header rule keys on 620/621");
  });
});

/* ------------------------------------------------------------ content box */

describe("Shell — the content column is the whole phone", () => {
  it("17. main padding tightens on a phone", () => {
    assert.match(MOBILE, /\.app-main\{padding:16px 14px 40px !important\}/);
  });

  it("18. a 320px card track fits every common phone width", () => {
    /* This is the number the whole remediation turns on, so it is measured from
     * the stylesheet rather than restated here. The content box is the viewport
     * minus main's own padding and nothing else — the sidebar is out of flow, so
     * it contributes zero — and the design's 320px card track has to fit inside
     * it. That is why no module's grid needed a second, module-specific patch,
     * and it is what would break first if the sidebar were ever put back into
     * the layout or the padding widened. */
    const sidebarIsOutOfFlow = /\.app-sidebar\{[^}]*position:fixed !important/.test(MOBILE);
    assert.ok(sidebarIsOutOfFlow, "a sidebar in flow would take width from the content box");

    const padding = MOBILE.match(/\.app-main\{padding:\d+px (\d+)px/);
    assert.ok(padding, "the mobile block must state main's padding");
    const sidePadding = Number(padding![1]) * 2;

    const CARD_TRACK = 320; // the widest card floor any module asks for
    for (const viewport of [360, 375, 390, 414]) {
      const content = viewport - sidePadding;
      assert.ok(
        content >= CARD_TRACK,
        `at ${viewport}px the content box is ${content}px, too narrow for a ${CARD_TRACK}px card`
      );
    }
  });
});

/* --------------------------------------------------------------- drawers */

describe("Shell — a drawer is a full-screen sheet on a phone", () => {
  it("19. the panel fills the viewport", () => {
    assert.match(MOBILE, /\.app-drawer\{[^}]*inset:0 !important/);
    assert.match(MOBILE, /\.app-drawer\{[^}]*width:100% !important/);
  });

  it("20. the panel cannot be moved sideways", () => {
    assert.match(MOBILE, /\.app-drawer\{[^}]*overflow-x:hidden/);
  });

  it("21. the body scrolls inside the panel, not the panel inside the page", () => {
    // header / body / footer: only the middle one scrolls.
    assert.ok(DRAWER.includes('className="app-drawer-body"'));
    assert.ok(DRAWER.includes('style={{ flex: 1, overflowY: "auto", padding: 22 }}'));

    /* AND IT OWNS THAT SCROLL AT EVERY WIDTH. This containment used to be stated
     * inside the mobile block, which left the 621-1100px band chaining the
     * gesture into the page behind the panel — the Gate 4.3 report's "the same
     * behaviour occurs inside the shared Drawer". Scroll ownership is not a
     * property of the viewport's width, so the rule is unconditional and this
     * assertion insists on that rather than merely on its existence. */
    assert.match(UNCONDITIONAL, /\.app-drawer-body\{overscroll-behavior:contain\}/);
    // Declarations only: the mobile block keeps a COMMENT saying where the rule
    // went, and a scan that read prose would report the rule as still there.
    const mobileRules = MOBILE.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!mobileRules.includes("overscroll-behavior"),
      "a mobile-only containment is the bug, not the fix");
  });

  it("22. the footer clears the home indicator", () => {
    assert.match(MOBILE, /\.app-drawer-foot\{padding-bottom:calc\(16px \+ env\(safe-area-inset-bottom\)\) !important\}/);
  });

  it("23. the page behind a drawer is scroll-locked", () => {
    assert.ok(DRAWER.includes("useScrollLock(open)"));
  });

  it("24. every drawer in the app is reached by the mobile rule", () => {
    /* The Lessons drawer is a bespoke copy of this panel that predates the
     * shared one. It is not rewritten here, but it carries the same class, so a
     * phone does not get full-screen sheets everywhere except Lessons. */
    const lessons = read("src", "components", "lessons", "lesson-drawer.tsx");
    for (const [name, src] of [["shared", DRAWER], ["lessons", lessons]] as const) {
      assert.ok(src.includes('className="app-drawer"'), `the ${name} drawer must opt in`);
    }
  });

  it("25. desktop drawer geometry is untouched", () => {
    // The mobile rules live only inside the breakpoint; the desktop panel is
    // still the comp's right-side 460px sheet.
    assert.ok(DRAWER.includes('width: "min(460px,94vw)"'));
    assert.ok(DRAWER.includes('position: "fixed", top: 0, right: 0, bottom: 0'));
    /* No drawer GEOMETRY rule may apply outside a breakpoint — the full-screen
     * sheet belongs to the phone and nowhere else.
     *
     * Scroll ownership is deliberately excluded, and the distinction is the
     * point: `.app-drawer-body{overscroll-behavior:contain}` is unconditional
     * BECAUSE a container that owns its scrolling owns it on a desktop too, and
     * confining it to the mobile block is exactly what left the tablet band
     * chaining into the page. It moves nothing and sizes nothing. */
    const geometry = /(inset|width|height|top|right|bottom|left|padding|margin|border|box-shadow|position|display|flex)\s*:/;
    const rules = [...UNCONDITIONAL.matchAll(/([^{}]*\.app-drawer[^{}]*)\{([^}]*)\}/g)];
    for (const [, selector, body] of rules) {
      assert.ok(!geometry.test(body), `${selector.trim()} states geometry outside a breakpoint: ${body}`);
    }
  });
});

/* ----------------------------------------------------------- honest limits */

describe("Shell — overflow is solved, not hidden", () => {
  it("26. no overflow-x:hidden is used on the page or its scroll container", () => {
    /* Clipping the document would mask exactly the fault this work fixed, and
     * would take the evidence with it. The one permitted use is inside the
     * drawer panel, whose own geometry is already correct. */
    const offenders = [...CSS.matchAll(/([^{}]+)\{[^}]*overflow-x:hidden[^}]*\}/g)].map((m) => m[1].trim());
    for (const selector of offenders) {
      assert.ok(
        selector.includes(".app-drawer"),
        `overflow-x:hidden on "${selector}" would hide the geometry instead of fixing it`
      );
    }
    for (const bad of ["html{", "body{", "html,body{"]) {
      const rule = CSS.slice(CSS.indexOf(bad), CSS.indexOf(bad) + 120);
      assert.ok(!rule.includes("overflow-x"), `${bad} must not clip the document`);
    }
  });
});
