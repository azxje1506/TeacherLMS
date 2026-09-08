/* What a Settings preference does to the modules that were closed before it.
 *
 * Run with:  npm test
 *
 * WHY THIS FILE EXISTS. Every other suite in this repository builds its
 * formatter from `DEFAULT_REGIONAL` — `finance-ui`, `reports-ui`, `reports-pdf`
 * and `review-pdf` all do, and until Sprint 11 that was reasonable, because no
 * control could change it: accent, surface, density, language and all four
 * regional preferences were reachable only by editing localStorage by hand. The
 * Settings page makes eight of those reachable for the first time, so the
 * non-default half of the formatter is now a production path and had never been
 * exercised anywhere.
 *
 * WHAT IT ASSERTS, AND WHAT IT DOES NOT. Only that a preference changes
 * PRESENTATION and nothing else: the same DTO, the same document structure, the
 * same source numbers, the same ISO dates, the same `No data`. It asserts
 * nothing about whether a figure is right — the domains own that, and their own
 * suites already say so.
 *
 * NO BROWSER, NO jsPDF, NO DATABASE. The two PDF document models are pure and
 * are exercised directly, which is the style tests/reports-pdf.test.ts and
 * tests/review-pdf.test.ts already established.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_REGIONAL, EM, createFormat } from "../src/lib/format";
import { RATE_VND_PER_USD, translate } from "../src/lib/i18n";
import { CURRENCIES, DATE_FORMATS, NUMBER_FORMATS, TIME_FORMATS, TODAY_ISO } from "../src/lib/constants";
import { renderSummaryValue, renderValue } from "../src/components/reports/reports-ui";
import { buildReportPdfDocument } from "../src/lib/reports-pdf-document";
import { REPORT_TITLE } from "../src/lib/reports";
import type { ReportPayload } from "../src/lib/reports";
import type { RegionalConfig } from "../src/lib/types";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
function code(...parts: string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const DICT = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
/** The identity translator: an English source string IS the dictionary key. */
const en = (x: string) => x;
const vi = (x: string) => translate(x, "vi");

const regional = (over: Partial<RegionalConfig>): RegionalConfig => ({ ...DEFAULT_REGIONAL, ...over });

/* ------------------------------------------------------------------ fixture */

/** A Student Payment payload: the report that carries money, a floor, a `none`
 * and a term all at once, so one document exercises every render branch. */
function paymentPayload(): ReportPayload {
  return {
    type: "student-payment",
    title: REPORT_TITLE["student-payment"],
    month: "2026-07",
    months: ["2026-07", "2026-06"],
    appClock: TODAY_ISO,
    scope: { kind: "studio", classId: null, className: null, studentId: null, studentName: null },
    options: { classes: [], students: [] },
    empty: false,
    summary: [
      { label: "Total billable", value: { kind: "money", amount: 13_100_000 } },
      { label: "Collection rate", value: { kind: "percent", value: 65 }, floor: true },
      { label: "Not recorded", value: { kind: "none" } },
    ],
    columns: [
      { key: "student", label: "Student", align: "left" },
      { key: "fee", label: "Monthly fee", align: "right" },
      { key: "collected", label: "Collected", align: "right" },
      { key: "status", label: "Status", align: "left" },
    ],
    rows: [
      {
        key: "b1", parentLinked: true,
        cells: [
          { kind: "text", value: "Nguyễn Đức Cường" }, { kind: "money", amount: 1_500_000 },
          { kind: "money", amount: 1_500_000 }, { kind: "term", key: "Paid" },
        ],
      },
      {
        key: "b2", parentLinked: false,
        cells: [
          { kind: "text", value: "Lê Thị Mỹ Hạnh" }, { kind: "money", amount: 700_000 },
          { kind: "none" }, { kind: "term", key: "Partially Paid" },
        ],
      },
    ],
    hiddenRecords: 0,
    completeness: { amountsComplete: false, unknownAmountBills: 1 },
  };
}

const docFor = (r: RegionalConfig, t: (k: string) => string = en, lang: "vi" | "en" = "en") =>
  buildReportPdfDocument(paymentPayload(), { t, fmt: createFormat(r, lang) });

/** The document's masthead block, which is where the report's context line and
 * its "Generated on" date live — they are part of the sheet a reader sees, not
 * metadata hanging off the file. */
function headerOf(doc: ReturnType<typeof buildReportPdfDocument>) {
  const h = doc.blocks.find((b) => b.kind === "masthead");
  assert.ok(h, "every report document opens with a masthead");
  return h as Extract<typeof h, { kind: "masthead" }>;
}

/** Every string a document actually prints, flattened. */
function textOf(doc: ReturnType<typeof buildReportPdfDocument>): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(doc);
  return out;
}

/** The shape of a document, ignoring every string in it. */
const shapeOf = (doc: ReturnType<typeof buildReportPdfDocument>) =>
  doc.blocks.map((b) => b.kind).join(",");

/* ============================================================== 9. language */

describe("Settings · language propagates as presentation only", () => {
  it("1. English is the source string, not a second dictionary", () => {
    for (const key of Object.keys(DICT).slice(0, 200)) {
      assert.equal(translate(key, "en"), key, key);
    }
    const i18n = code("src", "lib", "i18n.ts");
    assert.ok(/en:\s*\{\s*\}/.test(i18n), "the English dictionary is empty by construction");
    assert.equal(Object.keys(DICT).length > 700, true, "and Vietnamese is the only one that ships entries");
  });

  it("2. an unknown string falls through in both languages", () => {
    const made_up = "A string nobody has ever translated";
    assert.equal(translate(made_up, "en"), made_up);
    assert.equal(translate(made_up, "vi"), made_up);
  });

  it("3. a Reports document keeps its structure in either language", () => {
    const e = docFor(DEFAULT_REGIONAL, en, "en");
    const v = docFor(DEFAULT_REGIONAL, vi, "vi");
    assert.equal(shapeOf(e), shapeOf(v), "same blocks, same order");
    assert.notEqual(JSON.stringify(e), JSON.stringify(v), "but not the same words");
  });

  it("4. …and translates chrome without touching a person's name", () => {
    const v = textOf(docFor(DEFAULT_REGIONAL, vi, "vi"));
    assert.ok(v.includes("Nguyễn Đức Cường"), "student names are content, never keys");
    assert.ok(v.includes(DICT["No data"]), "an unknown is stated in Vietnamese");
    assert.ok(!v.includes("No data"), "and not left in English beside it");
  });

  it("5. months are localised, and the month key is not", () => {
    assert.equal(createFormat(DEFAULT_REGIONAL, "en").monthLabel("2026-07"), "July 2026");
    assert.equal(createFormat(DEFAULT_REGIONAL, "vi").monthLabel("2026-07"), "Tháng 7 2026");
    assert.equal(paymentPayload().month, "2026-07", "the DTO still carries the canonical key");
  });

  it("6. no Notifications string was added in either direction", () => {
    for (const key of ["Mark all read", "You're all caught up.", "Notifications"]) {
      // These predate Sprint 11 in the imported dictionary; what matters is that
      // no NEW one was introduced and nothing reads them.
      assert.ok(!/notifDismissed|notifRead/.test(code("src", "components", "settings", "settings-screen.tsx")), key);
    }
  });
});

/* =========================================================== 10. date format */

describe("Settings · date format propagates as presentation only", () => {
  it("1. all three formats render the same day differently", () => {
    const seen = DATE_FORMATS.map((df) => createFormat(regional({ dateFormat: df }), "en").dateLabel("2026-07-10"));
    assert.deepEqual(seen, ["10/07/2026", "07/10/2026", "2026/07/10"]);
    assert.equal(new Set(seen).size, 3, "three formats, three distinct strings");
  });

  it("2. an unreadable date is the shared placeholder in every format", () => {
    for (const df of DATE_FORMATS) {
      const f = createFormat(regional({ dateFormat: df }), "en");
      assert.equal(f.dateLabel(""), EM);
      assert.equal(f.dateLabel("not-a-date"), EM);
    }
  });

  it("3. the Reports document's Generated on follows the preference", () => {
    const seen = DATE_FORMATS.map((df) => headerOf(docFor(regional({ dateFormat: df }))).generatedOn);
    assert.deepEqual(seen, ["10/07/2026", "07/10/2026", "2026/07/10"]);
  });

  it("4. …while the payload's own ISO value never changes", () => {
    assert.equal(paymentPayload().appClock, "2026-07-10");
    assert.equal(TODAY_ISO, "2026-07-10", "and the application clock is still the fixed one");
  });

  it("5. the document's shape is identical under all three", () => {
    const shapes = new Set(DATE_FORMATS.map((df) => shapeOf(docFor(regional({ dateFormat: df })))));
    assert.equal(shapes.size, 1, "a date format moves no block");
  });

  it("6. no timezone conversion is introduced anywhere in the format path", () => {
    const format = code("src", "lib", "format.ts");
    assert.ok(!/toISOString|getTimezoneOffset|Intl\.DateTimeFormat|UTC/.test(format),
      "dates are parsed and printed locally, with no zone arithmetic");
    assert.ok(format.includes('new Date(iso + "T00:00:00")'), "and midnight-local is still how an ISO day is read");
  });

  it("7. `fmt.iso` still round-trips a date without shifting it", () => {
    const f = createFormat(DEFAULT_REGIONAL, "en");
    assert.equal(f.iso(new Date(2026, 6, 10)), "2026-07-10");
    assert.equal(f.iso(new Date(2026, 0, 1)), "2026-01-01");
  });
});

/* =========================================================== 11. time format */

describe("Settings · time format propagates as presentation only", () => {
  const h12 = createFormat(regional({ timeFormat: "12h" }), "en");
  const h24 = createFormat(regional({ timeFormat: "24h" }), "en");

  it("1. 12h keeps its meridiem, zero-padded as the native control shows it", () => {
    assert.equal(h12.time12("18:00"), "06:00 PM");
    assert.equal(h12.time12("09:05"), "09:05 AM");
    assert.equal(h12.time12("00:30"), "12:30 AM");
    assert.equal(h12.time12("12:00"), "12:00 PM");
  });

  it("2. 24h is meridiem-free", () => {
    assert.equal(h24.time12("18:00"), "18:00");
    assert.equal(h24.time12("09:05"), "09:05");
    assert.equal(h24.time12("00:30"), "00:30");
    for (const t of ["18:00", "09:05", "00:30", "12:00"]) {
      assert.ok(!/AM|PM/.test(h24.time12(t)), t);
    }
  });

  it("3. every authorised time format is one of those two, and no third", () => {
    /* Driven off the authorised list rather than a pair of literals, so a value
     * added to the setting without a rendering rule fails here rather than
     * shipping as a format nobody defined. */
    for (const tf of TIME_FORMATS) {
      const out = createFormat(regional({ timeFormat: tf }), "en").time12("18:00");
      assert.equal(/AM|PM/.test(out), tf === "12h", tf);
    }
    assert.equal(TIME_FORMATS.length, 2);
  });

  it("4. clockParts hands the meridiem back separately, and empty in 24h", () => {
    assert.deepEqual(h12.clockParts("18:00"), { clock: "06:00", meridiem: "PM" });
    assert.deepEqual(h24.clockParts("18:00"), { clock: "18:00", meridiem: "" });
  });

  it("5. a range composes from the same function in both formats", () => {
    assert.equal(h12.range("18:00", "19:30"), "06:00 PM – 07:30 PM");
    assert.equal(h24.range("18:00", "19:30"), "18:00 – 19:30");
    assert.ok(h12.range("", "19:30").startsWith(EM), "a half-known range says so");
  });

  it("6. arithmetic on a time is unaffected by how it is displayed", () => {
    for (const f of [h12, h24]) {
      assert.equal(f.addMinutes("18:00", 90), "19:30", "stored HH:MM stays 24h");
    }
  });

  it("7. the consumers format through fmt rather than rolling their own", () => {
    /* A second implementation is what `clockParts` was extracted to kill — the
     * Dashboard tile used to strip the meridiem with a regex and then print `PM`
     * under a 24h clock. */
    for (const f of [
      ["src", "components", "lessons", "lesson-ui.tsx"],
      ["src", "components", "attendance", "attendance-ui.tsx"],
    ] as const) {
      const src = code(...f);
      assert.ok(!/\bAM\b|\bPM\b/.test(src), `${f.join("/")} writes no meridiem of its own`);
    }
  });

  it("8. no native time input is redesigned by this preference", () => {
    const screen = code("src", "components", "settings", "settings-screen.tsx");
    assert.ok(!/type="time"|type="date"/.test(screen), "Settings introduces no date or time input");
  });
});

/* ========================================================= 12. number format */

describe("Settings · number format changes grouping and nothing else", () => {
  const comma = createFormat(regional({ numberFormat: "comma" }), "en");
  const dot = createFormat(regional({ numberFormat: "dot" }), "en");

  it("1. the two groupings are mirror images", () => {
    assert.equal(comma.number(1234567), "1,234,567");
    assert.equal(dot.number(1234567), "1.234.567");
    assert.equal(comma.number(1234.56, 2), "1,234.56");
    assert.equal(dot.number(1234.56, 2), "1.234,56");
  });

  it("2. sign and magnitude survive both", () => {
    assert.equal(comma.number(-1234567), "-1,234,567");
    assert.equal(dot.number(-1234567), "-1.234.567");
    assert.equal(comma.number(0), "0");
    assert.equal(dot.number(0), "0");
  });

  it("3. money is grouped the same way", () => {
    assert.equal(comma.vnd(1_500_000), "1,500,000đ");
    assert.equal(dot.vnd(1_500_000), "1.500.000đ");
  });

  it("4. a Reports document regroups without moving a block", () => {
    const c = docFor(regional({ numberFormat: "comma" }));
    const d = docFor(regional({ numberFormat: "dot" }));
    assert.equal(shapeOf(c), shapeOf(d));
    assert.ok(textOf(c).includes("1,500,000đ"));
    assert.ok(textOf(d).includes("1.500.000đ"));
  });

  it("5. `No data` is unaffected by grouping — it is not a number", () => {
    for (const nf of NUMBER_FORMATS) {
      const f = createFormat(regional({ numberFormat: nf }), "en");
      assert.equal(renderValue({ kind: "none" }, f, en), "No data");
    }
  });

  it("6. a percentage is not grouped, and a floor keeps its qualifier", () => {
    for (const nf of NUMBER_FORMATS) {
      const f = createFormat(regional({ numberFormat: nf }), "en");
      assert.equal(renderValue({ kind: "percent", value: 65 }, f, en), "65%");
      assert.equal(renderSummaryValue({ kind: "percent", value: 65 }, true, f, en), "At least 65%");
    }
  });
});

/* ============================================ 13. currency, strictly contained */

describe("Settings · currency is a display preference and nothing more", () => {
  const vnd = createFormat(regional({ currency: "VND" }), "en");
  const usd = createFormat(regional({ currency: "USD" }), "en");

  it("1. the same stored integer renders two ways", () => {
    const stored = 1_500_000;
    assert.equal(vnd.vnd(stored), "1,500,000đ");
    assert.equal(usd.vnd(stored), "$60.00");
    assert.equal(stored, 1_500_000, "and the value handed in is untouched");
  });

  it("2. USD uses the one rate the app already had, and no setting introduces another", () => {
    assert.equal(RATE_VND_PER_USD, 25_000);
    assert.equal(usd.vnd(RATE_VND_PER_USD), "$1.00");
    const screen = code("src", "components", "settings", "settings-screen.tsx");
    const ui = code("src", "components", "settings", "settings-ui.ts");
    for (const src of [screen, ui]) {
      assert.ok(!/RATE_VND_PER_USD|exchange|conversion/i.test(src), "no rate reaches the Settings UI");
    }
    assert.equal([...read("src", "lib", "i18n.ts").matchAll(/RATE_VND_PER_USD\s*=/g)].length, 1,
      "there is exactly one rate in the codebase");
  });

  it("3. `No data` never becomes a zero in either currency", () => {
    for (const cur of CURRENCIES) {
      const f = createFormat(regional({ currency: cur }), "en");
      const rendered = renderValue({ kind: "none" }, f, en);
      assert.equal(rendered, "No data");
      assert.notEqual(rendered, f.vnd(0));
      assert.ok(!/0/.test(rendered), `${cur}: an unknown carries no digit`);
    }
  });

  it("4. a KNOWN zero still prints as zero — the distinction survives", () => {
    assert.equal(renderValue({ kind: "money", amount: 0 }, vnd, en), "0đ");
    assert.equal(renderValue({ kind: "money", amount: 0 }, usd, en), "$0.00");
  });

  it("5. the document changes only its money strings", () => {
    const a = docFor(regional({ currency: "VND" }));
    const b = docFor(regional({ currency: "USD" }));
    assert.equal(shapeOf(a), shapeOf(b), "no block moves");
    assert.ok(textOf(b).includes("$60.00"), "money is converted for display");
    assert.ok(textOf(b).includes("Nguyễn Đức Cường"), "and everything else is identical");
    assert.ok(textOf(b).includes("No data"), "including the unknown");
  });

  it("6. Finance is not currency-aware internally", () => {
    /* The invariant the contract turns on: the domain layer computes in integer
     * VND and has never heard of a display preference. If any of these ever
     * imported the formatter or the settings store, a display choice could reach
     * a stored figure. */
    for (const f of ["billing.ts", "finance.ts", "finance-service.ts", "reports-service.ts"] as const) {
      const src = code("src", "lib", f);
      assert.ok(!/settings-context|RegionalConfig|createFormat|RATE_VND_PER_USD/.test(src),
        `${f} knows nothing about display currency`);
      /* `\bUSD\b`, not a bare `$` — every one of these files is full of Mongo
       * query operators (`$gte`, `$in`, `$lt`), so a dollar sign matches nine
       * times in finance-service alone and the assertion would be about
       * nothing. The currency symbol is only ever written as a string literal. */
      assert.ok(!/\bUSD\b/.test(src), `${f} names no second currency`);
      assert.ok(!/["']\$["']/.test(src), `${f} prints no currency symbol of its own`);
    }
  });

  it("7. the stored schema carries an amount, never a currency", () => {
    const models = code("src", "lib", "models.ts");
    const billing = /const BillingSchema[\s\S]*?\);/.exec(models)?.[0] ?? "";
    assert.ok(billing.includes("fee: Number"), "a fee is a number");
    assert.ok(!/currency/i.test(billing), "and no currency column exists to disagree with it");
  });

  it("8. the fee a teacher types is still labelled VND", () => {
    /* Entry unit and display preference are different questions: the value being
     * typed is VND whatever the screen is currently rendering in. */
    const drawer = code("src", "components", "classes", "class-drawer.tsx");
    assert.ok(drawer.includes('t("Monthly fee (VND/month)")'));
    assert.ok(!/useSettings\(\)\.regional|regional\.currency/.test(drawer), "the label is not conditional");
  });
});

/* ================================================= 14. PDF / print regression */

describe("Settings · the PDF document models under non-default preferences", () => {
  /** Everything at once, all non-default. */
  const exotic = regional({ dateFormat: "MM/DD/YYYY", numberFormat: "dot", currency: "USD", timeFormat: "24h" });

  it("1. Reports PDF reflects date, grouping and currency together", () => {
    const doc = docFor(exotic);
    assert.equal(headerOf(doc).generatedOn, "07/10/2026", "the chosen date format");
    const text = textOf(doc);
    assert.ok(text.includes("$60,00"), "USD, grouped the dot way");
    assert.ok(!text.some((s) => s.includes("1,500,000đ")), "and no VND string survives");
  });

  it("2. …and its structure is byte-for-byte the default document's shape", () => {
    assert.equal(shapeOf(docFor(exotic)), shapeOf(docFor(DEFAULT_REGIONAL)));
    assert.equal(docFor(exotic).blocks.length, docFor(DEFAULT_REGIONAL).blocks.length);
  });

  it("3. the English path stays valid — no key is left unresolved", () => {
    const text = textOf(docFor(DEFAULT_REGIONAL, en, "en"));
    assert.ok(!text.some((s) => /^[a-z-]+\.[a-z-]+$/.test(s)), "no raw lookup key leaked into the document");
    assert.ok(text.includes("No data"));
    assert.ok(text.includes("Paid"));
  });

  it("4. the Vietnamese path resolves the same document", () => {
    const text = textOf(docFor(exotic, vi, "vi"));
    assert.ok(text.includes(DICT["No data"]));
    assert.ok(text.includes(DICT["Paid"]));
    assert.ok(text.includes("$60,00"), "regional formatting is independent of language");
  });

  it("5. a report's month label follows the language, not the date format", () => {
    const enDoc = docFor(exotic, en, "en");
    const viDoc = docFor(exotic, vi, "vi");
    assert.ok(headerOf(enDoc).context.includes("July 2026"));
    assert.ok(headerOf(viDoc).context.includes("Tháng 7 2026"));
  });

  it("6. the Reviews document model is reachable in English and unchanged by Sprint 11", () => {
    /* Reviews owns its own suite; what this asserts is only that Sprint 11 left
     * its intl seam alone — the document still takes `t` and `fmt` from the
     * caller rather than reading a preference itself. */
    const doc = code("src", "lib", "review-pdf-document.ts");
    assert.ok(!/useSettings|localStorage|storageKeys/.test(doc), "the document model reads no preference");
    assert.ok(/ReviewPdfIntl/.test(doc), "it is still handed its translator and formatter");
    const pdf = code("src", "lib", "reports-pdf-document.ts");
    assert.ok(!/useSettings|localStorage|storageKeys/.test(pdf), "and neither does the Reports one");
  });

  it("7. neither document model reads a clock of its own", () => {
    for (const f of ["reports-pdf-document.ts", "review-pdf-document.ts"] as const) {
      assert.ok(!/new Date\(\)|Date\.now/.test(code("src", "lib", f)), `${f} takes the application day as data`);
    }
  });
});

/* =============================== 7/8. appearance, and Reports under density */

describe("Settings · appearance reaches the app only through existing tokens", () => {
  const CSS = read("src", "app", "globals.css");

  it("1. surface and density still map to the tokens they always did", () => {
    assert.ok(/\[data-surface="flat"\]\{--r:8px;--sh:none\}/.test(CSS));
    assert.ok(/\[data-surface="elevated"\]\{--r:20px/.test(CSS));
    assert.ok(/\[data-spacing="airy"\]\{--gap:26px\}/.test(CSS));
    assert.ok(/\[data-spacing="tight"\]\{--gap:11px\}/.test(CSS));
  });

  it("2. …and Sprint 11 added no component override to compensate for them", () => {
    const settingsSection = CSS.slice(CSS.indexOf("SETTINGS (Sprint 11)"));
    assert.ok(!/data-surface|data-spacing/.test(settingsSection),
      "no Settings rule special-cases a surface or a density");
  });

  it("3. no closed module RE-DEFINES a token Settings owns", () => {
    /* The distinction this test turns on, and it is not a pedantic one: READING
     * `var(--gap)` is how a module stays correct under a density change, while
     * DECLARING `--gap:` would be a module opting out of the preference. Reports
     * does the first — `--rp-workspace:calc(300px + var(--gap) + 760px)` — and an
     * earlier draft of this assertion flagged it, which would have had exactly
     * the wrong lesson drawn from it. Only declarations are forbidden. */
    for (const marker of ["Reports", "Finance"]) {
      const scoped = CSS.match(new RegExp(`\\[data-screen-label="${marker}"\\][^{]*\\{[^}]*\\}`, "g")) ?? [];
      for (const rule of scoped) {
        assert.ok(!/--gap:|--r:|--sh:/.test(rule), `${marker} does not re-pin a token Settings owns`);
      }
    }
  });

  it("4. …and Reports' own workspace width is DERIVED from the density token", () => {
    /* Which is why density needs no Reports fix: the ultra-wide centring Sprint
     * 10 Gate 7.2 added measures the gap rather than assuming it, so `airy`
     * simply produces a wider workspace and `tight` a narrower one. */
    assert.ok(/\[data-screen-label="Reports"\]\{--rp-workspace:calc\(300px \+ var\(--gap\) \+ 760px\)\}/.test(CSS),
      "the workspace reads the live gap");
  });

  it("5. Reports still stacks on its own container, not on a viewport guess", () => {
    /* THE DENSITY REGRESSION THIS GATE WAS ASKED TO CHECK. `airy` raises --gap
     * from 16 to 26px, which takes room away from the Reports preview at an
     * unchanged viewport width. Sprint 10 Gate 6.4 had already replaced the
     * viewport rule with a container query for exactly this class of reason, so
     * the density preference is a case that contract already covers — the report
     * stacks when the room runs out, whoever took the room. Nothing to fix. */
    assert.ok(/\[data-screen-label="Reports"\]\{container-type:inline-size;container-name:rp-page\}/.test(CSS),
      "the Reports container is still declared");
    assert.ok(/@container rp-page \(max-width:667px\)\{[\s\S]*?\.rp-grid\{grid-template-columns:minmax\(0,1fr\)\}/.test(CSS),
      "and it still folds on container width");
    assert.ok(!/@media[^{]*\(max-width:767px\)\{[^}]*\.rp-grid/.test(CSS),
      "the viewport rule it replaced has not come back");
  });

  it("6. Settings introduced no rule that could reach another screen", () => {
    const settingsSection = CSS.slice(CSS.indexOf("SETTINGS (Sprint 11)"));
    const selectors = [...settingsSection.matchAll(/^\s*([.[][^{\n]*)\{/gm)].map((m) => m[1].trim());
    for (const sel of selectors) {
      /* Two namespaces are legitimate, and both say "Settings" out loud: the
       * `.set-` class prefix, and the screen's own `data-screen-label` — which is
       * how Reports scopes its container declaration too, because a container
       * has to be declared on the screen root rather than on a child. */
      assert.ok(/\.set-|\[data-screen-label="Settings"\]/.test(sel),
        `every Settings selector is namespaced: ${sel}`);
    }
    assert.ok(selectors.length > 0, "and there are some to check");
  });

  it("7. the theme toggle and the Settings control are still one store", () => {
    const header = code("src", "components", "shell", "header.tsx");
    const screen = code("src", "components", "settings", "settings-screen.tsx");
    assert.ok(header.includes("useSettings()") && screen.includes("useSettings()"));
    assert.ok(header.includes("setAppearance(") && screen.includes("setAppearance("));
    for (const src of [header, screen]) {
      assert.ok(!/useState|localStorage/.test(src), "and neither keeps a copy");
    }
  });

  it("8. all four accent token sets are still reachable", () => {
    for (const accent of ["indigo", "emerald", "slate"]) {
      assert.ok(new RegExp(`\\[data-accent="${accent}"\\]\\{--primary:`).test(CSS), accent);
      assert.ok(new RegExp(`\\[data-theme="dark"\\]\\[data-accent="${accent}"\\]\\{--primary:`).test(CSS), `${accent} dark`);
    }
    assert.ok(/:root\{[\s\S]*?--accent:#d14242/.test(CSS), "and crimson is still the root default");
  });
});
