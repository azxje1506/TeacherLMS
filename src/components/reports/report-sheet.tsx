"use client";

/* The Reports document — the comp's own `.report-sheet`, filled generically.
 *
 * ONE SHEET FOR ALL FIVE REPORTS, because the design draws one: a masthead, a
 * row of summary tiles, one table, a footer. Nothing branches on report type
 * below — the payload decides what the tiles say and what the columns are, and
 * this file decides only how a value looks. That is what keeps a sixth report
 * type a server change rather than a screen change.
 *
 * IT REUSES THE DOCUMENT PRIMITIVES AND NOT THE REVIEWS COMPONENT. `.report-sheet`,
 * `.rp-head`, `.rp-block` and `.rp-foot` are generic document CSS — the sheet's
 * light-locked palette, its masthead rule and its page-break behaviour — and are
 * shared. `MonthlyReviewReportView` is NOT: it is ten skill bars, a radar, a
 * teacher summary and parent notes, and reusing it would mean stubbing seven
 * blocks to draw a table. Nothing here imports it, and nothing here changes it.
 *
 * NEUTRAL BRANDING. `English Tutor LMS`, the same identity the Reviews sheet
 * carries, and no author anywhere: nothing in this data model records who wrote
 * a report, and the reference design's studio name and "prepared by" line are
 * demo content (PROJECT_RULES, Reports). `Generated on` is the application day
 * off the payload — document metadata, not a record of anything.
 *
 * NO EXPORT AND NO PRINT HERE. Gate 4 draws the document; Gate 5 adds the two
 * actions. There is no `window.print()`, no jsPDF import and no print class in
 * this file.
 */

import { useSettings } from "@/lib/settings-context";
import { renderValue, renderSummaryValue } from "@/components/reports/reports-ui";
/* Billing's own wording for two Billing facts. Reports reports on those bills;
 * it does not get to describe them differently from the screen that owns them. */
import { historicalNote, partialNote } from "@/components/finance/finance-ui";
import type { ReportPayload } from "@/lib/reports";

/** The document's own identity. Not the studio name from the reference comp —
 * see the branding note above. */
const IDENTITY = "English Tutor LMS";

export function ReportSheet({ data }: { data: ReportPayload }) {
  const { t, fmt } = useSettings();

  /* The masthead's second line: the period, and what the report is about. The
   * scope names only entities that RESOLVED, so there is never a ghost name here
   * and never a placeholder for one. */
  const scopeLabel = data.scope.studentName && data.scope.className
    ? `${data.scope.studentName} · ${data.scope.className}`
    : data.scope.studentName ?? data.scope.className ?? t("All classes");

  return (
    <div className="report-sheet rp-sheet">
      <div className="rp-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" }}>{t(data.title)}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            {fmt.monthLabel(data.month)} · {scopeLabel}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{IDENTITY}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 3 }}>
            {t("Generated on")} {fmt.dateLabel(data.appClock)}
          </div>
        </div>
      </div>

      {data.empty ? <SheetEmpty /> : (
        <>
          {data.summary.length > 0 && (
            <div className="rp-block rp-stats">
              {data.summary.map((s) => (
                <div key={s.label} className="rp-stat">
                  <div className="rp-stat-label">{t(s.label)}</div>
                  <div className="rp-stat-value">{renderSummaryValue(s.value, s.floor, fmt, t)}</div>
                </div>
              ))}
            </div>
          )}

          {data.rows.length > 0 && (
            /* THE SCROLLER IS AROUND THE TABLE, NOT THE SHEET. A five-column
             * money table cannot fit 375px, and the page itself must never
             * scroll sideways — so the overflow is bounded here, inside the
             * document, and the sheet stays visually whole. No column is
             * dropped and no column count is changed to make a phone happy. */
            <div className="rp-block rp-table-wrap" tabIndex={0} role="region" aria-label={t(data.title)}>
              <table className="rp-table">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key} scope="col" style={{ textAlign: c.align }}>{t(c.label)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.key}>
                      {row.cells.map((cell, i) => (
                        <td key={data.columns[i]?.key ?? i} style={{ textAlign: data.columns[i]?.align ?? "left" }}>
                          {renderValue(cell, fmt, t)}
                          {/* PROJECT_RULES, Reports: the Student Payment report's
                            * per-student rows say when a student has nobody to
                            * talk to about the bill. A boolean and the app's own
                            * words — never a name, phone, email or address, and
                            * never on a report where parent linkage has no
                            * bearing on the figure. */}
                          {i === 0 && row.parentLinked === false && (
                            <span className="rp-no-parent">{t("No linked parent")}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Records counted in the totals above but named in no row, because
            * their student no longer resolves — Billing's own `hiddenRecords`,
            * shown only where that domain supplied it. No count is derived here
            * and no placeholder row is drawn for somebody who is gone.
            *
            * IT BORROWS FINANCE'S OWN SENTENCE rather than the reference comp's
            * "+N more". Sprint 9 replaced that affordance deliberately: a bare
            * count beside a list reads as a control that reveals four more
            * people, and there are no more people. The wording is also already a
            * FINANCE fact rather than a data-model one — "historical payment
            * records no longer have student information", never ghost, hidden or
            * deleted — and it is already translated. Reports states the same
            * fact about the same bills, so it says it in the same words instead
            * of coining a synonym. */}
          {typeof data.hiddenRecords === "number" && data.hiddenRecords > 0 && (
            <div className="rp-block rp-note">{historicalNote(data.hiddenRecords, t)}</div>
          )}

          {/* The scope's amounts are incomplete, and the sheet says so rather
            * than letting a floor be read as an exact figure. Finance's own
            * sentence again, for the same records. */}
          {data.completeness && !data.completeness.amountsComplete && (
            <div className="rp-block rp-note">
              {partialNote(data.completeness.unknownAmountBills, t)}
            </div>
          )}

          {/* Attendance's own coverage pair, where its helper supplied one. A
            * percentage over two registers and one over twenty are not the same
            * claim, and this is what says which. */}
          {data.coverage && (
            <div className="rp-block rp-note">
              {t("Registers taken")} · {data.coverage.registersTaken}/{data.coverage.lessonsCompleted}
            </div>
          )}
        </>
      )}

      <div className="rp-foot">
        <span>{IDENTITY} · {t(data.title)}</span>
        <span>{fmt.monthLabel(data.month)}</span>
      </div>
    </div>
  );
}

/** The design's own empty state, word for word. A month holding nothing is a
 * legitimate answer, not an error — so this is a quiet block inside the
 * document, never an error card in place of it. */
function SheetEmpty() {
  const { t } = useSettings();
  return (
    <div className="rp-block rp-empty">
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--muted)" }}>
        {t("No data for this selection")}
      </div>
      <p style={{ fontSize: 13, margin: "6px 0 0", color: "var(--muted-2)" }}>
        {t("Adjust the month, class or student filters to populate this report.")}
      </p>
    </div>
  );
}
