/* The Reports PDF renderer — millimetres, fonts, page breaks and ink.
 *
 * It walks the ordered block list from reports-pdf-document.ts and draws it onto
 * A4 portrait. It decides NOTHING about what a report contains: it never sees a
 * `ReportPayload`, never sees a `ReportValue` before it has become a string, and
 * has no branch on report type. Those questions were answered once, on the DTO.
 *
 * ---- WHY THE FONT MACHINERY IS DUPLICATED RATHER THAN SHARED ---------------
 *
 * Reviews already solves the hard part: jsPDF's fourteen standard fonts are
 * WinAnsi and physically cannot encode Vietnamese — `ế` (U+1EBF), `ữ` (U+1EEF),
 * `ị` (U+1ECB) and `đ` (U+0111) are all outside the encoding, and jsPDF answers
 * with mojibake rather than an error. The fix is an embedded Roboto, fetched at
 * export time. The ~50 lines below are that fix, and they are deliberately a
 * SECOND COPY rather than an extraction, for three reasons that are facts about
 * this repository rather than preferences:
 *
 *  1. `ReviewPdfError` is caught by `instanceof` in the Reviews composer. A
 *     shared loader would have to throw a shared type, which either changes that
 *     branch's behaviour or needs re-wrapping on the Reviews side.
 *  2. tests/review-pdf.test.ts asserts on the font code AS SOURCE, by string:
 *     the Roboto URL, `i += 0x8000`, `bytes.subarray(i, i + 0x8000)`,
 *     `if (buffer.byteLength < 1024)` and `fontCache = null;`. Moving that code
 *     out of review-pdf.ts breaks five assertions in a 159-test suite that
 *     guards a shipped, human-verified document.
 *  3. The runtime cost is a browser HTTP-CACHE HIT and one base64 conversion,
 *     not a second download — `/fonts/*.ttf` is a static asset.
 *
 * So the Sprint 10 contract's "Print has its own isolated scope" is matched here
 * by an isolated export: Reviews is not touched, not generalised, and cannot
 * regress because of anything in this file. If a third exporter ever appears,
 * THAT is the moment to extract — with the Reviews suite rewritten deliberately
 * rather than as a side effect.
 *
 * ---- IF THE FONT DOES NOT LOAD, NOTHING IS PRODUCED ------------------------
 *
 * A PDF drawn in Helvetica would open cleanly and be quietly wrong — a family's
 * name mangled on a document about their money. The failure is surfaced instead.
 * There is no fallback, and there is no code path that draws without the font.
 *
 * ---- WHAT IT NEVER DOES ----------------------------------------------------
 *
 * No fetch to the API, no cache read or write, no mutation, no server-side
 * generation and no persisted file. Exporting is a read of what is already on
 * screen.
 */

import type { ReportPdfBlock, ReportPdfColumnRole, ReportPdfDocument } from "./reports-pdf-document";

/* ------------------------------------------------------------------ the page */

/** A4 in millimetres, with the same 12mm margin `@media print { @page }` uses —
 * so the printed sheet and the exported file have the same gutter.
 *
 * PORTRAIT, ALWAYS. Landscape is never used (PROJECT_RULES, Reports): a wide
 * table is solved by bounded column widths and wrapping, not by rotating the
 * page, because a document that changed orientation with its content would stop
 * being one document. */
const PAGE = { w: 210, h: 297, margin: 12 } as const;
const CONTENT_W = PAGE.w - PAGE.margin * 2;

/** The document's vertical rhythm, in millimetres. The relationship is what
 * matters: a section boundary is larger than the gap inside a group. */
const RHYTHM = { section: 5, inner: 3.5 } as const;

/** The document palette, matching `.report-sheet`'s light-locked tokens. The
 * sheet is a white page with dark ink under every theme, so these are literals
 * rather than anything read from the running app's CSS. */
const INK = {
  fg: [24, 24, 27],
  fg2: [63, 63, 70],
  muted: [113, 113, 122],
  muted2: [161, 161, 170],
  border: [232, 232, 236],
  card2: [250, 250, 250],
  accent: [209, 66, 66],
} as const;

const FONT = "Roboto";
const REGULAR = "normal";
const BOLD = "bold";

/** Where the two weights live. Public, static, cacheable. */
const FONT_FILES: { style: string; url: string; vfs: string }[] = [
  { style: REGULAR, url: "/fonts/Roboto-Regular.ttf", vfs: "Roboto-Regular.ttf" },
  { style: BOLD, url: "/fonts/Roboto-Bold.ttf", vfs: "Roboto-Bold.ttf" },
];

/** Raised when the export cannot be produced correctly. Carries a dictionary key
 * so the caller can show it through the app's existing toast and `t`. */
export class ReportPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPdfError";
  }
}

/* ----------------------------------------------------------------- the fonts */

/** ArrayBuffer to base64, in chunks.
 *
 * CHUNKED BECAUSE `String.fromCharCode(...bytes)` ON A 168KB FONT BLOWS THE
 * ARGUMENT LIMIT and throws a RangeError in every engine. 0x8000 is the usual
 * safe stride. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The two weights, fetched once per page load.
 *
 * Cached as the PROMISE, not the result, so two quick exports share one fetch
 * rather than racing. A rejection is not cached: a failed load is usually a
 * transient network fault, and pinning it would make the button permanently
 * broken until a reload. */
let fontCache: Promise<{ style: string; vfs: string; base64: string }[]> | null = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  fontCache = (async () => {
    const loaded = [];
    for (const font of FONT_FILES) {
      const res = await fetch(font.url);
      if (!res.ok) throw new ReportPdfError("The report font could not be loaded.");
      const buffer = await res.arrayBuffer();
      /* A dev server that answers a missing asset with an HTML 404 page would
       * otherwise be embedded AS a font, and jsPDF would fail somewhere far from
       * here. A real TrueType file starts 0x00010000 and is not 12 bytes long. */
      if (buffer.byteLength < 1024) throw new ReportPdfError("The report font could not be loaded.");
      loaded.push({ style: font.style, vfs: font.vfs, base64: toBase64(buffer) });
    }
    return loaded;
  })();
  try {
    return await fontCache;
  } catch (e) {
    fontCache = null;
    throw e;
  }
}

/* ---------------------------------------------------------------- the cursor */

/** The narrow slice of jsPDF this renderer uses, named so the walk below can be
 * read — and unit-tested — without dragging the whole library's types in. */
export interface ReportJsPdf {
  addPage(): void;
  setPage?(page: number): void;
  setFont(name: string, style: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(text: string | string[], x: number, y: number, opts?: { align?: string }): void;
  splitTextToSize(text: string, width: number): string[];
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  setProperties(props: { title?: string; subject?: string }): void;
  save(filename: string): void;
  getNumberOfPages(): number;
}

/** The renderer's whole state: which page, and how far down it.
 *
 * THE FOOTER'S BAND IS RESERVED. `bottom` stops short of the margin by the
 * footer's own height, so content can never be laid into the strip the per-page
 * footer will later occupy — the printed sheet's `.rp-foot` never collides with
 * the last row of a table. */
const FOOTER_BAND = 8;

class Sheet {
  y = PAGE.margin;
  constructor(private readonly doc: ReportJsPdf) {}

  get bottom(): number {
    return PAGE.h - PAGE.margin - FOOTER_BAND;
  }

  /** Reserve `height`, starting a new page when it will not fit.
   *
   * THIS IS WHAT KEEPS A BLOCK WHOLE, the same promise `break-inside:avoid`
   * makes to the printed sheet: a block asks for its full height before drawing
   * a line of it. A block TALLER than a whole page is drawn from the top of a
   * fresh page rather than looping for ever — the table below never asks for
   * more than one row at a time, so this only ever applies to a single
   * oversized element. */
  need(height: number): number {
    if (this.y !== PAGE.margin && this.y + height > this.bottom) {
      this.doc.addPage();
      this.y = PAGE.margin;
    }
    const top = this.y;
    this.y += height;
    return top;
  }

  /** Will `height` fit without breaking? Asked by the table, which decides for
   * itself when to repeat a header. */
  fits(height: number): boolean {
    return this.y + height <= this.bottom;
  }

  newPage() {
    this.doc.addPage();
    this.y = PAGE.margin;
  }

  gap(mm: number) {
    this.y += mm;
  }
}

/* --------------------------------------------------------------- the drawing */

type Rgb = readonly number[];
const ink = (doc: ReportJsPdf, c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);

/** Characters the embedded font has no glyph for, and what to print instead.
 *
 * Roboto covers Latin, Latin Extended and the whole of Vietnamese, but has no
 * U+2192 RIGHTWARDS ARROW. A glyph the font lacks does not fail — it prints as
 * an empty notdef box — so the one character that would do that is spelled.
 * The middot U+00B7, which the masthead and the notes both use, IS covered.
 *
 * THE SCREEN KEEPS THE REAL CHARACTER. This substitution belongs to the
 * renderer, not to the document model. */
const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/→/g, "->"],
];

/** Every string is drawn through this. */
export function reportPdfSafeText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of UNSUPPORTED) out = out.replace(pattern, replacement);
  return out;
}

/** Draw text, always through the substitution above. Every call site in this
 * file goes through here, so a raw `doc.text` cannot creep back in. */
function write(doc: ReportJsPdf, text: string | string[], x: number, y: number, opts?: { align?: string }) {
  doc.text(Array.isArray(text) ? text.map(reportPdfSafeText) : reportPdfSafeText(text), x, y, opts);
}

/* ------------------------------------------------------------- column widths */

/** How much width each kind of column needs, relative to the others.
 *
 * THESE ARE CONTENT MEASUREMENTS, NOT PREFERENCES. At the table's 6.5–7.5pt the
 * longest thing each role has to hold is roughly:
 *
 *   text    a student's name plus its `No linked parent` line       widest
 *   money   `13,100,000đ` — eleven glyphs and a currency mark       wide
 *   term    `Partially Paid`, the longest status the app renders    moderate
 *   figure  a count or `65%`, plus its own column heading           narrow
 *
 * The previous split was by ALIGNMENT — left got two shares, right got one —
 * which is a proxy that fails on exactly the report that needs it most. On
 * Student Payment it gave the three money columns 20.7mm each, under what
 * `13,100,000đ` occupies, so every amount wrapped onto a second line; while
 * `Status`, holding one short word, was handed 41.3mm. The table was correct and
 * unreadable, which is what the human pass reported. */
const COLUMN_SHARE: Record<ReportPdfColumnRole, number> = {
  text: 26,
  money: 17,
  term: 16,
  figure: 11,
};

/** Portrait-safe column widths, in millimetres, summing EXACTLY to the content
 * column.
 *
 * NO COLUMN IS EVER DROPPED (PROJECT_RULES, Reports: the DTO decides what a
 * report contains, and a page width is not an argument about that), nothing is
 * clipped and nothing is truncated with an ellipsis — text that still does not
 * fit WRAPS.
 *
 * The remainder goes to the first column, so the widths always add up to
 * `CONTENT_W` exactly and a table can never be one hairline wider than the page. */
export function columnWidths(
  roles: readonly ReportPdfColumnRole[],
  total: number = CONTENT_W
): number[] {
  if (roles.length === 0) return [];
  const shares = roles.map((r) => COLUMN_SHARE[r]);
  const sum = shares.reduce((s, w) => s + w, 0);
  const widths = shares.map((w) => Math.floor((total * w) / sum * 100) / 100);
  const used = widths.reduce((s, w) => s + w, 0);
  widths[0] = Math.round((widths[0] + (total - used)) * 100) / 100;
  return widths;
}

/* ----------------------------------------------------------------- the walk */

const TABLE = {
  headerH: 7,
  rowPadY: 2.2,
  lineH: 4.2,
  subH: 3.4,
  cellPadX: 1.6,
} as const;

function drawMasthead(doc: ReportJsPdf, sheet: Sheet, b: Extract<ReportPdfBlock, { kind: "masthead" }>) {
  const top = sheet.need(16);
  doc.setFont(FONT, BOLD);
  doc.setFontSize(14);
  ink(doc, INK.fg);
  write(doc, b.title, PAGE.margin, top + 5);

  doc.setFont(FONT, REGULAR);
  doc.setFontSize(9);
  ink(doc, INK.muted);
  write(doc, b.context, PAGE.margin, top + 10.5);

  doc.setFont(FONT, BOLD);
  doc.setFontSize(9.5);
  ink(doc, INK.accent);
  write(doc, b.brand, PAGE.w - PAGE.margin, top + 5, { align: "right" });

  doc.setFont(FONT, REGULAR);
  doc.setFontSize(7.5);
  ink(doc, INK.muted2);
  write(doc, `${b.generatedLabel} ${b.generatedOn}`, PAGE.w - PAGE.margin, top + 10, { align: "right" });

  /* The masthead's own 2px rule, as the sheet draws it — IN THE DOCUMENT
   * ACCENT, which is what `.report-sheet .rp-head{border-bottom:2px solid
   * var(--accent)}` paints on screen. It was drawn in `INK.fg` here, so the
   * file's one piece of colour came out near-black while the preview's was red;
   * human verification caught exactly that. `INK.accent` is the light default
   * `--accent:#d14242`, the same constant and the same reasoning the Reviews
   * export already uses for its own masthead rule. */
  doc.setDrawColor(INK.accent[0], INK.accent[1], INK.accent[2]);
  doc.setLineWidth(0.5);
  doc.line(PAGE.margin, top + 14, PAGE.w - PAGE.margin, top + 14);
  sheet.gap(RHYTHM.section);
}

function drawStats(doc: ReportJsPdf, sheet: Sheet, b: Extract<ReportPdfBlock, { kind: "stats" }>) {
  /* The tile strip wraps at three across, which is what the sheet's own
   * `min-width:130px` produces in a 760px document. A fourth tile starts a
   * second row rather than shrinking the first three past legibility. */
  const perRow = 3;
  const gap = 3;
  const rows: typeof b.stats[] = [];
  for (let i = 0; i < b.stats.length; i += perRow) rows.push(b.stats.slice(i, i + perRow));

  for (const row of rows) {
    const h = 13;
    const top = sheet.need(h + gap);
    /* EVERY ROW FILLS THE CONTENT WIDTH, which is what the screen does and what
     * this did not. `.rp-stat` is `flex:1` inside a `flex-wrap` strip, so a row
     * holding fewer tiles than the one above it does not leave a gap — its tiles
     * grow to take the slack. Dividing by the fixed `perRow` instead left a
     * five-tile report with two 60mm cards and 63mm of white beside them, which
     * is the "cards do not fill" the human pass reported. Dividing by THIS row's
     * own length reproduces the flex behaviour exactly. */
    const w = (CONTENT_W - gap * (row.length - 1)) / row.length;
    row.forEach((stat, i) => {
      const x = PAGE.margin + i * (w + gap);
      doc.setFillColor(INK.card2[0], INK.card2[1], INK.card2[2]);
      doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, top, w, h, 1.5, 1.5, "FD");

      doc.setFont(FONT, REGULAR);
      doc.setFontSize(6.5);
      ink(doc, INK.muted);
      write(doc, doc.splitTextToSize(stat.label, w - 4)[0] ?? stat.label, x + 2, top + 4.6);

      doc.setFont(FONT, BOLD);
      doc.setFontSize(9.5);
      ink(doc, INK.fg);
      write(doc, doc.splitTextToSize(stat.value, w - 4)[0] ?? stat.value, x + 2, top + 10);
    });
  }
  sheet.gap(RHYTHM.section - gap);
}

/** The generic table.
 *
 * PAGINATION IS PER ROW, AND THE HEADER REPEATS. A row measures itself — every
 * cell wrapped to its own column width, plus the optional secondary line — and
 * asks for that height; when it does not fit, the page breaks BEFORE the row and
 * the column headings are drawn again at the top of the next one. So a row is
 * never split across the fold and a continued table is never a set of unlabelled
 * numbers. */
function drawTable(doc: ReportJsPdf, sheet: Sheet, b: Extract<ReportPdfBlock, { kind: "table" }>) {
  const widths = columnWidths(b.columns.map((c) => c.role));

  const header = () => {
    const top = sheet.need(TABLE.headerH);
    doc.setFont(FONT, BOLD);
    doc.setFontSize(6.5);
    ink(doc, INK.muted);
    let x = PAGE.margin;
    b.columns.forEach((c, i) => {
      const right = c.align === "right";
      write(doc, c.label, right ? x + widths[i] - TABLE.cellPadX : x + TABLE.cellPadX,
        top + 4, right ? { align: "right" } : undefined);
      x += widths[i];
    });
    doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
    doc.setLineWidth(0.3);
    doc.line(PAGE.margin, top + TABLE.headerH - 1.4, PAGE.w - PAGE.margin, top + TABLE.headerH - 1.4);
  };

  header();

  for (const row of b.rows) {
    doc.setFont(FONT, REGULAR);
    doc.setFontSize(7.5);
    const wrapped = row.cells.map((cell, i) =>
      doc.splitTextToSize(cell, Math.max(widths[i] - TABLE.cellPadX * 2, 4)));
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const h = TABLE.rowPadY * 2 + lines * TABLE.lineH + (row.sub ? TABLE.subH : 0);

    /* The break happens here, before a single cell of the row is drawn, and the
     * header comes with it. */
    if (!sheet.fits(h)) {
      sheet.newPage();
      header();
    }

    const top = sheet.need(h);
    let x = PAGE.margin;
    row.cells.forEach((_, i) => {
      const right = b.columns[i]?.align === "right";
      ink(doc, i === 0 ? INK.fg : INK.fg2);
      doc.setFont(FONT, i === 0 ? BOLD : REGULAR);
      doc.setFontSize(7.5);
      write(doc, wrapped[i], right ? x + widths[i] - TABLE.cellPadX : x + TABLE.cellPadX,
        top + TABLE.rowPadY + 3, right ? { align: "right" } : undefined);
      x += widths[i];
    });

    if (row.sub) {
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(6);
      ink(doc, INK.muted2);
      write(doc, row.sub, PAGE.margin + TABLE.cellPadX,
        top + TABLE.rowPadY + 3 + lines * TABLE.lineH);
    }

    doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
    doc.setLineWidth(0.15);
    doc.line(PAGE.margin, top + h - 0.6, PAGE.w - PAGE.margin, top + h - 0.6);
  }
  sheet.gap(RHYTHM.section);
}

function drawNote(doc: ReportJsPdf, sheet: Sheet, b: Extract<ReportPdfBlock, { kind: "note" }>) {
  doc.setFont(FONT, REGULAR);
  doc.setFontSize(6.5);
  const lines = doc.splitTextToSize(b.text, CONTENT_W);
  const top = sheet.need(lines.length * 3.4 + RHYTHM.inner);
  ink(doc, INK.muted2);
  write(doc, lines, PAGE.margin, top + 2.6);
}

function drawEmpty(doc: ReportJsPdf, sheet: Sheet, b: Extract<ReportPdfBlock, { kind: "empty" }>) {
  const top = sheet.need(24);
  doc.setFont(FONT, BOLD);
  doc.setFontSize(10);
  ink(doc, INK.muted);
  write(doc, b.title, PAGE.w / 2, top + 8, { align: "center" });
  doc.setFont(FONT, REGULAR);
  doc.setFontSize(8);
  ink(doc, INK.muted2);
  const lines = doc.splitTextToSize(b.body, CONTENT_W * 0.7);
  write(doc, lines, PAGE.w / 2, top + 14, { align: "center" });
  sheet.gap(RHYTHM.section);
}

function drawBlock(doc: ReportJsPdf, sheet: Sheet, block: ReportPdfBlock): void {
  switch (block.kind) {
    case "masthead": return drawMasthead(doc, sheet, block);
    case "stats": return drawStats(doc, sheet, block);
    case "table": return drawTable(doc, sheet, block);
    case "note": return drawNote(doc, sheet, block);
    case "empty": return drawEmpty(doc, sheet, block);
    // Drawn per page after the walk, never in sequence.
    case "footer": return;
  }
}

/** Walk the document onto the page.
 *
 * EXPORTED SEPARATELY FROM THE DOWNLOAD so a test can drive it with a recording
 * stub — no jsPDF, no browser, no binary snapshot to break on a library bump. */
export function renderReportPdf(doc: ReportJsPdf, model: ReportPdfDocument): void {
  doc.setProperties({ title: model.title, subject: model.subject });
  const sheet = new Sheet(doc);

  for (const block of model.blocks) drawBlock(doc, sheet, block);

  /* THE FOOTER IS PER PAGE, not per document — a three-page report says what it
   * is on every sheet, which is what the printed version does too. It is drawn
   * into the band `Sheet.bottom` has kept clear all along, so it can never land
   * on top of a table row. */
  const footer = model.blocks.find((b) => b.kind === "footer");
  if (footer && footer.kind === "footer") {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage?.(p);
      const y = PAGE.h - PAGE.margin + 2;
      doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
      doc.setLineWidth(0.2);
      doc.line(PAGE.margin, y - 4, PAGE.w - PAGE.margin, y - 4);
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(7);
      ink(doc, INK.muted2);
      write(doc, footer.left, PAGE.margin, y);
      write(doc, footer.right, PAGE.w - PAGE.margin, y, { align: "right" });
    }
  }
}

/* ------------------------------------------------------------------ the door */

/** Build and download the report as a PDF.
 *
 * READ-ONLY AND CACHE-FREE. It takes the document model the caller already
 * derived from the payload on screen, draws it, and hands the browser a file.
 * There is no request to the API, no query invalidation and no write of any
 * kind — and no file exists anywhere but in the viewer's downloads folder.
 *
 * jsPDF is imported dynamically so the library, and the font fetch it needs, are
 * paid for only by a session that actually exports.
 *
 * THE UNICODE FONT IS SET BEFORE ANY TEXT IS DRAWN. jsPDF's default is
 * Helvetica, and a single `text()` call made before that line would silently
 * emit WinAnsi mojibake for any Vietnamese in it. If the font throws, this
 * function throws with it and no document is produced at all. */
export async function exportReportPdf(model: ReportPdfDocument): Promise<void> {
  const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadFonts()]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  for (const font of fonts) {
    doc.addFileToVFS(font.vfs, font.base64);
    doc.addFont(font.vfs, FONT, font.style);
  }
  doc.setFont(FONT, REGULAR);

  renderReportPdf(doc as unknown as ReportJsPdf, model);
  doc.save(model.filename);
}
