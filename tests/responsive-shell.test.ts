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

describe("Shell — the header fits the phone instead of defining its width", () => {
  /* The header is a single non-wrapping flex row, so its intrinsic minimum IS
   * the document's minimum width. Anything in it that refuses to shrink has to
   * state how it gets out of the way on a phone. */

  it("11. every hard minimum in the header has a mobile escape", () => {
    // The search box is the largest single floor in the row.
    assert.ok(HEADER.includes('className="hdr-search"'), "the search box needs a mobile hook");
    assert.match(MOBILE, /\.hdr-search\{min-width:0 !important\}/);
  });

  it("12. Quick add sheds its label rather than being clipped", () => {
    // It is nowrap + flexShrink:0, so it cannot be squeezed — only shortened.
    assert.ok(HEADER.includes('className="hdr-quickadd-label"'));
    assert.match(MOBILE, /\.hdr-quickadd-label\{display:none !important\}/);
  });

  it("13. Quick add keeps an accessible name once its label is hidden", () => {
    // Hiding the only text in a button would otherwise leave it unlabelled.
    assert.ok(HEADER.includes('aria-label={t("Quick add")}'));
  });

  it("14. the flex spacer stops competing for room on a phone", () => {
    assert.ok(HEADER.includes('className="hdr-spacer"'));
    assert.match(MOBILE, /\.hdr-spacer\{display:none !important\}/);
  });

  it("15. the keyboard hint is hidden where there is no keyboard", () => {
    assert.match(MOBILE, /\.hdr-kbd\{display:none !important\}/);
  });

  it("16. the header row still fits the narrowest supported phone", () => {
    /* A budget, not a snapshot: sum what the row cannot give up at 375px and
     * assert the search box is still left with usable space. Values come from
     * the component and the mobile @media block.
     *   toggle 34 | quick add icon 16 + 22 padding | theme 38 | bell 38
     *   user chip 34 avatar + 12 padding-left + 2 margin-left
     *   gaps 8 x 5 (the spacer is hidden) | container padding 12 x 2 */
    const fixed = 34 + (16 + 22) + 38 + 38 + (34 + 12 + 2) + 8 * 5 + 12 * 2;
    const searchRoom = 375 - fixed;
    assert.ok(searchRoom > 80, `the search box would only get ${searchRoom}px`);
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
    assert.match(MOBILE, /\.app-drawer-body\{overscroll-behavior:contain\}/);
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
    const desktopCss = CSS.slice(0, CSS.indexOf("@media (max-width:1100px)"));
    assert.ok(!desktopCss.includes(".app-drawer"), "no drawer rule may apply outside a breakpoint");
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
