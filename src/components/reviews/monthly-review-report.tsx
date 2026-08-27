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
 * a document and reads correctly under a dark theme. Nothing here is
 * theme-conditional and nothing here is interactive: no button, no link, no
 * input. That is what lets Gate 4.4E print it untouched.
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
import type { MonthlyReviewReport, StudentAttendanceRate } from "@/lib/review-report";

/* The sheet's own type scale. Document metrics, not the app's screen metrics:
 * this block is sized to be read on paper as much as on a screen, and the values
 * are the comp's own report-sheet figures. */
const capStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
  color: "var(--muted-2)",
};
const blockTitle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
  color: "var(--fg)", marginBottom: 12,
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
  const { student, parent, period, summary, skills, radar, teacherSummary, feedback, meta } = report;

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
      <div className="rp-block" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: "18px 24px", marginBottom: 22 }}>
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
      <div className="rp-block" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
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
      <div className="rp-block" style={{ marginBottom: 24 }}>
        <div style={blockTitle}>{t("Skill ratings")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(230px,100%),1fr))", gap: 20, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            {skills.map((s) => (
              <SkillBar key={s.key} label={t(s.label)} rating={s.rating} color={report.summary.performanceColor} />
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
        * DETERMINISTIC ONLY: strongest, weakest, and a strictly positive biggest
        * improvement. No concern line and no achievement line exist on the DTO,
        * so none can be rendered. A student's first review has nothing to
        * improve against and says exactly that. */}
      <div className="rp-block" style={{ marginBottom: 24 }}>
        <div style={blockTitle}>{t("Teacher summary")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {teacherSummary.strongest && (
            <SummaryRow
              label={t("Best skill")}
              value={`${t(teacherSummary.strongest.label)} · ${teacherSummary.strongest.rating}`}
            />
          )}
          {teacherSummary.weakest && (
            <SummaryRow
              label={t("Weakest skill")}
              value={`${t(teacherSummary.weakest.label)} · ${teacherSummary.weakest.rating}`}
            />
          )}
          {teacherSummary.improvement ? (
            <SummaryRow
              label={t("Biggest improvement")}
              value={`${t(labelOf(skills, teacherSummary.improvement.key))} · ${teacherSummary.improvement.from} → ${teacherSummary.improvement.to}`}
            />
          ) : radar.previous === null ? (
            <SummaryRow label={t("Biggest improvement")} value={t("First review — no prior month")} muted />
          ) : null}
        </div>
      </div>

      {/* ---- teacher feedback ----------------------------------------------
        * The teacher's own words, and only those. The four assessment fields
        * keep their heading with the app's em dash when empty, so the document's
        * shape is the same on every report and a reader can see that a section
        * was left blank rather than wonder whether it exists. */}
      <div className="rp-block" style={{ marginBottom: 20 }}>
        <div style={blockTitle}>{t("Teacher comment")}</div>
        <Prose value={feedback.comment} />
      </div>

      <div className="rp-block" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))", gap: 20, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 5 }}>{t("Strengths")}</div>
          <Prose value={feedback.strengths} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)", marginBottom: 5 }}>{t("Areas for improvement")}</div>
          <Prose value={feedback.improvements} />
        </div>
      </div>

      <div className="rp-block" style={{ background: "var(--amber-soft)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{t("Learning goals for next month")}</div>
        <Prose value={feedback.goals} />
      </div>

      {/* PARENT NOTES ARE OMITTED WHEN EMPTY, unlike the four above: this is a
        * message addressed to the family rather than a section of the
        * assessment, so an empty one has nothing to say and no shape to keep. */}
      {feedback.parentNotes.trim() !== "" && (
        <div className="rp-block" style={{ marginBottom: 20 }}>
          <div style={blockTitle}>{t("Parent notes")}</div>
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

function labelOf(skills: MonthlyReviewReport["skills"], key: string): string {
  return skills.find((s) => s.key === key)?.label ?? key;
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
    <div style={{ flex: 1, minWidth: 130, border: "1px solid var(--border)", borderRadius: 10, padding: "13px 14px", textAlign: "center" }}>
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
 * THE FILL IS THE REPORT'S OVERALL BAND, not a per-skill one — the same colour
 * the overall tile takes, so the sheet reads as one document rather than ten
 * competing colours. The WIDTH is the rating, which is what actually carries the
 * information, and the number is printed beside it so colour is never the only
 * signal. */
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

function SummaryRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", flex: "none" }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: muted ? 500 : 600, color: muted ? "var(--muted)" : "var(--fg)", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
        {value}
      </span>
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
