/* The Reports PDF document model — what the file CONTAINS, in order.
 *
 * ---- THE SPLIT, AND WHY IT IS THE SAME ONE REVIEWS DRAWS -------------------
 *
 * This module turns a `ReportPayload` into a plain, ordered list of blocks.
 * `reports-pdf.ts` walks that list and puts ink on A4. The split is what makes
 * the export testable without a browser, without jsPDF and without a binary
 * snapshot: what a report SAYS is asserted here, and how wide its second column
 * is, is asserted there.
 *
 * ---- ONE CONTENT MODEL, ENFORCED RATHER THAN PROMISED ----------------------
 *
 * Every string below comes from `renderValue` / `renderSummaryValue` — the same
 * two functions the on-screen sheet calls, in `components/reports/reports-ui.ts`.
 * Not "the same rules": the same code. So a `none` cannot become `0đ` on paper
 * while it reads `No data` on screen, a floor cannot lose its `At least`, and a
 * currency cannot be grouped one way in one place and another way in the other.
 * There is no second formatter in this file and no arithmetic of any kind.
 *
 * ---- WHAT IT NEVER CONTAINS ------------------------------------------------
 *
 * No radar, no skill bar, no goals callout, no parent notes — those are the
 * Reviews document's blocks and this is not that document. No lifecycle, no
 * status, no persisted timestamp, no file URL, no report id. And no ghost
 * identity: only rows the payload already carries reach a block, and the payload
 * carries none.
 *
 * ---- PURE ------------------------------------------------------------------
 *
 * No clock, no network, no jsPDF, no DOM. `payload.appClock` is the application
 * day the DTO already carries; nothing here asks the system what time it is.
 */

import { slugifyName } from "./review-pdf-document";
import { renderSummaryValue, renderValue } from "@/components/reports/reports-ui";
import { historicalNote, partialNote } from "@/components/finance/finance-ui";
import type { Formatter } from "./format";
import type { ReportPayload } from "./reports";

/* ---------------------------------------------------------------- the blocks */

/** One figure in the summary strip. Label and value, both already final. */
export interface ReportPdfStat {
  label: string;
  value: string;
}

/** One column of the generic table. `align` is the payload's own. */
export interface ReportPdfColumn {
  label: string;
  align: "left" | "right";
}

/** One row. `sub` is the secondary line under the FIRST cell — the Student
 * Payment report's missing-parent indication, and nothing else. It is `null`
 * everywhere the payload did not set `parentLinked: false`, so a report that
 * carries no parent flag cannot grow one here. */
export interface ReportPdfRow {
  cells: string[];
  sub: string | null;
}

export type ReportPdfBlock =
  | {
      kind: "masthead";
      brand: string;
      title: string;
      /** "July 2026 · Grammar Stars · B1" — the sheet's own second line. */
      context: string;
      generatedLabel: string;
      generatedOn: string;
    }
  | { kind: "stats"; stats: ReportPdfStat[] }
  | { kind: "table"; columns: ReportPdfColumn[]; rows: ReportPdfRow[] }
  /** A neutral sentence under the table: a hidden-record count, an
   * incomplete-amounts line, an attendance coverage pair. Never a placeholder
   * row for somebody who is gone. */
  | { kind: "note"; text: string }
  /** The design's own empty state, when the selection genuinely holds nothing. */
  | { kind: "empty"; title: string; body: string }
  | { kind: "footer"; left: string; right: string };

export interface ReportPdfDocument {
  /** The download name. Deterministic, filesystem-safe, no id, no clock. */
  filename: string;
  /** PDF metadata — title/subject only. Never a stored value. */
  title: string;
  subject: string;
  blocks: ReportPdfBlock[];
}

/* ------------------------------------------------------------- the filename */

/** `student-payment-2026-07-grammar-stars-b1-emma-chen.pdf`
 *
 * DERIVED FROM THE SELECTION AND NOTHING ELSE: the report TYPE KEY, the
 * canonical month, and whichever scope names the payload resolved. No random
 * id, no clock, no counter, no report id — a filename travels, it sits in a
 * downloads folder and it may be mailed on, so it discloses nothing an
 * identifier would.
 *
 * THE TYPE KEY, NOT THE TITLE. `monthly-revenue`, not "Monthly Revenue Report" —
 * so a Vietnamese session and an English one produce the SAME filename for the
 * same report. A translated filename would be a second thing to keep in step
 * and would make two files of one document.
 *
 * A GHOST CANNOT REACH IT. Only a class or student the server RESOLVED becomes a
 * `scope` name, so there is nothing here to leak. `slugifyName` is Reviews'
 * own — Vietnamese is decomposed rather than deleted, so `Nguyễn Đức` is
 * `nguyen-duc` — and it is imported rather than copied because it is a genuinely
 * generic, already-tested utility. */
export function reportPdfFilename(payload: ReportPayload): string {
  const parts = [payload.type, payload.month];
  if (payload.scope.className) parts.push(slugifyName(payload.scope.className));
  if (payload.scope.studentName) parts.push(slugifyName(payload.scope.studentName));
  return `${parts.join("-")}.pdf`;
}

/* ------------------------------------------------------------- the document */

/** The translator and formatter the document is written with. The SAME pair the
 * on-screen sheet uses, passed in rather than imported, so this stays pure and a
 * test can drive it in Vietnamese without a React tree. */
export interface ReportPdfIntl {
  t: (key: string) => string;
  fmt: Formatter;
}

/** The document's identity. The same neutral brand the sheet carries — no
 * author, because nothing in this data model records who wrote a report. */
export const REPORT_BRAND = "English Tutor LMS";

/** Build the printed document from the payload the preview is showing.
 *
 * IT REFLOWS NOTHING AND RECOMPUTES NOTHING. Every figure is the payload's, run
 * through the screen's own renderer; the only decisions made here are which
 * blocks exist and in what order — which is the same order the sheet draws. */
export function buildReportPdfDocument(
  payload: ReportPayload,
  intl: ReportPdfIntl
): ReportPdfDocument {
  const { t, fmt } = intl;
  const title = t(payload.title);

  /* The masthead's second line, character for character what the sheet shows —
   * built from the same three payload fields, in the same order. */
  const scopeLabel = payload.scope.studentName && payload.scope.className
    ? `${payload.scope.studentName} · ${payload.scope.className}`
    : payload.scope.studentName ?? payload.scope.className ?? t("All classes");

  const blocks: ReportPdfBlock[] = [{
    kind: "masthead",
    brand: REPORT_BRAND,
    title,
    context: `${fmt.monthLabel(payload.month)} · ${scopeLabel}`,
    generatedLabel: t("Generated on"),
    generatedOn: fmt.dateLabel(payload.appClock),
  }];

  if (payload.empty) {
    blocks.push({
      kind: "empty",
      title: t("No data for this selection"),
      body: t("Adjust the month, class or student filters to populate this report."),
    });
  } else {
    if (payload.summary.length > 0) {
      blocks.push({
        kind: "stats",
        stats: payload.summary.map((s) => ({
          label: t(s.label),
          // The floor qualifier travels with the figure, so an incomplete
          // collection rate cannot print as an exact percentage.
          value: renderSummaryValue(s.value, s.floor, fmt, t),
        })),
      });
    }

    if (payload.rows.length > 0) {
      blocks.push({
        kind: "table",
        columns: payload.columns.map((c) => ({ label: t(c.label), align: c.align })),
        rows: payload.rows.map((row) => ({
          cells: row.cells.map((cell) => renderValue(cell, fmt, t)),
          // Exactly the sheet's condition: an explicit `false`, never a missing
          // flag, so no report without the flag can grow the line.
          sub: row.parentLinked === false ? t("No linked parent") : null,
        })),
      });
    }

    /* The three canonical notes, in the sheet's own order, from the same two
     * Finance sentences and the same coverage pair. None is dropped on paper:
     * a document that omitted the incomplete-amounts line would be stating a
     * total more confidently than the screen does. */
    if (typeof payload.hiddenRecords === "number" && payload.hiddenRecords > 0) {
      blocks.push({ kind: "note", text: historicalNote(payload.hiddenRecords, t) });
    }
    if (payload.completeness && !payload.completeness.amountsComplete) {
      blocks.push({ kind: "note", text: partialNote(payload.completeness.unknownAmountBills, t) });
    }
    if (payload.coverage) {
      blocks.push({
        kind: "note",
        text: `${t("Registers taken")} · ${payload.coverage.registersTaken}/${payload.coverage.lessonsCompleted}`,
      });
    }
  }

  blocks.push({
    kind: "footer",
    left: `${REPORT_BRAND} · ${title}`,
    right: fmt.monthLabel(payload.month),
  });

  return {
    filename: reportPdfFilename(payload),
    title,
    subject: `${title} · ${fmt.monthLabel(payload.month)}`,
    blocks,
  };
}
