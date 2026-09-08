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

import { MOBILE_QUERY, TABLET_QUERY } from "../src/lib/use-media-query";

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
/** Every `useEffect(...)` body in a source file. Lets an assertion say "no
 * effect does X" instead of "the file contains no effect", which stops being a
 * statement about anything the moment one legitimate effect is added. */
function effectBodies(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf("useEffect("); i !== -1; i = src.indexOf("useEffect(", i + 1)) {
    let depth = 0;
    for (let j = i + 9; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") { depth--; if (depth === 0) { out.push(src.slice(i, j + 1)); break; } }
    }
  }
  return out;
}

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
    assert.ok(SHELL.includes("const navShown = isMobile && navOpen;"), "ANDed, not cleared");
    /* Narrowed in Gate 6.2, not weakened. The shell now has ONE effect — the
     * Escape listener — so "contains no useEffect" would no longer say anything
     * about the open flag. What must stay true is that no effect writes the nav
     * or collapse state in response to a breakpoint change. */
    for (const body of effectBodies(SHELL)) {
      assert.ok(!/setCollapsePref\(/.test(body), "no effect may rewrite the collapse preference");
      assert.ok(!/isMobile|isTablet/.test(body), "no effect may watch the breakpoint");
    }
  });

  it("10. the toggle means 'overlay' on a phone and 'rail' on a desktop", () => {
    assert.ok(SHELL.includes("isMobile ? setNavOpen((o) => !o) : setCollapsePref(!railCollapsed)"));
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

/* ================================================ Gate 6.1: the rail's labels */

describe("Shell — the tablet rail hides labels that actually exist", () => {
  /* HUMAN VERIFICATION, SPRINT 10 GATE 6. Collapsing and expanding the sidebar
   * from tablet widths down either emptied the menu or failed to restore it.
   * Neither cause was in Sprint 10 — `git diff` over the shell is empty for the
   * whole sprint — and neither was in the Sidebar's own logic. They were:
   *
   *   1. Two selectors in the 860px block that have NEVER matched. The design
   *      comp's nav rows are `<button>`; this app's are `next/link`, so
   *      `nav button>span` matched nothing, and the logout `<button>` sits after
   *      `</nav>` so `nav button` did not reach it either. The rail was 64px
   *      with `overflow:hidden` while every label was still laid out inside it.
   *   2. The desktop `collapsed` flag reaching the phone overlay, where it is
   *      meaningless — and expressed as INLINE `display:none`, which no media
   *      query can override. That is the Gate 4.4D trap, in the shell.
   *
   * Both are pinned here against the DOM the component actually renders. */

  const RAIL = mediaBlock("(max-width:860px) and (min-width:621px)");

  it("27. the rail's hide rules name classes the sidebar really renders", () => {
    // Every class the rail block hides must appear in the component.
    for (const cls of ["sb-label", "nav-item"]) {
      assert.ok(RAIL.includes(`.${cls}`), `the rail block must target .${cls}`);
      assert.ok(SIDEBAR.includes(cls), `.${cls} must exist in the sidebar markup`);
    }
  });

  it("28. it no longer targets a `button` that is not there", () => {
    /* The regression itself. `<nav>` holds `next/link` rows only — the logout
     * button is outside it — so any `nav button` selector is dead code that
     * silently leaves labels visible in a 64px rail. */
    assert.ok(!/nav\s+button/.test(RAIL),
      "no `nav button` selector: the nav holds links, not buttons");
    const nav = SIDEBAR.slice(SIDEBAR.indexOf("<nav"), SIDEBAR.indexOf("</nav>"));
    assert.ok(!nav.includes("<button"), "nothing inside <nav> is a button");
    assert.ok(SIDEBAR.includes('className="nav-item"'), "the rows are .nav-item");
  });

  it("29. every label in the rail is reachable by one of those hooks", () => {
    /* The four things that must disappear at 64px: the brand, the section
     * headings, each row's text/badge, and the logout label. */
    const G = '.app-sidebar:not([data-rail-expanded="1"])';
    assert.ok(RAIL.includes(G + " .sb-label{display:none"), "brand + logout label");
    assert.ok(RAIL.includes(G + " nav>div{display:none"), "section headings");
    assert.ok(RAIL.includes(G + " .nav-item>span:not(:first-child){display:none"),
      "each row's label and badge");
    // The logout label was the one with no hook at all until 6.1.
    const foot = SIDEBAR.slice(SIDEBAR.indexOf("</nav>"));
    assert.ok(/className="sb-label"/.test(foot), "the logout label carries the shared hook");
  });

  it("30. the icons centre in the rail, through the class that exists", () => {
    assert.ok(RAIL.includes('.app-sidebar:not([data-rail-expanded="1"]) .nav-item{justify-content:center'));
  });
});

describe("Shell — a desktop flag never reaches the phone overlay", () => {
  it("31. `collapsed` is ANDed with the breakpoint, exactly as `navOpen` is", () => {
    /* Below 620px the stylesheet makes the sidebar a 248px overlay that is
     * full-labelled. `collapsed` means "narrow the rail to icons", which there
     * describes nothing — but it is applied as an inline `display:none` on every
     * label, so it would win over the media query and open an empty menu. */
    assert.ok(codeOf(SHELL).includes("const railCollapsed = !isMobile && (collapsePref ?? isTablet);"),
      "the flag is neutralised below the breakpoint");
    assert.ok(codeOf(SHELL).includes("collapsed={railCollapsed}"),
      "and the neutralised value is what the sidebar receives");
    assert.ok(!/collapsed=\{collapsePref\}/.test(codeOf(SHELL)),
      "the raw preference must not be passed down");
  });

  it("32. it is a derived value, not an effect that clears state on resize", () => {
    /* Same reasoning the scrim's `navShown` already states: a value ANDed during
     * render cannot be stale, whereas an effect leaves one render in which the
     * old flag is still in the DOM. */
    /* Narrowed the same way test 9 is: the guarantee is that no EFFECT rewrites
     * the preference on a resize, not that the file contains no effect at all. */
    for (const body of effectBodies(SHELL)) {
      assert.ok(!/setCollapsePref\(/.test(body), "no effect writes the preference");
    }
    assert.ok(codeOf(SHELL).includes("const navShown = isMobile && navOpen;"),
      "the sibling pattern is unchanged");
    assert.ok(codeOf(SHELL).includes("const railExpanded = collapsePref === false;"),
      "and the stylesheet's override flag is derived too");
  });

  it("33. the collapsed presentation is still inline, so the AND is what protects it", () => {
    /* If this ever stops being an inline style the AND is belt-and-braces rather
     * than load-bearing — but while it IS inline, no stylesheet can undo it, and
     * that is precisely why the flag must not arrive. */
    assert.ok(/hideCollapsed[^\n]*collapsed \? \{ display: "none" \}/.test(SIDEBAR),
      "labels are hidden inline when collapsed");
    assert.ok(/const sbw = collapsed \? 64 : 248;/.test(SIDEBAR));
  });

  it("34. the toggle still means two different things, and only two", () => {
    assert.ok(codeOf(SHELL).includes("isMobile ? setNavOpen((o) => !o) : setCollapsePref(!railCollapsed)"));
    /* AND IT SETTLES AGAINST WHAT IS SHOWN, not against what is stored. That is
     * what makes the FIRST press work at tablet, where the shown state is the
     * breakpoint's default and the stored preference is still `null` — the
     * updater form `(c) => !c` would have flipped null to true and collapsed an
     * already-collapsed rail, which is the no-op the human pass reported. */
    assert.ok(!/setCollapsePref\(\(c\) => !c\)/.test(codeOf(SHELL)),
      "the preference is not toggled against itself");
    assert.ok(codeOf(SHELL).includes("const [collapsePref, setCollapsePref] = useState<boolean | null>(null);"),
      "null is the third VALUE — follow the default — not a third presentation");
  });
});

describe("Shell — Reports' own CSS stays inside Reports", () => {
  it("35. no Reports rule names a shell selector on screen", () => {
    /* Sprint 10 added a large responsive block. Every screen rule in it must be
     * `.rp-*`; the ONLY place Reports may name a shell element is inside its
     * print scope, where hiding the sidebar and header is the entire point. */
    const shellNames = [".app-sidebar", ".app-header", ".app-shell", ".app-main",
      ".nav-item", ".sb-label", ".app-nav-scrim", ".app-drawer"];
    for (const block of ["(max-width:767px)", "(max-width:620px)"]) {
      const body = mediaBlock(block);
      for (const name of shellNames) {
        // Reports' phone rules touch only .rp-* — a shell name here would be a leak.
        const reportsRules = body.split("}").filter((r) => r.includes(".rp-"));
        for (const rule of reportsRules) {
          assert.ok(!rule.includes(name),
            `a Reports rule in ${block} names ${name}: ${rule.trim().slice(0, 80)}`);
        }
      }
    }
  });

  it("36. the shell's own breakpoints are untouched by Sprint 10", () => {
    // The three the shell owns still exist and still say what they said.
    assert.ok(CSS.includes("@media (max-width:860px) and (min-width:621px){"));
    assert.ok(CSS.includes("@media (max-width:620px){"));
    assert.match(MOBILE, /\.app-sidebar\{[^}]*position:fixed !important/);
    assert.match(MOBILE, /\.app-sidebar\{[^}]*width:248px !important/);
  });
});

/* ============================== Gate 6.2: the toggle, the drawer, the motion */

describe("Shell — the tablet toggle is no longer a no-op", () => {
  const RAIL = mediaBlock("(max-width:860px) and (min-width:621px)");

  it("37. the rail is the tablet DEFAULT, and the default can be overruled", () => {
    /* Every rail rule is gated on the override attribute. Unconditional
     * `!important` here is what made the button do nothing: the component
     * changed its state, and the stylesheet went on pinning 64px regardless. */
    for (const line of RAIL.split("\n")) {
      if (!line.includes(".app-sidebar")) continue;
      assert.ok(line.includes('[data-rail-expanded="1"]'),
        `an ungated rail rule would pin the sidebar again: ${line.trim()}`);
    }
  });

  it("38. the component publishes the one fact the stylesheet cannot know", () => {
    assert.ok(SIDEBAR.includes('data-rail-expanded={railExpanded ? "1" : "0"}'));
    assert.ok(codeOf(SHELL).includes("const railExpanded = collapsePref === false;"),
      "only an EXPLICIT expand overrules the default");
  });

  it("39. the default still comes from CSS, so a tablet cannot flash the wrong width", () => {
    /* The server has no viewport. If the rail were JS-only the HTML would ship
     * 248px and hydration would correct it — a visible jump on every load. */
    assert.ok(RAIL.includes("width:64px !important"), "the default is still stated in CSS");
    assert.ok(!/useEffect[\s\S]{0,200}railExpanded/.test(codeOf(SHELL)),
      "and it is not applied by an effect after mount");
  });

  it("40. the breakpoint the shell reads is the one the stylesheet uses", () => {
    const q = TABLET_QUERY.match(/max-width:\s*(\d+)px[\s\S]*min-width:\s*(\d+)px/);
    assert.ok(q, "TABLET_QUERY states both edges");
    assert.ok(CSS.includes(`@media (max-width:${q![1]}px) and (min-width:${q![2]}px){`),
      "the hook and the stylesheet must not drift");
  });

  it("41. expanding at tablet gives the real panel, not a third size", () => {
    // The component knows exactly two widths, and the tablet override picks one.
    assert.ok(SIDEBAR.includes("const sbw = collapsed ? 64 : 248;"));
    const widths = (SIDEBAR.match(/\b(64|248)\b/g) ?? []).length;
    assert.ok(widths >= 2, "the two designed widths");
    assert.ok(!/\b(120|160|200)\b/.test(SIDEBAR), "no invented intermediate rail");
  });

  it("42. the toggle is never a control that does nothing", () => {
    /* Either it acts, or it is not drawn. This build chose "it acts" at every
     * width, so the button is unconditional and the state behind it is real. */
    assert.ok(HEADER.includes("onClick={onToggleSidebar}"));
    assert.ok(!/hdr-toggle[^{]*\{[^}]*display:none/.test(CSS),
      "the control is not hidden at any width — it works instead");
  });
});

describe("Shell — the mobile drawer slides", () => {
  it("43. the drawer moves by transform, not by appearing", () => {
    assert.match(MOBILE, /\.app-sidebar\{[^}]*transform:translateX\(-100%\)/);
    assert.match(MOBILE, /\.app-sidebar\[data-mobile-open="1"\]\{transform:translateX\(0\)\}/);
    // A display swap cannot be transitioned, and would destroy the animation.
    assert.ok(!/\.app-sidebar\{[^}]*display:none/.test(MOBILE),
      "the drawer is moved off-canvas, never removed");
  });

  it("44. THE TRANSITION IS DECLARED WHERE IT CANNOT LOSE", () => {
    /* THE DEFECT. The phone block asked for `transition:transform .2s ease`
     * without `!important`, and the component's inline `transition:width .18s
     * ease` beat it — so the transform had no transition and the drawer jumped.
     * Naming both properties inline is what removes the contest. */
    assert.ok(SIDEBAR.includes('transition: "width .18s ease, transform .2s ease"'),
      "the inline declaration names transform as well as width");
    /* Comment-free: the prose that explains the removal names `transition` too,
     * and a scan over the raw block would find the explanation instead. */
    const phoneRules = MOBILE.replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.ok(!/\.app-sidebar\{[^}]*transition:/.test(phoneRules),
      "and the phone block no longer restates a rule it would lose");
  });

  it("45. reduced motion still switches the whole thing off", () => {
    /* There are TWO reduced-motion blocks — a global one that shortens every
     * duration, and the sidebar's own. `mediaBlock` returns the first, so this
     * asserts against the whole stylesheet instead. */
    assert.ok(/\.app-sidebar\{transition:none !important\}/.test(RULE_TEXT),
      "`!important` is what lets it beat the inline declaration");
    assert.ok(/transition-duration:\.01ms !important/.test(RULE_TEXT),
      "and the global reduced-motion rule still covers everything else");
  });

  it("46. the scrim sits under the drawer, and the drawer over the page", () => {
    const z = (re: RegExp) => Number(MOBILE.match(re)![1]);
    const drawer = z(/\.app-sidebar\{[^}]*z-index:(\d+)/);
    const scrim = z(/\.app-nav-scrim\{[^}]*z-index:(\d+)/);
    assert.ok(drawer > scrim, `drawer ${drawer} must sit above scrim ${scrim}`);
  });

  it("47. the drawer is full width-and-height, and full-labelled", () => {
    assert.match(MOBILE, /\.app-sidebar\{[^}]*width:248px !important/);
    assert.match(MOBILE, /\.app-sidebar\{[^}]*height:100dvh !important/);
    /* Labels are inline-hidden by `collapsed`, which the shell already ANDs
     * away below the breakpoint — so nothing in the phone block needs to undo
     * it, and this is the assertion that says so. */
    assert.ok(codeOf(SHELL).includes("const railCollapsed = !isMobile && (collapsePref ?? isTablet);"));
  });
});

describe("Shell — the drawer has its own way out", () => {
  it("48. there is a close control inside the drawer", () => {
    assert.ok(SIDEBAR.includes('className="sb-close btn-ghost"'));
    assert.ok(SIDEBAR.includes("onClick={onCloseNav}"));
    assert.ok(SIDEBAR.includes("<IconX"), "an obvious close glyph");
  });

  it("49. it is a real button with an accessible name", () => {
    const block = SIDEBAR.slice(SIDEBAR.indexOf("sb-close") - 300, SIDEBAR.indexOf("sb-close") + 300);
    assert.ok(/<button/.test(block), "a button, not a clickable div");
    assert.ok(/type="button"/.test(block), "and not a submit");
    assert.ok(/aria-label=\{t\("Close menu"\)\}/.test(SIDEBAR), "named, and translated");
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    assert.ok(dict["Close menu"], "the name is in the dictionary");
  });

  it("50. it is drawn only when there is a drawer to close", () => {
    assert.ok(/\{mobileOpen && \(/.test(SIDEBAR),
      "never beside the desktop rail, where it would duplicate the header toggle");
  });

  it("51. the scrim is no longer the only dismissal", () => {
    // Three ways out: the button, the scrim, Escape.
    assert.ok(SIDEBAR.includes("onClick={onCloseNav}"), "1 — the drawer's own control");
    assert.ok(SHELL.includes('className="app-nav-scrim"'), "2 — the scrim");
    assert.ok(SHELL.includes('if (e.key === "Escape") setNavOpen(false)'), "3 — Escape");
  });

  it("52. Escape is bound only while the drawer is open, and is cleaned up", () => {
    const [effect] = effectBodies(SHELL).filter((b) => b.includes("Escape"));
    assert.ok(effect, "the listener lives in an effect");
    assert.ok(effect.includes("if (!navShown) return;"), "not bound while closed");
    assert.ok(effect.includes("removeEventListener"), "and removed on close");
  });

  it("53. the toggle reports the state it controls", () => {
    assert.ok(HEADER.includes("aria-expanded={navExpanded}"));
    assert.ok(codeOf(SHELL).includes("navExpanded={isMobile ? navShown : !railCollapsed}"),
      "the drawer's open state on a phone, the rail's on everything else");
    assert.ok(HEADER.includes('aria-label={t("Toggle sidebar")}'), "the name is unchanged");
  });
});

describe("Shell — crossing the breakpoints leaves nothing broken", () => {
  it("54. a rail collapsed on a desktop never reaches the phone drawer", () => {
    // The 6.1 guarantee, restated against the new derivation.
    assert.ok(codeOf(SHELL).includes("!isMobile && (collapsePref ?? isTablet)"));
    assert.ok(codeOf(SHELL).includes("collapsed={railCollapsed}"));
  });

  it("55. and an expand asked for on a tablet never survives INTO the phone drawer", () => {
    /* `railExpanded` only reaches the stylesheet, and the tablet block that
     * reads it stops at 621px — so the attribute is inert on a phone. */
    const phone = mediaBlock("(max-width:620px)");
    assert.ok(!phone.includes("data-rail-expanded"), "the phone block ignores it");
  });

  it("56. no effect resets state when the viewport changes", () => {
    for (const body of effectBodies(SHELL)) {
      assert.ok(!/setNavOpen\(true\)/.test(body), "nothing opens the nav by itself");
      assert.ok(!/setCollapsePref\(/.test(body), "nothing rewrites the preference");
    }
  });

  it("57. the preference outranks the default at every width, in one expression", () => {
    /* One place decides, so tablet and desktop cannot disagree about what the
     * teacher asked for. */
    const hits = (codeOf(SHELL).match(/collapsePref/g) ?? []).length;
    assert.ok(hits >= 3 && hits <= 8, `collapsePref is read in ${hits} places, not scattered`);
    assert.ok(!/collapsePref[\s\S]{0,40}useState<boolean>\(/.test(codeOf(SHELL)),
      "null must remain expressible — it is what 'follow the default' means");
  });
});

describe("Shell — Reports is untouched by any of this", () => {
  it("58. no Gate 6.2 rule names a Reports selector", () => {
    for (const block of ["(max-width:860px) and (min-width:621px)", "(max-width:620px)"]) {
      const body = mediaBlock(block);
      for (const rule of body.split("}")) {
        if (!/\.app-sidebar|\.sb-close|\.app-nav-scrim/.test(rule)) continue;
        assert.ok(!rule.includes(".rp-"), `a shell rule names a Reports class: ${rule.trim().slice(0, 70)}`);
      }
    }
  });

  it("59. the Reports print scope still hides the sidebar, unchanged", () => {
    assert.ok(CSS.includes("body.print-report .app-sidebar"),
      "print still removes the shell, whatever the drawer does on screen");
  });
});

describe("Shell — the stylesheet is syntactically whole", () => {
  /* GATE 6.2 ADDED THIS BECAUSE THE SUITE COULD NOT SEE THE BUG IT WROTE. Every
   * assertion in this file reads globals.css as TEXT, so a comment reopened
   * after its own `*​/` — which is exactly what one edit here produced — passes
   * all 2000-odd of them and fails only in `npm run build`, minutes later, as a
   * postcss "Unknown word". These two checks are the cheapest possible parse. */

  it("60. every comment is opened and closed exactly once", () => {
    const opens = (CSS.match(/\/\*/g) ?? []).length;
    const closes = (CSS.match(/\*\//g) ?? []).length;
    assert.equal(opens, closes, `${opens} comment openers, ${closes} closers`);
    // …and none nests, which CSS does not support and postcss reads as content.
    let depth = 0;
    for (let i = 0; i < CSS.length - 1; i++) {
      if (CSS[i] === "/" && CSS[i + 1] === "*") { depth++; assert.ok(depth <= 1, `nested comment at ${i}`); i++; }
      else if (CSS[i] === "*" && CSS[i + 1] === "/") { depth--; assert.ok(depth >= 0, `stray closer at ${i}`); i++; }
    }
    assert.equal(depth, 0, "the file ends inside a comment");
  });

  it("61. braces balance once the comments are gone", () => {
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");
    let depth = 0;
    for (const ch of bare) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; assert.ok(depth >= 0, "a rule closes that never opened"); }
    }
    assert.equal(depth, 0, "an unclosed rule or @media block");
  });
});

/* ================================= Gate 6.3: both directions must interpolate */

describe("Shell — the rail animates in both directions", () => {
  const RAIL = mediaBlock("(max-width:860px) and (min-width:621px)");
  /** The component, comment-free. EVERY assertion below reads this and not the
   * raw file: the prose explaining what Gate 6.3 removed necessarily names
   * `minWidth`, `transition` and `display:none`, so a scan over the comments
   * finds the explanation instead of the code. */
  const SB = codeOf(SIDEBAR);
  /** The stylesheet's in-flow rules: comments gone, and the phone block — which
   * legitimately keeps an inert min-width — removed. `RULE_TEXT` is already
   * comment-free, so the block must be stripped in that same form. */
  const IN_FLOW_CSS = RULE_TEXT.replace(MOBILE.replace(/\/\*[\s\S]*?\*\//g, ""), " ");
  const IN_FLOW = [IN_FLOW_CSS, SB];

  it("62. one element owns the width, and it owns both states", () => {
    assert.ok(SB.includes("const sbw = collapsed ? 64 : 248;"), "both widths, one expression");
    assert.ok(SB.includes("width: sbw,"), "and the element states it");
  });

  it("63. THE SECOND WIDTH SOURCE IS GONE", () => {
    /* THE DEFECT. `minWidth: sbw` sat beside `width: sbw` and was not in the
     * transition, so it clamped — and it only BOUND while expanding:
     *   collapse  used width = max(animating 248→64, 64) → animates
     *   expand    used width = max(animating 64→248, 248) → 248 at once, snap
     * That is the whole asymmetry the human pass reported. */
    assert.ok(!/minWidth: sbw/.test(SB), "min-width must not track the animated width");
    assert.ok(!SB.includes("maxWidth: sbw"), "nor a max-width");
  });

  it("64. …and what it was doing is stated directly instead", () => {
    /* `min-width` was only stopping the flex item being squeezed by the content
     * column. `flex-shrink:0` says that without resolving the width. */
    assert.ok(SB.includes("flexShrink: 0"), "the shrink guarantee survives the removal");
    assert.ok(/display: "flex", minHeight: "100vh"/.test(SHELL), "the parent really is a flex row");
  });

  it("65. no in-flow rule reintroduces a min- or max-width on the sidebar", () => {
    for (const src of IN_FLOW) {
      assert.ok(!/\.app-sidebar[^{]*\{[^}]*min-width/.test(src),
        "an in-flow min-width would clamp the expand direction again");
      assert.ok(!/\.app-sidebar[^{]*\{[^}]*max-width/.test(src));
    }
    // The tablet rail holds itself with width alone.
    assert.ok(RAIL.includes('.app-sidebar:not([data-rail-expanded="1"]){width:64px !important}'));
    // Comment-free: the note explaining the removal names `min-width` itself.
    assert.ok(!codeOf(RAIL).includes("min-width"), "the rail must not clamp either");
  });

  it("66. the phone drawer's own min-width is inert, not an exception to the rule", () => {
    /* It is allowed to stay because it cannot bind: fixed position, so not a
     * flex item; equal to the width; and the drawer animates transform. */
    assert.match(MOBILE, /\.app-sidebar\{[^}]*position:fixed !important/);
    const w = MOBILE.match(/\.app-sidebar\{[\s\S]*?width:(\d+)px !important;min-width:(\d+)px !important/);
    assert.ok(w, "both are declared together");
    assert.equal(w![1], w![2], "and they are equal, so the clamp can never bind");
  });

  it("67. desktop and tablet share ONE transition, declared once", () => {
    assert.ok(SB.includes('transition: "width .18s ease, transform .2s ease"'));
    // Not a second implementation per breakpoint.
    assert.equal((SB.match(/transition:/g) ?? []).length, 1, "one declaration in the component");
    const bare = IN_FLOW_CSS;
    assert.ok(!/\.app-sidebar[^{]*\{[^}]*transition:[^}]*width/.test(bare),
      "no stylesheet rule declares a competing width transition");
  });

  it("68. the width never changes through display, and never through a parent track", () => {
    /* Anchored on the ELEMENT's own rule. A loose `.app-sidebar[^{]*` also
     * matches `.app-sidebar .sb-label{display:none}`, which is a LABEL rule and
     * entirely correct — it is the rail hiding its text, not a width swap. */
    assert.ok(!/\.app-sidebar(:not\([^)]*\))?\{[^}]*display:none/.test(IN_FLOW_CSS),
      "a display swap cannot be interpolated");
    /* The content column follows by `flex:1`, so nothing else states a track
     * that could jump while the sidebar animates. */
    assert.ok(SHELL.includes('style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}'));
    assert.ok(!/grid-template-columns[^;]*248px/.test(RULE_TEXT), "no grid track duplicates the width");
  });

  it("69. no timer, frame hook or forced reflow drives the motion", () => {
    for (const banned of ["setTimeout", "requestAnimationFrame", "offsetWidth", "getBoundingClientRect"]) {
      assert.ok(!SB.includes(banned), `${banned} has no part in a CSS transition`);
    }
  });

  it("70. reduced motion still turns it off deliberately, and only there", () => {
    assert.ok(/\.app-sidebar\{transition:none !important\}/.test(RULE_TEXT));
    // The switch is inside the reduced-motion query and nowhere else.
    const rmAt = CSS.indexOf("@media (prefers-reduced-motion:reduce)");
    assert.ok(CSS.indexOf(".app-sidebar{transition:none !important}") > rmAt,
      "the only `transition:none` on the sidebar sits inside the reduced-motion query");
  });

  it("71. the labels reveal with the width rather than forcing it", () => {
    /* `flex:1` + `overflow:hidden` makes each label's automatic minimum size
     * zero, so a label cannot push the row wider than the animating rail — it is
     * clipped and uncovered as the width grows. That is what keeps the motion
     * smooth instead of the row fighting the transition. */
    assert.ok(/flex: 1, whiteSpace: "nowrap", overflow: "hidden"/.test(SB));
    assert.ok(SB.includes('overflow: "hidden"'), "and the rail clips what has not been revealed");
  });

  it("72. the mobile drawer still moves by transform, untouched by any of this", () => {
    assert.match(MOBILE, /\.app-sidebar\{[^}]*transform:translateX\(-100%\)/);
    assert.match(MOBILE, /\.app-sidebar\[data-mobile-open="1"\]\{transform:translateX\(0\)\}/);
    assert.ok(SB.includes('data-mobile-open={mobileOpen ? "1" : "0"}'));
    assert.ok(SB.includes('className="sb-close btn-ghost"'), "and keeps its close control");
  });
});
