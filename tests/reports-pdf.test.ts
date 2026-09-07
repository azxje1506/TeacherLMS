/* Reports — the exported document, and the printed page.
 *
 * Run with:  npm test
 *
 * NO BROWSER, NO jsPDF AND NO BINARY SNAPSHOT. The document model is a plain
 * ordered list of blocks, so what a report SAYS on paper is asserted directly;
 * the renderer is driven by a recording stub, so what it DRAWS is asserted as
 * calls rather than as bytes. A snapshot would break on a library bump while
 * telling nobody anything, which is the reasoning tests/review-pdf.test.ts
 * already sets out for its own export.
 *
 * THE CENTRAL RULE THIS SUITE DEFENDS is that the file cannot say anything the
 * screen does not. Both surfaces run the SAME `renderValue` /
 * `renderSummaryValue`, so a `none` cannot become `0đ` on paper and a floor
 * cannot lose its `At least` — and the cross-checks below assert that for all
 * five report types rather than trusting the shared import.
 *
 * The font half exists because jsPDF's standard fonts physically cannot encode
 * Vietnamese, and a PDF drawn without the embedded one would open cleanly and be
 * wrong. The failure must be loud, and there must be no path that draws without
 * the font.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  REPORT_BRAND, buildReportPdfDocument, reportPdfFilename,
  type ReportPdfBlock, type ReportPdfDocument,
} from "../src/lib/reports-pdf-document";
import { columnWidths, renderReportPdf, reportPdfSafeText, type ReportJsPdf } from "../src/lib/reports-pdf";
import { renderSummaryValue, renderValue } from "../src/components/reports/reports-ui";
import { REPORT_TITLE, REPORT_TYPES, type ReportPayload, type ReportValue } from "../src/lib/reports";
import { createFormat, DEFAULT_REGIONAL } from "../src/lib/format";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
function code(...parts: string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PDF = code("src", "lib", "reports-pdf.ts");
const DOC = code("src", "lib", "reports-pdf-document.ts");
const PAGE = code("src", "app", "(app)", "reports", "page.tsx");
const CONTROLS = code("src", "components", "reports", "report-controls.tsx");
const CSS_RAW = read("src", "app", "globals.css");
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, " ");

const fmt = createFormat(DEFAULT_REGIONAL, "en");
const en = (x: string) => x;
const intl = { t: en, fmt };

/* ------------------------------------------------------------------ fixtures */

function payload(over: Partial<ReportPayload> = {}): ReportPayload {
  return {
    type: "monthly-revenue",
    title: REPORT_TITLE["monthly-revenue"],
    month: "2026-07",
    months: ["2026-07", "2026-06"],
    appClock: "2026-07-10",
    scope: { kind: "studio", classId: null, className: null, studentId: null, studentName: null },
    options: { classes: [], students: [] },
    empty: false,
    summary: [{ label: "Total revenue", value: { kind: "money", amount: 1_600_000 } }],
    columns: [
      { key: "type", label: "By lesson type", align: "left" },
      { key: "amount", label: "Revenue", align: "right" },
    ],
    rows: [{ key: "regular", cells: [{ kind: "term", key: "Regular" }, { kind: "money", amount: 1_600_000 }] }],
    ...over,
  };
}

/** The Student Payment shape, with everything that can be unknown, unknown. */
function paymentPayload(over: Partial<ReportPayload> = {}): ReportPayload {
  return payload({
    type: "student-payment",
    title: REPORT_TITLE["student-payment"],
    summary: [
      { label: "Total billable", value: { kind: "money", amount: 13_100_000 } },
      { label: "Collected", value: { kind: "money", amount: 8_550_000 } },
      { label: "Outstanding", value: { kind: "money", amount: 3_850_000 } },
      { label: "Partially paid", value: { kind: "count", value: 1 } },
      { label: "Collection rate", value: { kind: "percent", value: 65 }, floor: true },
      { label: "Not recorded", value: { kind: "money", amount: 700_000 } },
    ],
    columns: [
      { key: "student", label: "Student", align: "left" },
      { key: "class", label: "Class", align: "left" },
      { key: "fee", label: "Monthly fee", align: "right" },
      { key: "collected", label: "Collected", align: "right" },
      { key: "outstanding", label: "Outstanding", align: "right" },
      { key: "status", label: "Status", align: "left" },
    ],
    rows: [
      {
        key: "b1", parentLinked: true,
        cells: [
          { kind: "text", value: "Nguyễn Đức Cường" }, { kind: "text", value: "Grammar Stars · B1" },
          { kind: "money", amount: 750_000 }, { kind: "money", amount: 750_000 },
          { kind: "money", amount: 0 }, { kind: "term", key: "Paid" },
        ],
      },
      {
        key: "b2", parentLinked: false,
        cells: [
          { kind: "text", value: "Lê Thị Mỹ Hạnh" }, { kind: "text", value: "Grammar Stars · B1" },
          { kind: "money", amount: 700_000 }, { kind: "none" },
          { kind: "none" }, { kind: "term", key: "Partially Paid" },
        ],
      },
    ],
    hiddenRecords: 4,
    completeness: { amountsComplete: false, unknownAmountBills: 1 },
    ...over,
  });
}

const blocksOf = <K extends ReportPdfBlock["kind"]>(d: ReportPdfDocument, kind: K) =>
  d.blocks.filter((b): b is Extract<ReportPdfBlock, { kind: K }> => b.kind === kind);
const firstOf = <K extends ReportPdfBlock["kind"]>(d: ReportPdfDocument, kind: K) => blocksOf(d, kind)[0];

/* ---------------------------------------------------- the recording renderer */

interface Call { op: string; args: unknown[] }

/** A stub that records every call and answers the two questions the walk asks:
 * how a string wraps, and how many pages exist. Text is wrapped at a fixed
 * characters-per-millimetre so wrapping is deterministic and testable. */
function stub(charsPerMm = 2) {
  const calls: Call[] = [];
  let pages = 1;
  const rec = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  const doc: ReportJsPdf = {
    addPage: () => { pages++; calls.push({ op: "addPage", args: [] }); },
    setPage: rec("setPage"),
    setFont: rec("setFont"),
    setFontSize: rec("setFontSize"),
    setTextColor: rec("setTextColor"),
    setDrawColor: rec("setDrawColor"),
    setFillColor: rec("setFillColor"),
    setLineWidth: rec("setLineWidth"),
    text: rec("text"),
    splitTextToSize: (t: string, w: number) => {
      const per = Math.max(1, Math.floor(w * charsPerMm));
      const out: string[] = [];
      for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per));
      return out.length ? out : [""];
    },
    rect: rec("rect"),
    roundedRect: rec("roundedRect"),
    line: rec("line"),
    setProperties: rec("setProperties"),
    save: rec("save"),
    getNumberOfPages: () => pages,
  };
  return {
    doc, calls,
    get pages() { return pages; },
    texts: () => calls.filter((c) => c.op === "text").flatMap((c) => {
      const v = c.args[0];
      return Array.isArray(v) ? (v as string[]) : [v as string];
    }),
    ys: () => calls.filter((c) => c.op === "text").map((c) => c.args[2] as number),
  };
}

/* =========================================================== the document */

describe("Reports PDF · the document model", () => {
  it("1. every report type builds a document", () => {
    for (const type of REPORT_TYPES) {
      const d = buildReportPdfDocument(payload({ type, title: REPORT_TITLE[type] }), intl);
      assert.ok(d.blocks.length >= 3, type);
      assert.equal(firstOf(d, "masthead")!.title, REPORT_TITLE[type]);
    }
  });

  it("2. the masthead carries the neutral brand and no author", () => {
    const m = firstOf(buildReportPdfDocument(payload(), intl), "masthead")!;
    assert.equal(m.brand, REPORT_BRAND);
    assert.equal(REPORT_BRAND, "English Tutor LMS");
    const json = JSON.stringify(buildReportPdfDocument(payload(), intl));
    for (const banned of ["Sarah", "English Studio", "Prepared by", "Teacher OS"]) {
      assert.ok(!json.includes(banned), banned);
    }
  });

  it("3. `Generated on` is the payload's application day, and creates nothing", () => {
    const m = firstOf(buildReportPdfDocument(payload(), intl), "masthead")!;
    assert.equal(m.generatedOn, fmt.dateLabel("2026-07-10"));
    assert.ok(!DOC.includes("new Date("), "no clock in the document builder");
    assert.ok(!DOC.includes("Date.now"));
    assert.ok(!DOC.includes("generatedAt"));
  });

  it("4. the masthead context is the period and the resolved scope", () => {
    const studio = firstOf(buildReportPdfDocument(payload(), intl), "masthead")!;
    assert.equal(studio.context, "July 2026 · All classes");

    const scoped = firstOf(buildReportPdfDocument(payload({
      scope: { kind: "student-in-class", classId: "c2", className: "Grammar Stars · B1", studentId: "s1", studentName: "Emma Chen" },
    }), intl), "masthead")!;
    assert.equal(scoped.context, "July 2026 · Emma Chen · Grammar Stars · B1");
  });

  it("5. the footer is the sheet's own two halves", () => {
    const f = firstOf(buildReportPdfDocument(payload(), intl), "footer")!;
    assert.equal(f.left, `${REPORT_BRAND} · Monthly Revenue Report`);
    assert.equal(f.right, "July 2026");
  });

  it("6. an empty selection is a document, not an error", () => {
    const d = buildReportPdfDocument(payload({ empty: true }), intl);
    const e = firstOf(d, "empty")!;
    assert.equal(e.title, "No data for this selection");
    assert.equal(e.body, "Adjust the month, class or student filters to populate this report.");
    assert.equal(blocksOf(d, "table").length, 0);
    assert.equal(blocksOf(d, "stats").length, 0);
    // …and it still has a masthead and a footer.
    assert.ok(firstOf(d, "masthead"));
    assert.ok(firstOf(d, "footer"));
  });

  it("7. carries no Reviews block and no lifecycle field", () => {
    const kinds = new Set(buildReportPdfDocument(paymentPayload(), intl).blocks.map((b) => b.kind));
    assert.deepEqual([...kinds].sort(), ["footer", "masthead", "note", "stats", "table"]);
    for (const banned of ["radar", "skills", "goals", "parentNotes", "callout", "proseRow"]) {
      assert.ok(!DOC.includes(banned), `Reports' document must not carry ${banned}`);
    }
    for (const banned of ["status:", "reportId", "fileUrl", "downloadUrl", "history"]) {
      assert.ok(!DOC.includes(banned), banned);
    }
  });

  it("8. is pure — no jsPDF, no DOM, no database, no network", () => {
    for (const banned of [
      "jspdf", "jsPDF", "document.", "window.", "fetch(", "mongoose", "Model",
      "dbConnect", "localStorage",
    ]) {
      assert.ok(!DOC.includes(banned), `the document builder must not use ${banned}`);
    }
  });
});

/* ============================================ one content model, two surfaces */

describe("Reports PDF · the file cannot say what the screen does not", () => {
  it("9. every summary value is the screen's own rendering, for all five types", () => {
    for (const type of REPORT_TYPES) {
      const p = paymentPayload({ type, title: REPORT_TITLE[type] });
      const stats = firstOf(buildReportPdfDocument(p, intl), "stats")!;
      p.summary.forEach((s, i) => {
        assert.equal(stats.stats[i].value, renderSummaryValue(s.value, s.floor, fmt, en),
          `${type} · ${s.label}`);
        assert.equal(stats.stats[i].label, en(s.label));
      });
    }
  });

  it("10. every table cell is the screen's own rendering", () => {
    const p = paymentPayload();
    const table = firstOf(buildReportPdfDocument(p, intl), "table")!;
    p.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        assert.equal(table.rows[r].cells[c], renderValue(cell, fmt, en));
      });
    });
  });

  it("11. it is literally the same code, not a parallel implementation", () => {
    assert.ok(/from "@\/components\/reports\/reports-ui"/.test(DOC));
    assert.ok(DOC.includes("renderValue") && DOC.includes("renderSummaryValue"));
    // …and the document builder states no formatter of its own.
    for (const banned of ["toLocaleString", "đ", "%`", "Math.round", "reduce("]) {
      assert.ok(!DOC.includes(banned), `no second formatter or arithmetic (${banned})`);
    }
  });

  it("12. no canonical note is dropped on paper", () => {
    const d = buildReportPdfDocument(paymentPayload(), intl);
    const notes = blocksOf(d, "note").map((n) => n.text);
    assert.equal(notes.length, 2, "the hidden-record note and the incomplete-amounts note");
    assert.ok(notes.some((n) => n.includes("historical payment records")));
    assert.ok(notes.some((n) => n.includes("does not have a recorded amount")));
  });

  it("13. the coverage pair travels too, where the payload carries one", () => {
    const d = buildReportPdfDocument(paymentPayload({
      hiddenRecords: undefined, completeness: undefined,
      coverage: { registersTaken: 2, lessonsCompleted: 20 },
    }), intl);
    assert.deepEqual(blocksOf(d, "note").map((n) => n.text), ["Registers taken · 2/20"]);
  });

  it("14. scope is never widened or narrowed by exporting", () => {
    const p = paymentPayload({
      scope: { kind: "class", classId: "c2", className: "Grammar Stars · B1", studentId: null, studentName: null },
    });
    const d = buildReportPdfDocument(p, intl);
    assert.ok(firstOf(d, "masthead")!.context.includes("Grammar Stars · B1"));
    assert.equal(firstOf(d, "table")!.rows.length, p.rows.length, "no row is added or dropped");
  });
});

/* ============================================================== honesty */

describe("Reports PDF · financial honesty survives the export", () => {
  it("15. an unknown amount is No data on paper — never 0đ, never half", () => {
    const table = firstOf(buildReportPdfDocument(paymentPayload(), intl), "table")!;
    const partial = table.rows[1];
    assert.equal(partial.cells[3], "No data");
    assert.equal(partial.cells[4], "No data");
    assert.notEqual(partial.cells[3], "0đ");
    assert.notEqual(partial.cells[3], "350,000đ", "the deleted 50% rule");
  });

  it("16. an incomplete collection rate keeps its floor qualifier", () => {
    const stats = firstOf(buildReportPdfDocument(paymentPayload(), intl), "stats")!;
    const rate = stats.stats.find((s) => s.label === "Collection rate")!;
    assert.equal(rate.value, "At least 65%");
    assert.notEqual(rate.value, "65%", "an incomplete scope never prints an exact percentage");
  });

  it("17. no half-fee inference exists in either PDF module", () => {
    /* Scoped to MONEY, not to arithmetic: the renderer legitimately divides the
     * page width by two to centre the empty state, and banning `/ 2` outright
     * would fail on that while proving nothing about a fee. What must not exist
     * is any halving of, or arithmetic on, a payment figure. */
    for (const [name, src] of [["renderer", PDF], ["document", DOC]] as const) {
      for (const banned of [
        "fee / 2", "fee/2", "amount / 2", "amount * 0.5", "* 0.5",
        "paidAmount", "collectedFor", "outstandingFor",
      ]) {
        assert.ok(!src.includes(banned), `${name}: ${banned}`);
      }
    }
    // The document module does no arithmetic of any kind.
    assert.ok(!/[a-zA-Z)\]]\s*[*/+-]\s*\d/.test(DOC), "no numeric arithmetic in the document builder");
  });

  it("18. the parent line rides the payload's own explicit false", () => {
    const table = firstOf(buildReportPdfDocument(paymentPayload(), intl), "table")!;
    assert.equal(table.rows[0].sub, null, "a linked parent adds no line");
    assert.equal(table.rows[1].sub, "No linked parent");
    assert.ok(/parentLinked === false/.test(DOC), "explicitly false, never a missing flag");
  });

  it("19. a report with no parent flag cannot grow the line", () => {
    const table = firstOf(buildReportPdfDocument(payload(), intl), "table")!;
    assert.deepEqual(table.rows.map((r) => r.sub), [null]);
  });

  it("20. no parent contact detail reaches the document", () => {
    const json = JSON.stringify(buildReportPdfDocument(paymentPayload(), intl));
    for (const leak of ["phone", "email", "address", "relationship"]) {
      assert.ok(!json.includes(leak), leak);
    }
  });

  it("21. no ghost identity reaches the document", () => {
    const p = paymentPayload();
    const json = JSON.stringify(buildReportPdfDocument(p, intl));
    // Only rows the payload carried, and the payload carries no ghost.
    assert.equal(firstOf(buildReportPdfDocument(p, intl), "table")!.rows.length, 2);
    assert.ok(!json.includes("gone"));
    // The hidden count is stated as a sentence, never as a person.
    assert.ok(json.includes("historical payment records"));
  });

  it("22. Attendance: a none stays No data, never 0%", () => {
    const d = buildReportPdfDocument(payload({
      type: "attendance-summary", title: REPORT_TITLE["attendance-summary"],
      summary: [{ label: "Attendance rate", value: { kind: "none" } }],
      rows: [{ key: "c1", cells: [{ kind: "text", value: "Little Explorers" }, { kind: "none" }] }],
    }), intl);
    assert.equal(firstOf(d, "stats")!.stats[0].value, "No data");
    assert.equal(firstOf(d, "table")!.rows[0].cells[1], "No data");
  });

  it("23. Homework: a canonical numeric zero prints as the number, unexplained", () => {
    const d = buildReportPdfDocument(payload({
      type: "homework-summary", title: REPORT_TITLE["homework-summary"],
      summary: [{ label: "Homework completion", value: { kind: "percent", value: 0 } }],
      rows: [{ key: "s1", cells: [{ kind: "text", value: "Emma" }, { kind: "none" }] }],
    }), intl);
    assert.equal(firstOf(d, "stats")!.stats[0].value, "0%");
    assert.equal(firstOf(d, "table")!.rows[0].cells[1], "No data", "a row-level none stays No data");
    // No prose is added claiming a denominator the domain never supplied.
    for (const banned of ["graded", "denominator", "eligible", "of marked"]) {
      assert.ok(!DOC.toLowerCase().includes(banned), banned);
    }
  });

  it("24. Revenue: exact-as-stored, with no Billing field and no anomaly badge", () => {
    const d = buildReportPdfDocument(payload({
      summary: [{ label: "Total revenue", value: { kind: "money", amount: 18_000_000 } }],
    }), intl);
    assert.equal(firstOf(d, "stats")!.stats[0].value, "18,000,000đ");
    const json = JSON.stringify(d);
    for (const banned of ["Collected", "Outstanding", "Total billable", "anomaly", "check this"]) {
      assert.ok(!json.includes(banned), banned);
    }
  });
});

/* ============================================================== unicode */

describe("Reports PDF · Unicode", () => {
  it("25. Vietnamese names survive into the document unchanged", () => {
    const table = firstOf(buildReportPdfDocument(paymentPayload(), intl), "table")!;
    assert.equal(table.rows[0].cells[0], "Nguyễn Đức Cường");
    assert.equal(table.rows[1].cells[0], "Lê Thị Mỹ Hạnh");
  });

  it("26. Vietnamese labels and the đồng symbol survive", () => {
    const vi = createFormat(DEFAULT_REGIONAL, "vi");
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    const t = (k: string) => dict[k] ?? k;
    const d = buildReportPdfDocument(paymentPayload(), { t, fmt: vi });
    assert.equal(firstOf(d, "masthead")!.title, dict["Student Payment Report"]);
    assert.ok(firstOf(d, "stats")!.stats[0].value.endsWith("đ"));
    assert.ok(firstOf(d, "stats")!.stats.some((s) => s.value.startsWith(dict["At least"])));
    assert.equal(firstOf(d, "table")!.rows[1].sub, dict["No linked parent"]);
  });

  it("27. the renderer substitutes only glyphs the font lacks", () => {
    assert.equal(reportPdfSafeText("Listening 3 → 5"), "Listening 3 -> 5");
    // Everything Vietnamese, and the middot the masthead uses, passes through.
    for (const s of ["Nguyễn Đức Cường", "1,500,000đ", "July 2026 · All classes", "Tỷ lệ thu"]) {
      assert.equal(reportPdfSafeText(s), s);
    }
  });

  it("28. every glyph the document can emit is covered by Roboto", () => {
    /* The same cmap check the Reviews suite makes, over the strings THIS
     * document can produce — both languages, every block. */
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    const both = [
      buildReportPdfDocument(paymentPayload(), intl),
      buildReportPdfDocument(paymentPayload(), { t: (k) => dict[k] ?? k, fmt: createFormat(DEFAULT_REGIONAL, "vi") }),
    ];
    const covered = cmapOf(path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf"));
    for (const doc of both) {
      for (const ch of reportPdfSafeText(JSON.stringify(doc))) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20) continue; // structural whitespace in the JSON envelope
        assert.ok(covered.has(cp),
          `U+${cp.toString(16).toUpperCase()} (${ch}) has no glyph in Roboto`);
      }
    }
  });

  it("29. every string is drawn through the substitution", () => {
    assert.ok(!/\bdoc\.text\(/.test(PDF.replace(/function write[\s\S]*?\n\}/, "")),
      "no raw doc.text outside the write() helper");
  });
});

/** The codepoints a TrueType `cmap` format-4 subtable covers. */
function cmapOf(file: string): Set<number> {
  const buf = readFileSync(file);
  const numTables = buf.readUInt16BE(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("ascii", rec, rec + 4) === "cmap") cmapOff = buf.readUInt32BE(rec + 8);
  }
  assert.notEqual(cmapOff, -1, "the font has a cmap");
  const n = buf.readUInt16BE(cmapOff + 2);
  let sub = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = buf.readUInt16BE(rec), enc = buf.readUInt16BE(rec + 2);
    if (platform === 3 && (enc === 1 || enc === 10)) sub = cmapOff + buf.readUInt32BE(rec + 4);
  }
  assert.notEqual(sub, -1, "the font has a Windows Unicode subtable");
  assert.equal(buf.readUInt16BE(sub), 4, "format 4");
  const segX2 = buf.readUInt16BE(sub + 6), seg = segX2 / 2;
  const ends = sub + 14, starts = ends + segX2 + 2;
  const out = new Set<number>();
  for (let s = 0; s < seg; s++) {
    const end = buf.readUInt16BE(ends + s * 2), start = buf.readUInt16BE(starts + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end && c !== 0xffff; c++) out.add(c);
  }
  return out;
}

/* ================================================================= fonts */

describe("Reports PDF · the font is mandatory and its failure is loud", () => {
  it("30. both weights are fetched from the public font directory", () => {
    assert.ok(PDF.includes('url: "/fonts/Roboto-Regular.ttf"'));
    assert.ok(PDF.includes('url: "/fonts/Roboto-Bold.ttf"'));
    for (const w of ["Roboto-Regular.ttf", "Roboto-Bold.ttf"]) {
      assert.ok(readFileSync(path.join(process.cwd(), "public", "fonts", w)).length > 1024, w);
    }
  });

  it("31. both weights are registered before anything is drawn", () => {
    assert.ok(/addFileToVFS\(font\.vfs, font\.base64\)/.test(PDF));
    assert.ok(/addFont\(font\.vfs, FONT, font\.style\)/.test(PDF));
    const setFont = PDF.indexOf("doc.setFont(FONT, REGULAR);\n\n  renderReportPdf");
    const render = PDF.indexOf("renderReportPdf(doc as unknown");
    assert.ok(setFont > -1 && render > setFont, "the Unicode font is set before the walk");
  });

  it("32. a failed fetch throws and produces no document", () => {
    assert.ok(PDF.includes("if (!res.ok) throw new ReportPdfError"));
    assert.ok(PDF.includes("if (buffer.byteLength < 1024)"), "a 404 HTML page is not embedded as a font");
    // The throw happens in Promise.all, before jsPDF is constructed.
    const load = PDF.indexOf("loadFonts()");
    const construct = PDF.indexOf("new jsPDF(");
    assert.ok(load > -1 && construct > load);
  });

  it("33. there is no Helvetica fallback and no silent degradation", () => {
    assert.ok(!/Helvetica/i.test(PDF));
    assert.ok(!/catch[\s\S]{0,120}setFont\(/.test(PDF), "no catch that draws anyway");
    assert.equal((PDF.match(/const FONT = /g) ?? []).length, 1);
    assert.ok(PDF.includes('const FONT = "Roboto"'));
  });

  it("34. a rejection is not cached, so a transient fault is recoverable", () => {
    assert.ok(PDF.includes("fontCache = null;"));
  });

  it("35. the base64 conversion is chunked", () => {
    assert.ok(PDF.includes("i += 0x8000"));
    assert.ok(PDF.includes("bytes.subarray(i, i + 0x8000)"));
  });

  it("36. jsPDF is imported dynamically, so a non-exporting session pays nothing", () => {
    assert.ok(/await Promise\.all\(\[import\("jspdf"\), loadFonts\(\)\]\)/.test(PDF));
    assert.ok(!/^import .* from "jspdf"/m.test(PDF), "never a static import");
  });
});

/* ============================================================ the renderer */

describe("Reports PDF · page setup and the walk", () => {
  it("37. A4 portrait, 12mm margins, and no landscape anywhere", () => {
    assert.ok(PDF.includes("{ w: 210, h: 297, margin: 12 }"));
    assert.ok(/orientation: "portrait"/.test(PDF));
    assert.ok(!/landscape/i.test(PDF));
    assert.ok(/format: "a4"/.test(PDF));
  });

  it("38. sets document metadata and nothing persisted", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(payload(), intl));
    const props = s.calls.find((c) => c.op === "setProperties")!;
    assert.deepEqual(props.args[0], { title: "Monthly Revenue Report", subject: "Monthly Revenue Report · July 2026" });
  });

  it("39. draws every block of a short report on one page", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(payload(), intl));
    assert.equal(s.pages, 1);
    const texts = s.texts();
    assert.ok(texts.includes("Monthly Revenue Report"));
    assert.ok(texts.includes(REPORT_BRAND));
    assert.ok(texts.some((t) => t.includes("July 2026")));
  });

  it("40. the empty state is drawn, and no table is", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(payload({ empty: true }), intl));
    assert.ok(s.texts().includes("No data for this selection"));
    assert.equal(s.pages, 1);
  });

  it("41. the renderer decides layout only — it has no report semantics", () => {
    for (const banned of [
      "ReportPayload", "computeRevenue", "billing", "collectedFor", "parentLinked",
      "student-payment", "monthly-revenue", "attendance-summary",
    ]) {
      assert.ok(!PDF.includes(banned), `the renderer must not know about ${banned}`);
    }
  });

  it("42. it persists nothing and reaches no server", () => {
    for (const banned of [
      "writeFile", "createWriteStream", "node:fs", "/api/", "XMLHttpRequest",
      "createObjectURL", "uploadTo", "fileUrl",
    ]) {
      assert.ok(!PDF.includes(banned), banned);
    }
    // The one fetch is the static font asset.
    assert.equal((PDF.match(/fetch\(/g) ?? []).length, 1);
    assert.ok(PDF.includes("fetch(font.url)"));
  });
});

/* ============================================================ table widths */

describe("Reports PDF · portrait column widths", () => {
  const CONTENT = 210 - 24;

  it("43. widths always sum to the content column exactly", () => {
    for (const cols of [
      ["left", "right"],
      ["left", "left", "right", "right", "right", "left"],
      ["left"], ["right", "right", "right"],
    ] as ("left" | "right")[][]) {
      const w = columnWidths(cols);
      assert.equal(w.length, cols.length, "every column gets a width");
      assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - CONTENT) < 0.01,
        `${cols.length} columns sum to the content width`);
    }
  });

  it("44. no column is ever dropped, even at the widest authorised report", () => {
    // Student Payment is the widest: six columns.
    const p = paymentPayload();
    const table = firstOf(buildReportPdfDocument(p, intl), "table")!;
    assert.equal(table.columns.length, 6);
    const w = columnWidths(table.columns.map((c) => c.align));
    assert.equal(w.length, 6);
    assert.ok(w.every((x) => x > 4), "every column keeps a usable width");
  });

  it("45. text columns get the larger share", () => {
    const w = columnWidths(["left", "right"]);
    assert.ok(w[0] > w[1], "a name needs more room than a figure");
  });

  it("46. an empty column set is not a crash", () => {
    assert.deepEqual(columnWidths([]), []);
  });

  it("47. cells wrap rather than being clipped or truncated", () => {
    const s = stub(1); // one character per mm: everything wraps
    renderReportPdf(s.doc, buildReportPdfDocument(paymentPayload(), intl));
    assert.ok(!s.texts().some((t) => t.includes("…")), "nothing is ellipsised");
    assert.ok(PDF.includes("splitTextToSize"), "the renderer wraps");
    assert.ok(!/slice\(0, ?\d+\)/.test(PDF), "no string is cut to fit");
  });
});

/* ============================================================= pagination */

describe("Reports PDF · pagination", () => {
  /** A payment report with `n` rows. */
  const long = (n: number) => paymentPayload({
    rows: Array.from({ length: n }, (_, i) => ({
      key: `b${i}`,
      parentLinked: i % 3 === 0 ? false : true,
      cells: [
        { kind: "text", value: `Student ${i}` }, { kind: "text", value: "Grammar Stars · B1" },
        { kind: "money", amount: 750_000 }, { kind: "money", amount: 750_000 },
        { kind: "money", amount: 0 }, { kind: "term", key: "Paid" },
      ] as ReportValue[],
    })),
  });

  it("48. a short report is one page", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(5), intl));
    assert.equal(s.pages, 1);
  });

  it("49. a long report paginates", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(120), intl));
    assert.ok(s.pages > 1, `expected several pages, got ${s.pages}`);
  });

  it("50. the column headings repeat on every page", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(120), intl));
    const headers = s.texts().filter((t) => t === "Monthly fee").length;
    assert.equal(headers, s.pages, "one header per page a table spans");
  });

  it("51. no content is ever drawn below the footer band", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(120), intl));
    /* Everything except the per-page footer, which is drawn last into its own
     * reserved strip. 297 - 12 - 8 = 277mm is the content floor; the footer
     * sits at 287. */
    const footerY = 297 - 12 + 2;
    const content = s.ys().filter((y) => y !== footerY && y !== footerY - 4);
    for (const y of content) {
      assert.ok(y <= 285, `content at ${y}mm overruns the reserved footer band`);
    }
  });

  it("52. nothing is drawn above the top margin", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(120), intl));
    for (const y of s.ys()) assert.ok(y >= 12, `content at ${y}mm is inside the top margin`);
  });

  it("53. the footer is drawn once per page, not once per document", () => {
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(120), intl));
    const left = `${REPORT_BRAND} · Student Payment Report`;
    assert.equal(s.texts().filter((t) => t === left).length, s.pages);
  });

  it("54. a row is never split across the fold", () => {
    // Every row asks for its whole height before a cell of it is drawn.
    assert.ok(/if \(!sheet\.fits\(h\)\) \{\s*sheet\.newPage\(\);\s*header\(\);/.test(PDF));
  });

  it("55. a row with a secondary line reserves room for it", () => {
    assert.ok(/\(row\.sub \? TABLE\.subH : 0\)/.test(PDF));
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(long(30), intl));
    assert.ok(s.texts().includes("No linked parent"), "the line is drawn");
  });

  it("56. the stats strip breaks between rows of tiles, not through one", () => {
    const many = paymentPayload({
      summary: Array.from({ length: 9 }, (_, i) => ({
        label: `Tile ${i}`, value: { kind: "count", value: i } as ReportValue,
      })),
    });
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(many, intl));
    assert.ok(s.texts().includes("Tile 8"), "every tile is drawn");
  });
});

/* ============================================================== filename */

describe("Reports PDF · the filename", () => {
  it("57. studio scope: type and month", () => {
    assert.equal(reportPdfFilename(payload()), "monthly-revenue-2026-07.pdf");
    for (const type of REPORT_TYPES) {
      assert.equal(reportPdfFilename(payload({ type })), `${type}-2026-07.pdf`);
    }
  });

  it("58. class scope adds the class", () => {
    assert.equal(
      reportPdfFilename(payload({
        type: "class-revenue",
        scope: { kind: "class", classId: "c2", className: "Grammar Stars · B1", studentId: null, studentName: null },
      })),
      "class-revenue-2026-07-grammar-stars-b1.pdf"
    );
  });

  it("59. student scope adds the student, and both adds both", () => {
    assert.equal(
      reportPdfFilename(payload({
        type: "student-payment",
        scope: { kind: "student", classId: null, className: null, studentId: "s1", studentName: "Emma Chen" },
      })),
      "student-payment-2026-07-emma-chen.pdf"
    );
    assert.equal(
      reportPdfFilename(payload({
        type: "student-payment",
        scope: { kind: "student-in-class", classId: "c2", className: "Grammar Stars · B1", studentId: "s1", studentName: "Emma Chen" },
      })),
      "student-payment-2026-07-grammar-stars-b1-emma-chen.pdf"
    );
  });

  it("60. Vietnamese is decomposed, not deleted", () => {
    assert.equal(
      reportPdfFilename(payload({
        type: "student-payment",
        scope: { kind: "student", classId: null, className: null, studentId: "s1", studentName: "Nguyễn Đức Cường" },
      })),
      "student-payment-2026-07-nguyen-duc-cuong.pdf"
    );
  });

  it("61. is filesystem-safe for every awkward name", () => {
    for (const name of ["A/B \\ C", "  spaced  ", "Ann-Marie O'Neill", "…", "??", "Émile Zöla"]) {
      const f = reportPdfFilename(payload({
        type: "student-payment",
        scope: { kind: "student", classId: null, className: null, studentId: "s", studentName: name },
      }));
      assert.ok(/^[a-z0-9.-]+\.pdf$/.test(f), `${name} -> ${f}`);
      assert.ok(!f.includes(".."), f);
      assert.ok(!f.startsWith("-") && !f.startsWith("."), f);
    }
  });

  it("62. is deterministic — no id, no clock, no counter", () => {
    const p = paymentPayload();
    assert.equal(reportPdfFilename(p), reportPdfFilename(p));
    assert.ok(!DOC.includes("Math.random"));
    assert.ok(!DOC.includes("Date.now"));
    assert.ok(!/counter|sequence|nonce/i.test(DOC));
  });

  it("63. does not change with the interface language", () => {
    /* The TYPE KEY, not the translated title — so a Vietnamese session and an
     * English one produce one file for one document. */
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    const vi = buildReportPdfDocument(paymentPayload(), { t: (k) => dict[k] ?? k, fmt: createFormat(DEFAULT_REGIONAL, "vi") });
    const enDoc = buildReportPdfDocument(paymentPayload(), intl);
    assert.equal(vi.filename, enDoc.filename);
    assert.equal(vi.filename, "student-payment-2026-07.pdf");
  });
});

/* ================================================================= print */

/** The `@media print` block, comment-free. Module scope, because both print
 * suites below read it — the isolation rules and the stale-class guarantee are
 * two halves of one contract. */
const printBlock = (() => {
  const i = CSS.indexOf("@media print{");
  assert.notEqual(i, -1);
  let d = 0;
  for (let j = i + 12; j < CSS.length; j++) {
    if (CSS[j] === "{") d++;
    else if (CSS[j] === "}") { d--; if (d === 0) return CSS.slice(i, j + 1); }
  }
  throw new Error("unterminated @media print");
})();

describe("Reports Print · an isolated Reports-owned scope", () => {
  it("64. Reports prints under its own body class", () => {
    assert.ok(printBlock.includes("body.print-report{"));
    assert.ok(PAGE.includes('body.classList.add("print-report")'));
  });

  it("65. it does not reuse, extend or alter the Reviews scope", () => {
    assert.ok(printBlock.includes("body.print-review{"), "Reviews still prints its own way");
    assert.ok(!PAGE.includes("print-review"), "Reports never sets the Reviews class");
    // No Reports rule targets a Reviews-only hook.
    for (const reviewsOnly of ["rp-meta", "rp-goals", "rp-skills-row", "rp-skill-bars",
      "rp-summary-card", "skill-radar", "review-overlay", "report-scroll", "report-body", "rvc-"]) {
      assert.ok(!new RegExp(`body\\.print-report[^{]*${reviewsOnly}`).test(printBlock),
        `a Reports print rule must not target ${reviewsOnly}`);
    }
  });

  it("66. …and Reviews needs nothing from the Reports scope", () => {
    const reviewsRules = printBlock.split("\n").filter((l) => l.includes("body.print-review"));
    for (const line of reviewsRules) {
      assert.ok(!line.includes("print-report"), "the two scopes never share a selector");
    }
    assert.ok(reviewsRules.length >= 8, "the Reviews block is still substantial");
  });

  it("67. the deleted design-reference rule was not restored", () => {
    assert.ok(!printBlock.includes("[data-theme].print-report"),
      "the old rule targeted <html> and could never have matched");
    assert.ok(!/print-report \*\{visibility:hidden/.test(printBlock),
      "the visibility strategy is not reinstated");
  });

  it("68. the app shell does not print", () => {
    for (const sel of [".app-sidebar", ".app-header", ".no-print", ".rp-rail", ".rp-state"]) {
      assert.ok(new RegExp(`body\\.print-report [^{]*\\${sel}[^{]*\\{[^}]*display:none`).test(printBlock)
        || printBlock.includes(`body.print-report ${sel}`),
        `${sel} must be hidden when printing a report`);
    }
  });

  it("69. the actions are inside the rail, so hiding it hides them", () => {
    assert.ok(/className="rp-rail no-print"/.test(CONTROLS));
    assert.ok(/className="rp-actions"/.test(CONTROLS));
    const rail = CONTROLS.indexOf("rp-rail");
    const actions = CONTROLS.indexOf("rp-actions");
    assert.ok(rail > -1 && actions > rail, "the action block is nested in the rail");
  });

  it("70. the nested chain is unwrapped rather than repositioned", () => {
    for (const ancestor of [".app-main", '[data-screen-label="Reports"]', ".rp-grid", ".rp-preview"]) {
      assert.ok(printBlock.includes(`body.print-report ${ancestor}`),
        `${ancestor} is on the path to the sheet and must be neutralised`);
    }
    assert.ok(!/body\.print-report .report-sheet\{[^}]*position:absolute/.test(printBlock),
      "the sheet stays in flow, so pagination is the browser's");
  });

  it("71. the grid track cannot squeeze the printed document", () => {
    assert.ok(/body\.print-report \.rp-grid\{grid-template-columns:none/.test(printBlock));
  });

  it("72. the screen's table scroller is released, and only in print", () => {
    assert.ok(/body\.print-report \.rp-table-wrap\{overflow:visible/.test(printBlock));
    // The screen rule itself is untouched.
    assert.ok(/\.rp-table-wrap\{\s*overflow-x:auto/.test(CSS), "the screen scroller still exists");
  });

  it("73. a long table breaks between rows, and repeats its head", () => {
    assert.ok(/body\.print-report \.rp-table tr\{break-inside:avoid/.test(printBlock));
    assert.ok(/body\.print-report \.rp-table-wrap\{break-inside:auto/.test(printBlock),
      "the wrapper must be allowed to break, or a long table cannot paginate");
    assert.ok(/body\.print-report \.rp-table thead\{display:table-header-group/.test(printBlock));
  });

  it("74. nothing in the chain constrains height or clips overflow", () => {
    const guard = printBlock.slice(printBlock.lastIndexOf("body.print-report,"));
    for (const sel of [".app-main", ".rp-grid", ".rp-preview", ".report-sheet"]) {
      assert.ok(guard.includes(sel), `${sel} is named in the final unclipping guard`);
    }
    assert.ok(/height:auto !important;max-height:none !important;overflow:visible !important/.test(guard));
  });

  it("75. the document keeps its colours on paper", () => {
    assert.ok(/body\.print-report \.report-sheet,\s*body\.print-report \.report-sheet \*\{/.test(printBlock));
    assert.ok(/-webkit-print-color-adjust:exact/.test(printBlock));
    assert.ok(/print-color-adjust:exact/.test(printBlock));
  });

  it("76. A4 and the 12mm page margin are the document's own", () => {
    assert.ok(printBlock.includes("@page{margin:12mm}"), "shared with Reviews and with the PDF");
    assert.ok(PDF.includes("margin: 12"), "the exported file uses the same gutter");
  });

  it("77. THE FOOTER DECISION: hidden in browser print, drawn in the PDF", () => {
    /* Option B, matching the Reviews precedent. The browser draws its own URL,
     * date, page number and site name at the page edges — user-agent chrome
     * outside the page box that no stylesheet can remove — so printing the
     * report's own footer beneath it stacks two footers on every sheet. The
     * EXPORTED PDF keeps its footer, on every page, because it has no such
     * chrome to collide with. */
    assert.ok(/body\.print-report \.report-sheet \.rp-foot\{display:none/.test(printBlock));
    // Reviews made the identical call, and still does.
    assert.ok(/body\.print-review \.report-sheet \.rp-foot\{display:none/.test(printBlock));
    // The PDF's footer is unaffected by that decision.
    const s = stub();
    renderReportPdf(s.doc, buildReportPdfDocument(payload(), intl));
    assert.ok(s.texts().some((t) => t.startsWith(REPORT_BRAND)), "the file keeps its footer");
  });

  it("78. every Reports print rule targets a class the DOM actually renders", () => {
    const markup = PAGE + CONTROLS + code("src", "components", "reports", "report-sheet.tsx");
    const hooks = [...printBlock.matchAll(/body\.print-report[^{]*?\.(rp-[a-z-]+)/g)].map((m) => m[1]);
    for (const hook of new Set(hooks)) {
      assert.ok(markup.includes(hook) || CSS.includes(`.${hook}`),
        `.${hook} is targeted by a print rule but rendered by nothing`);
    }
    assert.ok(new Set(hooks).size >= 5, "the block does address the Reports DOM");
  });
});

describe("Reports Print · the trigger and its cleanup", () => {
  it("79. the class is added, then the dialog is opened", () => {
    const add = PAGE.indexOf('classList.add("print-report")');
    const print = PAGE.indexOf("window.print()");
    assert.ok(add > -1 && print > add, "the page is rewritten before it is printed");
  });

  it("80. cleanup runs on afterprint", () => {
    assert.ok(/window\.addEventListener\("afterprint", done\)/.test(PAGE));
    assert.ok(/body\.classList\.remove\("print-report"\)/.test(PAGE));
    assert.ok(/window\.removeEventListener\("afterprint", done\)/.test(PAGE));
  });

  it("81. cleanup also runs when window.print() throws", () => {
    assert.ok(/try \{\s*window\.print\(\);\s*\} catch \{[\s\S]*?done\(\);/.test(PAGE),
      "a browser that refuses the dialog must not leave the class behind");
  });

  it("82. the listener is removed, so prints do not accumulate handlers", () => {
    const done = PAGE.slice(PAGE.indexOf("const done"), PAGE.indexOf("window.addEventListener"));
    assert.ok(done.includes("removeEventListener"));
  });

  it("83. printing writes nothing", () => {
    const fn = PAGE.slice(PAGE.indexOf("function printReportSheet"), PAGE.indexOf("export default"));
    for (const banned of ["fetch(", "mutate", "invalidate", "setState", "localStorage"]) {
      assert.ok(!fn.includes(banned), banned);
    }
  });

  it("84. every print rule is inside @media print, so a stale class is inert", () => {
    const outside = CSS.replace(printBlock, "");
    assert.ok(!outside.includes("print-report"),
      "a class left behind by a browser that never fires afterprint must do nothing on screen");
  });
});

/* ============================================================ the actions */

describe("Reports · the final action block", () => {
  it("85. exactly two actions: Export PDF and Print", () => {
    assert.ok(CONTROLS.includes('t("Print")'));
    assert.ok(/t\(exporting \? "Exporting…" : "Export PDF"\)/.test(CONTROLS));
    const buttons = (CONTROLS.match(/<button/g) ?? []).length;
    assert.equal(buttons, 2, "two, and no third");
  });

  it("86. Excel and CSV are absent, not disabled", () => {
    for (const src of [PAGE, CONTROLS]) {
      assert.ok(!/Excel/.test(src));
      assert.ok(!/\bCSV\b/.test(src));
      assert.ok(!/xlsx/i.test(src));
    }
  });

  it("87. there is still no Generate button", () => {
    for (const src of [PAGE, CONTROLS]) assert.ok(!/Generate report/.test(src));
  });

  it("88. both actions are genuinely disabled only when unusable", () => {
    assert.ok(/disabled=\{!canAct \|\| exporting\}/.test(CONTROLS), "export: no payload, or already running");
    assert.ok(/disabled=\{!canAct\}/.test(CONTROLS), "print: no payload");
    assert.ok(/const canAct = !isLoading && !isError && !!data/.test(PAGE));
  });

  it("89. a refetch does NOT disable them — the sheet still shows a document", () => {
    /* Read the DEFINITION, not the JSX: `aria-busy={isFetching}` lives a few
     * lines below the prop that passes `canAct` down, and a loose scan matches
     * across both. */
    const def = PAGE.slice(PAGE.indexOf("const canAct ="));
    assert.ok(!def.slice(0, def.indexOf("\n")).includes("isFetching"),
      "keepPreviousData keeps a real report on screen while the next loads");
    assert.ok(PAGE.includes("placeholderData: keepPreviousData"));
  });

  it("90. the export acts on the payload the sheet is showing", () => {
    assert.ok(/buildReportPdfDocument\(data, \{ t, fmt \}\)/.test(PAGE));
    // No second fetch, no snapshot, no stale copy held in state.
    assert.ok(!/useRef[\s\S]{0,200}payload/.test(PAGE));
    assert.ok(!/refetch\(\)[\s\S]{0,80}exportReportPdf/.test(PAGE));
  });

  it("91. a double press cannot produce two files", () => {
    assert.ok(/if \(!data \|\| exporting\) return;/.test(PAGE));
  });

  it("92. a failed export is reported and leaves nothing behind", () => {
    assert.ok(/ReportPdfError \? e\.message : "The report could not be exported\."/.test(PAGE));
    assert.ok(/"error"\)/.test(PAGE), "shown through the app's own error toast");
    assert.ok(/finally \{\s*setExporting\(false\);/.test(PAGE), "the button recovers");
    assert.ok(!/Saving report/i.test(PAGE), "exporting is not saving");
  });

  it("93. every action string is already translated", () => {
    const dict = JSON.parse(read("src", "lib", "i18n-vi.json")) as Record<string, string>;
    for (const k of ["Export PDF", "Print", "Exporting…",
      "The report could not be exported.", "The report font could not be loaded."]) {
      assert.ok(dict[k], `${k} must be in the dictionary`);
    }
  });
});
