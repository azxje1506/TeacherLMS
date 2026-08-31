/* The printed document's LAYOUT, and nothing else — Gate 4.4E.
 *
 * ---- WHAT THIS FILE IS ALLOWED TO KNOW -------------------------------------
 *
 * This is presentation metadata. It decides the ORDER of the document's blocks,
 * which heading sits above which paragraph, and what shape each block has on an
 * A4 page. It decides NO VALUE. Every number and every word it places arrives
 * already derived on the `MonthlyReviewReport` DTO, exactly as the on-screen
 * report receives them — the same average, the same performance word and
 * colour, the same attendance and homework figures, the same ten ratings with
 * the same per-rating colours, the same tie-aware teacher-summary lines, the
 * same teacher's prose.
 *
 * So: no average, no percentage, no ranking, no threshold and no clock is
 * computed here. Search this file for arithmetic on a rating and you will find
 * none. That is the whole point — a second renderer that recomputed anything
 * would be a second opinion about the same month, free to disagree with the
 * preview a teacher approved before pressing Export.
 *
 * ---- WHY IT IS A DATA STRUCTURE RATHER THAN DRAWING CALLS ------------------
 *
 * `buildReviewPdfDocument` returns a plain, ordered list of blocks. The jsPDF
 * renderer in review-pdf.ts walks that list; it owns fonts, page breaks and
 * millimetres, and it owns no content decisions at all.
 *
 * The split is what makes the export testable without a browser, without jsPDF
 * and without comparing PDF bytes: the tests assert this list — its section
 * order, its Vietnamese strings, its "No data" branches, its em dashes — which
 * is the export's real contract. A binary snapshot would break on every jsPDF
 * patch release while proving nothing about the document.
 *
 * ---- THE PARITY OBLIGATION -------------------------------------------------
 *
 * The block order below mirrors `MonthlyReviewReportView` section for section:
 *
 *   masthead · student meta · summary tiles · skill ratings (bars + radar) ·
 *   teacher summary · teacher comment · strengths/improvements · goals ·
 *   parent notes (only when written) · footer
 *
 * When that component gains or loses a section, this list moves with it, and
 * tests/review-pdf.test.ts fails until it does. Nothing else in the export has
 * an opinion about what a report contains.
 */

import { EM } from "@/lib/format";
import { teacherSummaryLines } from "@/lib/review-report";
import type { MonthlyReviewReport, StudentAttendanceRate } from "@/lib/review-report";

/* ------------------------------------------------- the section presentation */

/** How a TOP-LEVEL REPORT SECTION is presented, stated once.
 *
 * ---- WHY THIS CONSTANT EXISTS ----------------------------------------------
 *
 * The sheet gives every section title a hairline rule beneath it; the exported
 * file did not, and the two documents drifted apart on something as basic as
 * where a section starts. They drifted because each surface decided it alone:
 * the sheet in an inline style, the renderer in a `case "heading"` that drew
 * text and stopped.
 *
 * WHAT IS SHARED IS THE STRUCTURE, NOT THE UNITS. A rule under the title, in the
 * document's own border token, spanning the content column. The sheet expresses
 * that in CSS pixels and the renderer in millimetres, because a shared literal
 * across two coordinate systems would be a false equivalence — but the DECISION
 * that there is a rule, and which token it takes, is made here and nowhere else.
 *
 * WHICH SECTIONS. Exactly the `heading` blocks — Skill ratings, Teacher summary,
 * Teacher comment, Parent notes — which are already the document model's own
 * top-level boundaries. There is no second list to keep in step, and no internal
 * label gets one: Strengths, Areas for improvement and the goals callout are
 * headings INSIDE a section, and the sheet does not rule them either.
 *
 * NO CSS DIMENSION CROSSES INTO DOMAIN LOGIC. This is presentation metadata in
 * the module whose whole job is presentation metadata; nothing about a Review
 * knows it exists. */
export const REPORT_SECTION = {
  /** Every top-level section title carries a divider beneath it. */
  divider: true,
  /** The divider's colour, as the report sheet's own token — resolved to CSS by
   * the browser and to ink by the renderer's ONE token-resolution helper. Never
   * a literal chosen for the PDF. */
  dividerToken: "var(--border)",
} as const;

/* ---------------------------------------------------------------- the blocks */

/** One measured figure in the summary strip. `detail` qualifies it, or is null
 * when there is nothing to qualify — never an invented denominator. */
export interface PdfTile {
  value: string;
  label: string;
  detail: string | null;
  /** The DTO's own performance colour, or null where this app grades nothing. */
  color: string | null;
}

export interface PdfMetaItem {
  label: string;
  value: string;
  strong: boolean;
}

/** One card of the teacher-summary block.
 *
 * THE PARTS, NOT A SENTENCE — the same parts `teacherSummaryLines` hands the
 * screen: a label, the skills it names, and the figure they share. The renderer
 * lays them out; it does not decide which skills are named, and it never joins
 * them into a single run that would have to be clipped. */
export interface PdfSummaryItem {
  label: string;
  /** The skill names, already translated, in canonical order. Never empty. */
  items: string[];
  /** The shared figure — "5", "3/5", "3 -> 5" — or null. */
  detail: string | null;
  muted: boolean;
  /** Which of the document palette's tones this card is keyed to. */
  tone: "green" | "amber" | "sky" | "muted";
}

export type PdfBlock =
  | {
      kind: "masthead";
      brand: string;
      title: string;
      generatedLabel: string;
      generatedOn: string;
    }
  | { kind: "meta"; items: PdfMetaItem[] }
  | { kind: "tiles"; tiles: PdfTile[] }
  | { kind: "heading"; text: string }
  /** THE SKILLS ROW — bars on the left, radar on the right, as the on-screen
   * report composes them. They were two stacked full-width blocks until human
   * verification compared the file to the preview; a report is a composition,
   * and the two halves read each other. The renderer splits the row and falls
   * back to stacking only if a page genuinely cannot hold it. */
  | {
      kind: "skills";
      /** One bar per skill, each carrying ITS OWN colour — the DTO's
       * `perfColor(rating)` token, not the report's overall band. A block-level
       * `color` used to paint all ten the same; a 5 and a 2 are not the same
       * thing and no longer print as though they were. */
      bars: { label: string; rating: number; color: string }[];
      axes: { label: string; rating: number | null }[];
    }
  /** THE TEACHER SUMMARY — one card per item, laid out as a row, mirroring the
   * sheet's own auto-fit grid. It was a stack of label/value rows until human
   * verification found a tie of eight skills unreadable in both places. */
  | { kind: "summary"; items: PdfSummaryItem[] }
  /** A titled paragraph. `title` is null for the body under a `heading` block. */
  | { kind: "prose"; title: string | null; titleColor: string | null; text: string }
  /** Two titled paragraphs side by side — the preview's own paired grid for
   * Strengths and Areas for improvement. */
  | {
      kind: "proseRow";
      left: { title: string; titleColor: string | null; text: string };
      right: { title: string; titleColor: string | null; text: string };
    }
  /** The goals box — the sheet's one tinted panel. */
  | { kind: "callout"; title: string; text: string }
  | { kind: "footer"; left: string; right: string };

export interface ReviewPdfDocument {
  /** The download name. Deterministic, filesystem-safe, no Review id. */
  filename: string;
  /** PDF document metadata — title/subject only. Never a stored value. */
  title: string;
  subject: string;
  blocks: PdfBlock[];
}

/* ------------------------------------------------------------- the filename */

/** A name reduced to ASCII words joined by single hyphens.
 *
 * VIETNAMESE IS DECOMPOSED, NOT DELETED. `Nguyễn Đức` becomes `nguyen-duc`
 * rather than `n-c`: NFD splits a letter from its diacritics, the combining
 * marks are dropped, and the two letters Unicode does not decompose — đ and Đ,
 * which are their own codepoints rather than d-plus-a-mark — are mapped by hand.
 * A filename is a handle, so it stays in the ASCII range every filesystem, mail
 * client and download folder agrees on; the document itself keeps the real name.
 *
 * Everything outside [a-z0-9] becomes a boundary, runs collapse, and the ends
 * are trimmed — so no locale-dependent punctuation, no leading dot, no trailing
 * hyphen, and never an empty string. */
export function slugifyName(name: string): string {
  const folded = name
    .normalize("NFD")
    // U+0300–U+036F: the combining diacritical marks NFD just split off.
    .replace(/[̀-ͯ]/g, "")
    // đ/Đ are their own codepoints, not d plus a mark, so NFD leaves them whole.
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"));
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  /* A name that is entirely non-Latin — or somehow empty — still needs a handle
   * rather than a file called "-2026-06.pdf". */
  return slug === "" ? "student" : slug;
}

/** `monthly-review-liam-park-2026-06.pdf`
 *
 * THE REVIEW'S ID IS DELIBERATELY ABSENT. A filename travels: it is mailed to a
 * family and sits in a downloads folder, and an internal identifier in it would
 * be a small, permanent disclosure for no benefit. Student name plus month is
 * what a human needs to find the file again — and it is the same for a create
 * preview as for the saved review, because the document is about the month, not
 * about a record. */
export function reviewPdfFilename(studentName: string, period: string): string {
  return `monthly-review-${slugifyName(studentName)}-${period}.pdf`;
}

/* ------------------------------------------------------------- the document */

/** The translator and formatters the document is written with. The SAME pair the
 * on-screen report uses, passed in rather than imported, so this stays pure and
 * a test can drive it in Vietnamese without a React tree. */
export interface ReviewPdfIntl {
  t: (key: string) => string;
  monthLabel: (month: string) => string;
  dateLabel: (date: string) => string;
}

/** Coverage, kept secondary — the report component's own rule, and the reason it
 * exists is the same: a percentage over two registers and a percentage over
 * twenty are not the same claim. `null` when there is nothing to qualify. */
function coverage(a: StudentAttendanceRate | null | undefined, label: string): string | null {
  if (!a || a.lessonsCompleted <= 0) return null;
  return `${label} ${a.registersTaken}/${a.lessonsCompleted}`;
}

/** A percentage as the report states it. `null` is "No data", NEVER 0% — the
 * distinction the whole Reviews module is careful about, preserved on paper. */
function pctText(pct: number | null | undefined, noData: string): string {
  return typeof pct === "number" ? `${pct}%` : noData;
}

/** Build the printed document from the report the preview is showing.
 *
 * PURE. Same report and same strings in, same document out — no clock, no
 * network, no jsPDF, no DOM. `report.meta.generatedOn` is the application day
 * the DTO already carries; nothing here asks the system what time it is. */
export function buildReviewPdfDocument(
  report: MonthlyReviewReport,
  intl: ReviewPdfIntl,
): ReviewPdfDocument {
  const { t, monthLabel, dateLabel } = intl;
  const { student, parent, period, summary, skills, radar, feedback, meta } = report;

  const blocks: PdfBlock[] = [];

  /* ---- masthead. The brand is a proper noun and is not a dictionary key — the
   * sidebar and the on-screen sheet both render it as a literal. */
  blocks.push({
    kind: "masthead",
    brand: "English Tutor LMS",
    title: t("Monthly Progress Report"),
    generatedLabel: t("Generated on"),
    generatedOn: dateLabel(meta.generatedOn),
  });

  /* ---- who and when. An unresolvable parent is the app's own em dash, never a
   * blank line and never an invented name — PROJECT_RULES requires a review to
   * say plainly when a student has no linked parent. */
  blocks.push({
    kind: "meta",
    items: [
      { label: t("Student"), value: student.name, strong: true },
      { label: t("Review period"), value: monthLabel(period), strong: true },
      { label: t("Grade"), value: t(student.gradeLabel), strong: false },
      { label: t("Parent / Guardian"), value: parent ? parent.name : EM, strong: false },
    ],
  });

  /* ---- the three measured figures. Only the score is coloured: `perfColor`
   * grades a 1-5 average and this app has no threshold anywhere for grading a
   * percentage, so colouring the other two would be inventing a rule. */
  blocks.push({
    kind: "tiles",
    tiles: [
      {
        value: summary.overallScore.toFixed(1),
        label: `${t("Overall")} · ${t(summary.performanceLabel)}`,
        detail: null,
        color: summary.performanceColor,
      },
      {
        value: pctText(summary.attendance?.pct, t("No data")),
        label: t("Attendance"),
        detail: coverage(summary.attendance, t("Registers taken")),
        color: null,
      },
      {
        value: pctText(summary.homework?.pct, t("No data")),
        label: t("Homework done"),
        detail:
          summary.homework && summary.homework.total > 0
            ? `${summary.homework.done}/${summary.homework.total}`
            : null,
        color: null,
      },
    ],
  });

  /* ---- the ten ratings, as bars and as the radar, both reading the same
   * ratings. The comparison series is off on paper for the reason the screen
   * turns it off: a printed report shows the month it is about. */
  blocks.push({ kind: "heading", text: t("Skill ratings") });
  blocks.push({
    kind: "skills",
    /* THE COLOUR IS THE SKILL'S, and it arrives already resolved on the DTO —
     * this file calls no threshold function, exactly as it calls no average. */
    bars: skills.map((s) => ({ label: t(s.label), rating: s.rating, color: s.color })),
    axes: radar.current.map((a) => ({
      label: t(labelOf(skills, a.key)),
      rating: a.rating,
    })),
  });

  /* ---- deterministic summary only, and the SAME lines the screen shows.
   *
   * `teacherSummaryLines` is the one place that decides which skills are named,
   * under which label, in which order — so the file cannot serialise only the
   * first of a tie while the preview shows three, which is precisely what
   * happened while each surface composed its own strings. No concern line and no
   * achievement line exist on the DTO, so none can be placed here either. */
  const items: PdfSummaryItem[] = teacherSummaryLines(report, t).map((line) => ({
    label: line.label,
    items: line.items,
    detail: line.detail,
    muted: line.muted,
    tone: line.tone,
  }));
  if (items.length > 0) {
    blocks.push({ kind: "heading", text: t("Teacher summary") });
    blocks.push({ kind: "summary", items });
  }

  /* ---- the teacher's own words, and only those.
   *
   * THE FOUR ASSESSMENT FIELDS KEEP THEIR HEADING WHEN EMPTY, carrying the app's
   * em dash — so every report has the same shape and a reader can see that a
   * section was left blank rather than wonder whether it exists. This mirrors
   * the on-screen `Prose`, which does the same. */
  blocks.push({ kind: "heading", text: t("Teacher comment") });
  blocks.push({ kind: "prose", title: null, titleColor: null, text: proseText(feedback.comment) });
  /* PAIRED, as the preview pairs them in its two-column grid. */
  blocks.push({
    kind: "proseRow",
    left: { title: t("Strengths"), titleColor: "green", text: proseText(feedback.strengths) },
    right: {
      title: t("Areas for improvement"),
      titleColor: "amber",
      text: proseText(feedback.improvements),
    },
  });
  blocks.push({
    kind: "callout",
    title: t("Learning goals for next month"),
    text: proseText(feedback.goals),
  });

  /* PARENT NOTES ARE OMITTED WHEN EMPTY, unlike the four above: this is a
   * message addressed to the family rather than a section of the assessment, so
   * an empty one has nothing to say and no shape to keep. */
  if (feedback.parentNotes.trim() !== "") {
    blocks.push({ kind: "heading", text: t("Parent notes") });
    blocks.push({ kind: "prose", title: null, titleColor: null, text: feedback.parentNotes });
  }

  /* ---- neutral footer. No author is named: nothing in this data model records
   * who wrote a review, and printing a name the system does not know would be a
   * fabrication on a document about a real child. */
  blocks.push({
    kind: "footer",
    left: `English Tutor LMS · ${t("Monthly Progress Report")}`,
    right: monthLabel(period),
  });

  return {
    filename: reviewPdfFilename(student.name, period),
    title: `${t("Monthly Progress Report")} — ${student.name} — ${monthLabel(period)}`,
    subject: t("Monthly Progress Report"),
    blocks,
  };
}

/** Empty prose prints the app's em dash, matching the on-screen `Prose`. */
function proseText(value: string): string {
  return value.trim() === "" ? EM : value;
}

function labelOf(skills: MonthlyReviewReport["skills"], key: string): string {
  return skills.find((s) => s.key === key)?.label ?? key;
}
