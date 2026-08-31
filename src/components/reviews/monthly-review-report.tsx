"use client";

/* The monthly progress report — ONE content component, for every surface.
 *
 * THIS IS THE ONLY IMPLEMENTATION OF THE REPORT'S CONTENT. The composer's live
 * preview renders it, the mobile preview overlay renders it, and Gate 4.4E's
 * Print and PDF must render this same component over the same
 * `MonthlyReviewReport` DTO. A report that is drawn three times is a report that
 * eventually says three different things; there is one, and it takes plain data.
 *
 * IT COMPUTES NOTHING. Every number arrives on the DTO, already derived by
 * `buildMonthlyReviewReportDraft` from the draft the teacher is typing plus the
 * server's per-month Attendance and Homework. There is no average, no ranking,
 * no percentage and no threshold in this file.
 *
 * IT IS A DOCUMENT, NOT A SCREEN. The sheet carries the comp's own report
 * classes — `report-sheet`, `rp-head`, `rp-block`, `rp-foot` — which globals.css
 * already gives print rules and a light-document palette, so the page prints as
 * a document and reads correctly under a dark theme.
 *
 * IT ALSO CARRIES SEVEN PRINT-ONLY HOOKS — `rp-meta`, `rp-tile`, `rp-goals`,
 * `rp-block-title`, `rp-skills-row`, `rp-skill-bars` and `rp-summary`, joining
 * `skill-radar` on the chart itself. They have no screen style whatsoever; they exist because reclaiming A4
 * budget means outranking the inline spacing below, an `!important` rule is the
 * only thing that outranks an inline style, and a rule can only reach an element
 * it can select. Every one is declared exactly once, inside `@media print`.
 *
 * Nothing here is theme-conditional and nothing here is interactive: no button,
 * no link, no input. That is what lets Gate 4.4E print it untouched.
 *
 * NO LIFECYCLE ANYWHERE. Sprint 8 Reviews have no Draft, no Published and no
 * Final. The reference comp's publication line is replaced with neutral document
 * metadata — the review period, and the day the document was generated, which is
 * a property of the DOCUMENT and is stored on no Review.
 *
 * NOTHING IS FABRICATED. No achievement, no concern, no AI prose, no author
 * attribution, and no 0% standing in for a figure nobody recorded — an empty
 * denominator says "No data", and an unlinked parent is the app's own em dash.
 */

import { useSettings } from "@/lib/settings-context";
import { EM } from "@/lib/format";
import { SkillRadar } from "@/components/reviews/charts";
import { teacherSummaryLines } from "@/lib/review-report";
import type {
  MonthlyReviewReport, StudentAttendanceRate, TeacherSummaryLine,
} from "@/lib/review-report";

/* The sheet's own type scale. Document metrics, not the app's screen metrics:
 * this block is sized to be read on paper as much as on a screen, and the values
 * are the comp's own report-sheet figures. */
const capStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
  color: "var(--muted-2)",
};
/* A SECTION TITLE, AND THE RULE UNDER IT. The hairline is the one thing added
 * for scanability: four uppercase captions with nothing between them and their
 * content read as a list of labels, and a reader looking for "Teacher summary"
 * on a printed page had to find it by size alone. The rule is the sheet's own
 * `--border`, one pixel, the same weight the tiles and the footer already use —
 * a document convention, not a new one. */
const blockTitle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
  color: "var(--fg)", marginBottom: 12,
  borderBottom: "1px solid var(--border)", paddingBottom: 6,
};

/** One percentage as the report states it.
 *
 * `null` IS "No data", NEVER 0%. The two are different facts — "this student
 * attended nothing" and "nobody took a register" — and a report showing 0% for
 * the second states an assessment the data never made. The metric helpers return
 * `null` precisely so this branch exists. */
function pctText(pct: number | null | undefined, noData: string): string {
  return typeof pct === "number" ? `${pct}%` : noData;
}

export interface MonthlyReviewReportViewProps {
  report: MonthlyReviewReport;
}

export function MonthlyReviewReportView({ report }: MonthlyReviewReportViewProps) {
  const { t, fmt } = useSettings();
  const { student, parent, period, summary, skills, radar, feedback, meta } = report;
  /* THE SUMMARY IS RESOLVED ONCE, in the module the composer card and the PDF
   * read too — this component still decides nothing about what it says. */
  const summaryLines = teacherSummaryLines(report, t);

  return (
    <div className="report-sheet rvc-sheet">
      {/* ---- document header ---------------------------------------------
        * The product's identity, what the document is, and neutral generated
        * metadata. The brand is a proper noun and is not a dictionary key — the
        * sidebar renders it as a literal for the same reason. */}
      <div className="rp-head">
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <div
            aria-hidden="true"
            style={{
              minWidth: 34, width: 34, height: 34, borderRadius: 9, flex: "none",
              background: "var(--accent)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700,
            }}
          >
            E
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}>English Tutor LMS</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
              {t("Monthly Progress Report")}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={capStyle}>{t("Generated on")}</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, fontFamily: "'Geist Mono',monospace" }}>
            {fmt.dateLabel(meta.generatedOn)}
          </div>
        </div>
      </div>

      {/* ---- student information ------------------------------------------
        * PROJECT_RULES: a feature that involves parent communication must say
        * clearly when a student has no linked parent. An unresolvable parent is
        * the app's own em dash, never a blank line and never an invented name. */}
      <div className="rp-block rp-meta" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: "18px 24px", marginBottom: 22 }}>
        <Meta label={t("Student")} value={student.name} strong />
        <Meta label={t("Review period")} value={fmt.monthLabel(period)} strong />
        <Meta label={t("Grade")} value={t(student.gradeLabel)} />
        <Meta label={t("Parent / Guardian")} value={parent ? parent.name : EM} />
      </div>

      {/* ---- summary --------------------------------------------------------
        * The overall score takes the app's EXISTING performance band. The two
        * percentages take none: `perfColor` grades a 1-5 average and this app
        * has no threshold anywhere for grading a percentage, so inventing one
        * here would be inventing a rule. The Reviews profile tab withholds the
        * same colour for the same reason. */}
      <div className="rp-block" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
        <Tile
          value={summary.overallScore.toFixed(1)}
          color={summary.performanceColor}
          label={`${t("Overall")} · ${t(summary.performanceLabel)}`}
        />
        <Tile
          value={pctText(summary.attendance?.pct, t("No data"))}
          label={t("Attendance")}
          detail={coverage(summary.attendance, t("Registers taken"))}
        />
        <Tile
          value={pctText(summary.homework?.pct, t("No data"))}
          label={t("Homework done")}
          detail={
            summary.homework && summary.homework.total > 0
              ? `${summary.homework.done}/${summary.homework.total}`
              : null
          }
        />
      </div>

      {/* ---- skills ---------------------------------------------------------
        * All ten, in canonical order, as bars and as the app's own radar. Both
        * read the SAME draft ratings, so the two cannot disagree. */}
      <div className="rp-block" style={{ marginBottom: 22 }}>
        <div className="rp-block-title" style={blockTitle}>{t("Skill ratings")}</div>
        {/* `rp-skills-row` is a hook, not a style: on paper the print stylesheet
          * gives the radar the same share of the column the exported PDF gives it,
          * which the screen's auto-fit grid cannot express. */}
        <div className="rp-skills-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(230px,100%),1fr))", gap: 20, alignItems: "center" }}>
          {/* `rp-skill-bars` is a hook, not a style: the print stylesheet tightens
            * the row gap there to reclaim vertical budget on paper. */}
          <div className="rp-skill-bars" style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            {skills.map((s) => (
              <SkillBar key={s.key} label={t(s.label)} rating={s.rating} color={s.color} />
            ))}
          </div>
          {/* The comparison series is deliberately off: a printed report shows
            * the month it is about. The DTO still carries the previous axes for
            * whatever wants them. */}
          <div style={{ minWidth: 0 }}>
            <SkillRadar current={radar.current} previous={null} compare={false} />
          </div>
        </div>
      </div>

      {/* ---- teacher summary -------------------------------------------------
        * DETERMINISTIC ONLY, and TIE-AWARE. The items are `teacherSummaryLines`
        * — the same function the composer card and the PDF call — so all three
        * name the same skills, in the same order, under the same labels. No
        * concern line and no achievement line exist on the DTO, so none can be
        * rendered, and a student's first review has nothing to improve against
        * and says exactly that.
        *
        * ---- WHY THIS IS A GRID OF CARDS RATHER THAN THREE LINES -------------
        *
        * It was three `label ……… value` rows, the value right-aligned. With one
        * strongest skill that read cleanly; with eight tied at 4 it became a wall
        * of names pressed against its own label, and human verification called
        * the block unscannable — on a phone and on paper alike.
        *
        * Each item now owns a card: the label above, the skills below it with
        * room to wrap, and the rating in its own corner. The grid is the sheet's
        * OWN idiom — `repeat(auto-fit,minmax(min(…),1fr))`, the same rule the
        * student-meta block and the strengths/improvements pair already use — so
        * three cards sit in a row on a page and on a desktop, two on a tablet and
        * one per row on a phone, with no breakpoint of its own and nothing new to
        * learn. That is also what keeps the printed height flat: three cards
        * side by side cost one row's height however long the tie list is. */}
      <div className="rp-block" style={{ marginBottom: 22 }}>
        <div className="rp-block-title" style={blockTitle}>{t("Teacher summary")}</div>
        <div className="rp-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(210px,100%),1fr))", gap: 10, alignItems: "stretch" }}>
          {summaryLines.map((line) => (
            <SummaryCard key={line.kind} line={line} />
          ))}
        </div>
      </div>

      {/* ---- teacher feedback ----------------------------------------------
        * The teacher's own words, and only those. The four assessment fields
        * keep their heading with the app's em dash when empty, so the document's
        * shape is the same on every report and a reader can see that a section
        * was left blank rather than wonder whether it exists. */}
      <div className="rp-block" style={{ marginBottom: 22 }}>
        <div className="rp-block-title" style={blockTitle}>{t("Teacher comment")}</div>
        <Prose value={feedback.comment} />
      </div>

      <div className="rp-block" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 20, marginBottom: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 5 }}>{t("Strengths")}</div>
          <Prose value={feedback.strengths} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)", marginBottom: 5 }}>{t("Areas for improvement")}</div>
          <Prose value={feedback.improvements} />
        </div>
      </div>

      <div className="rp-block rp-goals" style={{ background: "var(--amber-soft)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{t("Learning goals for next month")}</div>
        <Prose value={feedback.goals} />
      </div>

      {/* PARENT NOTES ARE OMITTED WHEN EMPTY, unlike the four above: this is a
        * message addressed to the family rather than a section of the
        * assessment, so an empty one has nothing to say and no shape to keep. */}
      {feedback.parentNotes.trim() !== "" && (
        <div className="rp-block" style={{ marginBottom: 22 }}>
          <div className="rp-block-title" style={blockTitle}>{t("Parent notes")}</div>
          <Prose value={feedback.parentNotes} />
        </div>
      )}

      {/* ---- footer ---------------------------------------------------------
        * Neutral. No author is named, because nothing in this data model records
        * who wrote a review, and printing a name the system does not know would
        * be a fabrication on a document about a real child. */}
      <div className="rp-foot">
        <span>English Tutor LMS · {t("Monthly Progress Report")}</span>
        <span>{fmt.monthLabel(period)}</span>
      </div>
    </div>
  );
}

/** Coverage, kept secondary: a percentage over two registers and a percentage
 * over twenty are not the same claim, and a single big number cannot say which
 * this is. `null` when there is nothing to qualify. */
function coverage(a: StudentAttendanceRate | null | undefined, label: string): string | null {
  if (!a || a.lessonsCompleted <= 0) return null;
  return `${label} ${a.registersTaken}/${a.lessonsCompleted}`;
}

function Meta({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={capStyle}>{label}</div>
      <div style={{ fontSize: strong ? 14.5 : 13, fontWeight: strong ? 700 : 500, marginTop: 4, overflowWrap: "anywhere" }}>
        {value}
      </div>
    </div>
  );
}

function Tile({ value, label, color, detail }: { value: string; label: string; color?: string; detail?: string | null }) {
  return (
    <div className="rp-tile" style={{ flex: 1, minWidth: 130, border: "1px solid var(--border)", borderRadius: 10, padding: "13px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.02em", color: color ?? "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{label}</div>
      {detail && <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>{detail}</div>}
    </div>
  );
}

/** One skill as a bar and its rating.
 *
 * THE FILL IS THIS SKILL'S OWN BAND. It was the report's overall colour — ten
 * identical bars — until the product decision that a bar about Listening should
 * say what Listening scored. The colour arrives on the DTO as `perfColor` of
 * this rating, the same mapping the drawer's rating control applies to the same
 * 1-5 scale, so the control the teacher just touched and the bar they are
 * looking at cannot disagree.
 *
 * THE WIDTH IS STILL THE RATING, and the number is still printed beside it, so
 * colour is never the only signal — which matters on a document that is printed
 * in greyscale as often as not. */
function SkillBar({ label, rating, color }: { label: string; rating: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <div style={{ flex: "0 0 84px", fontSize: 11.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 99, background: "var(--border-2)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: color }} />
      </div>
      <div style={{ flex: "none", fontSize: 11.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", minWidth: 12, textAlign: "right" }}>
        {rating}
      </div>
    </div>
  );
}

/** The tone tokens a summary item can carry, in the sheet's colour space.
 *
 * The pairing is the app's existing one, not a new palette: green is a strength
 * and amber is a focus area — exactly the two the feedback headings below use
 * and the profile's own strengths card uses — sky is movement, and muted is the
 * item that states a non-finding. Resolved here because this is a CSS surface;
 * the PDF resolves the same four names into ink. */
const TONE_COLOR: Record<TeacherSummaryLine["tone"], string> = {
  green: "var(--green)", amber: "var(--amber)", sky: "var(--sky)", muted: "var(--muted)",
};

/** One item of the teacher summary, as a card.
 *
 * LABEL ABOVE, NAMES BELOW, FIGURE IN THE CORNER. The names get the card's full
 * width to wrap into, which is what makes a nine-way tie readable instead of a
 * blob — and nothing is ever shortened: this document goes to a family, so a
 * skill a child was rated on is either printed or the layout is wrong.
 *
 * The rating sits in a small tinted pill in the card's own tone, so the figure
 * can be found without reading the names, and the tone tells a scanner which of
 * the three items they are looking at before they read the label. */
function SummaryCard({ line }: { line: TeacherSummaryLine }) {
  const tone = TONE_COLOR[line.tone];
  return (
    <div
      className="rp-summary-card"
      style={{
        minWidth: 0, border: "1px solid var(--border)", borderRadius: 10,
        padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ ...capStyle, color: tone, minWidth: 0, overflowWrap: "anywhere" }}>
          {line.label}
        </span>
        {line.detail && (
          <span
            style={{
              flex: "none", fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
              fontFamily: "'Geist Mono',monospace", whiteSpace: "nowrap",
              background: `color-mix(in srgb, ${tone} 12%, var(--card))`, color: tone,
            }}
          >
            {line.detail}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12.5, lineHeight: 1.45, fontWeight: line.muted ? 500 : 600,
          color: line.muted ? "var(--muted)" : "var(--fg-2)",
          minWidth: 0, overflowWrap: "anywhere",
        }}
      >
        {line.items.join(", ")}
      </div>
    </div>
  );
}

/** The teacher's own words, verbatim, or the app's em dash when there are none.
 * User content is never a dictionary key, so nothing here is translated. */
function Prose({ value }: { value: string }) {
  const text = value.trim();
  return (
    <p style={{ fontSize: 12.5, lineHeight: 1.6, color: text === "" ? "var(--muted-2)" : "var(--fg-2)", margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text === "" ? EM : value}
    </p>
  );
}
