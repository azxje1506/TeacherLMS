/* The PDF renderer — Gate 4.4E.
 *
 * ---- WHAT THIS FILE OWNS ---------------------------------------------------
 *
 * Millimetres, fonts, page breaks and ink. It walks the ordered block list from
 * review-pdf-document.ts and draws it onto A4. It decides NOTHING about what a
 * report contains: it never reads a `MonthlyReviewReport`, never sees a rating
 * before it has become a bar's width, and has no branch on "is there a parent"
 * or "was a register taken". Those questions were answered once, on the DTO.
 *
 * ---- WHY THE FONT IS FETCHED RATHER THAN BUNDLED ---------------------------
 *
 * jsPDF's fourteen standard fonts are WinAnsi — Latin-1 — and physically cannot
 * encode Vietnamese: `ế` (U+1EBF), `ữ` (U+1EEF), `ị` (U+1ECB) and `đ` (U+0111)
 * are all outside the encoding, and jsPDF answers with mojibake rather than an
 * error. So a Unicode TTF is embedded, and Roboto is the one this repo carries
 * (Apache-2.0, public/fonts/, verified to cover every Vietnamese codepoint the
 * app can produce).
 *
 * It is FETCHED FROM /fonts AT EXPORT TIME, not base64'd into a module. Two
 * weights inlined would put roughly half a megabyte of base64 into the client
 * bundle for a button most sessions never press. As a static asset it is cached
 * by the browser, costs the bundle nothing, and — because jsPDF itself is
 * dynamically imported below — none of this reaches a user who never exports.
 *
 * IF THE FONT DOES NOT LOAD, NOTHING IS PRODUCED. A PDF drawn in Helvetica
 * would open cleanly and be quietly wrong — a family's report with the child's
 * name mangled — so the failure is surfaced instead. Silence is not an option
 * here.
 *
 * ---- WHAT IT NEVER DOES ---------------------------------------------------
 *
 * No fetch to the API, no cache read or write, no Review mutation. Exporting is
 * a read of what is already on screen.
 */

import { REPORT_SECTION } from "@/lib/review-pdf-document";
import type {
  PdfBlock,
  ReviewPdfDocument,
} from "@/lib/review-pdf-document";

/* ------------------------------------------------------------------ the page */

/** A4 in millimetres, with the same 12mm margin `@media print { @page }` uses —
 * so the printed sheet and the exported file have the same gutter. */
const PAGE = { w: 210, h: 297, margin: 12 } as const;
const CONTENT_W = PAGE.w - PAGE.margin * 2;

/** The document's vertical rhythm, in millimetres — the file's half of the
 * spacing scale the sheet states in pixels.
 *
 * THE RELATIONSHIP IS WHAT MATTERS, not the numbers: a major section boundary is
 * larger than the gap between a title and the content it titles, which is larger
 * than the space inside a group. That ordering is what a reader uses to tell one
 * section from the next, and it is asserted rather than assumed.
 *
 * These are the same three steps the print stylesheet declares (16px / 8px /
 * 6-10px), expressed in this surface's own unit. They are deliberately NOT the
 * same literals: a millimetre on A4 and a CSS pixel in a page box are different
 * things, and sharing a number across them would be a false equivalence. What IS
 * shared is the ordering, and the fact that both documents rule a section title
 * — see `REPORT_SECTION`, which owns that decision for all three surfaces. */
const RHYTHM = {
  /** Between one top-level section and the next. */
  section: 4.5,
  /** From a section title's rule down to the content it titles. */
  title: 2.8,
  /** Inside a group — between the summary cards, and inside a card. */
  inner: 4,
} as const;

/** The document palette, matching `.report-sheet`'s light-locked tokens. The
 * sheet is a white page with dark ink under every theme, so these are literals
 * rather than anything read from the running app's CSS. */
const INK = {
  fg: [24, 24, 27],
  fg2: [63, 63, 70],
  muted: [113, 113, 122],
  muted2: [161, 161, 170],
  border: [232, 232, 236],
  border2: [239, 239, 241],
  accent: [209, 66, 66],
  green: [22, 163, 74],
  amber: [217, 119, 6],
  amberSoft: [255, 251, 235],
  white: [255, 255, 255],
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
 * so the caller can show it through the app's existing toast + `t`. */
export class ReviewPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPdfError";
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
      if (!res.ok) throw new ReviewPdfError("The report font could not be loaded.");
      const buffer = await res.arrayBuffer();
      /* A dev server that answers a missing asset with an HTML 404 page would
       * otherwise be embedded AS a font, and jsPDF would fail somewhere far from
       * here. A real TrueType file starts 0x00010000 and is not 12 bytes long. */
      if (buffer.byteLength < 1024) throw new ReviewPdfError("The report font could not be loaded.");
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

/** The renderer's whole state: which page, and how far down it. */
class Sheet {
  y = PAGE.margin;
  constructor(private readonly doc: JsPdfLike) {}

  /** Reserve `height`, starting a new page when it will not fit.
   *
   * THIS IS WHAT KEEPS A BLOCK WHOLE, which is the same promise
   * `break-inside:avoid` makes to the printed sheet: a block asks for its full
   * height before drawing a single line of it, so a skill bar row or a summary
   * line is never split across the fold. */
  need(height: number): number {
    if (this.y + height > PAGE.h - PAGE.margin) {
      this.doc.addPage();
      this.y = PAGE.margin;
    }
    const top = this.y;
    this.y += height;
    return top;
  }

  gap(mm: number) {
    this.y += mm;
  }
}

/* --------------------------------------------------------------- the drawing */

/** The narrow slice of jsPDF this renderer uses, named so the walk below can be
 * read (and unit-tested) without dragging the whole library's types in. */
interface JsPdfLike {
  addPage(): void;
  setFont(name: string, style: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(text: string | string[], x: number, y: number, opts?: { align?: string }): void;
  splitTextToSize(text: string, width: number): string[];
  getTextWidth(text: string): number;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  /** Relative-delta path. Used for the radar's rings and series polygon, because
   * only this can CLOSE and FILL an arbitrary shape — `line` cannot. */
  lines(deltas: number[][], x: number, y: number, scale?: number[], style?: string, closed?: boolean): void;
  circle(x: number, y: number, r: number, style?: string): void;
  addFileToVFS(name: string, data: string): void;
  addFont(file: string, name: string, style: string): void;
  setProperties(props: { title?: string; subject?: string }): void;
  save(filename: string): void;
  getNumberOfPages(): number;
}

type Rgb = readonly [number, number, number] | readonly number[];

function ink(doc: JsPdfLike, c: Rgb) {
  doc.setTextColor(c[0], c[1], c[2]);
}

/** Characters the embedded font has no glyph for, and what to print instead.
 *
 * THIS IS NOT A STYLE CHOICE. Roboto's static instance covers Latin, Latin
 * Extended and the whole of Vietnamese — verified against its cmap in
 * tests/review-pdf.test.ts — but it has no U+2192 RIGHTWARDS ARROW, and the
 * teacher-summary line writes "Listening · 3 → 5". A glyph the font lacks does
 * not fail: it prints as an empty notdef box, on a document that goes home to a
 * family. So the one character that would do that is spelled instead.
 *
 * THE SCREEN KEEPS THE REAL ARROW. This substitution belongs to the renderer,
 * not to the document model, so it applies to the file and changes nothing about
 * the report component or the printed page — both of which use the browser's own
 * font stack and have every glyph.
 *
 * The test asserts the OTHER direction too: that after this map is applied,
 * every character the document model can emit — over every branch, in Vietnamese
 * — has a glyph. A new unsupported character fails the suite rather than quietly
 * printing a box. */
const UNSUPPORTED: readonly (readonly [RegExp, string])[] = [
  [/→/g, "->"],
];

/** Draw text, always through the substitution above. Every call site in this
 * file goes through here, so a raw `doc.text` cannot creep back in. */
function write(doc: JsPdfLike, text: string | string[], x: number, y: number, opts?: { align?: string }) {
  doc.text(Array.isArray(text) ? text.map(pdfSafeText) : pdfSafeText(text), x, y, opts);
}

/** Every string is drawn through this. */
export function pdfSafeText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of UNSUPPORTED) out = out.replace(pattern, replacement);
  return out;
}

/** The four values `perfColor` can return, as the ink the document uses.
 *
 * WHY THIS EXISTS — AND IT IS NOT A SECOND PALETTE. `perfColor` in src/lib/calc.ts
 * answers with a CSS CUSTOM-PROPERTY REFERENCE: `var(--green)`, `var(--sky)`,
 * `var(--amber)` or `var(--accent)`. On screen the browser resolves those against
 * `.report-sheet`, which redeclares the whole palette so the document reads as a
 * white sheet under any theme. A PDF has no cascade to resolve them with, so the
 * renderer has to know the same four answers.
 *
 * The values below are `.report-sheet`'s OWN declarations, copied from
 * globals.css — the light-locked document palette, not a set chosen here. The
 * accent is the light default, which is also what the dark-theme override pins
 * the sheet to. tests/review-pdf.test.ts reads globals.css and fails if the two
 * ever disagree.
 *
 * WHAT THIS FIXES. Every one of these fell through the hex parser to the body
 * colour, so a 3.0 average drew its skill bars and its overall score in near
 * black — the screen said sky blue and the downloaded file said ink.
 *
 * THE MAP IS PINNED TO THE STYLESHEET, not to this file's judgement: test 45
 * reads `.report-sheet`'s own declarations out of globals.css and fails if a
 * value here drifts from one there, and tests 43-44 drive `perfColor` itself so
 * a changed threshold or a changed token fails before it can ship. */
const TOKEN_INK: Readonly<Record<string, readonly number[]>> = {
  "var(--green)": [22, 163, 74],   // .report-sheet --green:#16a34a
  "var(--sky)": [2, 132, 199],     // .report-sheet --sky:#0284c7
  "var(--amber)": [217, 119, 6],   // .report-sheet --amber:#d97706
  "var(--accent)": [209, 66, 66],  // the light default --accent:#d14242
  /* The section divider's token. It is here for the same reason the four bands
   * are: the renderer has no cascade to resolve a custom property with, and the
   * value is the sheet's own declaration rather than a line colour chosen for
   * the PDF. */
  "var(--border)": [232, 232, 236], // .report-sheet --border:#e8e8ec
  /* The radar web's ink — see RADAR_WEB. Here for the same reason as the rest:
   * the renderer has no cascade, and the value is the sheet's own declaration. */
  "var(--muted-2)": [161, 161, 170], // .report-sheet --muted-2:#a1a1aa
};

/** A CSS colour from the DTO, as PDF ink — THE ONE TOKEN-RESOLUTION HELPER.
 *
 * Every colour the renderer takes from the document model comes through here:
 * the overall tile's band, and each of the ten skill bars' own band. There is no
 * second lookup and no PDF-specific threshold anywhere in this file — the DTO
 * already decided which token a rating means, by calling the app's `perfColor`,
 * and this only turns that token into ink.
 *
 * Handles the tokens above and plain hex. Anything else falls back to the
 * document's body colour rather than to black-by-accident or to a throw: a
 * report must still print if the palette gains an `oklch()` one day — but a
 * value that SHOULD have been understood is a defect, not a fallback, which is
 * why the four `perfColor` answers are enumerated rather than guessed at.
 *
 * Exported so the parity tests can resolve a token the same way the renderer
 * does, rather than restating the map a third time. */
export function reportTokenInk(css: string | null): readonly number[] {
  if (!css) return INK.fg;
  const token = TOKEN_INK[css.trim()];
  if (token) return token;
  const hex = css.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  return INK.fg;
}

/** The four tone names a summary card can carry, as the document's ink.
 *
 * The names are the report model's — green for a strength, amber for a focus
 * area, sky for movement, muted for a non-finding — and they resolve here to the
 * SAME `.report-sheet` values the screen resolves them to through CSS. One
 * decision about which item is which colour, two colour spaces. */
const TONE_INK: Readonly<Record<string, readonly number[]>> = {
  green: INK.green,
  amber: INK.amber,
  sky: [2, 132, 199],   // .report-sheet --sky:#0284c7
  muted: INK.muted,
};

function namedColor(name: string | null): readonly number[] {
  return name === "green" ? INK.green : name === "amber" ? INK.amber : INK.fg;
}

/** Draw one block. Every branch is layout; none of them decides content. */
/** Where the section rule sits inside a heading's reserved band: under the
 * words, and clear of the content beneath by `RHYTHM.title`. */
const RULE_Y = 5.6;

function drawBlock(doc: JsPdfLike, sheet: Sheet, block: PdfBlock): void {
  switch (block.kind) {
    case "masthead": {
      const top = sheet.need(16);
      doc.setFont(FONT, BOLD);
      doc.setFontSize(14);
      ink(doc, INK.fg);
      write(doc, block.brand, PAGE.margin, top + 5);
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(9.5);
      ink(doc, INK.muted);
      write(doc, block.title, PAGE.margin, top + 10);

      doc.setFontSize(7.5);
      ink(doc, INK.muted2);
      write(doc, block.generatedLabel.toUpperCase(), PAGE.w - PAGE.margin, top + 4, { align: "right" });
      doc.setFont(FONT, BOLD);
      doc.setFontSize(10);
      ink(doc, INK.fg2);
      write(doc, block.generatedOn, PAGE.w - PAGE.margin, top + 9.5, { align: "right" });

      // The sheet's masthead rule, in the document accent.
      doc.setDrawColor(INK.accent[0], INK.accent[1], INK.accent[2]);
      doc.setLineWidth(0.6);
      doc.line(PAGE.margin, top + 14, PAGE.w - PAGE.margin, top + 14);
      sheet.gap(RHYTHM.section);
      return;
    }

    case "meta": {
      /* Two columns, mirroring the sheet's auto-fit grid at A4 width. */
      const colW = CONTENT_W / 2;
      const rows = Math.ceil(block.items.length / 2);
      const top = sheet.need(rows * 11);
      block.items.forEach((item, i) => {
        const x = PAGE.margin + (i % 2) * colW;
        const y = top + Math.floor(i / 2) * 11;
        doc.setFont(FONT, REGULAR);
        doc.setFontSize(7.5);
        ink(doc, INK.muted2);
        write(doc, item.label.toUpperCase(), x, y + 3);
        doc.setFont(FONT, item.strong ? BOLD : REGULAR);
        doc.setFontSize(10);
        ink(doc, INK.fg);
        write(doc, clip(doc, item.value, colW - 4), x, y + 8);
      });
      sheet.gap(RHYTHM.section);
      return;
    }

    case "tiles": {
      const gap = 3;
      const w = (CONTENT_W - gap * (block.tiles.length - 1)) / block.tiles.length;
      const h = 20;
      const top = sheet.need(h);
      block.tiles.forEach((tile, i) => {
        const x = PAGE.margin + i * (w + gap);
        doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, top, w, h, 2, 2, "S");
        doc.setFont(FONT, BOLD);
        doc.setFontSize(15);
        const c = tile.color ? reportTokenInk(tile.color) : INK.fg;
        ink(doc, c);
        write(doc, tile.value, x + w / 2, top + 8.5, { align: "center" });
        doc.setFont(FONT, REGULAR);
        doc.setFontSize(8);
        ink(doc, INK.muted);
        write(doc, clip(doc, tile.label, w - 4), x + w / 2, top + 13.5, { align: "center" });
        if (tile.detail) {
          doc.setFontSize(7);
          ink(doc, INK.muted2);
          write(doc, clip(doc, tile.detail, w - 4), x + w / 2, top + 17.5, { align: "center" });
        }
      });
      sheet.gap(RHYTHM.section);
      return;
    }

    case "heading": {
      /* ---- A TOP-LEVEL SECTION, WITH THE SAME RULE THE SHEET DRAWS ---------
       * The screen puts a hairline under every section title; the file used to
       * draw the words and stop, so the same document had section boundaries in
       * one place and not the other. `REPORT_SECTION` is where that decision
       * lives now, and the ink comes from the one token helper — never a line
       * colour picked for the PDF.
       *
       * THE RHYTHM MIRRORS THE SHEET's: the title sits close to the rule, the
       * rule closer to the content than to the section above it. */
      const top = sheet.need(REPORT_SECTION.divider ? RULE_Y + RHYTHM.title : 7);
      doc.setFont(FONT, BOLD);
      doc.setFontSize(8.5);
      ink(doc, INK.fg);
      write(doc, block.text.toUpperCase(), PAGE.margin, top + 3.6);
      if (REPORT_SECTION.divider) {
        const rule = reportTokenInk(REPORT_SECTION.dividerToken);
        doc.setDrawColor(rule[0], rule[1], rule[2]);
        doc.setLineWidth(0.2);
        doc.line(PAGE.margin, top + RULE_Y, PAGE.w - PAGE.margin, top + RULE_Y);
      }
      return;
    }

    case "skills": {
      /* ---- ONE ROW: bars left, radar right --------------------------------
       * The preview composes these side by side and the file now does too. The
       * split is 56/44 of the content column, which gives the ten labelled bars
       * a readable track and the radar enough room for a 24mm web plus its ten
       * labels without either crossing the gutter. */
      const gap = 6;
      const barsW = (CONTENT_W - gap) * 0.56;
      const radarW = CONTENT_W - gap - barsW;
      const radius = Math.min(radarW / 2 - RADAR_LABEL_RING, 26);
      const radarH = (radius + RADAR_LABEL_RING) * 2;
      const barsH = block.bars.length * SKILL_ROW_H;
      const rowH = Math.max(barsH, radarH);

      /* GRACEFUL DEGRADATION, and only if the row genuinely cannot fit: a page
       * that cannot hold the taller half stacks them instead of clipping. On A4
       * portrait this branch is unreachable — the row is ~70mm — but a smaller
       * page or a longer skill list must not silently lose the radar. */
      if (rowH > PAGE.h - PAGE.margin * 2) {
        drawSkillBars(doc, sheet, block.bars, PAGE.margin, CONTENT_W);
        sheet.gap(RHYTHM.inner);
        const top = sheet.need(radarH);
        drawRadar(doc, block.axes, PAGE.margin + CONTENT_W / 2, top + radarH / 2, radius);
        sheet.gap(RHYTHM.section);
        return;
      }

      const top = sheet.need(rowH);
      /* Both halves are drawn at absolute coordinates inside the reserved band,
       * so neither advances the cursor past the other — that is what makes it a
       * row rather than two blocks that happen to be adjacent. Each is centred
       * in the band, as the preview's `alignItems:center` does. */
      drawBarsAt(doc, block.bars, PAGE.margin, top + (rowH - barsH) / 2, barsW);
      drawRadar(doc, block.axes, PAGE.margin + barsW + gap + radarW / 2, top + rowH / 2, radius);
      sheet.gap(RHYTHM.section);
      return;
    }

    case "summary": {
      /* ---- THE SUMMARY, AS A ROW OF CARDS ----------------------------------
       *
       * It was a stack of `label ……… value` rows with the value clipped, then
       * with the value wrapped. Both read badly the moment a tie named eight
       * skills: a long right-aligned run against a short left label, and a block
       * whose height grew with the tie.
       *
       * The sheet now gives each item a card in an auto-fit grid, and so does
       * this: the cards divide the content column, the label and the rating pill
       * share the top line, and the skill names wrap inside the card beneath
       * them. NOTHING IS CLIPPED — a card grows downward and the row takes the
       * tallest card's height, so a nine-way tie prints in full.
       *
       * WHY A ROW RATHER THAN A STACK ON PAPER: three cards side by side cost
       * ONE row's height however long the lists are, which is what keeps a short
       * report inside its single-page budget. The screen's grid collapses to one
       * column on a phone; A4 is never that narrow, so the file always has the
       * room for the row the preview shows at report width. */
      const gap = RHYTHM.inner;
      const n = Math.max(1, block.items.length);
      const cardW = (CONTENT_W - gap * (n - 1)) / n;
      const padX = 3;
      const padY = 3.5;
      const innerW = cardW - padX * 2;

      /* MEASURED BEFORE ANYTHING IS DRAWN, so the row reserves the height of its
       * tallest card and can move to the next page whole. */
      doc.setFont(FONT, BOLD);
      doc.setFontSize(8.5);
      const wrapped = block.items.map((item) =>
        doc.splitTextToSize(pdfSafeText(item.items.join(", ")), innerW));
      const bodyLines = Math.max(1, ...wrapped.map((w) => w.length));
      const cardH = padY * 2 + 4 + bodyLines * 4.2;
      const top = sheet.need(cardH);

      block.items.forEach((item, i) => {
        const x = PAGE.margin + i * (cardW + gap);
        const tone = TONE_INK[item.tone] ?? INK.muted;

        doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, top, cardW, cardH, 2, 2, "S");

        // The label, in the item's own tone — the caption the sheet draws.
        doc.setFont(FONT, BOLD);
        doc.setFontSize(6.5);
        ink(doc, tone);
        write(doc, clip(doc, item.label.toUpperCase(), innerW - 10), x + padX, top + padY + 2.4);

        // The figure, in its own corner, so it can be found without reading.
        if (item.detail) {
          doc.setFontSize(7.5);
          ink(doc, tone);
          write(doc, item.detail, x + cardW - padX, top + padY + 2.6, { align: "right" });
        }

        // The names, wrapped, at the card's full inner width.
        doc.setFont(FONT, item.muted ? REGULAR : BOLD);
        doc.setFontSize(8.5);
        ink(doc, item.muted ? INK.muted : INK.fg2);
        wrapped[i].forEach((line, l) => {
          write(doc, line, x + padX, top + padY + 7.4 + l * 4.2);
        });
      });
      sheet.gap(RHYTHM.section);
      return;
    }

    case "proseRow": {
      /* Two columns, the preview's own paired grid. Measured first so the row
       * takes the height of the taller side and neither is clipped. */
      const gap = 8;
      const colW = (CONTENT_W - gap) / 2;
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(9);
      const left = doc.splitTextToSize(pdfSafeText(block.left.text), colW);
      const right = doc.splitTextToSize(pdfSafeText(block.right.text), colW);
      const rowH = 5 + Math.max(left.length, right.length) * 4.6;

      /* A pair too tall for any page falls back to one after the other, so a
       * very long strengths note cannot clip its neighbour. */
      if (rowH > PAGE.h - PAGE.margin * 2) {
        for (const col of [block.left, block.right]) {
          drawBlock(doc, sheet, { kind: "prose", title: col.title, titleColor: col.titleColor, text: col.text });
        }
        return;
      }

      const top = sheet.need(rowH);
      [[block.left, left, PAGE.margin], [block.right, right, PAGE.margin + colW + gap]].forEach(
        ([col, lines, x]) => {
          const c = col as { title: string; titleColor: string | null };
          doc.setFont(FONT, BOLD);
          doc.setFontSize(8.5);
          ink(doc, namedColor(c.titleColor));
          write(doc, c.title, x as number, top + 3.5);
          doc.setFont(FONT, REGULAR);
          doc.setFontSize(9);
          ink(doc, INK.fg2);
          write(doc, lines as string[], x as number, top + 8.4);
        },
      );
      sheet.gap(RHYTHM.section);
      return;
    }

    case "prose": {
      if (block.title) {
        const top = sheet.need(5);
        doc.setFont(FONT, BOLD);
        doc.setFontSize(8.5);
        const c = namedColor(block.titleColor);
        ink(doc, c);
        write(doc, block.title, PAGE.margin, top + 3.5);
      }
      drawParagraph(doc, sheet, block.text, PAGE.margin, CONTENT_W);
      sheet.gap(RHYTHM.section);
      return;
    }

    case "callout": {
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(pdfSafeText(block.text), CONTENT_W - 10);
      const h = 12 + lines.length * 4.6;
      const top = sheet.need(h);
      doc.setFillColor(INK.amberSoft[0], INK.amberSoft[1], INK.amberSoft[2]);
      doc.setDrawColor(INK.border[0], INK.border[1], INK.border[2]);
      doc.setLineWidth(0.2);
      doc.roundedRect(PAGE.margin, top, CONTENT_W, h, 2, 2, "FD");
      doc.setFont(FONT, BOLD);
      doc.setFontSize(8.5);
      ink(doc, INK.fg);
      write(doc, block.title, PAGE.margin + 5, top + 6);
      doc.setFont(FONT, REGULAR);
      doc.setFontSize(9);
      ink(doc, INK.fg2);
      write(doc, lines, PAGE.margin + 5, top + 11.5);
      sheet.gap(RHYTHM.section);
      return;
    }

    case "footer": {
      /* Drawn on every page at the end of the walk — see renderReviewPdf. */
      return;
    }
  }
}

/** Wrapped body text, page-breaking line by line so a long comment flows onto a
 * second page instead of running off the first. */
function drawParagraph(doc: JsPdfLike, sheet: Sheet, text: string, x: number, width: number) {
  doc.setFont(FONT, REGULAR);
  doc.setFontSize(9);
  ink(doc, INK.fg2);
  /* `pre-wrap` on screen: the teacher's own line breaks are theirs, so each is
   * wrapped independently rather than collapsed into one run. */
  for (const para of text.split("\n")) {
    const lines = para === "" ? [""] : doc.splitTextToSize(pdfSafeText(para), width);
    for (const line of lines) {
      const top = sheet.need(4.6);
      write(doc, line, x, top + 3.4);
    }
  }
}

/** One line of text, truncated with an ellipsis if it will not fit — the paper
 * equivalent of the sheet's `text-overflow:ellipsis` on its single-line cells. */
function clip(doc: JsPdfLike, text: string, width: number): string {
  text = pdfSafeText(text);
  if (doc.getTextWidth(text) <= width) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(out + "…") > width) out = out.slice(0, -1);
  return out + "…";
}

/** One skill bar's row height, and the ring the radar's labels need outside its
 * web. Shared so the skills row can measure both halves before drawing either. */
const SKILL_ROW_H = 6;
const RADAR_LABEL_RING = 9;

/** Ten labelled bars, at an explicit position and width.
 *
 * POSITIONED RATHER THAN CURSOR-DRIVEN, so the skills row can place it beside
 * the radar in one reserved band. `drawSkillBars` is the cursor-driven wrapper,
 * used only by the stacking fallback. */
function drawBarsAt(
  doc: JsPdfLike,
  rows: { label: string; rating: number; color: string }[],
  x: number,
  y: number,
  width: number,
): void {
  const labelW = Math.min(30, width * 0.34);
  const valueW = 6;
  const trackW = width - labelW - valueW - 4;
  rows.forEach((row, i) => {
    /* EACH BAR TAKES ITS OWN RATING'S BAND. The token was resolved once, on the
     * DTO, by the same `perfColor` the screen used; all this does is turn that
     * token into ink. */
    const fill = reportTokenInk(row.color);
    const top = y + i * SKILL_ROW_H;
    doc.setFont(FONT, REGULAR);
    doc.setFontSize(8);
    ink(doc, INK.fg2);
    write(doc, clip(doc, row.label, labelW - 2), x, top + 3.6);

    const trackX = x + labelW;
    doc.setFillColor(INK.border2[0], INK.border2[1], INK.border2[2]);
    doc.roundedRect(trackX, top + 1.9, trackW, 2, 1, 1, "F");
    /* The bar's own geometry — a fraction of five, clamped, exactly as the
     * on-screen SkillBar computes its width. Presentation, not a domain figure. */
    const pct = Math.max(0, Math.min(1, row.rating / 5));
    if (pct > 0) {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.roundedRect(trackX, top + 1.9, trackW * pct, 2, 1, 1, "F");
    }
    doc.setFont(FONT, BOLD);
    ink(doc, INK.fg);
    write(doc, String(row.rating), x + width, top + 3.6, { align: "right" });
  });
}

/** The cursor-driven form, for the fallback that stacks the two halves. */
function drawSkillBars(
  doc: JsPdfLike,
  sheet: Sheet,
  rows: { label: string; rating: number; color: string }[],
  x: number,
  width: number,
): void {
  const top = sheet.need(rows.length * SKILL_ROW_H);
  drawBarsAt(doc, rows, x, top, width);
}

/** One axis vertex, as a fraction of the full radius.
 *
 * THE SCALE IS THE CHART COMPONENT'S: rating over five, clamped, with an unrated
 * axis (`null`) collapsing to the centre so the shape still closes. Exported so
 * the parity test can check the geometry against `report.radar` directly rather
 * than trusting that the drawing looks about right. */
export function radarVertexFraction(rating: number | null): number {
  return Math.max(0, Math.min(5, rating ?? 0)) / 5;
}

/** The ten-axis radar.
 *
 * ---- WHY THIS WAS REDRAWN, TWICE -------------------------------------------
 *
 * The first version was geometrically correct and visually absent. It drew the
 * web in `--border` at 0.15mm — a 9% grey hairline on white — and the series as
 * a thin UNFILLED outline, at a 22mm radius. Human verification reported the
 * radar as missing, and it effectively was.
 *
 * The second version fixed that and overshot: a filled polygon painted OVER the
 * web, which read as a solid green shape rather than the screen's tinted chart.
 * The tint was arithmetically right — 20% green over white — and it still looked
 * heavy, because the thing that makes the screen version read as a CHART is not
 * the alpha value, it is that the rings and spokes stay VISIBLE THROUGH the
 * fill. An opaque fill, however pale, buries them.
 *
 * ---- WHAT jsPDF CAN AND CANNOT DO ------------------------------------------
 *
 * It cannot reproduce CSS alpha compositing here: a translucent fill needs an
 * ExtGState this renderer has no other use for, and pretending otherwise would
 * be the wrong kind of clever. So the translucency is APPROXIMATED, with two
 * changes that together get close on white A4:
 *
 *   1. a LIGHTER tint — 12% green over white rather than 20%, which is what a
 *      20% fill actually looks like on screen once the white card shows through
 *      the antialiasing and the web crosses it; and
 *   2. the DRAW ORDER IS INVERTED. The fill goes down FIRST, then the web and
 *      the spokes are drawn on top of it, then the outline, then the dots. The
 *      grid therefore reads through the interior exactly as it does on screen,
 *      which is what stops the shape looking solid.
 *
 * The outline keeps its full-strength green at 0.6mm and the vertex dots keep
 * theirs, so the month's shape is if anything MORE legible than before — it is
 * only the interior that got quieter. */
const RADAR_FILL = [227, 244, 233] as const; // #16a34a at 12% over #ffffff

/** The radar web's ink and weights.
 *
 * ---- WHY THE WEB WAS INVISIBLE, MEASURED ----------------------------------
 *
 * The rings were drawn in `--border-2` (#efeff1) and the spokes in `--border`
 * (#e8e8ec) — the tokens the on-screen SVG uses. Both are screen hairline
 * colours, meant for a 1px line on a light-grey UI with a backlight behind it.
 * On a white sheet, under the 12% green tint, they have no contrast at all:
 *
 *   ring  --border-2 vs the tint it crosses   0.4 relative luminance
 *   ring  --border-2 vs white paper          15.9
 *   spoke --border   vs the tint              7.3
 *   spoke --border   vs white paper          22.7
 *   series outline   vs the tint            113.0   <- the dominant mark
 *
 * A difference of 0.4 is not faint, it is identical — channel by channel the
 * ring is +12 red, MINUS 5 green, +8 blue against the fill, so inside the
 * polygon the rings were if anything lighter than what they crossed. Every one
 * of the fifteen paths was being emitted correctly; none of them could be seen.
 *
 * ---- THE FIX IS INK, NOT GEOMETRY AND NOT WEIGHT -------------------------
 *
 * `--muted-2` (#a1a1aa) is the report sheet's own light-grey token — the one
 * step between a hairline border and body text — and it reads through the tint
 * at 77.9. It stays firmly subordinate: the green outline is 113 from the tint,
 * a saturated colour against a neutral grey, and 3-4x the stroke width. So the
 * month's shape still dominates and the web is background structure, which is
 * what it is for. Nothing here is 'made dark' — the weights below are FINER
 * than the 0.25mm the invisible version used.
 *
 * The stroke widths stay at or above 0.15mm, the point below which a PDF
 * viewer or a printer starts rounding a line to whatever it feels like. */
const RADAR_WEB = {
  /** The five rings: the 1-5 scale itself, so the marginally stronger of the two. */
  ring: 0.18,
  /** The ten spokes: ten of them, so finer, or the centre would read as a blot. */
  spoke: 0.15,
  /** Both in the sheet's own light grey, resolved through the one token helper. */
  token: "var(--muted-2)",
} as const;
const RADAR_LINE = INK.green;

function drawRadar(
  doc: JsPdfLike,
  axes: { label: string; rating: number | null }[],
  cx: number,
  cy: number,
  r: number,
) {
  const n = axes.length;
  if (n === 0 || r <= 0) return;
  const at = (i: number, radius: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  };
  /** A closed ring or series polygon, as jsPDF's relative-delta path. */
  const polygon = (radiusOf: (i: number) => number, style: string) => {
    const points = Array.from({ length: n }, (_, i) => at(i, radiusOf(i)));
    const deltas = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    doc.lines(deltas, points[0][0], points[0][1], [1, 1], style, true);
  };
  const seriesRadius = (i: number) => r * radarVertexFraction(axes[i].rating);

  // 1. THE TINT GOES DOWN FIRST, with no stroke — the web is drawn over it.
  doc.setFillColor(RADAR_FILL[0], RADAR_FILL[1], RADAR_FILL[2]);
  polygon(seriesRadius, "F");

  // 2. The five-ring web and the ten spokes, ON TOP, so they show through.
  const grid = reportTokenInk(RADAR_WEB.token);
  doc.setDrawColor(grid[0], grid[1], grid[2]);
  doc.setLineWidth(RADAR_WEB.ring);
  for (let ring = 1; ring <= 5; ring++) polygon(() => (r * ring) / 5, "S");
  doc.setLineWidth(RADAR_WEB.spoke);
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, r);
    doc.line(cx, cy, x, y);
  }

  // 3. The month's own outline, at full strength, closed by construction.
  doc.setDrawColor(RADAR_LINE[0], RADAR_LINE[1], RADAR_LINE[2]);
  doc.setLineWidth(0.6);
  polygon(seriesRadius, "S");

  // 4. A dot per rated axis, as the chart draws them.
  doc.setFillColor(RADAR_LINE[0], RADAR_LINE[1], RADAR_LINE[2]);
  for (let i = 0; i < n; i++) {
    if (axes[i].rating === null) continue;
    const [x, y] = at(i, seriesRadius(i));
    doc.circle(x, y, 0.7, "F");
  }

  /* Labels sit outside the web, aligned away from the centre so a long one grows
   * outward rather than across the chart. */
  doc.setFont(FONT, REGULAR);
  doc.setFontSize(7);
  ink(doc, INK.muted);
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, r + 5);
    const align = Math.abs(x - cx) < 1.5 ? "center" : x > cx ? "left" : "right";
    write(doc, axes[i].label, x, y + 1.2, { align });
  }
}

/* ------------------------------------------------------------------ the walk */

/** Draw the whole document. Exported for tests, which drive it with a recording
 * stub instead of jsPDF — so the walk is checkable without a browser. */
export function renderReviewPdf(doc: JsPdfLike, model: ReviewPdfDocument): void {
  doc.setProperties({ title: model.title, subject: model.subject });
  const sheet = new Sheet(doc);
  const footer = model.blocks.find((b) => b.kind === "footer");

  for (const block of model.blocks) drawBlock(doc, sheet, block);

  /* THE FOOTER IS PER PAGE, not per document — a two-page report says what it is
   * on both sheets, which is what the printed version does too. */
  if (footer && footer.kind === "footer") {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      // The renderer walks pages it already created; nothing is added here.
      setPage(doc, p);
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

/** jsPDF's page cursor. Split out so the recording stub in tests can ignore it
 * without the walk needing to know whether it is talking to the real library. */
function setPage(doc: JsPdfLike, page: number): void {
  (doc as unknown as { setPage?: (p: number) => void }).setPage?.(page);
}

/* ------------------------------------------------------------------ the door */

/** Build and download the report as a PDF.
 *
 * READ-ONLY AND CACHE-FREE. It takes the document model the caller already
 * derived from the report on screen, draws it, and hands the browser a file.
 * There is no request to the API, no query invalidation, no form reset and no
 * Review write — exporting a dirty edit leaves it exactly as dirty as it was.
 *
 * jsPDF is imported dynamically so the library, and the font fetch it needs, are
 * paid for only by a session that actually exports. */
export async function exportReviewPdf(model: ReviewPdfDocument): Promise<void> {
  const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadFonts()]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  for (const font of fonts) {
    doc.addFileToVFS(font.vfs, font.base64);
    doc.addFont(font.vfs, FONT, font.style);
  }
  /* THE UNICODE FONT IS SET BEFORE ANY TEXT IS DRAWN. jsPDF's default is
   * Helvetica, and a single `text()` call made before this line would silently
   * emit WinAnsi mojibake for any Vietnamese in it. */
  doc.setFont(FONT, REGULAR);

  renderReviewPdf(doc as unknown as JsPdfLike, model);
  doc.save(model.filename);
}
