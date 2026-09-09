/* Notifications — the header integration.
 *
 * Run with:  npm test
 *
 * NO BROWSER AND NO RENDER, as everywhere else in this suite: this repository
 * has no DOM harness, so nothing here clicks a bell. That is stated plainly
 * rather than worked around, and it shapes what these tests are:
 *
 *   - the BEHAVIOUR the panel depends on is already proven directly, because it
 *     lives in pure functions — `presentNotifications`, `markAllRead`, `dismiss`
 *     and the rest are exercised for real in tests/notification-state.test.ts.
 *     Repeating them through a fake DOM would test the fake.
 *   - the COPY is proven directly here, in both languages and against real
 *     formatter settings, because `rowCopy` was split out for exactly that.
 *   - the WIRING — that the component calls those functions instead of
 *     reimplementing them, and that it wires the panel to the right ones — is a
 *     source scan, the same instrument tests/settings.test.ts and
 *     tests/reports-ui.test.ts use for the same job.
 *
 * What a source scan cannot prove is that a click lands, that focus moves or
 * that the panel is positioned correctly on a phone. Those are Gate 6's, and
 * saying so here is more useful than a green test that only looked like it
 * checked them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { rowCopy } from "../src/components/shell/notification-copy";
import { createFormat, DEFAULT_REGIONAL } from "../src/lib/format";
import { translate } from "../src/lib/i18n";
import { NOTIFICATION_MAX } from "../src/lib/constants";
import type { AppNotification } from "../src/lib/notifications";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

/** Comment-stripped source, so a scan tests the CODE and not the prose that
 * explains it — these files' own headers name most of the things asserted absent
 * below in order to say why they are absent. Lifted from tests/settings.test.ts. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (...parts: string[]) => strip(read(...parts));

const MENU = code("src", "components", "shell", "notification-menu.tsx");
const MENU_RAW = read("src", "components", "shell", "notification-menu.tsx");
const HEADER = code("src", "components", "shell", "header.tsx");
const SHELL = code("src", "components", "shell", "app-shell.tsx");
const LAYOUT = code("src", "app", "(app)", "layout.tsx");
const SERVER = code("src", "lib", "notifications-server.ts");
const CSS = read("src", "app", "globals.css");

/** Just the Notifications block of the stylesheet, comment-free — so a scan for
 * a rule cannot be satisfied by an unrelated one somewhere else in a 2,000-line
 * file, and cannot be satisfied by the prose explaining it either. */
const NOTIF_CSS = (() => {
  const start = CSS.indexOf(".notif-markall:hover");
  const end = CSS.indexOf("\n/* =", start);
  return strip(CSS.slice(start, end === -1 ? CSS.length : end));
})();
const DICT = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* --------------------------------------------------------------- fixtures */

const notification = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: "tuition:B1", type: "tuition", sourceId: "B1", context: null, subject: "Emma Chen",
  studentId: "s1", classId: "c1", month: "2026-06", date: null, start: null,
  amount: 1_500_000, billingStatus: "Unpaid", href: "/finance", sortKey: "2026-06", ...over,
});

const vi = (s: string) => translate(s, "vi");
const en = (s: string) => translate(s, "en");
const fmt = (over: Partial<typeof DEFAULT_REGIONAL> = {}, lang: "vi" | "en" = "vi") =>
  createFormat({ ...DEFAULT_REGIONAL, ...over }, lang);

/* ================================================================ row copy */

describe("Notifications UI · row copy", () => {
  it("1. an unpaid bill names the kind, the student, the month and the amount", () => {
    const { title, body } = rowCopy(notification(), en, fmt({}, "en"));
    assert.equal(title, "Unpaid tuition");
    assert.equal(body, "Emma Chen · June 2026 · 1,500,000đ");
  });

  it("2. a partially paid bill says so, and does not say 'unpaid'", () => {
    const { title } = rowCopy(notification({ billingStatus: "Partially Paid" }), en, fmt({}, "en"));
    assert.equal(title, "Partially paid tuition");
  });

  it("3. a makeup names the class, the date and the time", () => {
    const n = notification({
      id: "makeup:L1:2026-07-12", type: "makeup", subject: "Advanced B2",
      month: null, date: "2026-07-12", start: "16:00", amount: null, billingStatus: null, href: "/calendar",
    });
    const { title, body } = rowCopy(n, en, fmt({}, "en"));
    assert.equal(title, "Upcoming makeup");
    assert.equal(body, "Advanced B2 · 12/07/2026 · 04:00 PM");
  });

  it("4. a review due names the student and the month", () => {
    const n = notification({
      id: "review:s1:2026-06", type: "review", subject: "Emma Chen", month: "2026-06",
      amount: null, billingStatus: null, href: "/reviews/new?studentId=s1",
    });
    const { title, body } = rowCopy(n, en, fmt({}, "en"));
    assert.equal(title, "Review due");
    assert.equal(body, "Emma Chen · June 2026");
  });

  it("5. no row exposes an internal id as user-facing copy", () => {
    const rows: AppNotification[] = [
      notification(),
      notification({ id: "makeup:L1:2026-07-12", type: "makeup", subject: "B2", date: "2026-07-12", start: "09:00", month: null }),
      notification({ id: "review:s1:2026-06", type: "review", subject: "Emma Chen" }),
    ];
    for (const n of rows) {
      const { title, body } = rowCopy(n, en, fmt({}, "en"));
      assert.ok(!`${title} ${body}`.includes(n.id), `${n.id} must not be shown`);
      assert.ok(!`${title} ${body}`.includes(n.sourceId), `${n.sourceId} must not be shown`);
    }
  });

  it("6. every row title is translated in Vietnamese", () => {
    const cases: [Partial<AppNotification>, string][] = [
      [{}, "Học phí chưa trả"],
      [{ billingStatus: "Partially Paid" }, "Học phí trả một phần"],
      [{ type: "makeup", month: null, date: "2026-07-12", start: "09:00" }, "Buổi bù sắp tới"],
      [{ type: "review" }, "Cần viết đánh giá"],
    ];
    for (const [over, expected] of cases) {
      assert.equal(rowCopy(notification(over), vi, fmt()).title, expected);
    }
  });

  it("7. the body follows the teacher's regional preferences", () => {
    /* Not a restatement of the formatter's own tests: what this proves is that
     * the row goes THROUGH the formatter rather than building its own strings. */
    const n = notification({ type: "makeup", month: null, date: "2026-07-12", start: "16:00", amount: null });
    assert.ok(rowCopy(n, en, fmt({ dateFormat: "MM/DD/YYYY" }, "en")).body.includes("07/12/2026"));
    assert.ok(rowCopy(n, en, fmt({ dateFormat: "YYYY/MM/DD" }, "en")).body.includes("2026/07/12"));
    assert.ok(rowCopy(n, en, fmt({ timeFormat: "24h" }, "en")).body.includes("16:00"));
  });

  it("8. currency is a display preference, and the stored figure is untouched", () => {
    const n = notification({ amount: 1_500_000 });
    assert.ok(rowCopy(n, en, fmt({ currency: "VND" }, "en")).body.includes("1,500,000đ"));
    assert.ok(rowCopy(n, en, fmt({ currency: "USD" }, "en")).body.includes("$"));
    assert.equal(n.amount, 1_500_000, "the notification's own value never changed");
  });

  it("9. number grouping follows the preference too", () => {
    assert.ok(rowCopy(notification(), en, fmt({ numberFormat: "dot" }, "en")).body.includes("1.500.000đ"));
  });

  it("10. a missing name leaves a readable sentence rather than an empty gap", () => {
    const { body } = rowCopy(notification({ subject: "" }), en, fmt({}, "en"));
    assert.equal(body, "June 2026 · 1,500,000đ");
    assert.ok(!body.startsWith(" · "), "no leading separator");
  });

  it("11. copy never names a send, a reminder or a recipient", () => {
    const all = [
      rowCopy(notification(), en, fmt({}, "en")),
      rowCopy(notification({ type: "makeup", month: null, date: "2026-07-12", start: "09:00" }), en, fmt({}, "en")),
      rowCopy(notification({ type: "review" }), en, fmt({}, "en")),
    ].map((c) => `${c.title} ${c.body}`).join(" ");
    for (const banned of ["Send", "Remind", "Notify", "mailto", "@"]) {
      assert.ok(!all.includes(banned), `no row may say ${banned}`);
    }
  });
});

/* ====================================================================== i18n */

describe("Notifications UI · translation", () => {
  it("12. every string the panel draws is in the dictionary", () => {
    for (const key of [
      "Notifications", "Mark all read", "You're all caught up.", "Dismiss",
      "Unpaid tuition", "Partially paid tuition", "Upcoming makeup", "Review due",
    ]) {
      assert.ok(typeof DICT[key] === "string" && DICT[key] !== "", `"${key}" is translated`);
    }
  });

  it("13. Sprint 12 added exactly the two strings that were genuinely missing", () => {
    /* The other six were already in the dictionary the design shipped — three of
     * them orphaned since then. Reusing an existing entry rather than coining a
     * synonym is what keeps one concept from acquiring two Vietnamese words. */
    assert.equal(DICT["Partially paid tuition"], "Học phí trả một phần");
    assert.equal(DICT["Review due"], "Cần viết đánh giá");
  });

  it("14. English falls back to the source string and needs no second dictionary", () => {
    for (const key of ["Notifications", "Review due", "Partially paid tuition"]) {
      assert.equal(en(key), key);
    }
  });

  it("15. the panel draws no untranslated literal", () => {
    /* Every user-visible string in the component goes through `t(...)`. The scan
     * is on JSX text nodes, which is where a hard-coded label would land. */
    const textNodes = [...MENU.matchAll(/>\s*([A-Za-z][A-Za-z ',.!]{3,})\s*</g)].map((m) => m[1].trim());
    assert.deepEqual(textNodes, [], `untranslated text: ${textNodes.join(" | ")}`);
  });
});

/* ================================================================== wiring */

describe("Notifications UI · the panel calls the engine and reimplements none of it", () => {
  it("16. it renders the engine's visible list and slices nothing itself", () => {
    assert.ok(MENU.includes("view.visible.map("), "rows come from view.visible");
    assert.ok(!/\.slice\(/.test(MENU), "no second cap in the component");
    /* Not a bare search for "20" — the comp's own shadow is `rgba(0,0,0,.20)` and
     * its empty state is padded `34px 20px`. What must not appear is the CAP: the
     * component neither imports it nor writes it down. */
    assert.ok(!MENU.includes("NOTIFICATION_MAX"), "the cap is the engine's, and is not named here");
    assert.equal(NOTIFICATION_MAX, 20, "and it is still twenty, wherever it is applied");
  });

  it("17. the badge reads the engine's unread count, not the visible length", () => {
    const badge = /view\.unreadCount > 0 && \(([\s\S]*?)\n {12}\)\}/.exec(MENU)?.[1] ?? "";
    assert.ok(badge !== "", "the badge is drawn only when something is unread");
    assert.ok(badge.includes("{view.unreadCount}"), "and shows that number");
    assert.ok(!/visible/.test(badge), "never the count of rendered rows");
    /* `view.visible.length === 0` DOES appear in the component — it is the empty
     * state, which is a different question and a legitimate one. What matters is
     * that no unread number is ever derived from the capped list. */
    assert.ok(!/unread\w*\s*=[^=]/.test(MENU), "and no unread count is computed here at all");
    assert.ok(!/\.filter\(/.test(MENU), "nor any set of its own");
  });

  it("18. mark-all is given the whole live set and not the visible twenty", () => {
    assert.ok(MENU.includes("markAllRead(ack, markableIds(view))"),
      "markableIds returns `undismissed`, which is the point of it");
    assert.ok(!/markAllRead\([^)]*visible/.test(MENU), "never the capped list");
  });

  it("19. sorting, dedup and derivation are absent from the component", () => {
    for (const banned of ["sort(", "dedupe", "deriveNotifications", "compareNotifications"]) {
      assert.ok(!MENU.includes(banned), `${banned} belongs to the engine, not the panel`);
    }
  });

  it("20. every acknowledgement transition is a Gate 2 function", () => {
    for (const fn of ["markRead(ack,", "markAllRead(ack,", "dismissId(ack,"]) {
      assert.ok(MENU.includes(fn), `${fn} is delegated`);
    }
    assert.ok(!/JSON\.parse|JSON\.stringify/.test(MENU), "no hand-rolled storage parsing in the panel");
    assert.ok(!/localStorage/.test(MENU), "and no direct storage access");
  });

  it("21. opening a row marks that one read, then navigates", () => {
    const open = /openNotification = useCallback\(\(n: AppNotification\) => \{([\s\S]*?)\}, \[/.exec(MENU)?.[1] ?? "";
    assert.ok(open.includes("markRead(ack, n.id)"), "marks exactly the one opened");
    assert.ok(open.includes("router.push(n.href)"), "then navigates to its own target");
    assert.ok(open.includes("setOpen(false)"), "and closes the panel");
    assert.ok(!open.includes("markAllRead"), "opening one is not opening all");
  });

  it("22. opening the PANEL marks nothing read", () => {
    const toggle = /onClick=\{\(\) => setOpen\(\(o\) => !o\)\}/.test(MENU);
    assert.ok(toggle, "the bell only toggles");
    assert.ok(!/setOpen\([^)]*\)[\s\S]{0,80}markAllRead/.test(MENU), "no mark-all rides along with opening");
  });

  it("23. dismiss writes only dismissal, and cannot navigate", () => {
    const onDismiss = /onDismiss = useCallback\(\(id: string\) => \{([\s\S]*?)\}, \[/.exec(MENU)?.[1] ?? "";
    assert.ok(onDismiss.includes("dismissId(ack, id)"));
    assert.ok(!onDismiss.includes("router"), "dismiss never navigates");
    assert.ok(!onDismiss.includes("markRead"), "and never marks read");
    /* The two controls are SIBLING buttons, as the comp draws them, so there is
     * no bubbling from dismiss into the row's own action and nothing to stop. */
    assert.ok(!/stopPropagation/.test(MENU), "no propagation to stop");
  });

  it("24. the acknowledgement snapshot is read through the external store", () => {
    assert.ok(MENU.includes("useSyncExternalStore("), "not an effect, and not a useState seed");
    assert.ok(MENU.includes("getAcknowledgementServerSnapshot"), "the server sees nothing acknowledged");
    assert.ok(!/useState<AcknowledgementState>/.test(MENU), "no local mirror of the store");
  });
});

/* ============================================================== navigation */

describe("Notifications UI · navigation", () => {
  it("25. it navigates to the notification's own href and builds no url", () => {
    assert.ok(MENU.includes("router.push(n.href)"));
    const pushes = [...MENU.matchAll(/router\.push\(([^)]*)\)/g)].map((m) => m[1]);
    assert.deepEqual(pushes, ["n.href"], "one navigation, and it is the engine's target");
  });

  it("26. the three targets are existing screens", () => {
    const routes = ["src/app/(app)/finance/page.tsx", "src/app/(app)/calendar/page.tsx", "src/app/(app)/reviews/new/page.tsx"];
    for (const r of routes) assert.doesNotThrow(() => read(...r.split("/")), `${r} exists`);
  });

  it("27. no notifications route was added", () => {
    assert.throws(() => read("src", "app", "api", "notifications", "route.ts"));
    assert.throws(() => read("src", "app", "(app)", "notifications", "page.tsx"));
    for (const src of [MENU, HEADER, SHELL, LAYOUT, SERVER]) {
      assert.ok(!/["'`]\/api\/notifications/.test(src), "nothing calls a notifications endpoint");
    }
  });

  it("28. the sidebar gained no Notifications item", () => {
    const sidebar = code("src", "components", "shell", "sidebar.tsx");
    assert.ok(!/Notification/i.test(sidebar), "the twelve nav items are unchanged");
  });
});

/* ================================================== the server data boundary */

describe("Notifications UI · where the data comes from", () => {
  it("29. derivation runs on the server, in the layout that already runs there", () => {
    assert.ok(LAYOUT.includes("getActiveNotifications()"), "the layout derives");
    assert.ok(LAYOUT.includes("notifications={notifications}"), "and hands the result to the shell");
    assert.ok(SERVER.includes('import "server-only"'), "the derivation module is server-only");
  });

  it("30. the session is checked before any data is read", () => {
    const redirect = LAYOUT.indexOf("redirect(\"/login\")");
    const derive = LAYOUT.indexOf("getActiveNotifications()");
    assert.ok(redirect > -1 && derive > redirect, "an unauthenticated request touches no database");
  });

  it("31. the server module reuses the existing accessor and adds no query", () => {
    /* De-duplicated: `./notifications` is imported twice, once for the function
     * and once for the type, which is one dependency and not two. */
    const imports = [...new Set([...SERVER.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))].sort();
    assert.deepEqual(imports, ["./notifications", "./repo"]);
    assert.ok(SERVER.includes('import "server-only"'), "and it is server-only");
    for (const banned of ["Model", "mongoose", "dbConnect", "find(", "aggregate"]) {
      assert.ok(!SERVER.includes(banned), `${banned} would be a second copy of domain fetching`);
    }
  });

  it("32. nothing fetches five collections into the browser", () => {
    for (const src of [MENU, HEADER, SHELL]) {
      assert.ok(!/getAll\(|BillingModel|LessonModel|ReviewModel/.test(src));
    }
    assert.ok(!/fetch\(/.test(MENU), "the panel makes no request of its own");
  });

  it("33. the shell passes notifications down and computes none", () => {
    assert.ok(SHELL.includes("notifications={notifications}"), "forwarded to the header");
    assert.ok(!/deriveNotifications|presentNotifications/.test(SHELL), "and derives nothing itself");
    assert.ok(HEADER.includes("<NotificationMenu notifications={notifications} />"));
  });
});

/* =================================================================== header */

describe("Notifications UI · the header row is otherwise unchanged", () => {
  it("34. the bell is no longer an inert button", () => {
    assert.ok(!/<IconBell/.test(HEADER), "the header no longer draws the bell itself");
    assert.ok(MENU.includes("<IconBell size={17} />"), "the menu does, at the comp's size");
  });

  it("35. the search seam is still unsupplied and still inert", () => {
    assert.ok(HEADER.includes("onOpenSearch?: () => void"), "the seam survives");
    assert.ok(HEADER.includes("onOpenSearch?.()"), "and is still the only trigger");
  });

  it("36. the theme toggle and its pre-paint icon swap are untouched", () => {
    assert.ok(HEADER.includes('setAppearance({ theme: isDark ? "light" : "dark" })'));
    assert.ok(HEADER.includes("hdr-theme-icon-dark") && HEADER.includes("hdr-theme-icon-light"));
  });

  it("37. the row's own geometry is unchanged", () => {
    assert.ok(HEADER.includes("height: 60"), "still a 60px band");
    assert.ok(HEADER.includes("gap: 14"), "still the comp's 14px, still not density-aware");
    assert.ok(HEADER.includes("zIndex: 20"), "and still beneath the panel's 120");
  });
});

/* ================================================================ geometry */

describe("Notifications UI · the panel follows the design reference", () => {
  it("38. every geometry anchor the comp specifies, from the layer that owns it", () => {
    /* The five breakpoint-sensitive declarations are the STYLESHEET's, so a
     * media query can change them; the rest stay inline with the ported surface.
     * Anchored on the `.notif-panel` rule rather than searched for loose in the
     * file, so a stray `370px` somewhere else could not satisfy this. */
    const rule = /\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    for (const decl of ["position:absolute", "top:47px", "right:0", "width:370px", "max-width:calc(100vw - 40px)"]) {
      assert.ok(rule.includes(decl), `${decl} is the stylesheet's`);
    }
    /* And the surface, which never varies by width, is still the comp's. */
    for (const anchor of ["borderRadius: 14", "zIndex: 120", "maxHeight: 400", 'overflowY: "auto"']) {
      assert.ok(MENU.includes(anchor), `${anchor} is drawn as the comp specifies`);
    }
  });

  it("38a. no responsive-critical geometry is left inline where it could beat CSS", () => {
    /* The defect class this repository has shipped repeatedly: a media query that
     * cannot win because the same property is declared inline on the element. */
    const panelStyle = /className="notif-panel"[\s\S]*?style=\{\{([\s\S]*?)\}\}/.exec(MENU)?.[1] ?? "";
    assert.notEqual(panelStyle, "", "the panel's inline style block was found");
    for (const banned of ["position", "top", "right", "left", "width", "maxWidth"]) {
      assert.ok(!new RegExp(`(^|[\\s,])${banned}:`).test(panelStyle),
        `${banned} must not be inline — the mobile rule has to be able to change it`);
    }
  });

  it("39. it is a popover and not a full-screen modal", () => {
    assert.ok(MENU.includes('position: "absolute"'), "anchored to the bell, not the viewport");
    assert.ok(!/position: "fixed"/.test(MENU));
    assert.ok(!/scrim|backdrop|inset: 0/i.test(MENU), "no scrim over the application");
  });

  it("40. colours come from tokens, so both themes and all four accents follow", () => {
    const colours = [...MENU.matchAll(/(?:background|color|borderColor):\s*"(#[0-9a-fA-F]{3,8}|white|black|rgb[^"]*)"/g)];
    assert.deepEqual(colours.map((m) => m[1]), [], "not one hard-coded colour is left");
    assert.ok(MENU.includes('background: "var(--accent)"'), "the badge sits on the accent token");
    assert.ok(MENU.includes('color: "var(--primary-fg)"'),
      "and reads with the existing semantic inverse-text token, not a literal white");
    for (const token of ["var(--card)", "var(--border)", "var(--border-2)", "var(--muted)", "var(--fg)"]) {
      assert.ok(MENU.includes(token), `${token} is used`);
    }
  });

  it("41. the empty state is the comp's own line, translated", () => {
    assert.ok(MENU.includes('t("You\'re all caught up.")'));
    assert.ok(!/Loading|Spinner|skeleton/i.test(MENU), "no spinner and no fabricated content");
  });

  it("42. hover states are stylesheet-owned, not inline", () => {
    assert.ok(CSS.includes(".notif-markall:hover{opacity:.7}"));
    assert.ok(CSS.includes(".notif-open:hover{opacity:.75}"));
    assert.ok(MENU.includes('className="icon-action"'), "dismiss reuses the shared hover pair");
    assert.ok(!/onMouseEnter|onMouseOver/.test(MENU), "no JavaScript hover");
  });
});

/* ================================================================ responsive */

describe("Notifications UI · responsive hardening", () => {
  it("57. a mobile rule exists, and it is a media query the stylesheet owns", () => {
    assert.ok(/@media \(max-width:767px\)\{\s*\.notif-panel\{/.test(NOTIF_CSS),
      "the phone override is at the header's own 767px breakpoint");
  });

  it("58. the phone rule stops anchoring to the bell, which is what caused the clipping", () => {
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.notEqual(mobile, "", "the phone rule was found");
    assert.ok(mobile.includes("left:20px") && mobile.includes("right:20px"),
      "both edges are pinned, so the panel cannot depend on where the trigger sits");
    assert.ok(mobile.includes("width:auto"), "the 370px desktop width is released");
    assert.ok(mobile.includes("max-width:none"), "and so is the clamp that assumed an edge anchor");
  });

  it("59. the phone rule overrides every desktop declaration it needs to", () => {
    /* A media query that changes `width` but leaves `max-width`, or moves the
     * anchor but leaves `right:0` at its old value, is the half-fix that leaves
     * the defect in place. Every property the base rule sets must be answered. */
    const base = /\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    const props = (rule: string) => new Set([...rule.matchAll(/([a-z-]+):/g)].map((m) => m[1]));
    for (const p of props(base)) {
      assert.ok(props(mobile).has(p), `the phone rule leaves \`${p}\` at its desktop value`);
    }
  });

  it("60. the phone rule comes after the base rule, so it wins on source order", () => {
    /* Same specificity, so order decides — and getting this backwards is a silent
     * no-op rather than an error. */
    assert.ok(NOTIF_CSS.indexOf("@media (max-width:767px)") > NOTIF_CSS.indexOf(".notif-panel{"));
  });

  it("61. no width the panel can take is wider than the viewport", () => {
    /* Desktop clamps with the comp's own calc; phone releases the clamp but pins
     * both edges instead, which bounds the width at `100vw - 40px` by
     * construction. Neither branch can produce a box wider than the screen. */
    const base = /\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.ok(base.includes("max-width:calc(100vw - 40px)"), "desktop is clamped to the viewport");
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.ok(/left:\d+px/.test(mobile) && /right:\d+px/.test(mobile) && mobile.includes("width:auto"),
      "phone is bounded by its two pinned edges");
  });

  it("62. the phone gutters are the 20px each side the comp's own clamp implied", () => {
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    const left = Number(/left:(\d+)px/.exec(mobile)?.[1]);
    const right = Number(/right:(\d+)px/.exec(mobile)?.[1]);
    assert.equal(left, 20);
    assert.equal(right, 20);
    assert.equal(left + right, 40, "which is the `100vw - 40px` the comp asked for, actually delivered");
  });

  it("63. it stays a popover on a phone and does not become a sheet", () => {
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.ok(!/bottom:0|height:100|inset:0|100dvh|100vh/.test(mobile), "no full-height sheet");
    assert.ok(/top:\d+px/.test(mobile), "it still opens from the top, under the header");
    assert.ok(MENU.includes("borderRadius: 14"), "and keeps the comp's radius at every width");
  });

  it("64. the list still scrolls inside the panel rather than growing it", () => {
    assert.ok(MENU.includes("maxHeight: 400") && MENU.includes('overflowY: "auto"'));
    assert.ok(!/@media[^}]*\{[^}]*max-height:\s*(?!400)/.test(NOTIF_CSS), "and no breakpoint changes that");
  });

  it("65. the header is untouched by this gate", () => {
    /* Sprint 11 deliberately left header spacing fixed and Sprint 8 settled its
     * three shapes. Notifications hardening must not have reopened either. */
    assert.ok(HEADER.includes("height: 60") && HEADER.includes("gap: 14") && HEADER.includes("zIndex: 20"));
    assert.ok(!/notif-panel/.test(HEADER), "the panel's geometry is not the header's business");
    assert.ok(!/control-gap/.test(MENU), "and the panel takes no density token");
  });

  it("66. the badge cannot change header geometry", () => {
    /* It is absolutely positioned inside the trigger, so it is out of flow and
     * its presence or absence moves nothing around it. */
    const badge = /view\.unreadCount > 0 && \(([\s\S]*?)\n {12}\)\}/.exec(MENU)?.[1] ?? "";
    assert.ok(badge.includes('position: "absolute"'), "out of flow");
    assert.ok(/style=\{\{ \.\.\.iconBtn, position: "relative" \}\}/.test(MENU), "positioned against the 38px trigger");
  });

  it("67. long titles wrap and cannot run under the dismiss control", () => {
    assert.ok(MENU.includes('overflowWrap: "anywhere"'), "an unbreakable token still breaks");
    assert.ok(MENU.includes("flex: 1, minWidth: 0"), "and the text column may shrink below its content");
    assert.ok(MENU.includes("flexShrink: 0"), "while the icon and dismiss keep their size");
  });

  it("68. only the body truncates, exactly as the comp draws it", () => {
    assert.ok(MENU.includes('whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"'));
    assert.equal((MENU.match(/textOverflow/g) ?? []).length, 1, "the title is never ellipsized");
  });
});

/* ============================================================ motion / stack */

describe("Notifications UI · motion and stacking", () => {
  it("69. the open animation is the comp's, and reduced motion already covers it", () => {
    assert.ok(MENU.includes('animation: "fadeUp .16s ease both"'));
    assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation-duration:\.01ms/.test(CSS),
      "the app-wide reduced-motion rule already neutralises it — no new subsystem");
  });

  it("70. the animation moves the panel and never the page", () => {
    /* `fadeUp` is opacity plus a transform, and the panel is out of flow at every
     * width, so nothing it does can reflow the document. */
    assert.ok(/@keyframes fadeUp\{from\{opacity:0;transform:translateY\(6px\)\}/.test(CSS));
    const base = /\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.ok(/position:(absolute|fixed)/.test(base), "out of flow on desktop");
    const mobile = /@media \(max-width:767px\)\{\s*\.notif-panel\{([^}]*)\}/.exec(NOTIF_CSS)?.[1] ?? "";
    assert.ok(/position:(absolute|fixed)/.test(mobile), "and on a phone");
  });

  it("71. the panel sits above ordinary content and below every modal", () => {
    assert.ok(MENU.includes("zIndex: 120"), "above the page");
    /* Everything the app stacks above the header is a modal or a global overlay —
     * drawer (80/81), nav overlay (89/90), dialog (90/91), toast (200) — and all
     * of them SHOULD cover a popover. What must not exist is ORDINARY content in
     * between, so this asserts the gap: nothing sits strictly between the
     * header's 20 and the first overlay band at 80. A future page card at 100
     * would fail here rather than silently paint over the panel. */
    const stacked = [
      ...[...strip(CSS).matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1])),
      ...[...[MENU, HEADER, SHELL].join("\n").matchAll(/zIndex: (\d+)/g)].map((m) => Number(m[1])),
    ];
    assert.ok(stacked.length > 3, "the scan actually found the stacking rules");
    for (const z of stacked) {
      assert.ok(z <= 20 || z >= 80, `z-index ${z} sits between the header and the overlays`);
    }
  });

  it("72. no application-wide stacking was raised to make room for it", () => {
    assert.ok(HEADER.includes("zIndex: 20"), "the header still declares its original 20");
    /* The panel stacks locally, inside the header's own context, and the
     * stylesheet's own ceiling is unchanged at the mobile nav's 90. */
    const cssMax = Math.max(...[...strip(CSS).matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(cssMax, 90, "the stylesheet's highest stacking rule is still the nav overlay's");
    assert.ok(!NOTIF_CSS.includes("z-index"), "and the Notifications block declares none at all");
  });
});

/* =========================================================== accessibility */

describe("Notifications UI · keyboard and dismissal", () => {
  it("43. the bell has an accessible name that carries the unread count", () => {
    assert.ok(MENU.includes('`${t("Notifications")} (${view.unreadCount})`'));
    assert.ok(MENU.includes("aria-label={label}"));
    assert.ok(MENU.includes("aria-expanded={open}"), "and announces its own state");
  });

  it("44. the badge is not announced twice", () => {
    assert.ok(/data-testid="notif-badge"/.test(MENU));
    assert.ok(/aria-hidden="true"\s*\n\s*data-testid="notif-badge"/.test(MENU_RAW),
      "the badge repeats the label's count, so it is hidden from assistive tech");
  });

  it("45. Enter and Space need no handler, because both controls are buttons", () => {
    /* A <button> is activated by Enter and Space natively. The row is two
     * sibling buttons and the bell is a button, so there is no key handling to
     * write and no role to fake. */
    assert.ok(/<button\n\s+ref=\{bellRef\}\n\s+type="button"/.test(MENU_RAW), "the bell is a real button");
    assert.equal((MENU.match(/type="button"/g) ?? []).length, 4, "bell, mark-all, open and dismiss");
    assert.ok(!/onKeyDown|role="button"/.test(MENU), "nothing reimplements button activation");
  });

  it("46. Escape closes and returns focus to the bell", () => {
    assert.ok(MENU.includes('if (e.key === "Escape") { setOpen(false); bellRef.current?.focus(); }'));
  });

  it("47. a pointer outside closes it", () => {
    assert.ok(MENU.includes("!wrapRef.current.contains(e.target as Node)"));
    assert.ok(MENU.includes('document.addEventListener("mousedown", onDown)'));
  });

  it("48. no listener outlives the panel", () => {
    assert.ok(/if \(!open\) return;/.test(MENU), "bound only while open");
    assert.ok(MENU.includes('document.removeEventListener("mousedown", onDown)'));
    assert.ok(MENU.includes('document.removeEventListener("keydown", onKey)'));
  });

  it("49. it is a non-modal popover — no focus trap, no aria-modal", () => {
    for (const banned of ["aria-modal", "focus-trap", "inert", "role=\"dialog\""]) {
      assert.ok(!MENU.includes(banned), `${banned} would make the rest of the app unreachable`);
    }
  });

  it("50. the dismiss control is labelled", () => {
    assert.ok(MENU.includes('aria-label={t("Dismiss")}'));
  });
});

/* ================================================= states / accent / refresh */

describe("Notifications UI · interaction states", () => {
  it("73. every hover treatment is CSS, and none of them is a hard-coded neutral", () => {
    /* Four hoverable things: the bell, Mark all read, the row's open action and
     * dismiss. Each resolves through an existing rule or an opacity, so both
     * themes follow and nothing paints a fixed grey. */
    assert.ok(MENU.includes('className="btn-ghost"'), "the bell reuses the header's hover");
    assert.ok(MENU.includes('className="notif-markall"') && NOTIF_CSS.includes(".notif-markall:hover{opacity:.7}"));
    assert.ok(MENU.includes('className="notif-open"') && NOTIF_CSS.includes(".notif-open:hover{opacity:.75}"));
    assert.ok(MENU.includes('className="icon-action"'), "dismiss reuses the shared icon hover");
    assert.ok(CSS.includes(".icon-action:hover{background:var(--hover) !important;color:var(--fg) !important}"));
    assert.ok(!/#[0-9a-fA-F]{3,8}/.test(NOTIF_CSS), "the Notifications block hard-codes no colour");
  });

  it("74. there is no JavaScript hover anywhere in the panel", () => {
    for (const banned of ["onMouseEnter", "onMouseOver", "onMouseLeave", "onPointerEnter", ":hover"]) {
      assert.ok(!MENU.includes(banned), `${banned} belongs in the stylesheet, not the component`);
    }
  });

  it("75. focus uses the shared :focus-visible system and adds no bare :focus", () => {
    assert.ok(/button:focus-visible[^{]*\{outline:2px solid var\(--accent\)/.test(CSS),
      "the app-wide ring already covers all four controls");
    assert.ok(!/:focus[^-v]/.test(NOTIF_CSS), "Notifications declares no bare :focus of its own");
    assert.ok(!/outline: *['"]?none/.test(MENU), "and removes no ring");
  });

  it("76. read is not dismissed, and no read/unread row styling was invented", () => {
    /* The comp draws no per-row read state — the badge is the unread signal — so
     * inventing one would be a redesign. What must never happen is a read item
     * being HIDDEN: read and dismissed are different acts. */
    assert.ok(!/isRead\(|opacity.*read|data-read/.test(MENU), "no row is styled by its read state");
    assert.ok(MENU.includes("view.visible.map("), "and the list is the engine's, unfiltered by read");
    assert.ok(!/filter\([^)]*read/.test(MENU), "nothing hides a read notification");
  });

  it("77. accent changes reach the panel with no reload, through the token system", () => {
    /* `[data-accent]` on <html> rewrites the variables; everything accent-tinted
     * here reads one. Nothing caches an accent value in JS. */
    for (const use of ['background: "var(--accent)"', 'soft: "var(--accent-soft)", solid: "var(--accent)"']) {
      assert.ok(MENU.includes(use), use);
    }
    assert.ok(!/#d14242|#4f46e5|#0f766e|#475569/.test(MENU), "no accent hex is frozen into the panel");
    assert.ok(!/useSettings\(\)[\s\S]{0,80}accent/.test(MENU), "and no accent is read into JS state");
  });
});

describe("Notifications UI · the refresh boundary is deliberate and API-free", () => {
  it("78. nothing notification-owned polls, sockets, revalidates or refetches", () => {
    /* Scoped to the files Sprint 12 owns. `AppShell` is deliberately NOT in this
     * list: it has carried a `useQuery` for the sidebar counts and a
     * `router.refresh()` in the logout flow since long before this sprint, and a
     * scan that failed on those would be reporting Sprint 1 as a Gate 4 defect. */
    const owned = [MENU, LAYOUT, SERVER, code("src", "lib", "notification-ack-store.ts"),
                   code("src", "components", "shell", "notification-copy.ts")].join("\n");
    for (const banned of [
      "setInterval", "setTimeout", "WebSocket", "EventSource", "refetchInterval",
      "router.refresh", "revalidate", "useQuery", "swr", "poll",
    ]) {
      assert.ok(!owned.includes(banned), `${banned} would be the refresh loop the contract refuses`);
    }
  });

  it("78a. and the shell's own pre-existing fetches were not repurposed for it", () => {
    assert.ok(SHELL.includes('useQuery({ queryKey: ["meta", "counts"], queryFn: fetchCounts })'),
      "the counts query is exactly what it was");
    assert.ok(!/useQuery[\s\S]{0,120}notif/i.test(SHELL), "and no notification query joined it");
    assert.ok(/router\.refresh\(\)/.test(SHELL) && /onLogout/.test(SHELL), "refresh is still only the logout path");
  });

  it("79. the boundary is written down where a maintainer would look", () => {
    /* Whitespace-tolerant: the sentence wraps across comment lines, and a regex
     * that only matches it on one line would pass or fail on reflowing. */
    const raw = read("src", "app", "(app)", "layout.tsx").replace(/\s*\n\s*\*?\s*/g, " ");
    assert.ok(/does not re-run on client-side navigation/.test(raw),
      "the layout says when the list refreshes, so the behaviour is not a silent surprise");
    assert.ok(/full load of the authenticated shell does/.test(raw), "and when it does");
  });

  it("80. and it is not surfaced to the teacher", () => {
    for (const banned of ["Last updated", "Refresh", "Stale", "out of date", "Reload"]) {
      assert.ok(!MENU.includes(banned), `no ${banned} affordance — it is a technical detail`);
    }
  });
});

/* ============================================================= containment */

describe("Notifications UI · the contract still holds", () => {
  it("51. the panel writes to no domain entity", () => {
    for (const banned of [
      "fetch(", "useMutation", "Model", "mongoose", "dbConnect",
      "method: \"POST\"", "method: \"PATCH\"", "method: \"DELETE\"",
    ]) {
      assert.ok(!MENU.includes(banned), `the panel must never ${banned}`);
    }
  });

  it("52. no send, reminder or recipient affordance exists anywhere in it", () => {
    for (const banned of ["Send reminder", "Notify", "mailto:", "sms:", "Remind", "Email"]) {
      assert.ok(!MENU.includes(banned), `no ${banned}`);
    }
  });

  it("53. exactly three types are drawn, and a fourth would not typecheck", () => {
    /* Anchored on `= {` rather than on the generic: `Record<NotificationType,
     * (p: …) => React.ReactElement>` contains a `>` inside its own `=>`, which a
     * lazy `[^>]*>` stops at. */
    for (const name of ["TYPE_ICON", "TYPE_TINT"]) {
      const block = new RegExp(`const ${name}[\\s\\S]*?= \\{([\\s\\S]*?)\\n\\};`).exec(MENU)?.[1] ?? "";
      assert.notEqual(block, "", `${name} was found`);
      const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
      assert.deepEqual(keys, ["makeup", "review", "tuition"], name);
    }
    /* And the union itself is closed, so a fourth key is a compile error rather
     * than a silently unstyled row. */
    assert.ok(code("src", "lib", "notifications.ts")
      .includes('export type NotificationType = "tuition" | "makeup" | "review";'));
  });

  it("54. Settings gained no Notifications card and is untouched", () => {
    const screen = code("src", "components", "settings", "settings-screen.tsx");
    assert.ok(!/Notification/i.test(screen), "still no card, not even an inert one");
    assert.equal((screen.match(/<section/g) ?? []).length, 3, "still three sections");
  });

  it("55. acknowledgement did not become a preference", () => {
    /* Named exactly, not by an `/notif/i` sweep: the settings store contains
     * `for (const notify of listeners) notify();`, and a test that cannot tell a
     * listener from a notification is one that gets deleted rather than believed
     * — the same trap tests/settings.test.ts documents. */
    const store = code("src", "lib", "settings-context.tsx");
    assert.ok(!/notifRead|notifDismissed|Notification|Acknowledgement/.test(store),
      "the settings store still knows nothing about notifications");
    assert.ok(!/notification/.test(store), "and imports nothing from the module");
  });

  it("56. only Notifications-owned code names the reserved keys", () => {
    /* tests/settings.test.ts walks all of `src/` for this; here it is stated
     * from the other side, naming the two files that are allowed to. */
    for (const src of [MENU, HEADER, SHELL, LAYOUT, SERVER]) {
      assert.ok(!/notifRead|notifDismissed/.test(src), "not the shell, the header or the panel");
    }
    assert.ok(code("src", "lib", "notification-state.ts").includes("storageKeys.notifRead"));
    assert.ok(code("src", "lib", "notification-ack-store.ts").includes("persistAcknowledgement"));
  });
});
