/* Settings — the store's validation, and the screen's absences.
 *
 * Run with:  npm test
 *
 * NO BROWSER AND NO RENDER, as everywhere else in this suite. The hardening half
 * is genuine behaviour: `resolveSettings` takes its reader as an argument, so the
 * validation can be driven with a plain object and no storage shim, no DOM and no
 * React. The screen half is a source scan, because this gate's hardest rules are
 * ABSENCES — no Notifications card, no Save button, no duplicate preference
 * state, no `localStorage` on the page — and none of those is a function call.
 *
 * The third half, and it is the one that earns its keep, is PARITY: three pairs
 * of values in this codebase are written down twice and have to agree, and each
 * pair is checked here rather than trusted. The inline pre-paint script's
 * defaults against the store's defaults; the option arrays against their label
 * records; and the accent swatch fills against the palette they were copied from.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ACCENTS, CURRENCIES, DATE_FORMATS, DENSITIES, NUMBER_FORMATS, SURFACES, THEMES, TIME_FORMATS,
  storageKeys,
} from "../src/lib/constants";
import { SETTINGS_DEFAULTS, readStoredSettings, resolveSettings } from "../src/lib/settings-context";
import {
  ACCENT_LABEL, DENSITY_LABEL, SURFACE_LABEL, THEME_LABEL, TIME_FORMAT_LABEL,
  accentSwatchStyle, settingsSegmentStyle,
} from "../src/components/settings/settings-ui";
import { DEFAULT_REGIONAL, createFormat } from "../src/lib/format";
import { LANGS } from "../src/lib/i18n";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

/** A file's source with its comments stripped, so a scan tests the CODE and not
 * the prose explaining it. Lifted from tests/reports-ui.test.ts — and it matters
 * here for the same reason it does there: the Settings screen's own header
 * comment names every forbidden thing (`localStorage`, `useState`, the
 * Notifications card) in order to explain why it is absent. */
function code(...parts: string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SCREEN = code("src", "components", "settings", "settings-screen.tsx");
const SCREEN_RAW = read("src", "components", "settings", "settings-screen.tsx");
const PAGE = code("src", "app", "(app)", "settings", "page.tsx");
const UI = code("src", "components", "settings", "settings-ui.ts");
const STORE = code("src", "lib", "settings-context.tsx");
const CSS = read("src", "app", "globals.css");
const THEME_SCRIPT = read("src", "components", "theme-script.tsx");
const DICT = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;

/** Just the Settings section of the stylesheet, comment-free.
 *
 * SCOPED DELIBERATELY, exactly as tests/reports-ui.test.ts scopes its own: the
 * file carries other `@media (max-width:620px)` blocks and other grid rules, and
 * a whole-file scan would happily pass on somebody else's. Comment-free because
 * the section's own prose quotes the rules it is explaining. */
const SET_CSS = (() => {
  const from = CSS.indexOf("SETTINGS (Sprint 11)");
  assert.notEqual(from, -1, "the Settings stylesheet section exists");
  const to = CSS.indexOf("Tailwind theme bridge", from);
  return CSS.slice(from, to === -1 ? undefined : to).replace(/\/\*[\s\S]*?\*\//g, " ");
})();

/** A reader over a plain map, which is all `resolveSettings` ever needed. */
const from = (map: Record<string, string>) => (key: string) => map[key] ?? null;

/* ================================================== stored-value hardening */

describe("Settings · the store validates what the browser gives it", () => {
  it("1. an empty browser is the documented defaults", () => {
    const s = resolveSettings(() => null);
    assert.deepEqual(s.appearance, { theme: "light", accent: "crimson", surface: "soft", spacing: "cozy" });
    assert.equal(s.lang, "vi");
    assert.deepEqual(s.regional, DEFAULT_REGIONAL);
    assert.deepEqual(s, SETTINGS_DEFAULTS, "and they are the same defaults the server renders");
  });

  it("2. every valid stored value survives unchanged", () => {
    const stored = {
      [storageKeys.theme]: "dark",
      [storageKeys.accent]: "emerald",
      [storageKeys.surface]: "elevated",
      [storageKeys.spacing]: "airy",
      [storageKeys.lang]: "en",
      [storageKeys.dateFormat]: "YYYY/MM/DD",
      [storageKeys.timeFormat]: "24h",
      [storageKeys.currency]: "USD",
      [storageKeys.numberFormat]: "dot",
    };
    const s = resolveSettings(from(stored));
    assert.deepEqual(s.appearance, { theme: "dark", accent: "emerald", surface: "elevated", spacing: "airy" });
    assert.equal(s.lang, "en");
    assert.deepEqual(s.regional, { dateFormat: "YYYY/MM/DD", timeFormat: "24h", currency: "USD", numberFormat: "dot" });
  });

  it("3. …including every single authorised value of every setting", () => {
    for (const theme of THEMES) assert.equal(resolveSettings(from({ [storageKeys.theme]: theme })).appearance.theme, theme);
    for (const accent of ACCENTS) assert.equal(resolveSettings(from({ [storageKeys.accent]: accent })).appearance.accent, accent);
    for (const surface of SURFACES) assert.equal(resolveSettings(from({ [storageKeys.surface]: surface })).appearance.surface, surface);
    for (const spacing of DENSITIES) assert.equal(resolveSettings(from({ [storageKeys.spacing]: spacing })).appearance.spacing, spacing);
    for (const [lang] of LANGS) assert.equal(resolveSettings(from({ [storageKeys.lang]: lang })).lang, lang);
    for (const df of DATE_FORMATS) assert.equal(resolveSettings(from({ [storageKeys.dateFormat]: df })).regional.dateFormat, df);
    for (const tf of TIME_FORMATS) assert.equal(resolveSettings(from({ [storageKeys.timeFormat]: tf })).regional.timeFormat, tf);
    for (const cur of CURRENCIES) assert.equal(resolveSettings(from({ [storageKeys.currency]: cur })).regional.currency, cur);
    for (const nf of NUMBER_FORMATS) assert.equal(resolveSettings(from({ [storageKeys.numberFormat]: nf })).regional.numberFormat, nf);
  });

  it("4. an invalid appearance value falls back — this is the bug the gate fixes", () => {
    /* `sunset` has no `[data-accent="sunset"]` block, so before Sprint 11 it
     * reached <html data-accent="sunset"> and the screen silently kept whatever
     * palette it had. */
    const s = resolveSettings(from({
      [storageKeys.theme]: "midnight",
      [storageKeys.accent]: "sunset",
      [storageKeys.surface]: "glass",
      [storageKeys.spacing]: "roomy",
    }));
    assert.deepEqual(s.appearance, SETTINGS_DEFAULTS.appearance);
  });

  it("5. an invalid language falls back to vi", () => {
    for (const bad of ["fr", "EN", "vi-VN", ""]) {
      assert.equal(resolveSettings(from({ [storageKeys.lang]: bad })).lang, "vi", bad);
    }
  });

  it("6. an invalid regional value falls back", () => {
    const s = resolveSettings(from({
      [storageKeys.dateFormat]: "DD-MM-YYYY",
      [storageKeys.timeFormat]: "military",
      [storageKeys.currency]: "EUR",
      [storageKeys.numberFormat]: "space",
    }));
    assert.deepEqual(s.regional, DEFAULT_REGIONAL);
  });

  it("7. validation is per key — one bad value does not discard the good ones", () => {
    const s = resolveSettings(from({
      [storageKeys.theme]: "dark",
      [storageKeys.accent]: "not-an-accent",
      [storageKeys.currency]: "USD",
      [storageKeys.numberFormat]: "nope",
    }));
    assert.equal(s.appearance.theme, "dark", "the good one is kept");
    assert.equal(s.appearance.accent, "crimson", "the bad one falls back");
    assert.equal(s.regional.currency, "USD");
    assert.equal(s.regional.numberFormat, "comma");
  });

  it("8. case and whitespace are not quietly repaired", () => {
    /* A near-miss is still a miss: repairing it here would be a second, silent
     * normalisation rule that the setters do not share. */
    const s = resolveSettings(from({ [storageKeys.accent]: " indigo" , [storageKeys.theme]: "Dark" }));
    assert.equal(s.appearance.accent, "crimson");
    assert.equal(s.appearance.theme, "light");
  });

  /** Run `body` with a stubbed browser global, then put the environment back.
   * This drives the REAL reader — `lsRead` — rather than a hand-made one, which
   * is the only way its try/catch is ever executed. */
  function withWindow(localStorage: { getItem(key: string): string | null }, body: () => void) {
    const g = globalThis as unknown as { window?: unknown };
    const had = "window" in g;
    const previous = g.window;
    g.window = { localStorage };
    try { body(); } finally { if (had) g.window = previous; else delete g.window; }
  }

  it("9. storage that throws falls back — the real reader, not a stand-in", () => {
    withWindow({ getItem() { throw new Error("blocked site data"); } }, () => {
      assert.deepEqual(readStoredSettings(), SETTINGS_DEFAULTS);
    });
  });

  it("10. …and the same reader still validates what a working browser returns", () => {
    withWindow({ getItem: (k) => (k === storageKeys.theme ? "dark" : "garbage") }, () => {
      const s = readStoredSettings();
      assert.equal(s.appearance.theme, "dark", "the one good value is kept");
      assert.equal(s.appearance.accent, "crimson", "the rest fall back");
      assert.equal(s.lang, "vi");
      assert.deepEqual(s.regional, DEFAULT_REGIONAL);
    });
  });

  it("11. with no window at all — SSR — it is the defaults", () => {
    assert.ok(!("window" in globalThis), "this runner has no DOM, which is the SSR case");
    assert.deepEqual(readStoredSettings(), SETTINGS_DEFAULTS);
  });

  it("12. no cast is left anywhere in the read path", () => {
    assert.ok(!/lsGet/.test(STORE), "the unvalidated reader is gone");
    for (const t of ["Appearance[\"theme\"]", "Appearance[\"accent\"]", "RegionalConfig[\"currency\"]"]) {
      assert.ok(!STORE.includes(`as ${t}`), `no 'as ${t}' cast survives`);
    }
  });

  it("13. setter semantics are untouched", () => {
    for (const setter of ["setAppearance", "setLang", "setRegional"]) {
      assert.ok(STORE.includes(`const ${setter} = useCallback`), `${setter} still exists`);
    }
    assert.ok(STORE.includes("lsSet(storageKeys.theme, next.theme)"), "and still writes the same key");
    assert.ok(STORE.includes("commit({ ...current, appearance: next })"), "and still publishes a new snapshot");
  });

  it("14. no new storage key was introduced, and none was renamed", () => {
    const expected = {
      theme: "etlms.theme", accent: "etlms.accent", surface: "etlms.surface", spacing: "etlms.spacing",
      notifDismissed: "etlms.notifDismissed", notifRead: "etlms.notifRead", lang: "etlms.lang",
      dateFormat: "etlms.dateFormat", timeFormat: "etlms.timeFormat",
      currency: "etlms.currency", numberFormat: "etlms.numberFormat",
    };
    assert.deepEqual({ ...storageKeys }, expected);
  });

  it("15. the deferred notification keys are still read by nothing", () => {
    /* Named exactly, not by an `/notif/i` sweep: `settings-context` contains
     * `for (const notify of listeners)`, and a test that cannot tell a listener
     * from a notification is a test that will one day be deleted rather than
     * believed. */
    for (const file of [SCREEN, PAGE, UI, STORE]) {
      assert.ok(!/notifDismissed|notifRead/.test(file), "Sprint 11 reads neither reserved key");
    }
    assert.ok(storageKeys.notifDismissed === "etlms.notifDismissed" && storageKeys.notifRead === "etlms.notifRead",
      "and both are left declared, exactly as they were");
  });
});

/* ============================================== ThemeScript / default parity */

describe("Settings · the pre-paint script and the store agree on the defaults", () => {
  /** The inline script's fallbacks, read out of its source: g('etlms.theme','light'). */
  const scriptDefaults = Object.fromEntries(
    [...THEME_SCRIPT.matchAll(/g\('([^']+)','([^']+)'\)/g)].map((m) => [m[1], m[2]])
  );

  it("1. the script really does declare all four appearance defaults", () => {
    assert.deepEqual(Object.keys(scriptDefaults).sort(), [
      storageKeys.accent, storageKeys.spacing, storageKeys.theme, storageKeys.surface,
    ].sort());
  });

  it("2. …and each one equals the store's own default", () => {
    /* THIS IS THE DRIFT THE GATE 1 AUDIT FLAGGED. The script cannot import
     * DEFAULT_APPEARANCE — it is a string executed before any module loads — so
     * the four values are necessarily written twice. If they ever disagree the
     * first paint uses one palette and hydration switches to another, which is
     * the theme flash the script exists to prevent. */
    const d = SETTINGS_DEFAULTS.appearance;
    assert.equal(scriptDefaults[storageKeys.theme], d.theme);
    assert.equal(scriptDefaults[storageKeys.accent], d.accent);
    assert.equal(scriptDefaults[storageKeys.surface], d.surface);
    assert.equal(scriptDefaults[storageKeys.spacing], d.spacing);
  });

  it("3. every script default is itself an authorised value", () => {
    assert.ok((THEMES as readonly string[]).includes(scriptDefaults[storageKeys.theme]));
    assert.ok((ACCENTS as readonly string[]).includes(scriptDefaults[storageKeys.accent]));
    assert.ok((SURFACES as readonly string[]).includes(scriptDefaults[storageKeys.surface]));
    assert.ok((DENSITIES as readonly string[]).includes(scriptDefaults[storageKeys.spacing]));
  });

  it("4. the pre-paint strategy is unchanged — it is still a blocking inline script", () => {
    assert.ok(THEME_SCRIPT.includes("dangerouslySetInnerHTML"), "still inline");
    assert.ok(!/import .*settings-context/.test(THEME_SCRIPT), "and imports no runtime module");
  });
});

/* ======================================================= the authorised set */

describe("Settings · the option set is pinned from both directions", () => {
  const pairs: [readonly string[], Record<string, string>, string][] = [
    [THEMES, THEME_LABEL, "theme"],
    [ACCENTS, ACCENT_LABEL, "accent"],
    [SURFACES, SURFACE_LABEL, "surface"],
    [DENSITIES, DENSITY_LABEL, "density"],
    [TIME_FORMATS, TIME_FORMAT_LABEL, "time format"],
  ];

  it("1. every listed option has a label, and every label is a listed option", () => {
    for (const [list, labels, name] of pairs) {
      assert.deepEqual([...list].sort(), Object.keys(labels).sort(), name);
    }
  });

  it("2. the arrays hold exactly the authorised values, in the design's order", () => {
    assert.deepEqual([...THEMES], ["light", "dark"]);
    assert.deepEqual([...ACCENTS], ["crimson", "indigo", "emerald", "slate"]);
    assert.deepEqual([...SURFACES], ["soft", "flat", "elevated"]);
    assert.deepEqual([...DENSITIES], ["cozy", "airy", "tight"]);
    assert.deepEqual([...DATE_FORMATS], ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"]);
    assert.deepEqual([...TIME_FORMATS], ["12h", "24h"]);
    assert.deepEqual([...CURRENCIES], ["VND", "USD"]);
    assert.deepEqual([...NUMBER_FORMATS], ["comma", "dot"]);
  });

  it("3. there is no tenth setting", () => {
    /* The contract authorises nine, and a control for a tenth would have to be
     * rendered from a list — so the check is on what lists EXIST, read out of
     * lib/constants itself. An earlier version of this test asserted
     * `[eight literals].length + 1 === 9`, which is `8 + 1 === 9`: a tautology
     * over the test's own array that a ninth exported option list would have
     * sailed straight past. */
    const declared = [...code("src", "lib", "constants.ts")
      .matchAll(/export const (\w+) = \[[^\]]*\] as const satisfies/g)].map((m) => m[1]);
    assert.deepEqual(declared.sort(), [
      "ACCENTS", "CURRENCIES", "DATE_FORMATS", "DENSITIES",
      "NUMBER_FORMATS", "SURFACES", "THEMES", "TIME_FORMATS",
    ], "exactly eight authorised option lists, and no ninth");
    /* The ninth setting is the language, whose list the dictionary owns rather
     * than constants — which is why it is not among the eight. */
    assert.deepEqual(LANGS.map(([c]) => c), ["vi", "en"]);
  });

  it("4. every translatable label is in the Vietnamese dictionary", () => {
    for (const [, labels] of pairs) {
      for (const label of Object.values(labels)) {
        assert.ok(DICT[label], `missing dictionary key: ${label}`);
      }
    }
    for (const key of [
      "Settings", "Appearance", "Theme", "Accent colour", "Surface", "Density",
      "Language & Region", "Interface language", "Regional preferences",
      "Date format", "Time format", "Currency", "Number format",
      "Workspace", "Account", "Email", "Today", "Teacher / Admin",
      "Personalise your workspace. Preferences are saved to this device.",
      "Theme, accent colour and layout density.",
      "Interface language and regional formats for dates, time, currency and numbers.",
      "Applies immediately across the app.",
    ]) {
      assert.ok(DICT[key], `missing dictionary key: ${key}`);
    }
  });

  it("5. tokens are NOT put through the dictionary", () => {
    /* `DD/MM/YYYY`, `VND` and the grouping samples are symbols, not copy — the
     * same reason the review trend's 6M/12M are not translated. A key for one
     * would be a translation nobody should ever supply. */
    for (const token of [...DATE_FORMATS, ...CURRENCIES, "1,234.56", "1.234,56"]) {
      assert.ok(!(token in DICT), `${token} must not be a dictionary key`);
    }
  });
});

/* ======================================================== the page and screen */

describe("Settings · the page replaced the placeholder", () => {
  it("1. the route is no longer the module placeholder", () => {
    assert.ok(!PAGE.includes("ModulePlaceholder"), "the placeholder is gone");
    assert.ok(SCREEN.includes('data-screen-label="Settings"'));
  });

  it("2. it carries the design's own title and subtitle", () => {
    assert.ok(SCREEN.includes('t("Settings")'));
    assert.ok(SCREEN.includes('t("Personalise your workspace. Preferences are saved to this device.")'));
  });

  it("3. exactly three cards, and Notifications is not one of them", () => {
    for (const heading of ["Appearance", "Language & Region", "Workspace"]) {
      assert.ok(SCREEN.includes(`t("${heading}")`), `${heading} card is drawn`);
    }
    /* Against the comment-stripped source: this file's own header EXPLAINS why
     * there is no Notifications card, so scanning the prose would fail on the
     * explanation rather than on the markup. */
    assert.ok(!/Notification/i.test(SCREEN), "no Notifications card, not even an inert one");
    assert.ok(!/Mark all read/i.test(SCREEN), "and no Mark all read");
    assert.ok(!/caught up|unread|bell/i.test(SCREEN), "and none of its copy");
    assert.equal((SCREEN.match(/<section/g) ?? []).length, 3, "three sections, no fourth");
  });

  it("4. there is nothing to save", () => {
    assert.ok(!/<form/i.test(SCREEN), "no form");
    assert.ok(!/onSubmit/.test(SCREEN), "no submit handler");
    for (const word of ["Save", "Apply", "Discard", "Reset"]) {
      assert.ok(!SCREEN.includes(`t("${word}`), `no ${word} action`);
    }
  });

  it("5. the page holds no duplicate copy of any preference", () => {
    /* The blunt form on purpose: this screen needs no transient UI state either,
     * so "no useState at all" is both true and the easiest rule to keep. If a
     * later gate genuinely needs one, it has to come and change this line and
     * say why — which is the point. */
    assert.ok(!/useState|useReducer|useRef\(/.test(SCREEN), "no local state of any kind on the screen");

    /* And every selected value is read straight off the store on each render,
     * rather than copied into something that could go stale. */
    for (const expr of [
      "appearance.theme === theme", "appearance.accent === accent",
      "appearance.surface === surface", "appearance.spacing === spacing",
      "lang === code", "regional.dateFormat === df", "regional.timeFormat === tf",
      "regional.currency === cur", "regional.numberFormat === nf",
    ]) {
      assert.ok(SCREEN.includes(expr), `selection is read from the store: ${expr}`);
    }
  });

  it("6. …and reaches storage only through the store", () => {
    for (const file of [SCREEN, PAGE, UI]) {
      assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(file), "no direct storage access");
      assert.ok(!/addEventListener\(\s*["']storage/.test(file), "and no storage event handling");
    }
    assert.ok(SCREEN.includes("useSettings()"), "state comes from the shared store");
  });

  it("7. every write goes through an existing setter", () => {
    for (const setter of ["setAppearance", "setLang", "setRegional"]) {
      assert.ok(SCREEN.includes(setter), `${setter} is used`);
    }
    assert.ok(!/fetch\(|useMutation|useQuery/.test(SCREEN), "no network call of any kind");
    assert.ok(!/fetch\(/.test(PAGE), "and none on the server half either");
  });

  it("8. all nine controls are rendered from the authorised lists", () => {
    for (const list of ["THEMES", "ACCENTS", "SURFACES", "DENSITIES", "DATE_FORMATS", "TIME_FORMATS", "CURRENCIES", "NUMBER_FORMATS", "LANGS"]) {
      assert.ok(new RegExp(`${list}\\.map\\(`).test(SCREEN), `${list} is mapped into controls`);
    }
  });

  it("9. the controls are real buttons with their state exposed", () => {
    assert.ok(!/<div[^>]*onClick/.test(SCREEN), "no div pretending to be a button");
    assert.ok(SCREEN.includes("aria-pressed={active}"), "segments expose selection");
    assert.ok(SCREEN.includes("aria-pressed={appearance.accent === accent}"), "so do the swatches");
    assert.ok(SCREEN.includes('aria-label={t(ACCENT_LABEL[accent])}'), "a colour-only control is named");
    assert.equal((SCREEN.match(/type="button"/g) ?? []).length, 2, "both button kinds opt out of form submission");
  });

  it("10. currency is display-only — nothing here touches stored money", () => {
    assert.ok(!/RATE_VND|convert|exchange|rate/i.test(SCREEN), "no conversion and no rate configuration");
    assert.ok(!/Billing|fee|revenue/i.test(SCREEN), "and no Finance concept at all");
    assert.ok(SCREEN.includes('setRegional("currency", cur)'), "it writes the display preference and nothing else");
  });
});

describe("Settings · the Workspace card is read-only", () => {
  it("1. identity crosses a server boundary, not a fetch", () => {
    assert.ok(PAGE.includes("getSession"), "the server half uses the app's own session helper");
    assert.ok(!/api\/auth\/me|useQuery|fetch\(/.test(PAGE), "and no client-side identity request");
    assert.ok(!/getSession|jwt|cookie/i.test(SCREEN), "the client half never resolves a session");
  });

  it("2. only name and email cross it", () => {
    assert.ok(PAGE.includes("name: session?.name ?? \"\""));
    assert.ok(PAGE.includes("email: session?.email ?? \"\""));
    assert.ok(!/passwordHash|sub:|role/.test(PAGE), "nothing else from the payload");
  });

  it("3. the card has no way to change anything", () => {
    const workspace = SCREEN.slice(SCREEN.indexOf('t("Workspace")'));
    assert.ok(!/<input|<textarea|<select/i.test(workspace), "no field");
    assert.ok(!/onClick|onChange/.test(workspace), "no handler");
    assert.ok(!/Edit|Change|Upload|Avatar/i.test(workspace), "no edit affordance");
  });

  it("4. it shows the four facts the design names, and no more", () => {
    for (const label of ["Account", "Email", "Currency", "Today"]) {
      assert.ok(SCREEN.includes(`t("${label}")`), label);
    }
    assert.equal((SCREEN.match(/<Fact /g) ?? []).length, 4);
  });

  it("5. a missing identity renders the app's own placeholder, never an empty line", () => {
    assert.ok(SCREEN.includes("account.name ?"), "name falls back");
    assert.ok(SCREEN.includes("account.email || EM"), "so does email");
  });

  it("6. Today comes from the application clock and the shared formatter", () => {
    assert.ok(SCREEN.includes("fmt.dateLabel(TODAY_ISO)"));
    assert.ok(!/new Date\(/.test(SCREEN), "the browser's clock is not this app's clock");
  });
});

/* ================================================================ fidelity */

describe("Settings · the design's own measurements", () => {
  it("1. the content column and the card shell are the comp's", () => {
    assert.ok(SCREEN.includes("maxWidth: 760"), "760px column");
    assert.ok(SCREEN.includes('padding: "20px 22px"'), "card padding");
    assert.ok(SCREEN.includes("marginBottom: 16"), "card spacing");
    for (const token of ["var(--card)", "var(--border)", "var(--r)", "var(--sh)"]) {
      assert.ok(SCREEN.includes(token), `card uses ${token}`);
    }
  });

  it("2. the heading is the comp's", () => {
    assert.ok(SCREEN.includes('fontSize: 24, fontWeight: 600, letterSpacing: "-.02em"'));
  });

  it("3. the sub-grids keep the comp's measurements — in the stylesheet", () => {
    /* Gate 4 moved these off the elements; the VALUES are unchanged, so they are
     * asserted where they now live. See the responsive-ownership suite below for
     * why they had to move at all. */
    assert.ok(SET_CSS.includes("gap:10px;max-width:420px"), "accent swatches");
    assert.ok(/\.set-pair-appearance\{[^}]*gap:18px;max-width:520px/.test(SET_CSS), "surface + density");
    assert.ok(/\.set-pair-regional\{[^}]*gap:18px;max-width:560px/.test(SET_CSS), "regional");
    assert.ok(/\.set-pair-workspace\{[^}]*gap:14px 22px/.test(SET_CSS), "workspace");
    assert.ok(/\.set-seg-row\{[^}]*gap:8px\}/.test(SET_CSS) && /\.set-seg-row\.tight\{gap:6px\}/.test(SET_CSS),
      "both of the comp's segment gaps");
  });

  it("4. a segment is the comp's own control, and only its two states differ", () => {
    const off = settingsSegmentStyle(false);
    const on = settingsSegmentStyle(true);
    assert.equal(off.height, 34);
    assert.equal(off.padding, "0 13px");
    assert.equal(off.borderRadius, 9);
    assert.equal(off.background, "var(--card)");
    assert.equal(off.border, "1px solid var(--border)");
    assert.equal(on.background, "var(--accent-soft)", "selected is the app's existing on-pill");
    assert.equal(on.color, "var(--accent)");
    assert.equal(on.fontWeight, 600);
    assert.equal(on.height, off.height, "and choosing one never changes the geometry");
  });

  it("5. the dense variant exists because the comp's own grid is that tight", () => {
    const dense = settingsSegmentStyle(false, "dense");
    assert.equal(dense.padding, "0 8px");
    assert.equal(dense.fontSize, 12.5);
    assert.equal(dense.height, 34, "same control, same height");
  });

  it("6. a swatch keeps a constant border width in both states", () => {
    assert.equal(accentSwatchStyle(true).border, "2px solid var(--fg)");
    assert.equal(accentSwatchStyle(false).border, "2px solid var(--border)");
  });

  it("7. no literal colour is introduced in the components", () => {
    for (const file of [SCREEN, UI]) {
      assert.ok(!/#[0-9a-f]{3,8}\b/i.test(file), "components use tokens, never hex");
    }
  });
});

/* ============================================== responsive ownership (Gate 4) */

describe("Settings · responsive layout is owned by the stylesheet", () => {
  /** The four containers whose column count has to be able to change. */
  const GRIDS = ["set-pair-appearance", "set-pair-regional", "set-pair-workspace", "set-accent-grid"];

  it("1. no responsive layout property is left inline on the screen", () => {
    /* THE WHOLE POINT OF THIS GATE. An inline `grid-template-columns` outranks a
     * media query, so a collapse rule written against one is a rule that never
     * fires — the dead-rule failure this repository shipped three times in
     * Sprint 10. If any of these come back, the responsive rules below become
     * decoration. */
    assert.ok(!/gridTemplateColumns/.test(SCREEN), "no inline grid-template-columns");
    assert.ok(!/display: "grid"/.test(SCREEN), "no inline display:grid");
    assert.ok(!/display: "flex"/.test(SCREEN), "no inline display:flex");
    assert.ok(!/flexWrap/.test(SCREEN), "and no inline wrap rule");
  });

  it("2. …and each container is a class the stylesheet declares", () => {
    for (const cls of GRIDS) {
      assert.ok(SCREEN.includes(`"${cls}"`), `the screen uses .${cls}`);
      assert.ok(new RegExp(`\\.${cls}\\{`).test(SET_CSS), `the stylesheet declares .${cls}`);
    }
    assert.ok(SCREEN.includes('"set-seg-row"') && /\.set-seg-row\{/.test(SET_CSS), "and the segment row");
  });

  it("3. nothing in the Settings section needs !important", () => {
    /* There is no inline declaration left to outrank, so the presence of one
     * here would mean an inline style had crept back. */
    assert.ok(!/!important/.test(SET_CSS), "no !important anywhere in the Settings rules");
  });

  it("4. the three pair grids collapse on ROOM, not on a viewport guess", () => {
    /* Sprint 10 Gate 6.4's lesson: a viewport breakpoint is only ever a proxy
     * for how much room the shell actually left. `auto-fit` measures the room
     * itself, so the same rule covers a phone, a tablet with the rail out, and a
     * desktop under `airy` density — no breakpoint can be wrong because there is
     * none. */
    for (const cls of ["set-pair-appearance", "set-pair-regional", "set-pair-workspace"]) {
      const rule = new RegExp(`\\.${cls}\\{[^}]*grid-template-columns:repeat\\(auto-fit,minmax\\(min\\((\\d+)px,100%\\),1fr\\)\\)`);
      const m = rule.exec(SET_CSS);
      assert.ok(m, `.${cls} folds on available room`);
      assert.ok(Number(m![1]) >= 200, `.${cls}'s minimum is a real control width, not a token`);
    }
  });

  it("5. …and can only ever be two columns or one", () => {
    /* A third track would be a lopsided layout nobody designed. The widest the
     * grid can ever be is the 760px column less the card's 22px padding either
     * side; three tracks at each stated minimum do not fit in it. */
    const CARD_CONTENT_MAX = 760 - 22 * 2;
    const mins: Record<string, number> = {};
    for (const [, cls, min] of SET_CSS.matchAll(/\.(set-pair-[a-z]+)\{[^}]*minmax\(min\((\d+)px/g) as unknown as Iterable<[string, string, string]>) {
      mins[cls] = Number(min);
    }
    for (const [cls, min] of Object.entries(mins)) {
      const capMatch = new RegExp(`\\.${cls}\\{[^}]*max-width:(\\d+)px`).exec(SET_CSS);
      const gapMatch = new RegExp(`\\.${cls}\\{[^}]*gap:(\\d+)px`).exec(SET_CSS);
      const cap = capMatch ? Number(capMatch[1]) : CARD_CONTENT_MAX;
      const gap = Number(gapMatch![1]);
      assert.ok(3 * min + 2 * gap > Math.min(cap, CARD_CONTENT_MAX), `.${cls} can never draw a third column`);
      assert.ok(2 * min + gap <= Math.min(cap, CARD_CONTENT_MAX), `.${cls} still draws two on a desktop`);
    }
  });

  it("6. a segmented row wraps rather than overflowing", () => {
    assert.ok(/\.set-seg-row\{[^}]*flex-wrap:wrap/.test(SET_CSS), "the row may wrap");
    const seg = settingsSegmentStyle(false, "dense");
    assert.equal(seg.flex, "1 1 auto", "a content basis, so the wrap can be triggered at all");
    assert.equal(seg.minWidth, "max-content", "and no option is drawn narrower than its own label");
    assert.equal(seg.whiteSpace, "nowrap", "a label is never broken mid-token");
  });

  it("7. both states of a segment stay the same height when a row wraps", () => {
    assert.equal(settingsSegmentStyle(true).height, settingsSegmentStyle(false).height);
    assert.equal(settingsSegmentStyle(true, "dense").height, settingsSegmentStyle(false, "dense").height);
    assert.equal(settingsSegmentStyle(true, "dense").height, settingsSegmentStyle(true).height,
      "and both variants agree, so a wrapped mixed row is level");
  });

  it("8. the accent grid is four across, and two when the card is too narrow", () => {
    assert.ok(/\.set-accent-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(SET_CSS), "four by default");
    const narrow = /@container set-page \(max-width:(\d+)px\)\{\s*\.set-accent-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.exec(SET_CSS);
    assert.ok(narrow, "two across when four labelled swatches no longer fit");
    assert.ok(Number(narrow![1]) < 620, "and it folds well inside the shell's own narrow breakpoint");
  });

  it("8b. …measured against the card, not the viewport", () => {
    /* TWO REASONS THIS IS A CONTAINER QUERY. `tests/finance-ui.test.ts` asserts
     * that every `@media (max-width:Npx)` in the stylesheet uses a width the
     * shell already changes shape at — a fourth breakpoint invented for one grid
     * is a guard to respect, not a test to loosen. And the viewport is the wrong
     * measure anyway: this card's width moves with the sidebar rail and the
     * density token, so only the container knows when four labels stop fitting.
     * `auto-fit` cannot express it either — any track minimum that permits four
     * columns also permits three on the way down. */
    assert.ok(/\[data-screen-label="Settings"\]\{container-type:inline-size;container-name:set-page\}/.test(SET_CSS),
      "the Settings column is a query container");
    const media = [...SET_CSS.matchAll(/@media \(max-width:(\d+)px\)/g)].map((m) => m[1]);
    assert.deepEqual(media, [], "and Settings introduces no viewport breakpoint at all");
  });

  it("8c. the container declaration cannot reach a printed page", () => {
    /* `container-type` implies layout containment, which interacts with the
     * fragmentation that paginates print — the caution Reports already takes. */
    const at = SET_CSS.indexOf("container-type:inline-size");
    const before = SET_CSS.slice(Math.max(0, at - 120), at);
    assert.ok(before.includes("@media screen"), "the container is declared for screen only");
  });

  it("9. no fixed width anywhere can force a horizontal scrollbar", () => {
    /* `max-width` only ever makes a box narrower than its container; `width` and
     * `min-width` in pixels are what push a card sideways. */
    assert.ok(!/[^-]width: \d+,/.test(SCREEN.replace(/maxWidth: \d+/g, "")), "no inline pixel width");
    assert.ok(!/min-width:\d+px/.test(SET_CSS), "and no pixel floor in the Settings rules");
    assert.ok(!/width:\d+px/.test(SET_CSS.replace(/max-width:\d+px/g, "")), "nor a fixed width");
  });

  it("10. the swatch takes its width from its track, not from itself", () => {
    const sw = accentSwatchStyle(false);
    assert.equal(sw.width, "100%");
    assert.equal(sw.minWidth, undefined, "no floor to overflow the collapsed grid");
  });

  it("11. the label under a swatch may take two lines rather than be cut", () => {
    assert.ok(/\.set-accent-label\{/.test(SET_CSS), "the label is stylesheet-owned");
    assert.ok(!/text-overflow:ellipsis|white-space:nowrap/.test(
      /\.set-accent-label\{[^}]*\}/.exec(SET_CSS)?.[0] ?? ""), "and is never clipped");
  });

  it("12. Settings adds no rule outside its own section", () => {
    /* A Settings selector loose in another module's block is how one screen's
     * responsive fix silently becomes another's regression. */
    const others = CSS.slice(0, CSS.indexOf("SETTINGS (Sprint 11)"));
    assert.ok(!/\.set-/.test(others), "no Settings class is declared earlier in the file");
  });
});

/* ---------------------------------------------------------------------------
   The one place a colour IS written twice, and the check that keeps it honest. */

describe("Settings · the accent swatches match the palette they mirror", () => {
  /** `--accent` out of a palette block in globals.css. */
  function paletteAccent(selector: string): string {
    const at = CSS.indexOf(selector + "{");
    assert.notEqual(at, -1, `no ${selector} block`);
    const block = CSS.slice(at, CSS.indexOf("}", at));
    const m = /--accent:(#[0-9a-f]{6})/i.exec(block);
    assert.ok(m, `${selector} declares no --accent`);
    return m![1].toLowerCase();
  }
  /** The fill of one swatch rule. */
  function swatch(accent: string, dark: boolean): string {
    const sel = `${dark ? '[data-theme="dark"] ' : ""}.set-sw[data-sw-accent="${accent}"]`;
    const at = CSS.indexOf(sel + "{");
    assert.notEqual(at, -1, `no rule for ${sel}`);
    const m = /background:(#[0-9a-f]{6})/i.exec(CSS.slice(at, CSS.indexOf("}", at)));
    assert.ok(m, `${sel} sets no background`);
    return m![1].toLowerCase();
  }

  it("1. light: each swatch is that accent's own --accent", () => {
    /* Crimson is the unnamed :root default, which is precisely why it cannot be
     * borrowed as a token and has to be copied. */
    assert.equal(swatch("crimson", false), paletteAccent(":root"));
    for (const accent of ["indigo", "emerald", "slate"]) {
      assert.equal(swatch(accent, false), paletteAccent(`[data-accent="${accent}"]`), accent);
    }
  });

  it("2. dark: each swatch is that accent's dark --accent", () => {
    assert.equal(swatch("crimson", true), paletteAccent('[data-theme="dark"]'));
    for (const accent of ["indigo", "emerald", "slate"]) {
      assert.equal(swatch(accent, true), paletteAccent(`[data-theme="dark"][data-accent="${accent}"]`), accent);
    }
  });

  it("3. there is a swatch rule for every authorised accent and no others", () => {
    const found = [...CSS.matchAll(/\.set-sw\[data-sw-accent="([a-z]+)"\]/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(found)].sort(), [...ACCENTS].sort());
  });

  it("4. the swatch attribute is deliberately not `data-accent`", () => {
    /* `[data-accent="indigo"]` matches ANY element, so the real attribute would
     * re-bind the whole palette on the button as a side effect of painting it. */
    assert.ok(!/data-accent=\{/.test(SCREEN), "the screen sets no data-accent");
    assert.ok(SCREEN.includes("data-sw-accent={accent}"));
  });
});

/* ============================================ the label that is the behaviour */

describe("Settings · a number-format label is produced by the formatter it selects", () => {
  it("1. comma and dot render the sample the way the setting will", () => {
    const comma = createFormat({ ...DEFAULT_REGIONAL, numberFormat: "comma" }, "en").number(1234.56, 2);
    const dot = createFormat({ ...DEFAULT_REGIONAL, numberFormat: "dot" }, "en").number(1234.56, 2);
    assert.equal(comma, "1,234.56");
    assert.equal(dot, "1.234,56");
    assert.notEqual(comma, dot, "the two options are distinguishable");
  });

  it("2. the screen builds that label rather than hard-coding it", () => {
    assert.ok(SCREEN.includes("createFormat({ ...regional, numberFormat: nf }, lang).number(NUMBER_FORMAT_SAMPLE, 2)"));
    assert.ok(!SCREEN.includes("1,234.56"), "no literal sample to drift");
  });
});

/* ================================================== nothing else was touched */

describe("Settings · Sprint 11 changed nothing it was not authorised to", () => {
  it("1. the header theme toggle still reads the same store", () => {
    const header = code("src", "components", "shell", "header.tsx");
    assert.ok(header.includes("useSettings()"), "same store");
    assert.ok(header.includes("setAppearance({ theme: isDark ? \"light\" : \"dark\" })"), "same setter");
    assert.ok(!/localStorage/.test(header), "and still no storage of its own");
  });

  it("2. the sidebar's Settings item is unchanged", () => {
    const sidebar = code("src", "components", "shell", "sidebar.tsx");
    assert.ok(sidebar.includes('{ href: "/settings", label: "Settings", Icon: IconSettings }'));
  });

  it("3. no Settings API route, model or schema exists", () => {
    for (const p of [
      ["src", "app", "api", "settings"],
      ["src", "app", "api", "preferences"],
    ]) {
      assert.throws(() => readFileSync(path.join(process.cwd(), ...p)), `${p.join("/")} must not exist`);
    }
    const models = code("src", "lib", "models.ts");
    assert.ok(!/Setting|Preference/i.test(models), "no Settings model");
    const schemas = code("src", "lib", "schemas.ts");
    assert.ok(!/settingsSchema|appearanceSchema/i.test(schemas), "no Settings validation schema");
  });

  it("4. auth is untouched", () => {
    const auth = code("src", "lib", "auth.ts");
    const jwt = code("src", "lib", "jwt.ts");
    assert.ok(jwt.includes("export const SESSION_COOKIE = \"etlms_session\""), "same cookie");
    assert.ok(jwt.includes("sub: string;") && jwt.includes("email: string;") && jwt.includes("name: string;"),
      "same payload shape — no preference was added to the token");
    assert.ok(!/Setting|preference|theme/i.test(auth + jwt), "and auth knows nothing about Settings");
  });

  it("5. no server action anywhere in Settings", () => {
    for (const file of [SCREEN_RAW, read("src", "app", "(app)", "settings", "page.tsx"), read("src", "components", "settings", "settings-ui.ts")]) {
      assert.ok(!file.includes('"use server"'), "no server action");
    }
  });
});
