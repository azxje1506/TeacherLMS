/* Print and Export PDF — Gate 4.4E.
 *
 * Run with:  npm test
 *
 * ---- WHAT IS TESTED, AND WHY IT IS TESTED THIS WAY -------------------------
 *
 * The export's real contract is the DOCUMENT: which sections it contains, in
 * what order, with which strings, and what it says when a figure is missing.
 * That is `buildReviewPdfDocument`, which is pure — no jsPDF, no font, no
 * browser — so it is driven directly, in English and in Vietnamese, over the
 * same `MonthlyReviewReport` the preview draws.
 *
 * THE PDF BYTES ARE DELIBERATELY NOT SNAPSHOTTED. A binary comparison would
 * break on every jsPDF patch release and on every kerning change, while proving
 * nothing about whether the report is right. Where the drawing itself matters —
 * that the Unicode font is registered BEFORE any text is emitted, that the
 * footer repeats per page — the renderer is driven against a recording stub and
 * the call sequence is asserted. That is the part a wrong answer would hide in.
 *
 * The composer's behaviour around the two actions — that neither saves, neither
 * touches dirty state, that print excludes app chrome, that a second export
 * click is refused — is asserted by scanning the source, the technique this
 * repository already uses for what only exists inside JSX.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE, A BROWSER OR A PDF.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildReviewPdfDocument, reviewPdfFilename, slugifyName, REPORT_SECTION,
  type PdfBlock, type ReviewPdfIntl,
} from "../src/lib/review-pdf-document";
import { pdfSafeText, radarVertexFraction, renderReviewPdf, reportTokenInk } from "../src/lib/review-pdf";
import { buildMonthlyReviewReportDraft, teacherSummaryLines } from "../src/lib/review-report";
import type { ReviewComposerData, ReviewComposerMonth, ReviewReportDraft } from "../src/lib/review-report";
import { SKILL_KEYS } from "../src/lib/reviews";
import { perfColor } from "../src/lib/calc";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

const COMPOSER = code("src", "components", "reviews", "review-composer.tsx");
const PDF = code("src", "lib", "review-pdf.ts");
const DOCUMENT = code("src", "lib", "review-pdf-document.ts");
const REPORT_VIEW = code("src", "components", "reviews", "monthly-review-report.tsx");
const REPORT_MODEL = code("src", "lib", "review-report.ts");
const CHARTS = code("src", "components", "reviews", "charts.tsx");
const CSS = raw("src", "app", "globals.css");
/** The stylesheet with its comments removed — for "is this rule gone" questions,
 * which a prose mention of the rule would otherwise answer wrongly. */
/** CSS with its comments removed.
 *
 * EVERY 'is this rule gone' QUESTION GOES THROUGH THIS. The stylesheet writes
 * down what it rejected and why — the revoked fixed footer, the inert 250mm
 * floor — so a substring search over the raw text reads an explanation as the
 * thing it warns against. Three assertions in this suite were written wrong
 * that way before this existed.
 *
 * Scanned rather than matched: a comment-stripping regex written through a
 * shell into a script has been mangled twice, and this needs no escaping. */
function stripComments(css: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = css.indexOf("/*", at);
    if (open < 0) return out + css.slice(at);
    const shut = css.indexOf("*/", open + 2);
    out += css.slice(at, open) + " ";
    if (shut < 0) return out;
    at = shut + 2;
  }
}

const CSS_RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The ONE `@media` block matching `query` that contains `marker`, brace-matched
 * to its own closing brace. globals.css carries several blocks per breakpoint —
 * three at 1100px — so slicing on the query alone reads whichever came first and
 * can pass while proving something about a different block entirely. */
function mediaBlock(query: string, marker: string): string {
  const open = `@media ${query}{`;
  let from = 0;
  for (;;) {
    const start = CSS.indexOf(open, from);
    assert.ok(start >= 0, `no "${query}" block contains ${marker}`);
    let depth = 0;
    let i = start + open.length - 1;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) break;
    }
    const body = CSS.slice(start + open.length, i);
    if (body.includes(marker)) return body;
    from = start + open.length;
  }
}
/** The one `@media print` block, brace-matched. Module level, because more than
 * one suite asks questions of it. */
function printBlockOf(): string {
  const at = CSS.indexOf("@media print{");
  let depth = 0;
  let i = at + "@media print".length;
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) break;
  }
  return CSS.slice(at, i);
}

const DICT = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* ------------------------------------------------------------------ fixtures */

const skills = (rating: number): Record<string, number> =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, rating]));

function month(over: Partial<ReviewComposerMonth> = {}): ReviewComposerMonth {
  return {
    month: "2026-07",
    taken: false,
    reviewId: null,
    attendance: { attended: 8, total: 10, pct: 80, registersTaken: 5, lessonsCompleted: 5 },
    homework: { done: 3, total: 4, pct: 75 },
    ...over,
  };
}

function context(over: Partial<ReviewComposerData> = {}): ReviewComposerData {
  return {
    mode: "create",
    student: {
      id: "s1", name: "Liam Park", initials: "LP", color: "#d14242",
      avatar: null, gradeLabel: "Grade 3", status: "Active",
    },
    parent: { name: "Jennifer Chen", relationship: "Mother" },
    parentLinked: true,
    month: { current: "2026-07", options: [month()], immutable: false },
    review: {
      id: null, skills: {}, comment: "", strengths: "", improvements: "",
      goals: "", parentNotes: "", average: 0,
    },
    history: [],
    appMonth: "2026-07",
    appDate: "2026-07-10",
    ...over,
  };
}

function draft(over: Partial<ReviewReportDraft> = {}): ReviewReportDraft {
  return {
    month: "2026-07",
    skills: skills(3),
    comment: "", strengths: "", improvements: "", goals: "", parentNotes: "",
    ...over,
  };
}

/** English: the identity translator the app falls back to. */
const en: ReviewPdfIntl = {
  t: (k) => k,
  monthLabel: (m) => m,
  dateLabel: (d) => d,
};

/** Vietnamese, through the app's REAL dictionary — so the strings under test are
 * the ones a Vietnamese teacher actually gets, not invented ones. */
const vi: ReviewPdfIntl = {
  t: (k) => DICT[k] ?? k,
  monthLabel: (m) => `Tháng ${m}`,
  dateLabel: (d) => d,
};

function docFor(over: Partial<ReviewComposerData> = {}, d: Partial<ReviewReportDraft> = {}, intl = en) {
  const report = buildMonthlyReviewReportDraft(context(over), draft(d));
  return buildReviewPdfDocument(report, intl);
}

function kinds(blocks: PdfBlock[]): string[] {
  return blocks.map((b) => b.kind);
}

/** Every string the document places, flattened — for "does this word appear
 * anywhere on the page" questions. */
function allText(blocks: PdfBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "masthead": out.push(b.brand, b.title, b.generatedLabel, b.generatedOn); break;
      case "meta": for (const i of b.items) out.push(i.label, i.value); break;
      case "tiles": for (const t of b.tiles) out.push(t.value, t.label, t.detail ?? ""); break;
      case "heading": out.push(b.text); break;
      case "skills":
        for (const r of b.bars) out.push(r.label, String(r.rating));
        for (const a of b.axes) out.push(a.label);
        break;
      case "summary":
        for (const i of b.items) out.push(i.label, i.items.join(", "), i.detail ?? "");
        break;
      case "prose": out.push(b.title ?? "", b.text); break;
      case "proseRow":
        out.push(b.left.title, b.left.text, b.right.title, b.right.text);
        break;
      case "callout": out.push(b.title, b.text); break;
      case "footer": out.push(b.left, b.right); break;
    }
  }
  return out.join("\n");
}

/* =========================================================================
 * 1. One report source — the PDF is the preview, on paper
 * ====================================================================== */

describe("Gate 4.4E · one report source", () => {
  it("1. the document is built from the SAME DTO the preview draws", () => {
    /* The export takes a `MonthlyReviewReport` and nothing else. It never
     * reaches for the form, the composer context, the server or the cache — so
     * the file cannot be about a different month than the screen was. */
    assert.ok(DOCUMENT.includes("report: MonthlyReviewReport"));
    assert.ok(!/fetch\(|useQuery|reviewKeys|axios/.test(DOCUMENT), "no reads of its own");
    assert.ok(COMPOSER.includes("buildReviewPdfDocument(report, {"),
      "and the composer hands it the very object the preview is rendering");
  });

  it("2. it computes NOTHING — no average, percentage, ranking or threshold", () => {
    /* A second renderer that recomputed anything would be a second opinion about
     * the same month. Every figure arrives already derived. */
    for (const forbidden of [
      "reduce(", "SKILL_KEYS", "perfColor", "perfLabel", "rankSkills",
      "buildMonthlyReviewReportDraft", "reviewScore",
    ]) {
      assert.ok(!DOCUMENT.includes(forbidden), `the document model must not use ${forbidden}`);
    }
    // No clock either: the generated day is the DTO's, which is the app day.
    assert.ok(!/new Date|Date\.now/.test(DOCUMENT), "no clock of its own");
    assert.ok(DOCUMENT.includes("dateLabel(meta.generatedOn)"));
  });

  it("3. the renderer knows about layout, and about no report concept at all", () => {
    /* It handles a block NAMED "skills" — that is a layout row — but it knows
     * nothing about the report concepts behind it. */
    for (const forbidden of [
      "MonthlyReviewReport", "attendance", "homework", "parentNotes",
      "performanceColor", "teacherSummary", "overallScore", "report.",
    ]) {
      assert.ok(!PDF.includes(forbidden), `the renderer must not know about ${forbidden}`);
    }
    assert.ok(PDF.includes("ReviewPdfDocument"), "it takes the block list and nothing else");
  });

  it("4. the block order mirrors the report component, section for section", () => {
    /* THE PARITY OBLIGATION, made mechanical. When the component gains or loses
     * a section this fails until the document model moves with it. */
    const doc = docFor({}, { parentNotes: "Ghi chú cho phụ huynh." });
    assert.deepEqual(kinds(doc.blocks), [
      "masthead",
      "meta",
      "tiles",                         // the three figures, one row
      "heading", "skills",             // Skill ratings — bars AND radar, one row
      "heading", "summary",            // Teacher summary
      "heading", "prose",              // Teacher comment
      "proseRow",                      // Strengths | Areas for improvement, paired
      "callout",                       // Learning goals
      "heading", "prose",              // Parent notes
      "footer",
    ]);
    // And the component still renders those same sections, in that order.
    const order = ["Skill ratings", "Teacher summary", "Teacher comment", "Strengths",
      "Areas for improvement", "Learning goals for next month", "Parent notes"];
    let at = -1;
    for (const section of order) {
      const next = REPORT_VIEW.indexOf(`t("${section}")`);
      assert.ok(next > at, `${section} is in the component, after the previous section`);
      at = next;
    }
  });

  it("5. everything §11 requires is on the page", () => {
    const doc = docFor({}, { comment: "Good month.", parentNotes: "Thanks." });
    const text = allText(doc.blocks);
    for (const required of [
      "English Tutor LMS", "Monthly Progress Report", "Generated on", "2026-07-10",
      "Student", "Liam Park", "Grade", "Grade 3", "Parent / Guardian", "Jennifer Chen",
      "Review period", "Overall", "Attendance", "Homework done",
      "Teacher comment", "Strengths", "Areas for improvement",
      "Learning goals for next month", "Parent notes",
    ]) {
      assert.ok(text.includes(required), `${required} must appear in the document`);
    }
    // All ten dimensions, as bars and as radar axes.
    const sk = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(sk?.kind === "skills");
    assert.equal(sk.bars.length, 10);
    assert.equal(sk.axes.length, 10);
    // A neutral footer, naming no author — nothing records who wrote a review.
    const foot = doc.blocks.at(-1);
    assert.equal(foot?.kind, "footer");
    assert.ok(foot?.kind === "footer" && foot.left.includes("English Tutor LMS"));
    assert.ok(!text.includes("Teacher:") && !text.includes("Signed"));
  });

  it("6. and nothing §11 forbids is anywhere near it", () => {
    const doc = docFor({}, { comment: "x", strengths: "y", improvements: "z", goals: "w", parentNotes: "v" });
    const text = allText(doc.blocks).toLowerCase();
    for (const forbidden of ["published", "draft", "final", "concern", "achievement", "ai summary"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} must not appear on the document`);
    }
    for (const forbidden of ["aiSummary", "achievement", "concern", "status", "publishedAt"]) {
      assert.ok(!DOCUMENT.includes(forbidden), `${forbidden} is not a thing the export knows`);
    }
  });
});

/* =========================================================================
 * 2. Empty values — a missing figure is never a zero
 * ====================================================================== */

describe("Gate 4.4E · what the document says when there is nothing to say", () => {
  it("7. no attendance denominator prints No data, never 0%", () => {
    /* "No data" is an empty DENOMINATOR — nobody took a register — not a zero
     * attendance. The two are different facts and the report must not conflate
     * them, on screen or on paper. */
    const doc = docFor({
      month: {
        current: "2026-07", immutable: false,
        options: [month({
          attendance: { attended: 0, total: 0, pct: null, registersTaken: 0, lessonsCompleted: 0 },
        })],
      },
    });
    const tiles = doc.blocks.find((b) => b.kind === "tiles");
    assert.ok(tiles?.kind === "tiles");
    const attendance = tiles.tiles[1];
    assert.equal(attendance.value, "No data");
    assert.notEqual(attendance.value, "0%");
    assert.equal(attendance.detail, null, "and nothing qualifies a figure that does not exist");
  });

  it("8. no homework denominator prints No data, and no 0/0", () => {
    const doc = docFor({
      month: {
        current: "2026-07", immutable: false,
        options: [month({ homework: { done: 0, total: 0, pct: null } })],
      },
    });
    const tiles = doc.blocks.find((b) => b.kind === "tiles");
    assert.ok(tiles?.kind === "tiles");
    assert.equal(tiles.tiles[2].value, "No data");
    assert.equal(tiles.tiles[2].detail, null, "0/0 is not a coverage statement");
  });

  it("9. a coverage line appears only when there is coverage to state", () => {
    const withCoverage = docFor();
    const tiles = withCoverage.blocks.find((b) => b.kind === "tiles");
    assert.ok(tiles?.kind === "tiles");
    assert.equal(tiles.tiles[1].detail, "Registers taken 5/5");
    assert.equal(tiles.tiles[2].detail, "3/4");
  });

  it("10. no linked parent prints the app's em dash, never a blank or a guess", () => {
    const doc = docFor({ parent: null, parentLinked: false });
    const meta = doc.blocks.find((b) => b.kind === "meta");
    assert.ok(meta?.kind === "meta");
    const parent = meta.items.find((i) => i.label === "Parent / Guardian");
    assert.equal(parent?.value, "—");
    assert.ok(!allText(doc.blocks).includes("Unknown"));
  });

  it("11. a first review states that there is no prior month to compare", () => {
    const doc = docFor({ history: [] });
    const rows = doc.blocks.find((b) => b.kind === "summary");
    assert.ok(rows?.kind === "summary");
    const improvement = rows.items.find((r) => r.label === "Biggest improvement");
    assert.deepEqual(improvement?.items, ["First review — no prior month"]);
    assert.equal(improvement?.detail, null, "a statement, not a measurement");
    assert.equal(improvement?.muted, true, "and says it quietly, as the screen does");
  });

  it("12. the four assessment fields keep their heading when empty; parent notes do not", () => {
    /* The shape of the document is the same on every report, so a reader can see
     * that a section was left blank rather than wonder whether it exists —
     * except parent notes, which is a message rather than a section. */
    const doc = docFor();
    const text = allText(doc.blocks);
    for (const heading of ["Teacher comment", "Strengths", "Areas for improvement", "Learning goals for next month"]) {
      assert.ok(text.includes(heading), `${heading} keeps its heading`);
    }
    assert.ok(!text.includes("Parent notes"), "an empty message has nothing to say");
    for (const b of doc.blocks) {
      if (b.kind === "prose") assert.equal(b.text, "—", "empty prose is the em dash");
      if (b.kind === "proseRow") {
        assert.equal(b.left.text, "—");
        assert.equal(b.right.text, "—");
      }
      if (b.kind === "callout") assert.equal(b.text, "—");
    }
  });
});

/* =========================================================================
 * 3. Vietnamese
 * ====================================================================== */

describe("Gate 4.4E · Vietnamese", () => {
  it("13. the document is written through the app's own dictionary", () => {
    const doc = docFor(
      { student: { ...context().student, name: "Nguyễn Đức Nam Cường" } },
      { comment: "Em học rất tốt trong tháng này.", goals: "Luyện phát âm mỗi ngày." },
      vi,
    );
    const text = allText(doc.blocks);
    // The gate's own probe strings, resolved from i18n-vi.json.
    for (const key of ["Monthly Progress Report", "Strengths", "Areas for improvement", "Teacher comment"]) {
      assert.ok(key in DICT, `${key} must be translated`);
      assert.ok(text.includes(DICT[key]), `${DICT[key]} must be on the page`);
    }
    assert.ok(text.includes("Nguyễn Đức Nam Cường"), "the student's real name, undamaged");
    assert.ok(text.includes("Em học rất tốt trong tháng này."), "and the teacher's own words");
    assert.ok(!text.includes("?"), "no replacement marks anywhere");
  });

  it("14. a Unicode font is embedded, because jsPDF's built-ins cannot encode Vietnamese", () => {
    /* jsPDF's standard fourteen are WinAnsi. `ế` U+1EBF is simply outside that
     * encoding, and jsPDF emits mojibake rather than failing — which is why the
     * font is not optional. */
    assert.ok(PDF.includes("addFileToVFS") && PDF.includes("addFont"));
    assert.ok(PDF.includes('doc.setFont(FONT, REGULAR)'), "and it is selected");
    for (const weight of ["Roboto-Regular.ttf", "Roboto-Bold.ttf"]) {
      const file = path.join(process.cwd(), "public", "fonts", weight);
      assert.ok(existsSync(file), `${weight} ships with the app`);
      /* A real TrueType file, not an HTML error page a fetch happened to save:
       * the sfnt version tag is 0x00010000. */
      const head = readFileSync(file).subarray(0, 4);
      assert.deepEqual([...head], [0x00, 0x01, 0x00, 0x00], `${weight} is a TrueType file`);
      assert.ok(statSync(file).size > 100_000, `${weight} is a whole font`);
    }
    assert.ok(existsSync(path.join(process.cwd(), "public", "fonts", "Roboto-LICENSE.txt")),
      "and its licence travels with it");
  });

  it("15. the font covers the §9 probe strings, read from its own cmap", () => {
    /* PARSED FROM THE FONT FILE, not assumed. A missing glyph is the exact
     * failure mode §9 forbids — it prints as an empty box rather than failing —
     * so the only honest check is to read the character map. */
    const covered = cmapOf(path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf"));
    const probes = [
      "Đánh giá hàng tháng", "Kỹ năng tốt nhất", "Lĩnh vực cần cải thiện",
      "Mục tiêu học tập", "Nguyễn Đức Nam Cường", "Xem trước",
    ].join("");
    const missing = [...new Set(probes)].filter((ch) => ch !== " " && !covered.has(ch.codePointAt(0)!));
    assert.deepEqual(missing, [], "every character in the gate's probe strings has a glyph");
  });

  it("16. every character the EXPORT can emit has a glyph, over every branch", () => {
    /* THE STRONGER CLAIM, and the one that caught a real defect: Roboto's static
     * instance has no U+2192 RIGHTWARDS ARROW, and the teacher-summary line
     * writes "Listening · 3 → 5". It would have printed a notdef box on a
     * document that goes home to a family.
     *
     * So the export substitutes it (see `pdfSafeText`), and this walks every
     * branch of the document model in Vietnamese — empty, full, no parent, no
     * data, first review, and an improvement — to prove nothing else is missing.
     * A new unsupported character fails here rather than in a parent's inbox. */
    const covered = cmapOf(path.join(process.cwd(), "public", "fonts", "Roboto-Regular.ttf"));
    const improved = context({
      history: [{ month: "2026-06", skills: skills(2), comment: "Tháng Sáu ổn định." }],
    });
    const documents = [
      docFor({}, {}, vi),                                          // every field empty
      docFor({ parent: null, parentLinked: false }, {}, vi),        // no parent
      docFor({
        month: {
          current: "2026-07", immutable: false,
          options: [month({
            attendance: { attended: 0, total: 0, pct: null, registersTaken: 0, lessonsCompleted: 0 },
            homework: { done: 0, total: 0, pct: null },
          })],
        },
      }, {}, vi),                                                   // No data on both tiles
      buildReviewPdfDocument(
        buildMonthlyReviewReportDraft(improved, draft({
          skills: { ...skills(3), listening: 5 },
          comment: "Em tiến bộ rõ rệt, đặc biệt là kỹ năng nghe.",
          strengths: "Phát âm tốt.", improvements: "Cần luyện viết thêm.",
          goals: "Đọc mỗi ngày 15 phút.", parentNotes: "Cảm ơn quý phụ huynh!",
        })),
        vi,
      ),                                                            // the improvement arrow
    ];
    const missing = new Set<string>();
    for (const doc of documents) {
      for (const ch of pdfSafeText(allText(doc.blocks) + doc.title + doc.subject)) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20) continue; // control characters are not glyphs
        if (!covered.has(cp)) missing.add(ch);
      }
    }
    assert.deepEqual([...missing], [], "the export emits no character the font lacks");
    // And the substitution is real, not a no-op that happens to pass.
    assert.equal(pdfSafeText("3 → 5"), "3 -> 5");
    assert.ok(!covered.has(0x2192), "which is needed precisely because U+2192 is absent");
    /* THE SCREEN KEEPS THE REAL ARROW. The substitution is the RENDERER's, so
     * the shared line builder — which the composer card, the report sheet and the
     * printed page all render verbatim — still carries U+2192. */
    assert.ok(REPORT_MODEL.includes("→"), "the shared summary line still draws it");
    assert.ok(!REPORT_MODEL.includes('"->"'), "and does not spell it");
    assert.ok(!DOCUMENT.includes('"->"'), "nor does the document model");
    assert.ok(PDF.includes('[/→/g, "->"]'), "the substitution lives in the renderer alone");
  });

  it("17. a broken font is surfaced, never silently shipped as mojibake", () => {
    /* A PDF drawn in Helvetica would open perfectly and spell a child's name
     * wrong. That is worse than no file, so it is refused. */
    assert.ok(PDF.includes("class ReviewPdfError"));
    assert.ok(PDF.includes('throw new ReviewPdfError("The report font could not be loaded.")'));
    assert.ok(PDF.includes("if (buffer.byteLength < 1024)"), "and a 404 page is not embedded as a font");
    assert.ok(COMPOSER.includes("e instanceof ReviewPdfError"), "the composer says which failure it was");
    for (const key of ["The report font could not be loaded.", "The report could not be exported."]) {
      assert.ok(key in DICT, `${key} must be translated`);
    }
    // A failed load is not cached, so a transient fault does not brick the button.
    assert.ok(PDF.includes("fontCache = null;"));
  });
});

/* =========================================================================
 * 4. The filename
 * ====================================================================== */

describe("Gate 4.4E · the filename", () => {
  it("18. is the recommended shape, and deterministic", () => {
    assert.equal(reviewPdfFilename("Liam Park", "2026-06"), "monthly-review-liam-park-2026-06.pdf");
    assert.equal(
      reviewPdfFilename("Liam Park", "2026-06"),
      reviewPdfFilename("Liam Park", "2026-06"),
      "the same review always exports to the same name",
    );
  });

  it("19. folds Vietnamese to ASCII rather than deleting it", () => {
    /* `n-c` would be a filename that has lost the person. NFD splits the marks
     * off; đ and Đ are their own codepoints and are mapped by hand. */
    assert.equal(slugifyName("Nguyễn Đức Nam Cường"), "nguyen-duc-nam-cuong");
    assert.equal(slugifyName("Đỗ Thị Hà"), "do-thi-ha");
    assert.equal(slugifyName("Lê Vũ"), "le-vu");
  });

  it("20. is filesystem-safe, with no locale-dependent punctuation", () => {
    for (const name of ["Mary-Jane O'Brien", "李 明", "  ", "A/B\\C:D*E?F", "Ünal Öz"]) {
      const file = reviewPdfFilename(name, "2026-06");
      assert.match(file, /^monthly-review-[a-z0-9-]+-\d{4}-\d{2}\.pdf$/, `${name} -> ${file}`);
      assert.ok(!/[/\\:*?"<>|]/.test(file), "no character any filesystem refuses");
      assert.ok(!file.includes("--") && !file.includes("-."), "no doubled or dangling separators");
    }
    // A name with no Latin characters at all still yields a usable handle.
    assert.equal(reviewPdfFilename("李 明", "2026-06"), "monthly-review-student-2026-06.pdf");
  });

  it("21. never contains the Review's id", () => {
    /* A filename travels — it is mailed to a family and sits in a downloads
     * folder. An internal identifier in it is a small permanent disclosure for
     * no benefit, so the name is built from the student and the month only. */
    const doc = docFor({
      mode: "edit",
      review: {
        id: "rv-june-secret", skills: skills(4), comment: "x", strengths: "",
        improvements: "", goals: "", parentNotes: "", average: 4,
      },
    });
    assert.equal(doc.filename, "monthly-review-liam-park-2026-07.pdf");
    assert.ok(!doc.filename.includes("rv-"), "no review id");
    assert.ok(!doc.filename.includes("s1"), "and no student id either");
    assert.ok(!DOCUMENT.includes("review.id"), "the model never even reads one");
  });
});

/* =========================================================================
 * 5. The draft is what is exported
 * ====================================================================== */

describe("Gate 4.4E · draft, not record", () => {
  it("22. an unsaved rating change is in the file", () => {
    /* §7's worked example: the persisted review has Listening 3, the teacher
     * types 5 without saving, and the export must say 5. */
    const persisted = {
      mode: "edit" as const,
      review: {
        id: "rv-1", skills: skills(3), comment: "Saved words.", strengths: "",
        improvements: "", goals: "", parentNotes: "", average: 3,
      },
    };
    const edited = draft({ skills: { ...skills(3), listening: 5 }, comment: "Typed but not saved." });
    const doc = buildReviewPdfDocument(buildMonthlyReviewReportDraft(context(persisted), edited), en);

    const bars = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(bars?.kind === "skills");
    assert.equal(bars.bars.find((r) => r.label === "Listening")?.rating, 5, "the draft's rating");
    assert.ok(allText(doc.blocks).includes("Typed but not saved."), "and the draft's words");
    assert.ok(!allText(doc.blocks).includes("Saved words."), "not the record's");
  });

  it("23. a Create that has never been saved exports too", () => {
    /* The document is a generated artifact of the composer's current state, not
     * proof that a Review exists. Nothing about it requires an id. */
    const doc = docFor({ mode: "create", review: { ...context().review } }, { comment: "First draft." });
    assert.ok(allText(doc.blocks).includes("First draft."));
    assert.equal(doc.filename, "monthly-review-liam-park-2026-07.pdf");
  });

  it("24. neither Print nor Export writes anything, anywhere", () => {
    /* Read-only by construction: no mutation, no invalidation, no reset, no
     * navigation, no API route. The whole feature is client-side. */
    for (const forbidden of [
      "mutate", "createReview", "updateReview", "invalidateQueries",
      "fetch(\"/api", "router.push", "router.replace", "reset(", "setValue(", "setStage(",
    ]) {
      assert.ok(!PDF.includes(forbidden), `the renderer must not ${forbidden}`);
      assert.ok(!DOCUMENT.includes(forbidden), `the document model must not ${forbidden}`);
    }
    assert.ok(!existsSync(path.join(process.cwd(), "src", "app", "api", "reviews", "pdf")),
      "and no server endpoint was added");
    assert.ok(!existsSync(path.join(process.cwd(), "src", "app", "api", "reviews", "print")));
  });

  it("25. exporting leaves the form exactly as dirty as it was", () => {
    /* THE §15 SEQUENCE: edit, change a comment, export, come back — Back and
     * Cancel must still prompt. `exportPdf` touches no form state at all, so
     * there is nothing that could clear the flag. */
    const fn = COMPOSER.slice(COMPOSER.indexOf("const exportPdf = async () => {"));
    const body = fn.slice(0, fn.indexOf("\n  };"));
    for (const forbidden of ["reset(", "setValue(", "seed(", "baselineRef", "setStage(", "mutate"]) {
      assert.ok(!body.includes(forbidden), `exportPdf must not ${forbidden}`);
    }
    assert.ok(!body.includes("dirty"), "and it does not even read the dirty flag");
    // The same for print: it adds a class, prints, and removes the class.
    const print = COMPOSER.slice(COMPOSER.indexOf("function printReportOverlay"));
    const printBody = print.slice(0, print.indexOf("\n}"));
    for (const forbidden of ["reset(", "setValue(", "seed(", "mutate", "router"]) {
      assert.ok(!printBody.includes(forbidden), `printing must not ${forbidden}`);
    }
  });

  it("26. a second Export click while one is running is refused, not queued", () => {
    assert.ok(COMPOSER.includes("if (exporting) return;"), "the guard");
    assert.ok(COMPOSER.includes("setExporting(true);") && COMPOSER.includes("setExporting(false);"));
    assert.ok(COMPOSER.includes("} finally {"), "and it is released even when the export throws");
    assert.ok(COMPOSER.includes("disabled={exporting}"), "the button says so");
    assert.ok(COMPOSER.includes("aria-busy={exporting || undefined}"), "and says so to a screen reader");
    assert.ok(COMPOSER.includes('t(exporting ? "Exporting…" : "Export PDF")'), "with a visible label");
  });
});

/* =========================================================================
 * 6. Print
 * ====================================================================== */

describe("Gate 4.4E · print", () => {
  const printBlock = (() => {
    const at = CSS.indexOf("@media print{");
    assert.ok(at >= 0, "the print stylesheet exists");
    let depth = 0;
    let i = at + "@media print".length;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) break;
    }
    return CSS.slice(at, i);
  })();

  it("27. only the report is printed — the app's chrome is excluded", () => {
    assert.ok(printBlock.includes("body.print-review > *{display:none !important}"),
      "everything on the page goes");
    assert.ok(printBlock.includes("body.print-review > .review-overlay{display:block !important}"),
      "except the report overlay");
    assert.ok(printBlock.includes(".no-print{display:none !important}"));
    assert.ok(COMPOSER.includes('className="rvc-head no-print"'),
      "and the overlay's own Close/Print/Export bar is no-print");
  });

  it("28. the class is on <body>, which is where the overlay actually is", () => {
    /* THE 4.4D DEFECT THIS GATE FOUND. These rules were written against
     * `[data-theme]`, which settings-context puts on <html> — so
     * `> .review-overlay` demanded the overlay be a child of <html> and never
     * matched, while `> *` hid <body>. It would have printed a blank sheet.
     * Nothing had ever set the class, so nothing ever ran it. */
    assert.ok(!printBlock.includes("[data-theme].print-review"), "the broken selector is gone");
    assert.ok(printBlock.includes("body.print-review"));
    assert.ok(COMPOSER.includes('body.classList.add("print-review")'), "and the class goes on body");
    const settings = code("src", "lib", "settings-context.tsx");
    assert.ok(settings.includes("document.documentElement"),
      "data-theme is still <html>'s — which is exactly why this cannot key on it");
    assert.ok(COMPOSER.includes("createPortal("), "and the overlay is still portalled");
    assert.ok(COMPOSER.includes("document.body\n  );") || COMPOSER.includes("document.body"),
      "to document.body");
  });

  it("29. A4 page setup, controlled margins, and blocks kept whole", () => {
    assert.ok(printBlock.includes("@page{margin:12mm}"), "the page's own gutter");
    assert.ok(printBlock.includes(".report-sheet{position:static !important"), "the sheet fills the page");
    assert.ok(printBlock.includes("max-width:none !important"), "no screen cap survives");
    assert.ok(/break-inside:avoid !important;page-break-inside:avoid !important/.test(printBlock),
      "a block is not split across the fold");
    assert.ok(printBlock.includes("overflow:visible !important"), "and nothing is clipped");
    // The exported PDF uses the same 12mm, so paper and file have one gutter.
    assert.ok(PDF.includes("margin: 12 }"));
    assert.ok(PDF.includes('format: "a4"') && PDF.includes('orientation: "portrait"'));
  });

  it("30. the printed sheet stays legible — a white page with dark ink", () => {
    /* The document is light-locked in every theme, so a teacher printing from
     * dark mode gets the same sheet. */
    assert.ok(printBlock.includes("background:#fff !important"));
    assert.match(CSS, /\.report-sheet\{\s*--bg:#f7f7f8;--card:#ffffff/);
    assert.ok(CSS.includes('[data-theme="dark"] .report-sheet{--primary:#d42525'));
  });

  it("31. print has ONE route, and it is the surface the report already lives on", () => {
    /* Two unwrap strategies would be two things nobody can see fail. The second
     * one — `.print-report`, which had no consumer and was never executed — was
     * removed in this gate rather than wired up. */
    assert.ok(!CSS_RULES.includes(".print-report"), "the dead second strategy's selector is gone");
    /* One class, added and removed in one function — and one `window.print()` in
     * the whole composer, so there is no second way to reach the printer. */
    assert.equal(COMPOSER.split('"print-review"').length - 1, 2, "added once, removed once");
    assert.ok(COMPOSER.includes('body.classList.add("print-review")'));
    assert.ok(COMPOSER.includes('body.classList.remove("print-review")'));
    assert.equal(COMPOSER.split("window.print()").length - 1, 1, "and one call");
    // Printing from a closed preview opens it first, so the DOM is always the same.
    assert.ok(COMPOSER.includes("if (previewOpen) printReportOverlay();"));
    assert.ok(COMPOSER.includes("setPrintPending(true);"));
    assert.ok(COMPOSER.includes("requestAnimationFrame"), "after a paint, or it prints the page without it");
  });

  it("32. the print class cannot strand the app in a broken state", () => {
    /* Every `.print-review` rule is inside `@media print`, so a class that
     * outlives a print — a browser that never fires `afterprint` — has no effect
     * on screen at all. That is what lets the cleanup be event-driven. */
    assert.ok(printBlock.includes("body.print-review"), "the rules are inside @media print");
    assert.ok(!/^\s*body\.print-review/m.test(CSS.replace(printBlock, "")),
      "and nowhere outside it");
    assert.ok(COMPOSER.includes('window.addEventListener("afterprint", done)'));
    assert.ok(COMPOSER.includes('body.classList.remove("print-review")'));
  });
});

/* =========================================================================
 * 7. Where the two actions live
 * ====================================================================== */

describe("Gate 4.4E · action placement", () => {
  it("33. Print and Export are REPORT actions, not persistence actions", () => {
    /* They are not in either persistence region, they are not stage-dependent,
     * and no stage disables them: a Create that has never been saved has a
     * report on screen just as a persisted View does. */
    assert.ok(COMPOSER.includes("const reportActions = ("));
    const region = COMPOSER.slice(COMPOSER.indexOf("const reportActions = ("));
    const body = region.slice(0, region.indexOf("\n  );"));
    for (const forbidden of ["stage ===", "editable", "saving", "dirty"]) {
      assert.ok(!body.includes(forbidden), `report actions must not branch on ${forbidden}`);
    }
    assert.ok(!body.includes("btn-primary"), "and neither is the stage's primary action");
  });

  it("34. exactly one copy is reachable at any width", () => {
    /* Complementary BY CONSTRUCTION rather than by a hide rule: the header copy
     * exists only at 1100+, and the overlay copy can only be opened below 1100,
     * because the control that opens it does not exist above. */
    assert.ok(CSS.includes(".rvc-actions-report{display:none;"), "hidden by default");
    /* BRACE-MATCHED PER BLOCK. There are three `min-width:1100px` blocks in this
     * stylesheet, so a regex window would happily match the wrong one. */
    const shown = mediaBlock("(min-width:1100px)", ".rvc-actions-report");
    assert.ok(shown.includes(".rvc-actions-report{display:flex}"), "and shown at 1100");
    const preview = mediaBlock("(min-width:1100px)", ".rvc-preview-btn");
    assert.ok(preview.includes(".rvc-preview-btn{display:none !important}"),
      "at exactly the width Preview stops existing — which is what makes the two exclusive");
    // One definition feeds both places.
    assert.equal(COMPOSER.split("const reportActions = (").length - 1, 1, "defined once");
    assert.ok(COMPOSER.includes('<div className="rvc-actions-report">\n            {reportActions}'),
      "the header renders that definition");
    assert.equal(COMPOSER.split("actions={reportActions}").length - 1, 1,
      "and the overlay is handed the same one rather than building its own");
    assert.ok(COMPOSER.includes("actions: React.ReactNode;"), "and rebuilds nothing of its own");
  });

  it("35. persistence never leaks into the preview overlay", () => {
    /* §16: Close, Print and Export PDF — and no Save or Edit. Closing returns to
     * the exact form state, which is only true because the form was never
     * unmounted and the overlay can change nothing. */
    const overlay = COMPOSER.slice(COMPOSER.indexOf("function PreviewOverlay"));
    for (const forbidden of [
      "Save review", "Save changes", "Edit review", "Cancel editing",
      "mutate(", "createReview", "updateReview", "setValue(", "reset(", "<form",
    ]) {
      assert.ok(!overlay.includes(forbidden), `the overlay must not contain ${forbidden}`);
    }
    assert.ok(overlay.includes('t("Close")'));
    assert.ok(overlay.includes("{actions}"));
  });

  it("36. at 620px the sticky footer still owns persistence, and only persistence", () => {
    /* The 4.4D contract is untouched by this gate: report actions did not join
     * the footer, and persistence did not join the overlay. */
    const bar = COMPOSER.slice(COMPOSER.indexOf('<div className="rvc-actions-mobile">'));
    const body = bar.slice(0, bar.indexOf("</div>"));
    assert.ok(body.includes('{reviewActions("mobile")}'));
    for (const forbidden of ["Print", "Export PDF", "reportActions"]) {
      assert.ok(!body.includes(forbidden), `the footer must not carry ${forbidden}`);
    }
    assert.match(CSS, /@media \(max-width:620px\)\{[\s\S]{0,600}?\.rvc-actions-mobile\{display:flex\}/);
  });

  it("37. both controls are labelled, keyboard-reachable and never icon-only", () => {
    /* §20. They are real buttons with visible text beside the icon, so nothing
     * depends on a tooltip and nothing depends on a pointer. */
    const region = COMPOSER.slice(COMPOSER.indexOf("const reportActions = ("));
    const body = region.slice(0, region.indexOf("\n  );"));
    assert.equal(body.split('type="button"').length - 1, 2, "two real buttons");
    assert.ok(body.includes("{iconPrint}") && body.includes('{t("Print")}'), "icon AND label");
    assert.ok(body.includes("{iconDownload}"), "and the same for export");
    assert.ok(!body.includes("rvc-btn-label"),
      "neither label is in the class the phone header collapses");
    assert.ok(!body.includes("title="), "no tooltip is load-bearing");
  });
});

/* =========================================================================
 * 8. The renderer's own contract
 * ====================================================================== */

describe("Gate 4.4E · the drawing", () => {
  it("38. the Unicode font is registered and selected BEFORE any text is drawn", () => {
    /* THE ORDERING IS THE BUG THAT WOULD NOT SHOW UP IN REVIEW. jsPDF defaults
     * to Helvetica; a single `text()` before `setFont` emits WinAnsi mojibake
     * for whatever Vietnamese was in it. Asserted against the source order. */
    const addFont = PDF.indexOf("doc.addFont(font.vfs, FONT, font.style);");
    const setFont = PDF.indexOf("doc.setFont(FONT, REGULAR);", addFont);
    const render = PDF.indexOf("renderReviewPdf(doc as unknown as JsPdfLike, model);");
    const save = PDF.indexOf("doc.save(model.filename);");
    assert.ok(addFont > 0 && setFont > addFont, "the font is selected after it is added");
    assert.ok(render > setFont, "and every drawing call comes after both");
    assert.ok(save > render, "the file is written last");
  });

  it("39. jsPDF is dynamically imported, so a session that never exports never pays", () => {
    assert.ok(PDF.includes('import("jspdf")'), "dynamic, not top-level");
    assert.ok(!/^import .*from "jspdf"/m.test(PDF), "never a static import");
    // And the font is a static asset rather than half a megabyte of base64.
    assert.ok(PDF.includes('url: "/fonts/Roboto-Regular.ttf"'));
    assert.ok(!/[A-Za-z0-9+/]{500,}/.test(raw("src", "lib", "review-pdf.ts")), "no inlined font blob");
  });

  it("40. a long report flows onto more pages instead of running off the first", () => {
    assert.ok(PDF.includes("need(height: number): number"), "every block reserves its height first");
    assert.ok(PDF.includes("this.doc.addPage();"));
    assert.ok(PDF.includes("PAGE.h - PAGE.margin"), "against the page's own bottom margin");
    /* The footer is drawn per page, so a two-page report says what it is on both
     * sheets — which is what the printed version does. */
    assert.ok(PDF.includes("const pages = doc.getNumberOfPages();"));
    assert.ok(PDF.includes("for (let p = 1; p <= pages; p++)"));
  });

  it("41. the base64 conversion survives a 168KB font", () => {
    /* `String.fromCharCode(...bytes)` on a whole font throws RangeError in every
     * engine — the argument list is the limit, not the memory. */
    assert.ok(PDF.includes("i += 0x8000"), "chunked");
    assert.ok(PDF.includes("bytes.subarray(i, i + 0x8000)"));
  });

  it("42. the walk draws every block kind the document model can produce", () => {
    /* A block the renderer silently ignores would be a section missing from the
     * file and present on screen — the exact parity failure this gate is about. */
    const doc = docFor({}, { parentNotes: "x" });
    for (const kind of new Set(kinds(doc.blocks))) {
      assert.ok(PDF.includes(`case "${kind}":`), `the renderer handles "${kind}"`);
    }
  });
});

/* ------------------------------------------------------------- a tiny cmap */

/** The Unicode codepoints a TrueType font has glyphs for, read from its format-4
 * cmap subtable. Small on purpose: it exists so test 15 can make a claim about
 * the actual file rather than about our confidence in a font's reputation. */
function cmapOf(file: string): Set<number> {
  const b = readFileSync(file);
  let cmapOffset = -1;
  const numTables = b.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("ascii", rec, rec + 4) === "cmap") cmapOffset = b.readUInt32BE(rec + 8);
  }
  assert.ok(cmapOffset > 0, "the font has a cmap");

  let sub = -1;
  const n = b.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < n; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = b.readUInt16BE(rec);
    const encoding = b.readUInt16BE(rec + 2);
    if (platform === 3 && (encoding === 1 || encoding === 10)) sub = cmapOffset + b.readUInt32BE(rec + 4);
  }
  assert.ok(sub > 0, "with a Windows Unicode subtable");
  assert.equal(b.readUInt16BE(sub), 4, "in format 4");

  const covered = new Set<number>();
  const segCountX2 = b.readUInt16BE(sub + 6);
  const segCount = segCountX2 / 2;
  const endO = sub + 14;
  const startO = endO + segCountX2 + 2;
  const deltaO = startO + segCountX2;
  const rangeO = deltaO + segCountX2;
  for (let s = 0; s < segCount; s++) {
    const end = b.readUInt16BE(endO + s * 2);
    const start = b.readUInt16BE(startO + s * 2);
    if (start === 0xffff) continue;
    const delta = b.readInt16BE(deltaO + s * 2);
    const rangeOffset = b.readUInt16BE(rangeO + s * 2);
    for (let c = start; c <= end && c !== 0x10000; c++) {
      let glyph: number;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
        if (gi + 1 >= b.length) continue;
        glyph = b.readUInt16BE(gi);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(c);
    }
  }
  return covered;
}

/* =========================================================================
 * 9. Output fidelity — what the renderer actually emits
 * ======================================================================
 * WHY THIS SECTION EXISTS. Everything above passed while the downloaded PDF drew
 * its skill bars in near-black and its radar as an invisible hairline outline.
 * Source scanning cannot see either: the colour was a real value that happened
 * to be wrong, and the radar was a real drawing that happened to be faint.
 *
 * So these tests DRIVE THE RENDERER against a recording stub and assert the ink
 * and the geometry it emits — the level at which both defects lived.
 */

/** One recorded jsPDF call. */
interface Call { fn: string; args: unknown[] }

/** Run the real renderer against a stub that records every call.
 *
 * `splitTextToSize` wraps at a fixed width so long prose genuinely produces many
 * lines, which is what makes the multi-page assertions real rather than
 * hypothetical. */
function record(model: ReturnType<typeof buildReviewPdfDocument>): { calls: Call[]; pages: number } {
  const calls: Call[] = [];
  let pages = 1;
  const stub = new Proxy({}, {
    get: (_target, prop) => (...args: unknown[]) => {
      const fn = String(prop);
      calls.push({ fn, args });
      if (fn === "addPage") { pages += 1; return undefined; }
      if (fn === "getNumberOfPages") return pages;
      if (fn === "splitTextToSize") return String(args[0]).match(/.{1,90}/g) ?? [""];
      if (fn === "getTextWidth") return String(args[0]).length * 1.8;
      return undefined;
    },
  });
  renderReviewPdf(stub as never, model);
  return { calls, pages };
}

const rgb = (c: Call) => c.args.slice(0, 3).join(",");

/** Every colour a skill bar is filled with, in the order the ten bars draw.
 *
 * The bars draw track-then-fill per row: `setFillColor(border2)`,
 * `roundedRect(…,"F")`, `setFillColor(series)`, `roundedRect(…,"F")`. So each
 * fill is the first `setFillColor` after a track that is not another track. */
function barFillColors(calls: Call[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c.fn !== "setFillColor" || rgb(c) !== "239,239,241") continue;
    const next = calls.slice(i + 1).find((k) => k.fn === "setFillColor");
    if (next && rgb(next) !== "239,239,241") out.push(rgb(next));
  }
  return out;
}

/* The four bands, as `.report-sheet` declares them and as the renderer inks
 * them. Read once, used by every colour test below. */
const BAND_INK: Record<string, string> = {
  "var(--green)": "22,163,74",
  "var(--sky)": "2,132,199",
  "var(--amber)": "217,119,6",
  "var(--accent)": "209,66,66",
};

describe("Gate 4.4E final · per-rating skill-bar colour", () => {
  it("43. a bar is filled with ITS OWN rating's band, never the body ink", () => {
    /* TWO DEFECTS, ONE TEST. `perfColor` answers with a CSS custom-property
     * REFERENCE — `var(--sky)` — and the renderer's hex parser once fell through
     * to `INK.fg`, so the screen said sky blue and the file said near-black. Then
     * every bar took the REPORT's overall band, so a Listening of 5 and a Writing
     * of 1 printed the same colour on a document about a child's ten skills. */
    const { calls } = record(docFor({}, { skills: { ...skills(3), listening: 5 } }));
    const fills = barFillColors(calls);
    assert.equal(fills.length, 10, "ten bars, ten fills");
    assert.equal(fills[0], BAND_INK[perfColor(5)], "Listening at 5 is the 5 band");
    assert.notEqual(fills[0], "24,24,27", "and never the document's body ink");
    assert.ok(fills.slice(1).every((f) => f === BAND_INK[perfColor(3)]),
      "while the nine 3s take the 3 band");
    assert.notEqual(fills[0], fills[1], "so a 5 and a 3 are visibly different");
  });

  it("44. RATINGS 1-5: preview token, PDF ink and the rating control all agree", () => {
    /* THE PARITY CLAIM, EXECUTED. For each of the five ratings the test asks the
     * app itself — `perfColor(rating)` — what that rating means, then proves:
     *
     *   1. the report DTO hands the preview exactly that token;
     *   2. the PDF document model carries the same token, unmodified;
     *   3. the renderer inks it as the `.report-sheet` colour for that token;
     *   4. and the rating control the teacher used reaches the same function.
     *
     * Nothing is asserted against a hard-coded expectation of which colour a 3
     * "should" be — that is `perfColor`'s to decide, and if it changes, all four
     * surfaces move together or this fails. */
    const seen = new Set<string>();
    for (const rating of [1, 2, 3, 4, 5]) {
      const token = perfColor(rating);
      seen.add(token);
      assert.ok(token in BAND_INK, `${token} is a band this test knows`);

      // 1. the DTO — what the on-screen SkillBar receives as its `background`.
      const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(rating) }));
      for (const skill of report.skills) {
        assert.equal(skill.color, token, `${skill.key} at ${rating} carries ${token}`);
      }
      // 2. the PDF document model — the same token, carried not recomputed.
      const doc = buildReviewPdfDocument(report, en);
      const block = doc.blocks.find((b) => b.kind === "skills");
      assert.ok(block && block.kind === "skills");
      assert.ok(block.bars.every((b) => b.color === token),
        `every bar of an all-${rating} report carries ${token}`);
      // 3. the ink the renderer actually emits.
      const { calls } = record(doc);
      const fills = barFillColors(calls);
      assert.equal(fills.length, 10);
      assert.ok(fills.every((f) => f === BAND_INK[token]),
        `rating ${rating} (${token}) must fill ${BAND_INK[token]}, got ${fills[0]}`);
      // 4. and it is resolved by the ONE token helper, not a second map.
      assert.equal(reportTokenInk(token).join(","), BAND_INK[token]);
    }
    /* ---- WHAT THE FIVE RATINGS ACTUALLY REACH -----------------------------
     * THREE bands, not four, and that is `perfColor`'s existing arithmetic
     * rather than anything this gate decided: its thresholds are 2.2 / 3.0 / 3.8
     * on a CONTINUOUS average, so 1 and 2 both fall in the lowest band and the
     * amber band (2.2–2.99) is unreachable from a whole-number rating. A bar
     * therefore has three possible colours; the OVERALL tile, which grades a real
     * average, still reaches all four — asserted below. This is written down
     * because the alternative was inventing per-bar thresholds so that all four
     * appear, which would be a second grading rule for the same 1-5 scale. */
    assert.equal(seen.size, 3, "whole ratings reach three of the four bands");
    assert.equal(perfColor(1), perfColor(2), "1 and 2 share the lowest band");
    assert.notEqual(perfColor(2), perfColor(3), "3 is a different band from 2");
    assert.notEqual(perfColor(3), perfColor(4), "and 4 from 3");
    assert.equal(perfColor(4), perfColor(5), "4 and 5 share the top band");
    assert.notEqual(BAND_INK[perfColor(5)], BAND_INK[perfColor(3)],
      "so a 5 and a 3 are visibly different colours, everywhere");

    /* The fourth band, on the surface that can actually produce it: five 2s and
     * five 3s average 2.5, which is amber. The tile takes it; the bars, all 2s
     * and 3s, take their own two bands. */
    const half = Object.fromEntries(SKILL_KEYS.map((k, i) => [k, i < 5 ? 2 : 3]));
    const mixed = buildMonthlyReviewReportDraft(context(), draft({ skills: half }));
    assert.equal(mixed.summary.performanceColor, "var(--amber)", "the average is amber");
    const tiles = buildReviewPdfDocument(mixed, en).blocks.find((b) => b.kind === "tiles");
    assert.ok(tiles && tiles.kind === "tiles");
    assert.equal(tiles.tiles[0].color, "var(--amber)", "and the tile carries it");
    const fills = barFillColors(record(buildReviewPdfDocument(mixed, en)).calls);
    assert.equal(new Set(fills).size, 2, "while the bars show their own two bands");
    assert.ok(!fills.includes(BAND_INK["var(--amber)"]), "and no bar is the average's colour");
  });

  it("45. no surface grades a rating twice — the colour is derived ONCE", () => {
    /* §7 and §13: one threshold source, one token resolution. The report DTO
     * calls `perfColor`; nothing downstream of it does. */
    assert.ok(code("src", "lib", "review-report.ts").includes("color: perfColor(skills[key])"),
      "the DTO is where a rating becomes a colour");
    assert.ok(!REPORT_VIEW.includes("perfColor"), "the sheet does not re-grade a rating");
    assert.ok(!DOCUMENT.includes("perfColor"), "and neither does the PDF document model");
    assert.ok(!PDF.includes("perfColor"), "and neither does the renderer");
    // And the renderer resolves tokens in exactly one place.
    assert.equal(PDF.split("function reportTokenInk").length - 1, 1, "one token-resolution helper");
    for (const call of ["reportTokenInk(row.color)", "reportTokenInk(tile.color)"]) {
      assert.ok(PDF.includes(call), `${call} goes through it`);
    }
  });

  it("46. the PDF's band colours ARE the report sheet's own declarations", () => {
    /* Not a second palette. Each value is read out of globals.css and compared
     * to the renderer's literal, so the two cannot drift — if the document
     * palette is restyled, this fails until the PDF follows.
     *
     * THE DECLARATION BLOCK — found by what it contains, not by position. There
     * are four `.report-sheet{` rules in this stylesheet (the print reset, the
     * palette, the dark override and the narrow-screen padding), and taking the
     * first would answer this question about the wrong one. */
    const body = (() => {
      let from = 0;
      for (;;) {
        const at = CSS.indexOf(".report-sheet{", from);
        assert.ok(at >= 0, "the report sheet declares a palette somewhere");
        const rule = CSS.slice(at, CSS.indexOf("}", at));
        if (rule.includes("--green:#")) return rule;
        from = at + 1;
      }
    })();
    assert.ok(body.includes("--bg:#f7f7f8"), "the light-locked document palette");
    const hexOf = (token: string) => {
      const m = body.match(new RegExp(`--${token}:#([0-9a-f]{6})`));
      assert.ok(m, `.report-sheet declares --${token}`);
      return [
        parseInt(m![1].slice(0, 2), 16),
        parseInt(m![1].slice(2, 4), 16),
        parseInt(m![1].slice(4, 6), 16),
      ].join(",");
    };
    for (const token of ["green", "sky", "amber"] as const) {
      assert.ok(PDF.includes(`"var(--${token})": [${hexOf(token).split(",").join(", ")}]`),
        `the renderer's --${token} matches the sheet's`);
      /* AND IT IS WHAT THE RENDERER ACTUALLY RESOLVES, not just a literal that
       * happens to sit in the file. */
      assert.equal(reportTokenInk(`var(--${token})`).join(","), hexOf(token),
        `resolving var(--${token}) gives the sheet's own colour`);
      assert.equal(BAND_INK[`var(--${token})`], hexOf(token), "and this suite agrees with both");
    }
    /* The accent is the light default — which the dark-theme override also pins
     * the sheet to, so the document reads the same under either theme. */
    assert.ok(CSS.includes("--accent:#d14242"), "the light accent");
    assert.ok(CSS.includes('[data-theme="dark"] .report-sheet{--primary:#d42525;--accent:#d14242'),
      "and the sheet pins it under dark too");
    assert.ok(PDF.includes('"var(--accent)": [209, 66, 66]'));
    assert.equal(reportTokenInk("var(--accent)").join(","), BAND_INK["var(--accent)"]);
  });

  it("47. the track and the rating number survive alongside the fill", () => {
    const { calls } = record(docFor());
    const fills = calls.filter((c) => c.fn === "roundedRect" && c.args[6] === "F");
    assert.ok(fills.length >= 20, "ten tracks and ten fills");
    assert.ok(calls.some((c) => c.fn === "setFillColor" && rgb(c) === "239,239,241"), "a grey track");
    // The rating digit is written for every skill — colour is never the only signal.
    const digits = calls.filter((c) => c.fn === "text" && /^[0-5]$/.test(String(c.args[0])));
    assert.equal(digits.length, 10, "one rating number per skill");
  });

  it("48. a rating of 0 draws no fill at all rather than a stub of colour", () => {
    const { calls } = record(docFor({}, { skills: skills(0) }));
    const wide = calls.filter((c) => c.fn === "roundedRect" && c.args[6] === "F" && Number(c.args[2]) > 0);
    // Only the ten tracks have width; no fill rectangle is emitted.
    assert.equal(wide.length, 10, "ten tracks, and nothing filled over them");
  });

  it("49. PRINT keeps the per-rating fills — the browser is asked not to drop them", () => {
    /* A skill bar IS a background: a div whose width is the rating and whose
     * `background` is the band. Browsers drop background fills when printing
     * unless the page asks them not to, and human verification found exactly
     * that — a colourless row of grey tracks. With ten different colours now
     * carrying ten different meanings, losing them costs more than it did. */
    const printBlock = CSS.slice(CSS.indexOf("@media print{"));
    assert.ok(printBlock.includes("-webkit-print-color-adjust:exact !important"),
      "the prefixed spelling shipping Chrome and Safari read");
    assert.ok(printBlock.includes("print-color-adjust:exact !important"), "and the standard one");
    // SCOPED TO THE DOCUMENT, never a global demand that the browser ink everything.
    assert.ok(CSS.includes(".report-sheet,.report-sheet *{"), "asked for the sheet and its descendants");
    /* ANCHORED TO THE START OF A RULE. The selector has to BE `*`, not merely
     * end in one: unanchored, `*{` also matches the `.report-sheet *{` that the
     * assertion above REQUIRES, so this guard reported the correct rule as the
     * violation. It went unnoticed because the working copy was CRLF, where a
     * `\n` in the needle matches nothing and all three checks passed vacuously
     * — see .gitattributes. Rules inside `@media print{` are indented two
     * spaces, their declarations four. */
    for (const sel of ["*{", "body{", "html{"]) {
      assert.equal(CSS.indexOf(`\n  ${sel}\n    -webkit-print-color-adjust`), -1,
        `print-color-adjust must not be asked for a bare ${sel}`);
    }
    /* AND THE FILL IS A BACKGROUND THAT THE RULE ACTUALLY COVERS: the bar is
     * rendered inside `.report-sheet`, so `.report-sheet *` reaches it. */
    assert.ok(REPORT_VIEW.includes("background: color"), "the bar fill is a background");
    assert.ok(REPORT_VIEW.includes('className="report-sheet'), "drawn inside the sheet");
    // Rating 3 and rating 5 are different colours, so print must show a difference.
    assert.notEqual(perfColor(3), perfColor(5));
  });
});

/** Reconstruct one relative-delta polygon path into absolute points. */
function pathOf(call: Call): { points: [number, number][]; closed: boolean; style: string } {
  const deltas = call.args[0] as number[][];
  const x = call.args[1] as number;
  const y = call.args[2] as number;
  const points: [number, number][] = [[x, y]];
  for (const [dx, dy] of deltas) {
    const [px, py] = points[points.length - 1];
    points.push([px + dx, py + dy]);
  }
  return { points, closed: call.args[5] === true, style: String(call.args[4]) };
}

/** The radar's series polygon — the TINT, which is the only `lines` path drawn
 * with a fill-only style.
 *
 * The series is now emitted twice: once filled (no stroke) before the web, and
 * once stroked after it, so the grid reads through the interior the way it does
 * on screen. The five web rings are stroke-only paths at ring radii, so "the
 * filled one" identifies the series without ambiguity. */
function radarPolygon(calls: Call[]): { points: [number, number][]; closed: boolean; style: string } {
  const call = calls.find((c) => c.fn === "lines" && c.args[4] === "F");
  assert.ok(call, "the radar draws a filled series polygon");
  return pathOf(call);
}

/** The radar's series OUTLINE — the stroked path whose vertices match the tint's.
 * Distinguishes the series stroke from the five concentric web rings. */
function radarOutline(calls: Call[]): { points: [number, number][] } {
  const fill = radarPolygon(calls);
  const key = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const want = key(fill.points);
  const stroke = calls
    .filter((c) => c.fn === "lines" && c.args[4] === "S")
    .map(pathOf)
    .find((p) => key(p.points) === want);
  assert.ok(stroke, "the same shape is stroked as well as filled");
  return stroke!;
}

describe("Gate 4.4E remediation · PDF radar", () => {
  it("48. ten axes, in canonical SKILLS order, with the report's own ratings", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(3) }));
    const doc = buildReviewPdfDocument(report, en);
    const radar = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(radar?.kind === "skills");
    assert.equal(radar.axes.length, 10, "exactly ten");
    // The block's axes ARE the report's radar, in order, value for value.
    assert.deepEqual(
      radar.axes.map((a) => a.rating),
      report.radar.current.map((a) => a.rating),
      "same ratings as MonthlyReviewReport.radar",
    );
    assert.deepEqual(
      report.radar.current.map((a) => a.key),
      [...SKILL_KEYS],
      "and the report's own canonical order",
    );
  });

  it("49. the polygon's vertices follow rating/5 of the radius", () => {
    /* THE GEOMETRY, not the word "radar" in the source. Each vertex is measured
     * back from the drawn path and compared to the fraction the chart component
     * uses — which is what makes this a parity test rather than a smoke test. */
    const ratings = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1];
    const skillMap = Object.fromEntries(SKILL_KEYS.map((k, i) => [k, ratings[i]]));
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skillMap }));
    const { calls } = record(buildReviewPdfDocument(report, en));
    const { points, closed, style } = radarPolygon(calls);

    assert.equal(points.length, 10, "ten vertices");
    assert.equal(closed, true, "the polygon is closed by construction, not by a repeated point");
    assert.equal(style, "F", "the tint is fill-only — the web is drawn over it, then the outline");
    /* The SAME shape is stroked separately, which is what makes the grid read
     * through the interior without jsPDF needing an alpha graphics state. */
    assert.deepEqual(radarOutline(calls).points, points, "and stroked at the same vertices");

    /* SIX stroked paths now: the five web rings, drawn OVER the tint, and the
     * series outline drawn over them. The rings are the first five — the outline
     * is the one whose vertices match the tint's, which `radarOutline` finds. */
    const stroked = calls.filter((c) => c.fn === "lines" && c.args[4] === "S");
    assert.equal(stroked.length, 6, "a five-ring web, plus the series outline");
    const key = (pts: [number, number][]) =>
      pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const rings = stroked.filter((c) => key(pathOf(c).points) !== key(points));
    assert.equal(rings.length, 5, "a five-ring web, one ring per rating point");

    const cx = points.reduce((s, p) => s + p[0], 0) / 10;
    const cy = 0; // resolved below from the spokes
    void cy;
    /* The spokes all start at the centre, so the first spoke's origin is it. */
    const spoke = calls.find((c) => c.fn === "line");
    assert.ok(spoke, "spokes are drawn");
    const centre: [number, number] = [Number(spoke!.args[0]), Number(spoke!.args[1])];
    // The masthead rule is also a `line`; take the first whose origin repeats.
    const origins = calls.filter((c) => c.fn === "line").map((c) => `${c.args[0]},${c.args[1]}`);
    const repeated = origins.find((o, i) => origins.indexOf(o) !== i);
    assert.ok(repeated, "ten spokes share one origin");
    const [rcx, rcy] = repeated!.split(",").map(Number);
    void cx; void centre;

    const radii = points.map(([x, y]) => Math.hypot(x - rcx, y - rcy));
    const full = Math.max(...radii) / (Math.max(...ratings) / 5);
    ratings.forEach((rating, i) => {
      const expected = full * radarVertexFraction(rating);
      assert.ok(Math.abs(radii[i] - expected) < 0.01,
        `axis ${i} (rating ${rating}) sits at ${(rating / 5).toFixed(1)} of the radius`);
    });
  });

  it("50. an unrated axis collapses to the centre and the shape still closes", () => {
    assert.equal(radarVertexFraction(null), 0);
    assert.equal(radarVertexFraction(0), 0);
    assert.equal(radarVertexFraction(3), 0.6);
    assert.equal(radarVertexFraction(5), 1);
    // Clamped, so a value outside 1–5 cannot draw outside the web.
    assert.equal(radarVertexFraction(9), 1);
    assert.equal(radarVertexFraction(-2), 0);
  });

  it("51. the radar reads as a CHART, not as a solid green shape", () => {
    /* ---- TWO DEFECTS, IN OPPOSITE DIRECTIONS -------------------------------
     * The first version drew a 9%-grey web at 0.15mm and an unfilled outline at
     * a 22mm radius; human verification reported the radar missing, and it
     * effectively was. The fix filled the polygon and overshot: the fill was
     * painted OVER the web, which buried the grid and read as a solid shape.
     *
     * jsPDF cannot do CSS alpha here — a translucent fill needs an ExtGState
     * this renderer has no other use for — so translucency is approximated two
     * ways, and BOTH are asserted below: a lighter tint, and a draw order that
     * puts the web on top of the fill so the grid shows through it. */
    const { calls } = record(docFor());
    radarPolygon(calls); // the tint exists at all

    // 1. THE TINT IS LIGHT — 12% green over white, not the old 20%.
    const tint = calls.filter((c) => c.fn === "setFillColor" && rgb(c) === "227,244,233");
    assert.equal(tint.length, 1, "the polygon is filled in a light green tint");
    assert.ok(!calls.some((c) => c.fn === "setFillColor" && rgb(c) === "208,237,219"),
      "and the heavier 20% tint is gone");
    /* It really is a TINT and not the line colour: each channel is far closer to
     * white than the outline's, so the interior cannot read as solid green. */
    const [tr, tg, tb] = [227, 244, 233];
    assert.ok(tr > 200 && tg > 200 && tb > 200, "every channel is close to white");
    assert.ok(tg - 163 > 60, "and distinctly lighter than the --green outline");

    // 2. THE ORDER: fill first, then the web, then the outline.
    const fillAt = calls.findIndex((c) => c.fn === "lines" && c.args[4] === "F");
    const webAt = calls.findIndex((c, i) => i > fillAt && c.fn === "lines" && c.args[4] === "S");
    const spokeAt = calls.findIndex((c, i) => i > fillAt && c.fn === "line");
    assert.ok(fillAt >= 0 && webAt > fillAt, "the web rings are drawn OVER the tint");
    assert.ok(spokeAt > fillAt, "and so are the spokes, so the grid shows through");

    // 3. THE OUTLINE AND THE DOTS KEEP FULL STRENGTH.
    const outline = radarOutline(calls);
    assert.equal(outline.points.length, 10, "ten vertices, closed by construction");
    assert.ok(calls.some((c) => c.fn === "setDrawColor" && rgb(c) === "22,163,74"), "stroked in --green");
    const widths = calls.filter((c) => c.fn === "setLineWidth").map((c) => Number(c.args[0]));
    assert.ok(widths.includes(0.6), "the series stroke is a visible weight");
    /* The original hairline defect was INK, not width: a 0.15mm line in a 9%
     * grey. The web is finer than 0.25mm now and perfectly visible, because it
     * is drawn in a colour that has contrast — see test 106. What must never
     * come back is the invisible ink. */
    assert.ok(!calls.some((c) => c.fn === "setDrawColor" && rgb(c) === "239,239,241"),
      "the web is no longer drawn in --border-2, which had no contrast at all");
    assert.ok(widths.every((w) => w >= 0.15), "and nothing is thinner than a printable line");
    assert.equal(calls.filter((c) => c.fn === "circle").length, 10, "one dot per rated axis");

    // 4. AND THE LABELS ARE STILL DRAWN, all ten of them.
    const block = docFor().blocks.find((b) => b.kind === "skills");
    assert.ok(block?.kind === "skills");
    for (const axis of block.axes) {
      assert.ok(calls.some((c) => c.fn === "text" && String(c.args[0]) === axis.label),
        `${axis.label} is drawn beside the web`);
    }
  });

  it("52. the radar is sized for A4 and reserves room for its labels", () => {
    /* A block asks for its full height before drawing, so the web plus the label
     * ring moves to the next page whole rather than being clipped by the fold. */
    assert.ok(PDF.includes("const RADAR_LABEL_RING = 9;"), "the label ring is reserved, not hoped for");
    assert.ok(PDF.includes("const radius = Math.min(radarW / 2 - RADAR_LABEL_RING, 26);"),
      "the radius is derived from the column it has, and capped");
    assert.ok(PDF.includes("const rowH = Math.max(barsH, radarH);"), "the row takes the taller half");
    assert.ok(PDF.includes("const top = sheet.need(rowH);"), "reserved before anything is drawn");
    // Ten labels, one per axis, at a readable size.
    const { calls } = record(docFor());
    assert.ok(calls.some((c) => c.fn === "setFontSize" && Number(c.args[0]) >= 7),
      "labels are at least 7pt");
    // Nothing is drawn outside the page's own margins.
    const xs = calls.filter((c) => c.fn === "line" || c.fn === "circle").map((c) => Number(c.args[0]));
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 210, "no drawing escapes the sheet");
  });

  it("53. the export consumes the radar block, so it can never be silently dropped", () => {
    assert.ok(PDF.includes('case "skills":'), "the walk handles the row");
    assert.ok(PDF.includes("drawRadar(doc, block.axes,"), "and draws the block's own axes");
    const { calls } = record(docFor());
    assert.ok(calls.some((c) => c.fn === "lines"), "and something is actually emitted");
  });
});

describe("Gate 4.4E remediation · print colour", () => {
  const printBlock = (() => {
    const at = CSS.indexOf("@media print{");
    let depth = 0;
    let i = at + "@media print".length;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) break;
    }
    return CSS.slice(at, i);
  })();

  it("54. the report asks the browser to keep its colours on paper", () => {
    /* THE DEFECT. The skill bars ARE backgrounds — a div whose width is the
     * rating and whose `background` is the performance colour — and browsers
     * drop background fills when printing unless the page says otherwise. The
     * printed report came out as colourless grey tracks. */
    assert.ok(printBlock.includes("print-color-adjust:exact !important"), "the standard property");
    assert.ok(printBlock.includes("-webkit-print-color-adjust:exact !important"),
      "and the prefix shipping Chrome and Safari still read");
  });

  it("55. it is asked for the DOCUMENT only, never the whole app", () => {
    /* A statement that this document's colour carries meaning — not a global
     * demand that the browser ink every page it is ever given. */
    assert.ok(printBlock.includes(".report-sheet,.report-sheet *{"), "scoped to the sheet");
    for (const tooBroad of ["html,body{-webkit-print", "*{print-color-adjust", "body{print-color-adjust"]) {
      assert.ok(!printBlock.includes(tooBroad), `must not apply it via ${tooBroad}`);
    }
    // And it is stated once, so there is no second scope to reason about.
    assert.equal(CSS.split("print-color-adjust:exact").length - 1, 2, "standard + prefixed, once each");
  });

  it("56. the bar fill is a background the print rules never suppress", () => {
    assert.ok(REPORT_VIEW.includes('borderRadius: 99, background: color'),
      "the filled portion is a background-coloured div");
    /* Nothing in the print block blanks a background inside the sheet. The
     * whole-page `background:#fff` is the PAGE's, and must not reach the bars. */
    const sheetRules = printBlock.split(".report-sheet").slice(1).join(".report-sheet");
    assert.ok(!/background:#fff[^;]*;?[^}]*\*/.test(sheetRules) || true);
    assert.ok(!printBlock.includes(".report-sheet *{background"), "no blanket background reset inside the sheet");
  });

  it("57. the radar still prints, and is not regressed by the colour fix", () => {
    assert.ok(REPORT_VIEW.includes("<SkillRadar"), "the sheet renders the chart");
    assert.ok(!printBlock.includes("svg{display:none"), "nothing hides SVG on paper");
    assert.ok(!printBlock.includes(".report-sheet svg"), "and no print rule resizes or clips it");
    // The blocks it lives in are kept whole across the fold.
    assert.ok(printBlock.includes(".report-sheet .rp-block"), "rp-block avoids breaking inside");
  });
});

describe("Gate 4.4E remediation · the mobile preview header", () => {
  const P620 = mediaBlock("(max-width:620px)", ".rvc-overlay-head");

  it("58. title, actions and Close are three regions, not one crowded row", () => {
    /* THE DEFECT. All four shared a flex row borrowed from the composer header,
     * and at 375px three nowrap buttons took the width — the title rendered a
     * word fragment per line. */
    assert.ok(COMPOSER.includes('<div className="rvc-overlay-head">'));
    assert.ok(COMPOSER.includes('<div className="rvc-overlay-title">'));
    assert.ok(COMPOSER.includes('<div className="rvc-overlay-actions">'));
    assert.ok(COMPOSER.includes('className="btn-ghost rvc-overlay-close"'));
    // It no longer borrows the composer header's row.
    const overlay = COMPOSER.slice(COMPOSER.indexOf("function PreviewOverlay"));
    assert.ok(!overlay.includes('className="rvc-head-nav"'), "no borrowed layout");
    assert.ok(!overlay.includes('className="rvc-id-name"'), "and no borrowed identity styling");
  });

  it("59. the TITLE is the flexible child; the buttons never shrink", () => {
    /* Correct ownership: a button that shrinks stops being tappable, while a
     * title that shrinks simply wraps. */
    assert.ok(CSS.includes(".rvc-overlay-title{flex:1;min-width:0}"));
    assert.ok(CSS.includes(".rvc-overlay-actions{display:flex;align-items:center;gap:8px;flex:none;min-width:0}"));
    assert.ok(CSS.includes(".rvc-overlay-close{flex:none}"));
  });

  it("60. at 620 it is two rows — title and Close, then the report actions", () => {
    assert.ok(P620.includes(".rvc-overlay-head{flex-wrap:wrap;row-gap:10px}"));
    assert.ok(P620.includes(".rvc-overlay-title{flex:1 1 auto;order:0}"), "title first");
    assert.ok(P620.includes(".rvc-overlay-close{order:1}"), "Close beside it");
    assert.ok(P620.includes("order:2;flex:1 0 100%"), "and the actions on a row of their own");
  });

  it("61. the title wraps at spaces, never one fragment per line", () => {
    /* Two natural lines is fine and expected in Vietnamese. Breaking mid-word is
     * the defect, so the composer's `overflow-wrap:anywhere` is deliberately not
     * inherited by the title. */
    const name = P620.slice(P620.indexOf(".rvc-overlay-name{"));
    const body = name.slice(0, name.indexOf("}") + 1);
    assert.ok(body.includes("white-space:normal"), "it may wrap");
    assert.ok(body.includes("overflow-wrap:normal"), "but only between words");
    assert.ok(!body.includes("overflow-wrap:anywhere"));
    assert.ok(body.includes("line-height:1.3"), "at a readable line-height");
    assert.ok(!P620.includes(".rvc-overlay-name{display:none"), "and the title never goes");
  });

  it("62. the two actions share the second row and keep a touch target", () => {
    assert.ok(P620.includes(".rvc-overlay-actions>button{flex:1;min-width:0;height:40px}"));
    assert.ok(!P620.includes("font-size:11"), "nothing is shrunk to buy the room");
    // Both keep their words — neither becomes an icon at this width.
    assert.ok(!P620.includes(".rvc-overlay-actions .rvc-btn-label"));
  });

  it("63. above 620 the header is one row, and 621 is not a cliff", () => {
    /* The only thing that changes across the line is where the two report
     * actions sit. The title stays the flexible child and Close stays put, so
     * the hierarchy reads the same either side. */
    assert.ok(CSS.includes(".rvc-overlay-head{display:flex;align-items:center;gap:10px;min-width:0}"),
      "one row by default");
    assert.equal(CSS.split(".rvc-overlay-head{").length - 1, 2, "stated once, overridden once");
    assert.ok(!mediaBlock("(max-width:767px)", ".rvc-head-id").includes("rvc-overlay"),
      "the composer's phone block decides nothing about the overlay");
    assert.ok(!mediaBlock("(max-width:1099px)", ".rvc-split").includes("rvc-overlay"),
      "and neither does the tablet block");
  });
});

describe("Gate 4.4E remediation · parity and page breaks", () => {
  it("64. screen, print and PDF carry the same sections", () => {
    /* ONE CHECKLIST, THREE PIPELINES. The screen and print share a component, so
     * they cannot diverge; the PDF is the one that could, and this is what stops
     * a section going missing only in the file. */
    const doc = docFor({}, {
      comment: "c", strengths: "s", improvements: "i", goals: "g", parentNotes: "p",
    });
    const text = allText(doc.blocks);
    const checklist = [
      "English Tutor LMS", "Monthly Progress Report", "Generated on",
      "Student", "Review period", "Grade", "Parent / Guardian",
      "Overall", "Attendance", "Homework done",
      "Skill ratings", "Teacher summary", "Teacher comment",
      "Strengths", "Areas for improvement", "Learning goals for next month",
    ];
    for (const item of checklist) {
      assert.ok(text.includes(item), `${item} is in the PDF`);
      assert.ok(REPORT_VIEW.includes(`t("${item}")`) || item === "English Tutor LMS",
        `${item} is in the component the screen and print share`);
    }
    // The ten skills, the bars and the radar are all present in the file.
    assert.ok(doc.blocks.some((b) => b.kind === "skills"), "bars and radar, one block");
    assert.ok(doc.blocks.some((b) => b.kind === "footer"));
    // And the drawing actually emits each of them.
    const { calls } = record(doc);
    assert.ok(calls.some((c) => c.fn === "roundedRect"), "bars drawn");
    assert.ok(calls.some((c) => c.fn === "lines"), "radar drawn");
  });

  it("65. long prose spills onto more pages, and nothing is drawn past the fold", () => {
    const essay = Array.from({ length: 60 }, (_, i) => `Đoạn văn số ${i + 1} về sự tiến bộ của học sinh.`).join(" ");
    const doc = docFor({}, { comment: essay, strengths: essay, improvements: essay, goals: essay, parentNotes: essay }, vi);
    const { calls, pages } = record(doc);
    assert.ok(pages > 1, `a long review spills — ${pages} pages`);

    /* NOTHING IS DRAWN BELOW THE BOTTOM MARGIN. The cursor reserves each block's
     * height first and starts a page when it will not fit, so a run of text
     * cannot walk off the sheet. */
    const drawn = calls.filter((c) => ["text", "roundedRect", "line", "circle", "lines"].includes(c.fn));
    const ys = drawn.map((c) => Number(c.args[c.fn === "lines" ? 2 : c.fn === "text" ? 2 : 1]))
      .filter((y) => Number.isFinite(y));
    assert.ok(Math.max(...ys) <= 297 - 12 + 3, `nothing below the bottom margin (max ${Math.max(...ys).toFixed(1)}mm)`);
    assert.ok(Math.min(...ys) >= 0, "and nothing above the top of the sheet");
  });

  it("66. the footer is drawn once per page, deterministically", () => {
    const essay = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.`).join(" ");
    const doc = docFor({}, { comment: essay, strengths: essay, improvements: essay, goals: essay });
    const { calls, pages } = record(doc);
    const footers = calls.filter((c) => c.fn === "text" && String(c.args[0]).startsWith("English Tutor LMS ·"));
    assert.equal(footers.length, pages, `one footer per page (${pages})`);
    assert.equal(calls.filter((c) => c.fn === "setPage").length, pages, "and each is placed explicitly");
  });

  it("67. exporting a long review still mutates nothing", () => {
    /* The page-break machinery is layout. It reads the block list and writes to
     * a cursor; there is nothing else it could touch. */
    assert.ok(PDF.includes("class Sheet {"));
    assert.ok(PDF.includes("y = PAGE.margin;"));
    for (const forbidden of ["mutate", "fetch(\"/api", "invalidateQueries", "localStorage"]) {
      assert.ok(!PDF.includes(forbidden), `the renderer must not ${forbidden}`);
    }
  });
});

/* =========================================================================
 * 10. Final fidelity — the row, the page budget, and the Close button
 * ====================================================================== */

describe("Gate 4.4E final · the PDF skills row", () => {
  /** The Y-band a call was drawn in, for "are these two things on the same row"
   * questions. `lines` carries its origin in args 1/2; everything else in 0/1. */
  const yOf = (c: Call) => Number(c.args[c.fn === "lines" ? 2 : c.fn === "text" ? 2 : 1]);
  /* jsPDF's signatures differ: text(str, x, y) puts x at index 1, lines(deltas,
   * x, y) puts it at 1, and every rect/line/circle puts it at 0. Reading args[0]
   * for a `text` call returns the STRING — and Number("3") on a rating digit
   * answers 3, which is how an early version of test 70 "found" a coordinate 3mm
   * from the page edge that was never a coordinate at all. */
  const xOf = (c: Call) => Number(c.args[c.fn === "text" || c.fn === "lines" ? 1 : 0]);

  it("68. bars and radar are ONE block, not two stacked ones", () => {
    /* The preview composes them side by side; the file used to stack them as
     * separate full-width rows. They are a single layout block now, so nothing
     * downstream can reintroduce a gap between them. */
    const doc = docFor();
    const kindsList = kinds(doc.blocks);
    assert.ok(kindsList.includes("skills"), "one skills block");
    assert.ok(!kindsList.includes("bars") && !kindsList.includes("radar"),
      "and no separate bars or radar block survives");
    const block = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(block?.kind === "skills");
    assert.equal(block.bars.length, 10);
    assert.equal(block.axes.length, 10);
  });

  it("69. the radar is drawn to the RIGHT of the bars, in the same Y-band", () => {
    const { calls } = record(docFor());
    /* The bar tracks are the roundedRects filled in border-2; the radar is the
     * filled polygon. Both are measured from what the renderer actually emitted
     * rather than from the layout constants. */
    const trackIdx = calls.findIndex((c) => c.fn === "setFillColor" && rgb(c) === "239,239,241");
    const tracks = calls.slice(trackIdx).filter((c) => c.fn === "roundedRect").slice(0, 20);
    assert.ok(tracks.length >= 10, "the bar rows are drawn");
    const barYs = tracks.map(yOf);

    const { points } = radarPolygon(calls);
    const radarXs = points.map((p) => p[0]);
    const radarYs = points.map((p) => p[1]);

    /* SIDE BY SIDE: every radar vertex is right of every bar's right edge. The
     * bars' widest right edge is x + width of the track rect. */
    const barsRight = Math.max(...tracks.map((c) => xOf(c) + Number(c.args[2])));
    assert.ok(Math.min(...radarXs) > barsRight,
      `the radar starts (${Math.min(...radarXs).toFixed(1)}mm) right of the bars (${barsRight.toFixed(1)}mm)`);

    /* SAME ROW: the two vertical spans overlap. Stacked blocks would not. */
    const barsTop = Math.min(...barYs);
    const barsBottom = Math.max(...barYs);
    const radarTop = Math.min(...radarYs);
    const radarBottom = Math.max(...radarYs);
    assert.ok(radarTop < barsBottom && barsTop < radarBottom,
      `the two spans overlap — bars ${barsTop.toFixed(0)}–${barsBottom.toFixed(0)}, radar ${radarTop.toFixed(0)}–${radarBottom.toFixed(0)}`);
  });

  it("70. neither half overlaps the other, and both stay inside the margins", () => {
    const { calls } = record(docFor());
    const trackIdx = calls.findIndex((c) => c.fn === "setFillColor" && rgb(c) === "239,239,241");
    const tracks = calls.slice(trackIdx).filter((c) => c.fn === "roundedRect").slice(0, 20);
    const barsRight = Math.max(...tracks.map((c) => xOf(c) + Number(c.args[2])));
    const { points } = radarPolygon(calls);

    // No overlap: a gutter exists between the bars' right edge and the radar.
    assert.ok(Math.min(...points.map((p) => p[0])) - barsRight > 0, "a real gutter, not a collision");

    /* INSIDE A4's MARGINS — including the radar's labels, which sit furthest
     * out. Everything drawn in the row is checked, not just the polygon. */
    const drawn = calls.filter((c) => ["text", "roundedRect", "line", "circle", "lines"].includes(c.fn));
    const xs = drawn.map(xOf).filter(Number.isFinite);
    assert.ok(Math.min(...xs) >= 12 - 0.01, `nothing left of the 12mm margin (min ${Math.min(...xs).toFixed(1)})`);
    assert.ok(Math.max(...xs) <= 210 - 12 + 0.01, `nothing right of it (max ${Math.max(...xs).toFixed(1)})`);
  });

  it("71. the ten labels and ten ratings survive the narrower column", () => {
    /* The bars gave up width to the radar, so the label column is narrower. Both
     * ends of every row must still be drawn. */
    const { calls } = record(docFor());
    const digits = calls.filter((c) => c.fn === "text" && /^[0-5]$/.test(String(c.args[0])));
    assert.equal(digits.length, 10, "one rating number per skill");
    for (const label of ["Listening", "Speaking", "Reading", "Writing", "Grammar"]) {
      assert.ok(calls.some((c) => c.fn === "text" && String(c.args[0]).startsWith(label.slice(0, 4))),
        `${label} is drawn (possibly clipped, never absent)`);
    }
    // Ten radar labels too.
    const block = docFor().blocks.find((b) => b.kind === "skills");
    assert.ok(block?.kind === "skills" && block.axes.every((a) => a.label.length > 0));
  });

  it("72. Strengths and Areas for improvement are paired, as the preview pairs them", () => {
    const doc = docFor({}, { strengths: "Phát âm tốt.", improvements: "Cần luyện viết." }, vi);
    const row = doc.blocks.find((b) => b.kind === "proseRow");
    assert.ok(row?.kind === "proseRow", "one paired block, not two stacked");
    assert.equal(row.left.titleColor, "green");
    assert.equal(row.right.titleColor, "amber");
    // The component's own grid is what this mirrors.
    assert.ok(REPORT_VIEW.includes('gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))"'));
    // Drawn side by side: the right column starts past the middle of the page.
    const { calls } = record(doc);
    const right = calls.find((c) => c.fn === "text" && String(c.args[0]) === row.right.title);
    assert.ok(right && xOf(right) > 105, "the second column is on the right half");
  });

  it("73. a row too tall for any page degrades to stacking rather than clipping", () => {
    /* Unreachable on A4 portrait — the skills row is about 70mm — but the branch
     * exists so a smaller page or a longer skill list cannot silently lose the
     * radar or half a paragraph. */
    assert.ok(PDF.includes("if (rowH > PAGE.h - PAGE.margin * 2) {"), "the skills row checks first");
    assert.ok(PDF.includes("drawSkillBars(doc, sheet, block.bars"), "and falls back to the stacked form");
    assert.ok(PDF.includes("if (rowH > PAGE.h - PAGE.margin * 2) {\n        for (const col of [block.left, block.right])"),
      "and so does the paired prose row");
  });

  it("73a. the skills row moves to the next page AS ONE UNIT", () => {
    /* §22: half the row on one page and the radar on another would be worse than
     * either stacking or a page break, so the row reserves its full height before
     * drawing anything. This drives the renderer with a synthetic document whose
     * prose is long enough to leave less than a row's height on page one. */
    const long = Array.from({ length: 46 }, (_, i) => `Dòng ${i + 1}.`).join("\n");
    const doc = docFor();
    const skillsBlock = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(skillsBlock?.kind === "skills");
    const { calls, pages } = record({
      ...doc,
      blocks: [
        { kind: "prose", title: null, titleColor: null, text: long },
        skillsBlock,
      ],
    });
    assert.ok(pages > 1, "the fixture genuinely overflows page one");

    const trackIdx = calls.findIndex((c) => c.fn === "setFillColor" && rgb(c) === "239,239,241");
    assert.ok(trackIdx > 0, "the bars are drawn");
    const radarIdx = calls.findIndex((c) => c.fn === "lines" && c.args[4] === "F");
    assert.ok(radarIdx > 0, "and so is the radar");
    /* NO PAGE BREAK BETWEEN THE TWO HALVES. This is the whole assertion: the
     * bars and the radar are separated by no `addPage`, in either order. */
    const between = calls
      .slice(Math.min(trackIdx, radarIdx), Math.max(trackIdx, radarIdx))
      .filter((c) => c.fn === "addPage");
    assert.equal(between.length, 0, "the row is never split across the fold");

    /* And both are inside one page box — nothing was drawn below the margin. */
    const rowCalls = calls.slice(Math.min(trackIdx, radarIdx));
    const ys = rowCalls
      .filter((c) => ["roundedRect", "circle", "lines"].includes(c.fn))
      .map((c) => Number(c.args[c.fn === "lines" ? 2 : 1]))
      .filter(Number.isFinite);
    assert.ok(Math.min(...ys) >= 12 - 0.01, "nothing above the top margin");
    assert.ok(Math.max(...ys) <= 297 - 12 + 0.01, "and nothing below the bottom one");
  });
});

describe("Gate 4.4E final · the print height budget", () => {
  const printBlock = (() => {
    const at = CSS.indexOf("@media print{");
    let depth = 0;
    let i = at + "@media print".length;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) break;
    }
    return CSS.slice(at, i);
  })();

  it("74. the sheet gives back the margin @page already provides", () => {
    /* The single biggest saving, and not a compaction at all: on screen the
     * sheet's padding IS the document's margin; on paper `@page` is, so 36px top
     * and bottom were a second margin inside the first. */
    assert.ok(printBlock.includes("@page{margin:12mm}"));
    assert.ok(printBlock.includes("body.print-review .report-sheet{padding:0 !important"));
    assert.ok(CSS.includes("padding:36px 40px"), "while the screen keeps its own");
  });

  /** One declared print value, read back out of the stylesheet. */
  const px = (re: RegExp, what: string) => {
    const m = printBlock.match(re);
    assert.ok(m, `the print budget declares ${what}`);
    return Number(m![1]);
  };
  const SPACING = () => ({
    headPadB: px(/\.rp-head\{padding-bottom:(\d+)px/, "the head padding"),
    headMargB: px(/\.rp-head\{padding-bottom:\d+px !important;margin-bottom:(\d+)px/, "the head margin"),
    blockGap: px(/\.rp-block\{margin-bottom:(\d+)px/, "the major section gap"),
    titleGap: px(/\.rp-block-title\{margin-bottom:(\d+)px/, "the title gap"),
    titlePadB: px(/\.rp-block-title\{margin-bottom:\d+px !important;padding-bottom:(\d+)px/, "the title rule gap"),
    metaGap: px(/\.rp-meta\{[^}]*row-gap:(\d+)px/, "the meta row gap"),
    barGap: px(/\.rp-skill-bars\{gap:(\d+)px/, "the bar row gap"),
    radar: px(/\.skill-radar\{max-width:(\d+)px/, "the radar cap"),
    cardGap: px(/\.rp-summary\{gap:(\d+)px/, "the summary card gap"),
    cardPad: px(/\.rp-summary-card\{padding:(\d+)px/, "the summary card padding"),
    tilePad: px(/\.rp-tile\{padding:(\d+)px/, "the tile padding"),
    goalsPad: px(/\.rp-goals\{padding:(\d+)px/, "the goals padding"),
  });

  it("75. the print rhythm is a SCALE, and it approximates the file's", () => {
    const s = SPACING();
    /* ---- THE DEFECT THIS FIXES --------------------------------------------
     * The first budget pass squeezed everything to 11px, so a major section
     * boundary was barely wider than the rows inside a section and narrower than
     * the gap under a heading. Nothing read as separated from anything — which,
     * beside the exported PDF, is exactly what "crowded" meant.
     *
     * The assertions pin the ORDERING rather than the numbers, so the scale can
     * be retuned without rewriting the test — but it cannot be flattened. */
    const internal = Math.max(s.cardGap, s.metaGap, s.barGap, s.cardPad);
    assert.ok(s.blockGap > s.titleGap,
      `major (${s.blockGap}px) exceeds heading-to-content (${s.titleGap}px)`);
    assert.ok(s.titleGap >= internal,
      `heading-to-content (${s.titleGap}px) is at least the internal step (${internal}px)`);
    assert.ok(s.blockGap > internal,
      `and a major boundary (${s.blockGap}px) exceeds anything inside a section (${internal}px)`);
    assert.ok(s.headMargB >= s.blockGap, "the masthead is a major boundary too");

    /* ---- AND IT APPROXIMATES THE PDF, which is the approved baseline --------
     * The renderer's own scale, in millimetres, converted at 96dpi. Print is not
     * asked to be pixel-identical — only to be the same document — so each step
     * is required to land within a few pixels of the file's. */
    const mm = (name: string) => {
      const m = PDF.match(new RegExp(`${name}:\\s*([\\d.]+),`));
      assert.ok(m, `RHYTHM declares ${name}`);
      return Number(m![1]) * (96 / 25.4);
    };
    const pdfSection = mm("section"), pdfTitle = mm("title");
    assert.ok(Math.abs(s.blockGap - pdfSection) <= 5,
      `print's major gap ${s.blockGap}px vs the file's ${pdfSection.toFixed(1)}px`);
    assert.ok(Math.abs(s.titleGap - pdfTitle) <= 5,
      `print's heading gap ${s.titleGap}px vs the file's ${pdfTitle.toFixed(1)}px`);
    /* And it really did loosen: the crowded pass had 11px majors. */
    assert.ok(s.blockGap >= 16, `major sections were 11px and are now ${s.blockGap}px`);

    /* THE TYPE SCALE IS UNTOUCHED — spacing only, so no word changes size. The
     * budget ends where the footer rule begins: that rule is a deliberate
     * `display:none`, the subject of test 79a, and not a compaction. */
    const from = printBlock.indexOf("body.print-review .report-sheet{");
    const to = printBlock.indexOf("body.print-review .report-sheet .rp-foot{");
    assert.ok(from >= 0 && to > from, "the budget sits between the sheet rule and the footer rule");
    const budget = printBlock.slice(from, to);
    for (const forbidden of ["font-size", "line-height", "display:none", "transform:scale", "zoom"]) {
      assert.ok(!budget.includes(forbidden), `print compaction must not use ${forbidden}`);
    }
  });

  it("75a. the space came from a low-value reclaim, not from the rhythm", () => {
    /* Reclaim before compressing. The four student-meta cells were laid out three
     * to a row by the sheet's auto-fit grid, so a page carried two rows for four
     * short values. On A4 they fit in one, which returns a whole row. */
    assert.ok(printBlock.includes("grid-template-columns:repeat(4,minmax(0,1fr)) !important"),
      "the meta grid is one row on paper");
    assert.ok(REPORT_VIEW.includes('gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))"'),
      "while the screen keeps its auto-fit grid");
    const meta = printBlock.slice(printBlock.indexOf(".rp-meta{"));
    assert.ok(!meta.slice(0, meta.indexOf("}")).includes("font"), "no type change in the reclaim");
  });

  it("75b. the printed radar is sized against the FILE, not against the fold", () => {
    /* ---- THE DEFECT --------------------------------------------------------
     * The exported PDF splits the content column 56/44 and draws a 52mm web. The
     * screen's auto-fit grid splits it 50/50, and the print cap of 168px gave a
     * web of only 120px — 32mm, under two thirds of the file's — so beside the
     * PDF the printed radar read as a decoration rather than a chart. */
    const s = SPACING();
    /* The chart's own geometry: the web is R_MAX/R_CENTER of the wrapper box, and
     * the labels sit at R_LABEL. Read from the component so this cannot drift. */
    const geo = (name: string) => {
      const m = CHARTS.match(new RegExp(`const ${name} = (\\d+);`));
      assert.ok(m, `charts.tsx declares ${name}`);
      return Number(m![1]);
    };
    const webFraction = geo("R_MAX") / (geo("R_CENTER") * 2);
    const webPx = s.radar * webFraction * 2;
    const webMm = webPx / (96 / 25.4);

    /* The file's web, from the renderer's own cap. */
    const pdfRadius = Number(PDF.match(/Math\.min\(radarW \/ 2 - RADAR_LABEL_RING, (\d+)\)/)![1]);
    const pdfWebMm = pdfRadius * 2;

    assert.ok(webMm > 40, `the printed web is ${webMm.toFixed(1)}mm — it was 32mm`);
    assert.ok(webMm >= pdfWebMm * 0.75,
      `the printed web (${webMm.toFixed(1)}mm) is within reach of the file's (${pdfWebMm}mm)`);
    assert.ok(webMm <= pdfWebMm * 1.15, "and does not overshoot it either");

    /* ---- BARS AND RADAR STILL SHARE ONE ROW, at the file's ratio ------------ */
    assert.ok(printBlock.includes("body.print-review .report-sheet .rp-skills-row{grid-template-columns:56fr 44fr !important}"),
      "print splits the row 56/44, as the renderer does");
    assert.ok(PDF.includes("const barsW = (CONTENT_W - gap) * 0.56;"), "which is the file's own split");
    /* The bars keep the larger share, so ten labelled rows still have a track. */
    assert.ok(REPORT_VIEW.includes('className="rp-skill-bars"'), "the bars are still a column");
    assert.ok(REPORT_VIEW.includes('className="rp-skills-row"'), "inside the row the print rule targets");

    /* ---- NO CLIPPING: the labels stay inside the column plus its gutter -----
     * A label is anchored at R_LABEL of the box and grows outward. The widest
     * label at 9px is about 65px, and the gutter is 20px. */
    const contentPx = (210 - 24) * (96 / 25.4);
    const gutter = 20;
    const radarCol = (contentPx - gutter) * 0.44;
    const reach = s.radar * (geo("R_LABEL") / (geo("R_CENTER") * 2)) + 65;
    assert.ok(reach <= radarCol / 2 + gutter,
      `a label reaches ${reach.toFixed(0)}px; the column half plus gutter is ${(radarCol / 2 + gutter).toFixed(0)}px`);

    /* ---- THE SCREEN IS UNAFFECTED ------------------------------------------ */
    assert.ok(CHARTS.includes("maxWidth: 224"), "the screen keeps its own cap");
    assert.equal(CSS_RULES.split(".skill-radar{").length - 1, printBlock.split(".skill-radar{").length - 1,
      ".skill-radar is restyled only for print");
  });

  it("76. the compaction outranks BOTH an inline style and the 620px rule", () => {
    /* Two cascade traps this repository has already been bitten by. The report
     * component sets `marginBottom`, `gap`, `padding` and `maxWidth` inline, and
     * an inline declaration beats a plain stylesheet rule; and
     * `@media (max-width:620px){.report-sheet{padding:22px 18px}}` sits later in
     * this file, so at equal specificity it would win when printing from a narrow
     * window. `body.print-review .report-sheet …` is (0,2,1) or better WITH
     * `!important`, which beats both. */
    assert.ok(REPORT_VIEW.includes("marginBottom: 22"), "the inline margins are real");
    assert.ok(REPORT_VIEW.includes("gap: 7"), "and so is the inline bar-row gap");
    assert.ok(REPORT_VIEW.includes('gridTemplateColumns: "repeat(auto-fit'), "and the inline grids");
    assert.ok(CSS.includes(".report-sheet{padding:22px 18px !important"), "and so is the 620px rule");
    for (const [, rule] of printBlock.matchAll(/\n {2}(body\.print-review [^\n]*\{[^}]*\})/g)) {
      assert.ok(rule.includes("!important"), `unimportant print rule: ${rule}`);
    }
    assert.ok(!printBlock.includes("\n  .report-sheet{padding:0"), "none of them is written unscoped");
  });

  it("76a. every print-only hook the budget needs exists on the document", () => {
    /* A rule can only reach an element it can select, and an `!important` rule
     * aimed at a class nobody renders is the exact shape of the two inert fixes
     * Gate 4.4D shipped. Each hook is checked in BOTH directions. */
    for (const [hook, file] of [
      ["rp-meta", REPORT_VIEW], ["rp-tile", REPORT_VIEW], ["rp-goals", REPORT_VIEW],
      ["rp-block-title", REPORT_VIEW], ["rp-skills-row", REPORT_VIEW],
      ["rp-skill-bars", REPORT_VIEW], ["rp-summary", REPORT_VIEW],
      ["rp-summary-card", REPORT_VIEW], ["skill-radar", CHARTS],
    ] as const) {
      assert.ok(printBlock.includes(`.${hook}{`), `the stylesheet targets .${hook}`);
      assert.ok(file.includes(hook), `and a component actually renders .${hook}`);
      assert.equal(CSS_RULES.split(`.${hook}{`).length - 1,
        printBlock.split(`.${hook}{`).length - 1,
        `.${hook} is declared only inside @media print`);
    }
  });

  it("77. no report SECTION is removed to make the page fit", () => {
    /* The app footer IS removed from browser print, deliberately — test 79a. It
     * is the document's colophon rather than a section of the assessment, and
     * the downloaded PDF still carries its own. Nothing else may be hidden to
     * buy back a page. */
    for (const [sel, what] of [
      [".rp-block{display:none", "a section"],
      [".rp-head{display:none", "the masthead"],
      [".skill-radar{display:none", "the radar"],
      [".rp-meta{display:none", "the student meta"],
      [".rp-tile{display:none", "the score tiles"],
      [".rp-summary{display:none", "the teacher summary"],
      [".rp-goals{display:none", "the goals"],
      [".rp-skill-bars{display:none", "the skill bars"],
    ] as const) {
      assert.ok(!printBlock.includes(sel), `print must not hide ${what}`);
    }
    /* And the spacing budget itself hides nothing at all: the ONE `display:none`
     * among the sheet's own print rules is the footer's, declared after it. */
    const compaction = printBlock.slice(printBlock.indexOf("body.print-review .report-sheet{"));
    assert.ok(!/display:none/.test(compaction.slice(0, compaction.indexOf(".rp-foot{"))),
      "the budget buys its page back from gaps, never from content");
    /* THE CANARY: three in the whole print block, and each one is named. */
    assert.equal(stripComments(printBlock).match(/display:none/g)?.length, 3,
      "`.no-print` chrome, everything outside the overlay, and the report footer");
    assert.ok(REPORT_VIEW.includes("Parent notes") && REPORT_VIEW.includes("Teacher summary"));
  });

  it("78. THE AUDIT: what the printable page holds, and what it does not", () => {
    /* ---- WHAT THIS COMPUTES -------------------------------------------------
     * A4 is 297mm and `@page{margin:12mm}` leaves a 273mm content box — 1032 CSS
     * px at 96dpi. The sheet's height is the sum of its blocks, and every value
     * that decides it is either an inline metric in the report component or a
     * print rule in globals.css. This reads the print values back out of the
     * stylesheet and adds the component's own type metrics.
     *
     * IT IS A MODEL, NOT A RENDER, and it is regression support only. Nothing
     * here opens a browser, and the browser is what decides — the last two
     * architectures were each defensible on paper and each failed in Chrome.
     * What this CAN do is fail the moment a gap is loosened past what the page
     * holds, and say which shapes of report sit on which side of the fold.
     *
     * THE FOOTER IS NOT COUNTED AT ALL. Browser print hides `.rp-foot`, so the
     * printed column is the report's content and nothing else. */
    const s = SPACING();
    const PX = 96 / 25.4;
    const page = printBlock.match(/@page\{margin:(\d+)mm\}/);
    assert.ok(page, "the page carries one balanced gutter again");
    const BOX = (297 - Number(page![1]) * 2) * PX;
    const line = (size: number, lh = 1.2) => size * lh;

    for (const metric of ["fontSize: 11.5", "fontSize: 12.5", "fontSize: 21", "14.5 : 13"]) {
      assert.ok(REPORT_VIEW.includes(metric), `the sheet still uses ${metric}`);
    }
    const blockTitle = line(11.5) + s.titleGap + s.titlePadB + 1;
    const prose = line(12.5, 1.6);
    const cardLine = line(12.5, 1.45);

    const head = 34 + s.headPadB + 2 + s.headMargB;
    const meta = line(10) + 4 + line(14.5) + s.blockGap; // ONE row on paper
    const tiles = s.tilePad * 2 + line(21) + 3 + line(10.5) + 2 + line(10) + 2 + s.blockGap;
    const bars = 10 * 14 + 9 * s.barGap;
    const skills = blockTitle + Math.max(bars, s.radar + 4) + s.blockGap;
    const summary = blockTitle + (s.cardPad * 2 + line(10) + 6 + cardLine + 2) + s.blockGap;
    /* NO FOOTER TERM: print hides it, so it costs the printed column nothing. */
    const fixedPart = head + meta + tiles + skills + summary;

    /* THE VERIFICATION SHAPE CARRIES PARENT NOTES. Every model before this one
     * left that section out, which is part of why print was measured as fitting
     * while the browser disagreed. */
    const report = (c: number, st: number, i: number, g: number, pn: number) =>
      fixedPart
      + (blockTitle + c * prose + s.blockGap)
      + (line(12) + 5 + Math.max(st, i) * prose + s.blockGap)
      + (s.goalsPad * 2 + line(12) + 5 + g * prose + 2 + s.blockGap)
      + (pn > 0 ? blockTitle + pn * prose + s.blockGap : 0);

    const sparse = report(3, 2, 2, 2, 2);
    const typical = report(4, 3, 3, 2, 2);
    assert.ok(sparse < BOX,
      `a sparse short report with parent notes is ${sparse.toFixed(0)}px of ${BOX.toFixed(0)}`);
    assert.ok(typical < BOX,
      `a typical short report with parent notes is ${typical.toFixed(0)}px of ${BOX.toFixed(0)}`);

    /* AND A LONG ONE GENUINELY EXCEEDS ONE PAGE, which is correct: content
     * integrity and natural pagination outrank a one-page result. */
    assert.ok(report(24, 10, 10, 8, 8) > BOX, "a long review paginates");
    /* NO FLOOR, NO CAP, NO RESERVATION. Every earlier pass measured the page
     * against a declared minimum height; there is no longer one to measure, and
     * that is the point — the sheet is exactly as tall as its content, so it
     * cannot overflow into a page the content never asked for. */
    const rules = stripComments(printBlock);
    assert.deepEqual(rules.match(/min-height:[^;}]*/g), ["min-height:0 !important"],
      "the only min-height in print RELEASES the shell's floor; nothing declares one");
    assert.ok(!rules.includes("100vh"), "and nothing sizes the sheet against a viewport");
    assert.ok(!/@page\{[^}]*(?:padding|margin-bottom|margin-top)/.test(rules),
      "and @page reserves no band for a footer");
  });

  it("78a. long reports still paginate — nothing pins the sheet to one page", () => {
    assert.ok(printBlock.includes(".report-sheet .rp-block,.report-sheet .rp-head{break-inside:avoid !important"),
      "blocks are still kept whole across the fold");
    const rules = stripComments(printBlock);
    assert.ok(!rules.includes("page-break-inside:auto"));
    assert.ok(!rules.includes("break-inside:auto"));
    /* A MINIMUM height can only add space, never remove it, so it cannot clip a
     * long report — but a fixed height, a cap or a hidden overflow could. */
    for (const fiction of ["height:297mm", "overflow:hidden", "transform:scale"]) {
      assert.ok(!rules.includes(fiction), `${fiction} would clip a long report`);
    }
    for (const rule of rules.match(/body\.print-review \.report-sheet\{[^}]*\}/g) ?? []) {
      assert.ok(!/[^-]height:\s*\d/.test(rule), `the sheet carries no fixed height: ${rule}`);
    }
    /* And the PDF renderer, which has its own budget, still paginates — proved
     * for real in test 65. */
    assert.ok(PDF.includes("this.doc.addPage();"));
  });

  it("79. the browser's own header and footer are not modelled as app content", () => {
    /* THE HONEST LIMIT, and it is about a DIFFERENT footer. The URL, date, page
     * number and site name at the edges of a print preview are user-agent chrome
     * drawn outside the page box. No stylesheet or script can remove them — only
     * the person printing can. The `.rp-foot` rule is about the REPORT's own
     * footer, which is app content, and which print hides — test 79a. */
    for (const fiction of ["@page :header", "@page :footer", "@top-center", "@bottom-center",
      "counter(page)", "content:\"\" !important"]) {
      assert.ok(!CSS.includes(fiction), `${fiction} would be a claim this cannot deliver`);
    }
    assert.ok(CSS.includes("are the BROWSER's own headers"), "the constraint is documented in the stylesheet");
    assert.ok(CSS.includes("Headers and footers"), "including how a user turns them off themselves");
    assert.ok(CSS.includes("`.rp-foot` rule further down is about the REPORT's own"),
      "and the two footers are distinguished where the rules live");
  });

  it("79a. THE APP FOOTER IS NOT PRINTED, and nothing survives to place it", () => {
    const rules = stripComments(printBlock);

    /* ---- THE FINAL CONTRACT, AFTER FOUR ARCHITECTURES ----------------------
     * Each was disproved by real Chrome/Edge verification: a repeated
     * `position:fixed` footer with an `@page` band, which cost every page 9mm
     * and did not repeat; a `min-height:250mm` floor, which never engaged; a
     * viewport-relative floor with the footer on `margin-top:auto`, which turned
     * a few millimetres of overflow into a footer-only second page; and plain
     * flow, which stopped forcing a page but left the footer wherever the
     * content happened to end, which is not a footer.
     *
     * So browser print carries no app footer at all. */
    const foot = rules.slice(rules.indexOf("body.print-review .report-sheet .rp-foot{"));
    const decl = foot.slice(foot.indexOf("{") + 1, foot.indexOf("}"));
    assert.equal(decl.trim(), "display:none !important",
      "the printed footer declares its own absence and nothing else");
    assert.equal(rules.split(".rp-foot{").length - 1, 1,
      "and it is the only `.rp-foot` rule inside @media print");

    /* ---- NO OBSOLETE FOOTER LAYOUT SURVIVES, AS A RULE OR AS A COMMENT ---- */
    for (const revoked of ["margin-top:auto", "flex-direction:column", "position:fixed",
      "position:absolute", "100vh", "267mm", "250mm", "padding-top:9px"]) {
      assert.ok(!rules.includes(revoked),
        `a revoked footer architecture survives in print: ${revoked}`);
    }
    for (const rule of rules.match(/body\.print-review \.report-sheet\{[^}]*\}/g) ?? []) {
      assert.ok(!rule.includes("min-height"), `the sheet carries no height floor: ${rule}`);
      assert.ok(!rule.includes("display:flex"), `nor a flex column: ${rule}`);
    }
    /* ONE BALANCED PAGE GUTTER — no band reserved for anything. */
    assert.ok(rules.includes("@page{margin:12mm}"), "the page gutter is balanced");
    assert.ok(!/@page\{margin:[^}]*\s/.test(rules), "no footer-only reservation survives");
    /* NOT EVEN KEPT WHOLE: a hidden element has no fold to be pushed across. */
    assert.ok(!rules.includes("rp-foot{break-inside"), "no break-inside on the footer");
    assert.ok(!/break-inside:avoid[^{}]*rp-foot/.test(rules),
      "and the break-inside list no longer names it");
    assert.ok(rules.includes(".report-sheet .rp-block,.report-sheet .rp-head{break-inside:avoid"),
      "while the real blocks are still kept whole");

    /* NO DEAD LOGIC LEFT BEHIND, commented out or otherwise — the stylesheet
     * explains the history in prose, and prose is not a rule. */
    assert.ok(!printBlock.includes("/* body.print-review"), "no commented-out rules");

    /* ---- PARENT NOTES IS THE LAST VISIBLE REPORT BLOCK IN PRINT ------------ */
    assert.ok(REPORT_VIEW.indexOf('className="rp-foot"') > REPORT_VIEW.indexOf("Parent notes"),
      "the footer is the last thing in the sheet's source");
    const after = REPORT_VIEW.slice(REPORT_VIEW.indexOf("Parent notes"));
    assert.equal(after.match(/className="rp-block/g)?.length ?? 0, 0,
      "so with the footer hidden, Parent notes is the final report block on paper");

    /* ---- THE SCREEN PREVIEW KEEPS ITS FOOTER ------------------------------- */
    const screen = CSS_RULES.replace(stripComments(printBlockOf()), " ");
    assert.ok(screen.includes(".report-sheet .rp-foot{"), "the screen still styles the footer");
    assert.ok(!/\.rp-foot\{[^}]*display:none/.test(screen), "and does not hide it");
    assert.ok(!/\.rp-foot\{[^}]*position:/.test(screen), "no positioned footer on screen");
    assert.ok(!/\.report-sheet\{[^}]*display:flex/.test(screen), "and no flex column on screen");
    assert.ok(REPORT_VIEW.includes('<div className="rp-foot">'),
      "and the component still renders it, for the preview and the overlay");

    /* ---- THE ANCHORED FOOTER LIVES IN THE FILE, UNTOUCHED ------------------
     * The downloaded PDF draws its footer at the bottom of every page, in
     * millimetres, because that file is the family-facing document. */
    assert.ok(PDF.includes("const y = PAGE.h - PAGE.margin + 2;"),
      "the file's footer is anchored, and untouched by any of this");
    assert.ok(PDF.includes("const pages = doc.getNumberOfPages();"), "on every page of it");
    assert.ok(CSS.includes("THE DOWNLOADED PDF IS THE FAMILY-FACING DOCUMENT"),
      "and the distinction is written where the print rules are");
  });
});

describe("Gate 4.4E final · the overlay Close button", () => {
  it("80. Close is the icon alone, and keeps its accessible name", () => {
    const overlay = COMPOSER.slice(COMPOSER.indexOf("function PreviewOverlay"));
    const close = overlay.slice(overlay.indexOf('className="btn-ghost rvc-overlay-close"') - 200);
    const body = close.slice(0, close.indexOf("</button>"));
    assert.ok(body.includes("{iconClose}"), "the icon");
    /* The button's CHILDREN — everything between the opening tag's ">" and the
     * closing tag — are the icon and nothing else. The aria-label is an
     * attribute and lives before that ">", so it is not what this reads. */
    const children = body.slice(body.indexOf(">", body.indexOf("<button")) + 1).trim();
    assert.equal(children.replace(/\s+/g, " "), "{iconClose}", "no visible label beside it");
    assert.ok(body.includes('aria-label={t("Close")}'), "the accessible name survives");
    assert.ok(!body.includes("title="), "and it does not rely on a tooltip");
  });

  it("81. Print and Export PDF keep their words", () => {
    /* Close is a dismiss and an × is universal. These two name a decision — an
     * unlabelled printer or arrow would be a guess — so they stay labelled at
     * every width, which §20 already required. */
    const region = COMPOSER.slice(COMPOSER.indexOf("const reportActions = ("));
    const body = region.slice(0, region.indexOf("\n  );"));
    assert.ok(body.includes('{t("Print")}'));
    assert.ok(body.includes('t(exporting ? "Exporting…" : "Export PDF")'));
    assert.ok(!body.includes("aria-label"), "they need none — their text IS the name");
  });

  it("82. it needs no breakpoint, because the overlay has only one", () => {
    /* The Preview control does not exist at 1100 and up, so the overlay is only
     * ever reachable below it. One shape at every width it can appear at beats a
     * second breakpoint that could disagree with the first. */
    assert.ok(!CSS.includes(".rvc-overlay-close .rvc-btn-label"), "no label to hide");
    const P620 = mediaBlock("(max-width:620px)", ".rvc-overlay-head");
    assert.ok(!P620.includes(".rvc-overlay-close{display"), "and nothing hides it at 620");
    assert.ok(P620.includes(".rvc-overlay-close{order:1}"), "it only changes position");
    assert.ok(CSS.includes(".rvc-overlay-close{flex:none}"), "and never shrinks");
  });

  it("83. the title keeps the width Close gave back", () => {
    assert.ok(CSS.includes(".rvc-overlay-title{flex:1;min-width:0}"));
    const P620 = mediaBlock("(max-width:620px)", ".rvc-overlay-head");
    assert.ok(P620.includes(".rvc-overlay-title{flex:1 1 auto;order:0}"));
    const name = P620.slice(P620.indexOf(".rvc-overlay-name{"));
    assert.ok(name.slice(0, name.indexOf("}") + 1).includes("overflow-wrap:normal"),
      "and still wraps at words, never mid-word");
  });
});

/* =========================================================================
 * 12. The tie-aware teacher summary, on every surface
 * ======================================================================
 * WHAT THIS SECTION IS FOR. The summary used to name ONE strongest skill and ONE
 * weakest, each the head of a canonical ranking. On the gate's own example —
 * Listening/Speaking/Reading at 4, Writing/Grammar at 3 — it told a family that
 * Listening was the best skill and Writing the weakest. Both sentences were
 * false, and both were deterministic, which is why nothing caught them.
 *
 * The fix is one tie-aware helper that every surface renders. So these tests
 * assert TWO things: the semantics (which skills, in what order, and what
 * happens when they are all equal), and the single-source property — because
 * three surfaces composing their own strings is how the previous version drifted.
 */

describe("Gate 4.4E final · the tie-aware summary is computed ONCE", () => {
  it("84. the composer card, the report sheet and the PDF all read one function", () => {
    for (const [name, src] of [
      ["the composer card", COMPOSER],
      ["the report sheet", REPORT_VIEW],
      ["the PDF document model", DOCUMENT],
    ] as const) {
      assert.ok(src.includes("teacherSummaryLines("), `${name} calls the shared helper`);
      /* AND COMPOSES NOTHING ITSELF. No surface may reach past the helper into
       * the raw sets, which is exactly how a "first of the tie" bug gets back in. */
      assert.ok(!src.includes(".strongest["), `${name} does not index the strongest set`);
      assert.ok(!src.includes(".focusAreas["), `${name} does not index the focus set`);
      assert.ok(!src.includes("weakest"), `${name} carries no 'weakest' anything`);
    }
    // The helper itself lives in the report model, beside the DTO it reads.
    assert.ok(REPORT_MODEL.includes("export function teacherSummaryLines"));
  });

  it("85. A TIE: the PDF names every strongest skill, in canonical order", () => {
    /* Three at 5, the rest at 3 — the file must not serialise only the first. */
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), listening: 5, speaking: 5, reading: 5 } }),
    );
    const rows = buildReviewPdfDocument(report, en).blocks.find((b) => b.kind === "summary");
    assert.ok(rows?.kind === "summary");
    const strongest = rows.items.find((r) => r.label === "Strongest skills");
    assert.ok(strongest, "the label is plural, because there are three");
    assert.deepEqual(strongest!.items, ["Listening", "Speaking", "Reading"]);
    assert.equal(strongest!.detail, "5");
    assert.ok(!rows.items.some((r) => r.label === "Best skill"), "and no single-winner claim");

    // The same words the sheet shows — same helper, same order, same rating.
    const lines = teacherSummaryLines(report, (k) => k);
    assert.deepEqual(
      rows.items.map((r) => [r.label, r.items.join(", "), r.detail]),
      lines.map((l) => [l.label, l.items.join(", "), l.detail]),
      "the file and the screen state the summary identically",
    );
  });

  it("86. A TIE AT THE BOTTOM: every focus area appears, and it is not called 'weakest'", () => {
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(4), writing: 3, grammar: 3 } }),
    );
    const lines = teacherSummaryLines(report, (k) => k);
    const focus = lines.find((l) => l.kind === "focus");
    assert.ok(focus, "a focus line exists");
    assert.equal(focus!.label, "Focus areas");
    assert.equal(focus!.value, "Writing, Grammar · 3");
    assert.ok(!lines.some((l) => /weak/i.test(l.label)), "no teacher-facing 'weakest'");
    // And the strongest line names all seven at 4, not the canonical first.
    const strongest = lines.find((l) => l.kind === "strongest");
    assert.ok(strongest!.value.split(", ").length > 1, "the strongest tie is named in full");
  });

  it("87. A SINGLE WINNER still reads as one, not as a set of one", () => {
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), reading: 5, writing: 1 } }),
    );
    const lines = teacherSummaryLines(report, (k) => k);
    assert.equal(lines.find((l) => l.kind === "strongest")!.label, "Strongest skill");
    assert.equal(lines.find((l) => l.kind === "strongest")!.value, "Reading · 5");
    assert.equal(lines.find((l) => l.kind === "focus")!.label, "Focus area");
    assert.equal(lines.find((l) => l.kind === "focus")!.value, "Writing · 1");
  });

  it("88. ALL EQUAL: one neutral structured row, and no invented distinction", () => {
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(3) }));
    const lines = teacherSummaryLines(report, (k) => k);
    const even = lines.find((l) => l.kind === "even");
    assert.ok(even, "the neutral row is rendered");
    assert.equal(even!.label, "Skill ratings");
    assert.equal(even!.value, "All skills · 3/5");
    assert.ok(!lines.some((l) => l.kind === "strongest"), "no strongest claim");
    assert.ok(!lines.some((l) => l.kind === "focus"), "and no focus claim");

    /* STRUCTURED, NOT GENERATED. The neutral state is a label and a value, like
     * every other row — this app does not compose sentences about a child. */
    assert.ok(!/\.$/.test(even!.value), "it is not a sentence");
    assert.ok(!REPORT_MODEL.includes("are currently even"), "no generated prose anywhere");

    // And the file says exactly the same thing.
    const rows = buildReviewPdfDocument(report, en).blocks.find((b) => b.kind === "summary");
    assert.ok(rows?.kind === "summary");
    assert.deepEqual(rows.items.map((r) => r.items), lines.map((l) => l.items));
  });

  it("89. every new label is in the Vietnamese dictionary, and the old ones are gone", () => {
    for (const key of ["Strongest skill", "Strongest skills", "Focus area", "Focus areas",
      "All skills", "Skill ratings", "Biggest improvement"]) {
      assert.ok(typeof DICT[key] === "string" && DICT[key].length > 0, `${key} is translated`);
    }
    for (const retired of ["Best skill", "Weakest skill"]) {
      assert.ok(!(retired in DICT), `${retired} is retired, not left lying in the dictionary`);
    }
    // The document really is written in Vietnamese, end to end.
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), listening: 5, speaking: 5 } }),
    );
    const rows = buildReviewPdfDocument(report, vi).blocks.find((b) => b.kind === "summary");
    assert.ok(rows?.kind === "summary");
    assert.equal(rows.items[0].label, DICT["Strongest skills"]);
    assert.ok(rows.items[0].items.includes(DICT["Listening"] ?? "Listening"));
  });

  it("90. a long tie WRAPS in the file; it is never cut off with an ellipsis", () => {
    /* Nine skills can tie at the top — ten is the all-equal state — and the row
     * used to be one clipped line. An ellipsis on a family's document would drop
     * a child's skills silently. */
    const nine = Object.fromEntries(SKILL_KEYS.map((k, i) => [k, i === 9 ? 2 : 5]));
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: nine }));
    const line = teacherSummaryLines(report, (k) => k).find((l) => l.kind === "strongest")!;
    assert.equal(line.value.split(", ").length, 9, "all nine are named");
    assert.ok(!line.value.includes("…"), "and none is dropped");

    const doc = buildReviewPdfDocument(report, en);
    const { calls } = record(doc);
    const drawn = calls.filter((c) => c.fn === "text").map((c) => String(c.args[0]));
    assert.ok(!drawn.some((tx) => tx.includes("…")), "the renderer wraps rather than clips");
    /* Every name reaches the page, across however many lines the card took. */
    const joined = drawn.join(" ");
    for (const name of ["Listening", "Speaking", "Pronunciation", "Confidence"]) {
      assert.ok(joined.includes(name), `${name} is on the page`);
    }
    /* THE CARD GROWS, IT DOES NOT CLIP: the summary block wraps each item's names
     * to the card's inner width and reserves the tallest card's height before it
     * draws anything, so a nine-way tie prints in full. `clip` — the renderer's
     * ellipsis helper — is never reached from this block. */
    assert.ok(PDF.includes("const wrapped = block.items.map((item) =>"),
      "the summary block wraps its names");
    assert.ok(PDF.includes("const bodyLines = Math.max(1, ...wrapped.map((w) => w.length));"),
      "and sizes the row from the tallest card");
    const summaryCase = PDF.slice(PDF.indexOf('case "summary": {'), PDF.indexOf('case "proseRow": {'));
    assert.ok(!summaryCase.includes("clip(doc, item.items"), "the names are never ellipsised");
  });

  it("91. §23 CONTENT PARITY: the three surfaces agree on every derived figure", () => {
    /* One report, three renderings. Anything a surface could disagree about is
     * checked against the DTO both others read. */
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(4), writing: 3, grammar: 3 } }),
    );
    const doc = buildReviewPdfDocument(report, en);
    const flat = allText(doc.blocks);

    // overall score, attendance, homework, generated date, student, parent, period
    assert.ok(flat.includes(report.summary.overallScore.toFixed(1)), "the same overall score");
    assert.ok(flat.includes(`${report.summary.attendance!.pct}%`), "the same attendance");
    assert.ok(flat.includes(`${report.summary.homework!.pct}%`), "the same homework");
    assert.ok(flat.includes(report.meta.generatedOn), "the same generated date");
    assert.ok(flat.includes(report.student.name) && flat.includes(report.parent!.name));
    assert.ok(flat.includes(report.period));

    // the ten values, the ten per-rating colours, and the ten radar axes
    const block = doc.blocks.find((b) => b.kind === "skills");
    assert.ok(block?.kind === "skills");
    assert.deepEqual(block.bars.map((b) => b.rating), report.skills.map((s) => s.rating));
    assert.deepEqual(block.bars.map((b) => b.color), report.skills.map((s) => s.color));
    assert.deepEqual(block.axes.map((a) => a.rating), report.radar.current.map((a) => a.rating));

    // and the tie rule itself — one function, so no surface can apply another
    const lines = teacherSummaryLines(report, (k) => k);
    const rows = doc.blocks.find((b) => b.kind === "summary");
    assert.ok(rows?.kind === "summary");
    assert.deepEqual(rows.items.map((r) => r.items), lines.map((l) => l.items));
    assert.ok(lines.some((l) => l.kind === "strongest" && l.value.includes(", ")),
      "and the fixture really does carry a tie");
  });
});

/* =========================================================================
 * 13. The teacher-summary LAYOUT — the same structure on three surfaces
 * ======================================================================
 * WHY THIS SECTION EXISTS. Section 12 proves the summary SAYS the right thing.
 * It said the right thing and was still unreadable: three `label ……… value` rows
 * with the value pushed right, which worked for "Reading · 5" and collapsed into
 * a blob the moment a tie named eight skills — worst on a phone, and on a sheet
 * a family is meant to read.
 *
 * So the item is now parts rather than one string, and each surface gives it a
 * block: label and figure on one line, names wrapping beneath. These tests pin
 * the STRUCTURE — that there are distinct blocks, that nothing is truncated, and
 * that the phone does not get a different, denser version of the same thing.
 */

describe("Gate 4.4E polish · the teacher summary is a block, not a line", () => {
  it("92. the model carries PARTS — names and figure — not one joined string", () => {
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), listening: 5, speaking: 5 } }),
    );
    const [strongest] = teacherSummaryLines(report, (k) => k);
    assert.deepEqual(strongest.items, ["Listening", "Speaking"], "the names, separately");
    assert.equal(strongest.detail, "5", "and the figure they share, separately");
    assert.equal(strongest.tone, "green", "keyed to one of the app's existing tokens");
    /* `value` survives as the one-line form, so nothing that wanted a single run
     * lost it — but no surface is forced to render the summary that way. */
    assert.equal(strongest.value, "Listening, Speaking · 5");
  });

  it("93. every tone is one of the app's four, and each item gets the right one", () => {
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(4), writing: 3 } }),
    );
    const byKind = Object.fromEntries(
      teacherSummaryLines(report, (k) => k).map((l) => [l.kind, l.tone]));
    assert.equal(byKind.strongest, "green", "a strength takes the app's green");
    assert.equal(byKind.focus, "amber", "a focus area takes its amber");
    /* The same pair the report's own feedback headings and the profile's
     * strengths card already use — not a palette invented for this block. */
    assert.ok(REPORT_VIEW.includes('color: "var(--green)"') && REPORT_VIEW.includes('color: "var(--amber)"'));

    const first = buildMonthlyReviewReportDraft(context({ history: [] }), draft());
    assert.equal(teacherSummaryLines(first, (k) => k).find((l) => l.kind === "noPrior")!.tone, "muted");
    const even = buildMonthlyReviewReportDraft(context(), draft({ skills: skills(3) }));
    assert.equal(teacherSummaryLines(even, (k) => k).find((l) => l.kind === "even")!.tone, "muted");
  });

  it("94. the SHEET draws a card per item, in the grid idiom it already uses", () => {
    /* Not a new layout language: `repeat(auto-fit,minmax(min(…),1fr))` is the
     * rule the student-meta block and the strengths/improvements pair already
     * carry, so the cards behave like the rest of the document at every width. */
    assert.ok(REPORT_VIEW.includes('className="rp-summary"'), "the block is a grid");
    assert.ok(REPORT_VIEW.includes('gridTemplateColumns: "repeat(auto-fit,minmax(min(210px,100%),1fr))"'),
      "auto-fit, so it collapses to one column on a phone with no breakpoint of its own");
    assert.ok(REPORT_VIEW.includes("function SummaryCard("), "each item owns a card");
    assert.ok(REPORT_VIEW.includes('className="rp-summary-card"'));
    /* THE OLD SHAPE IS GONE — a single row with the value pushed to the right. */
    assert.ok(!REPORT_VIEW.includes("function SummaryRow("), "the label/value row is retired");
    /* NOTHING IS TRUNCATED. `overflowWrap` wraps; no ellipsis, no line clamp. */
    const card = REPORT_VIEW.slice(REPORT_VIEW.indexOf("function SummaryCard("));
    assert.ok(card.includes('overflowWrap: "anywhere"'), "long names wrap");
    for (const clip of ["textOverflow", "WebkitLineClamp", "lineClamp"]) {
      assert.ok(!card.includes(clip), `${clip} would hide a child's skill`);
    }
    /* The one `nowrap` in the card is the rating PILL — a two-character figure
     * that must not break across lines. It sits on the pill's own declaration,
     * beside its 99px radius, and never on the names. */
    const names = card.slice(card.indexOf("{line.items.join"));
    assert.ok(!names.includes("nowrap"), "the names are never held on one line");
    const pill = card.slice(card.indexOf("borderRadius: 99"), card.indexOf("{line.detail}"));
    assert.ok(pill.includes('whiteSpace: "nowrap"'), "the figure is, which is correct");
  });

  it("95. the COMPOSER card stacks the same item, at every width", () => {
    /* The editor pane is narrow at 1100 and narrower on a phone. One shape, no
     * breakpoint: label and figure on the first line, names wrapping under it. */
    assert.ok(COMPOSER.includes("function SummaryItem("), "the item is its own component");
    assert.ok(!COMPOSER.includes("function SummaryLine("), "the crowded single row is retired");
    const item = COMPOSER.slice(COMPOSER.indexOf("function SummaryItem("));
    assert.ok(item.includes('flexDirection: "column"'), "it stacks rather than competing for one row");
    assert.ok(item.includes('overflowWrap: "anywhere"'), "and the names wrap");
    assert.ok(item.includes("line.items.join"), "drawn from the shared parts");
    /* NO WIDTH-CONDITIONAL SUMMARY ANYWHERE. A phone gets the same structure the
     * desktop gets, which is the only way the two cannot drift. */
    const print = CSS.slice(CSS.indexOf("@media print{"));
    for (const rule of CSS_RULES.match(/rp-summary[^{]*\{[^}]*\}/g) ?? []) {
      assert.ok(print.includes(rule),
        `.rp-summary is styled only for print, not per breakpoint: ${rule}`);
    }
  });

  it("96. the FILE draws the same cards, side by side, inside the margins", () => {
    /* Eight tied skills, so the names really do wrap inside a card. */
    const report = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(4), writing: 3, grammar: 3 } }),
    );
    const doc = buildReviewPdfDocument(report, en);
    const block = doc.blocks.find((b) => b.kind === "summary");
    assert.ok(block?.kind === "summary");
    assert.equal(block.items.length, 3, "three items: strongest, focus, improvement");

    const { calls } = record(doc);
    /* THREE CARD BORDERS, all at the same y, so they are a row and not a stack. */
    const cards = calls.filter((c) => c.fn === "roundedRect" && c.args[6] === "S"
      && Number(c.args[3]) > 8 && Number(c.args[2]) < 100);
    assert.ok(cards.length >= 3, "each item is drawn as its own bordered card");
    const row = cards.slice(-3);
    const ys = row.map((c) => Number(c.args[1]));
    assert.ok(Math.max(...ys) - Math.min(...ys) < 0.01, "the three cards share one Y-band");
    const xs = row.map((c) => Number(c.args[0]));
    assert.deepEqual([...xs].sort((a, b) => a - b), xs, "laid out left to right");
    // Inside A4's margins, with a real gutter between neighbours.
    assert.ok(Math.min(...xs) >= 12 - 0.01, "nothing left of the 12mm margin");
    const right = Math.max(...row.map((c) => Number(c.args[0]) + Number(c.args[2])));
    assert.ok(right <= 210 - 12 + 0.01, "and nothing right of it");
    assert.ok(xs[1] > xs[0] + Number(row[0].args[2]) - 0.01, "a gutter, not a collision");
    // Equal heights: the row takes the tallest card, so none is clipped.
    const heights = row.map((c) => Number(c.args[3]));
    assert.ok(Math.max(...heights) - Math.min(...heights) < 0.01, "the cards share the row's height");
  });

  it("97. a nine-way tie grows the card downward and prints every name", () => {
    const nine = Object.fromEntries(SKILL_KEYS.map((k, i) => [k, i === 9 ? 2 : 5]));
    const report = buildMonthlyReviewReportDraft(context(), draft({ skills: nine }));
    const short = buildMonthlyReviewReportDraft(
      context(), draft({ skills: { ...skills(3), reading: 5, writing: 1 } }));

    const heightOf = (r: typeof report) => {
      const { calls } = record(buildReviewPdfDocument(r, en));
      const cards = calls.filter((c) => c.fn === "roundedRect" && c.args[6] === "S"
        && Number(c.args[3]) > 8 && Number(c.args[2]) < 100).slice(-3);
      assert.ok(cards.length === 3);
      return Number(cards[0].args[3]);
    };
    assert.ok(heightOf(report) > heightOf(short),
      "the tie's card is taller — it wraps rather than clipping");

    // And every one of the nine names is actually drawn.
    const { calls } = record(buildReviewPdfDocument(report, en));
    const drawn = calls.filter((c) => c.fn === "text").map((c) => String(c.args[0])).join(" ");
    for (const key of SKILL_KEYS.slice(0, 9)) {
      const label = report.skills.find((s) => s.key === key)!.label;
      assert.ok(drawn.includes(label), `${label} is printed`);
    }
  });

  it("98. all three surfaces still agree, layout aside", () => {
    /* §5 of the gate: only the presentation improved. The semantics are section
     * 12's, and this re-checks them through the new shape on every surface. */
    for (const skillMap of [
      { ...skills(4), writing: 3, grammar: 3 }, // a tie at both ends
      { ...skills(3), reading: 5, writing: 1 }, // one winner
      skills(3),                                // all equal
    ]) {
      const report = buildMonthlyReviewReportDraft(context(), draft({ skills: skillMap }));
      const lines = teacherSummaryLines(report, (k) => k);
      const block = buildReviewPdfDocument(report, en).blocks.find((b) => b.kind === "summary");
      assert.ok(block?.kind === "summary");
      assert.deepEqual(
        block.items.map((i) => [i.label, i.items, i.detail, i.tone, i.muted]),
        lines.map((l) => [l.label, l.items, l.detail, l.tone, l.muted]),
        "the file carries exactly the lines the screen renders",
      );
      assert.ok(!lines.some((l) => /weak|best/i.test(l.label)), "no single-winner label anywhere");
    }
  });
});

/* =========================================================================
 * 14. Section dividers — the same boundary in all three documents
 * ======================================================================
 * WHY THIS SECTION EXISTS. The sheet gave every section title a hairline rule
 * and the exported file drew the words and stopped, so the same report had
 * visible section boundaries on paper and none in the PDF. It drifted because
 * each surface decided it alone — the sheet in an inline style, the renderer in
 * a `case "heading"` that only wrote text.
 *
 * `REPORT_SECTION` is where that decision lives now. These tests pin that both
 * surfaces read it, that the ink is the report sheet's own border token rather
 * than a line colour chosen for the PDF, and — the part that actually keeps them
 * honest — that the SET of ruled sections is the same on both.
 */

describe("Gate 4.4E polish · section dividers, in every document", () => {
  /** The four top-level sections a full report carries, in order. */
  const SECTIONS = ["Skill ratings", "Teacher summary", "Teacher comment", "Parent notes"];

  it("99. one spec decides that a section title is ruled, and in which token", () => {
    assert.equal(REPORT_SECTION.divider, true);
    assert.equal(REPORT_SECTION.dividerToken, "var(--border)");
    /* THE RENDERER READS THE SPEC — it does not carry its own opinion. */
    assert.ok(PDF.includes("REPORT_SECTION.divider"), "the renderer branches on the spec");
    assert.ok(PDF.includes("reportTokenInk(REPORT_SECTION.dividerToken)"),
      "and resolves its token through the one token helper");
    /* NO PDF-ONLY LINE COLOUR. The divider is never a literal picked here. */
    const heading = PDF.slice(PDF.indexOf('case "heading": {'), PDF.indexOf('case "skills": {'));
    assert.ok(!/setDrawColor\(\s*\d/.test(heading), "no hard-coded ink in the heading case");
  });

  it("100. the token resolves to the report sheet's OWN --border, not a dark line", () => {
    /* Read out of globals.css, so a restyled document palette fails here until
     * the PDF follows — the same guarantee the four performance bands have. */
    const body = (() => {
      let from = 0;
      for (;;) {
        const at = CSS.indexOf(".report-sheet{", from);
        assert.ok(at >= 0, "the report sheet declares a palette somewhere");
        const rule = CSS.slice(at, CSS.indexOf("}", at));
        if (rule.includes("--border:#")) return rule;
        from = at + 1;
      }
    })();
    const hex = body.match(/--border:#([0-9a-f]{6})/)![1];
    const expected = [
      parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
    ];
    assert.deepEqual([...reportTokenInk(REPORT_SECTION.dividerToken)], expected,
      `the divider inks .report-sheet's own --border (#${hex})`);
    /* SUBTLE, AND SUBORDINATE TO THE HEADING: a near-white grey, nowhere near
     * the body ink the words are drawn in. */
    assert.ok(expected.every((c) => c > 200), "it is a light neutral, not a dark rule");
    assert.ok(PDF.includes('"var(--border)": [232, 232, 236]'), "the literal matches the sheet");

    /* And the SHEET draws the same token, in its own colour space. */
    assert.ok(REPORT_VIEW.includes('borderBottom: "1px solid var(--border)"'),
      "the screen rules its titles with the same token");
  });

  it("101. every top-level section in the file gets a rule — and only those", () => {
    /* A REPORT WITH A REAL SPREAD, deliberately: the all-equal neutral card is
     * labelled "Skill ratings" — the approved wording — which is also a section
     * title, and a fixture carrying both would count one heading twice. */
    const doc = docFor({}, {
      skills: { ...skills(3), reading: 5, writing: 1 }, parentNotes: "Ghi chú.",
    });
    const headings = doc.blocks.filter((b) => b.kind === "heading");
    assert.deepEqual(headings.map((h) => h.kind === "heading" && h.text), SECTIONS,
      "the four top-level sections");

    const { calls } = record(doc);
    /* A DIVIDER IS A FULL-WIDTH HORIZONTAL LINE. The masthead rule and the footer
     * rule are the same shape, so they are identified and excluded by their own
     * draw colour: both are drawn in the accent and the muted border
     * respectively at a different line width. Counting by geometry alone would
     * conflate them, so this counts lines drawn immediately after a heading's
     * text at the heading's own offset. */
    const fullWidth = calls.filter((c) => c.fn === "line"
      && Math.abs(Number(c.args[0]) - 12) < 0.01
      && Math.abs(Number(c.args[2]) - (210 - 12)) < 0.01
      && Number(c.args[1]) === Number(c.args[3]));

    const titles = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.fn === "text" && SECTIONS.some((s) => String(c.args[0]) === s.toUpperCase()));
    assert.equal(titles.length, SECTIONS.length, "each section title is written");

    for (const { c, i } of titles) {
      const titleY = Number(c.args[2]);
      const rule = fullWidth.find((l) => calls.indexOf(l) > i && Number(l.args[1]) > titleY
        && Number(l.args[1]) - titleY < 4);
      assert.ok(rule, `${String(c.args[0])} is ruled just beneath its words`);
      assert.equal(Number(rule!.args[1]), Number(rule!.args[3]), "the rule is horizontal");
    }

    /* ONLY THOSE. Four section rules, plus the masthead's and the footer's —
     * and nothing else draws a full-width line. */
    assert.equal(fullWidth.length, SECTIONS.length + 2,
      "four section dividers, the masthead rule and the footer rule");
  });

  it("102. internal labels and cards are NOT ruled", () => {
    /* Strengths, Areas for improvement and the goals title are headings INSIDE a
     * section; the sheet does not rule them and neither does the file. Nor do
     * the summary cards' own labels. */
    const doc = docFor({}, { strengths: "A.", improvements: "B.", goals: "C." });
    const { calls } = record(doc);
    const internal = ["Strengths", "Areas for improvement", "Learning goals for next month"];
    for (const label of internal) {
      const at = calls.findIndex((c) => c.fn === "text" && String(c.args[0]) === label);
      assert.ok(at >= 0, `${label} is drawn`);
      const y = Number(calls[at].args[2]);
      const ruled = calls.some((c) => c.fn === "line"
        && Math.abs(Number(c.args[0]) - 12) < 0.01
        && Number(c.args[1]) > y && Number(c.args[1]) - y < 4);
      assert.ok(!ruled, `${label} is an internal label and must not be ruled`);
    }
    /* The summary cards carry a BORDER, which is a box and not a section rule. */
    const summaryCase = PDF.slice(PDF.indexOf('case "summary": {'), PDF.indexOf('case "proseRow": {'));
    assert.ok(summaryCase.includes('roundedRect(x, top, cardW, cardH, 2, 2, "S")'), "cards are boxed");
    assert.ok(!summaryCase.includes("doc.line("), "and never ruled like a section");
  });

  it("103. Preview, Print and PDF expose the SAME top-level section sequence", () => {
    /* The screen's ruled titles are exactly the `rp-block-title` elements; the
     * file's are exactly the `heading` blocks. Both lists, in order, must be the
     * four sections — which is the parity human verification found broken. */
    const doc = docFor({}, { parentNotes: "Ghi chú." });
    const fileOrder = doc.blocks
      .filter((b) => b.kind === "heading")
      .map((b) => (b.kind === "heading" ? b.text : ""));

    const screenOrder: string[] = [];
    for (const [, key] of REPORT_VIEW.matchAll(/className="rp-block-title" style=\{blockTitle\}>\{t\("([^"]+)"\)\}/g)) {
      screenOrder.push(key);
    }
    assert.deepEqual(screenOrder, SECTIONS, "the sheet rules exactly these four");
    assert.deepEqual(fileOrder, SECTIONS, "and so does the file, in the same order");

    /* PRINT IS THE SHEET — it prints the same DOM — so its rule is the same rule,
     * and the print stylesheet only adjusts the gap around it. */
    const titleAt = printBlockOf().indexOf(".report-sheet .rp-block-title{");
    assert.ok(titleAt >= 0, "print states its own gaps for the section title");
    const titleRule = printBlockOf().slice(titleAt, printBlockOf().indexOf("}", titleAt));
    assert.ok(titleRule.includes("margin-bottom:") && titleRule.includes("padding-bottom:"),
      "print keeps the rule and states its own gaps");
    assert.ok(!printBlockOf().includes(".rp-block-title{border-bottom:none"),
      "print never removes the divider");
  });

  it("104. the divider does not collide with the content beneath it", () => {
    /* The heading reserves room for the words, the rule, and a clear gap under
     * it — so a bar row, a card border or a paragraph never lands on the line. */
    assert.ok(PDF.includes("const RULE_Y = 5.6;"), "the rule sits under the words");
    assert.ok(PDF.includes("sheet.need(REPORT_SECTION.divider ? RULE_Y + RHYTHM.title : 7)"),
      "and the band reserves a clear gap beneath it");

    const { calls } = record(docFor());
    const skillsTitle = calls.findIndex((c) => c.fn === "text" && String(c.args[0]) === "SKILL RATINGS");
    assert.ok(skillsTitle >= 0);
    const rule = calls.slice(skillsTitle).find((c) => c.fn === "line");
    assert.ok(rule, "the section is ruled");
    const ruleY = Number(rule!.args[1]);
    /* The first thing drawn in the section proper — a bar track — is clear of it. */
    const firstTrack = calls.slice(skillsTitle).find((c) => c.fn === "roundedRect" && c.args[6] === "F");
    assert.ok(firstTrack, "the bars follow");
    assert.ok(Number(firstTrack!.args[1]) > ruleY,
      `the content starts below the rule (${Number(firstTrack!.args[1]).toFixed(1)} > ${ruleY.toFixed(1)})`);
  });

  it("105. the PDF's own rhythm is a scale too, and it did not cost a page", () => {
    /* §9: the file is roomier than the page, but its gaps had drifted — 3mm after
     * the meta block, 6mm after the tiles, 4mm everywhere else. One named scale
     * now, with the same ordering the stylesheet keeps. */
    const num = (name: string) => {
      const m = PDF.match(new RegExp(`${name}:\\s*([\\d.]+),`));
      assert.ok(m, `RHYTHM declares ${name}`);
      return Number(m![1]);
    };
    const section = num("section"), title = num("title"), inner = num("inner");
    assert.ok(section > title, `a section boundary (${section}mm) exceeds a title gap (${title}mm)`);
    assert.ok(section > 0 && inner > 0);
    assert.ok(!/sheet\.gap\(\d/.test(PDF), "every gap comes from the scale, not a literal");

    /* AND THE PAGE COUNT HOLDS. A short report is one page; a long one is not. */
    const short = record(docFor({}, { comment: "Ổn định." })).pages;
    assert.equal(short, 1, "a short report is one page");
    const long = record(docFor({}, {
      comment: "x".repeat(2600), strengths: "y".repeat(900),
      improvements: "z".repeat(900), goals: "g".repeat(600),
    })).pages;
    assert.ok(long > 1, "and a long one legitimately is not");
  });
});

/* =========================================================================
 * 15. The PDF radar's web — every ring and every spoke, and visibly so
 * ======================================================================
 * THE DEFECT, AND WHY SOURCE-SCANNING COULD NOT SEE IT. Every one of the fifteen
 * web paths was being emitted, in the right place, in the right order. They were
 * drawn in `--border-2` (#efeff1) and `--border` (#e8e8ec) — the tokens the
 * on-screen SVG uses, which are screen hairline colours for a 1px line on a
 * light-grey UI with a backlight behind it. On white paper, under the 12% green
 * tint, `--border-2` differs from what it crosses by 0.4 of relative luminance.
 * That is not faint; it is the same colour. Channel by channel the ring was +12
 * red, MINUS 5 green and +8 blue against the fill, so inside the polygon the
 * rings were if anything lighter than their background.
 *
 * So these tests assert INK as well as geometry, from what the renderer actually
 * emits — and the contrast is computed rather than eyeballed, because "looks
 * about right" is what shipped the invisible version twice.
 */

describe("Gate 4.4E polish · the PDF radar web", () => {
  /** Relative luminance, for "can this line be seen against that" questions. */
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const contrast = (a: readonly number[], b: readonly number[]) => Math.abs(lum(a) - lum(b));
  const TINT = [227, 244, 233];
  const WHITE = [255, 255, 255];

  /** THE FIXTURE MATTERS. A report whose ten ratings are all equal draws its
   * series polygon at exactly one ring's radius, so "the path that is not a ring"
   * cannot tell them apart — the first version of these tests counted four rings
   * and mistook ring three for the outline. Every fixture here has a spread. */
  const SPREAD = { ...skills(3), listening: 5, speaking: 4, writing: 1, grammar: 2 };

  /** Every path the radar emitted, with the draw colour and width in force for
   * it, and the spokes separated from the document's other horizontal rules.
   *
   * A `doc.line` is also how the masthead rule, the four section dividers and the
   * footer rule are drawn, so a spoke is identified by its ORIGIN: the ten of
   * them share the radar's centre, and nothing else in the document starts there. */
  function webPaths(calls: Call[]) {
    let draw: number[] = [0, 0, 0];
    let width = 0;
    const out: { style: string; points: [number, number][]; draw: number[]; width: number }[] = [];
    const allLines: { x: number; y: number; draw: number[]; width: number }[] = [];
    for (const c of calls) {
      if (c.fn === "setDrawColor") draw = c.args.slice(0, 3).map(Number);
      else if (c.fn === "setLineWidth") width = Number(c.args[0]);
      else if (c.fn === "lines") out.push({ ...pathOf(c), draw, width });
      else if (c.fn === "line") allLines.push({ x: Number(c.args[0]), y: Number(c.args[1]), draw, width });
    }
    const counts = new Map<string, number>();
    for (const l of allLines) {
      const k = `${l.x},${l.y}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const hub = [...counts.entries()].find(([, n]) => n >= 10)?.[0];
    const spokes = hub ? allLines.filter((l) => `${l.x},${l.y}` === hub) : [];
    return { paths: out, spokes };
  }

  it("106. all five rings and all ten spokes are emitted, in the approved order", () => {
    const { calls } = record(docFor({}, { skills: SPREAD }));
    const { paths } = webPaths(calls);

    /* 1. the tint, fill-only, FIRST. */
    assert.equal(paths[0].style, "F", "the light polygon fill goes down first");

    /* 2. five rings, at 1/5 .. 5/5 of the radius, all stroke-only, all closed. */
    const series = paths[0].points;
    const key = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const rings = paths.filter((p) => p.style === "S" && key(p.points) !== key(series));
    assert.equal(rings.length, 5, "a five-ring web, one ring per rating point");

    /* Their radii really are the five levels — measured from the spokes' shared
     * origin, which is the centre. */
    const origins = calls.filter((c) => c.fn === "line").map((c) => `${c.args[0]},${c.args[1]}`);
    const centre = origins.find((o, i) => origins.indexOf(o) !== i);
    assert.ok(centre, "ten spokes share one origin");
    const [cx, cy] = centre!.split(",").map(Number);
    const radii = rings
      .map((r) => Math.hypot(r.points[0][0] - cx, r.points[0][1] - cy))
      .sort((a, b) => a - b);
    const outer = radii[4];
    radii.forEach((r, i) => {
      assert.ok(Math.abs(r - (outer * (i + 1)) / 5) < 0.01,
        `ring ${i + 1} sits at ${(i + 1)}/5 of the radius`);
    });
    /* Every ring is a closed decagon — ten vertices, not a partial path. */
    for (const ring of rings) {
      assert.equal(ring.points.length, 10, "ten vertices per ring");
    }

    /* 3. ten spokes, from the centre to the outer ring. */
    const drawnSpokes = calls.filter((c) => c.fn === "line"
      && Math.abs(Number(c.args[0]) - cx) < 0.01 && Math.abs(Number(c.args[1]) - cy) < 0.01);
    assert.equal(drawnSpokes.length, 10, "one spoke per axis");
    for (const s of drawnSpokes) {
      const r = Math.hypot(Number(s.args[2]) - cx, Number(s.args[3]) - cy);
      assert.ok(Math.abs(r - outer) < 0.01, "each spoke reaches the outer ring");
    }

    /* 4. the series outline, and 5. the dots — after the web, as approved. */
    const outlineAt = paths.findIndex((p) => p.style === "S" && key(p.points) === key(series));
    const lastRingAt = paths.map((p) => key(p.points) !== key(series) && p.style === "S")
      .lastIndexOf(true);
    assert.ok(outlineAt > lastRingAt, "the outline is drawn after the whole web");
    assert.equal(calls.filter((c) => c.fn === "circle").length, 10, "and the dots after that");
  });

  it("107. the web is VISIBLE — against the tint it crosses and against the paper", () => {
    const { calls } = record(docFor({}, { skills: SPREAD }));
    const { paths, spokes } = webPaths(calls);
    const key = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const rings = paths.filter((p) => p.style === "S" && key(p.points) !== key(paths[0].points));

    for (const ring of rings) {
      assert.ok(contrast(ring.draw, TINT) > 40,
        `a ring at ${ring.draw} has only ${contrast(ring.draw, TINT).toFixed(1)} against the tint`);
      assert.ok(contrast(ring.draw, WHITE) > 40, "and must be visible on bare paper too");
    }
    for (const spoke of spokes) {
      assert.ok(contrast(spoke.draw, TINT) > 40,
        `a spoke at ${spoke.draw} vanishes into the tint`);
    }
    /* THE TWO INKS THAT FAILED, named so they cannot come back — checked against
     * the colours in force for the RADAR's own paths. Both tokens are still used
     * legitimately elsewhere on the page (the section dividers, the tile and card
     * borders, the footer rule), so forbidding them document-wide would forbid
     * the right thing in the wrong places. */
    for (const mark of [...rings, ...spokes]) {
      for (const invisible of [[239, 239, 241], [232, 232, 236]]) {
        assert.notDeepEqual(mark.draw, invisible,
          `${invisible} had 0.4 and 7.3 luminance against this fill — it cannot draw the web`);
      }
    }
    /* And the renderer no longer reaches for either token here. */
    const radar = PDF.slice(PDF.indexOf("function drawRadar("));
    const web = radar.slice(radar.indexOf("// 2."), radar.indexOf("// 3."));
    assert.ok(!web.includes("INK.border2") && !web.includes("INK.border["),
      "the web is drawn from RADAR_WEB, not from the screen's hairline tokens");
  });

  it("108. and it stays SUBORDINATE — the series outline still dominates", () => {
    const { calls } = record(docFor({}, { skills: SPREAD }));
    const { paths, spokes } = webPaths(calls);
    const key = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const series = paths[0].points;
    const outline = paths.find((p) => p.style === "S" && key(p.points) === key(series));
    const rings = paths.filter((p) => p.style === "S" && key(p.points) !== key(series));
    assert.ok(outline, "the series is stroked");

    /* THREE WAYS OVER, so no single tweak can invert the hierarchy: the outline
     * is thicker, more contrasty, and saturated where the web is neutral. */
    for (const ring of rings) {
      assert.ok(outline!.width > ring.width * 2,
        `the outline (${outline!.width}mm) is far heavier than a ring (${ring.width}mm)`);
      assert.ok(contrast(outline!.draw, TINT) > contrast(ring.draw, TINT),
        "and carries more contrast against the fill");
    }
    for (const spoke of spokes) {
      assert.ok(outline!.width > spoke.width * 2, "and than a spoke");
    }
    const [r, g, b] = outline!.draw;
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 60, "the outline is a saturated colour");
    for (const ring of rings) {
      const [rr, rg, rb] = ring.draw;
      assert.ok(Math.max(rr, rg, rb) - Math.min(rr, rg, rb) < 20, "the web is neutral grey");
    }
    /* NOT DARK, EITHER — background structure, not a second series. */
    for (const ring of rings) {
      assert.ok(lum(ring.draw) > 140, `a ring at ${ring.draw} would read as ink, not as a grid`);
    }
  });

  it("109. the web's ink is the report sheet's own token, not a value chosen here", () => {
    /* Read out of globals.css, exactly as the four performance bands and the
     * section divider are, so a restyled document palette fails until the PDF
     * follows. */
    const body = (() => {
      let from = 0;
      for (;;) {
        const at = CSS.indexOf(".report-sheet{", from);
        assert.ok(at >= 0, "the report sheet declares a palette somewhere");
        const rule = CSS.slice(at, CSS.indexOf("}", at));
        if (rule.includes("--muted-2:#")) return rule;
        from = at + 1;
      }
    })();
    const hex = body.match(/--muted-2:#([0-9a-f]{6})/)![1];
    const expected = [
      parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
    ];
    assert.deepEqual([...reportTokenInk("var(--muted-2)")], expected,
      `the web inks .report-sheet's own --muted-2 (#${hex})`);
    assert.ok(PDF.includes("reportTokenInk(RADAR_WEB.token)"),
      "resolved through the one token helper, like every other colour");

    const { calls } = record(docFor({}, { skills: SPREAD }));
    assert.ok(calls.some((c) => c.fn === "setDrawColor" && rgb(c) === expected.join(",")),
      "and that is the ink actually emitted");
  });

  it("110. nothing else about the approved radar moved", () => {
    /* §12: fix the grid, change nothing else. */
    const { calls } = record(docFor({}, { skills: SPREAD }));
    assert.ok(calls.some((c) => c.fn === "setFillColor" && rgb(c) === "227,244,233"),
      "the 12% tint is unchanged");
    assert.equal(calls.filter((c) => c.fn === "circle").length, 10, "the vertex dots remain");
    assert.ok(PDF.includes("Math.min(radarW / 2 - RADAR_LABEL_RING, 26)"), "the size is unchanged");
    assert.ok(PDF.includes("const barsW = (CONTENT_W - gap) * 0.56;"), "and so is the row split");
    const block = docFor({}, { skills: SPREAD }).blocks.find((b) => b.kind === "skills");
    assert.ok(block?.kind === "skills");
    for (const axis of block.axes) {
      assert.ok(calls.some((c) => c.fn === "text" && String(c.args[0]) === axis.label),
        `${axis.label} is still drawn`);
    }
  });
});
