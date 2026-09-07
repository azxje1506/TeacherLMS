"use client";

/* Reports — ported from the design comp's REPORTS screen: the heading with its
 * subtitle, the sticky options rail, and the live report preview beside it. Data
 * is real, via React Query against /api/reports.
 *
 * NO GENERATE BUTTON. The design draws none — the rail's action block is Export
 * PDF / Excel / Print and nothing else — and a valid selection derives a preview
 * on its own. The Dashboard's "Generate report" is a link to this screen and
 * generates nothing itself.
 *
 * NO ACTION BLOCK AT ALL IN THIS GATE, and that is a temporary, deliberate
 * state. Export PDF and Print are authorised and are Gate 5; Excel is deferred
 * and will never be drawn. Drawing any of the three now — even disabled — would
 * be a control that suggests a working feature, which PROJECT_RULES rules out
 * more firmly than it rules out a gap. The rail's own `border-top` separator and
 * bottom padding are the only things that move when Gate 5 adds the block, so
 * nothing here has to be redesigned to receive it.
 *
 * THE SERVER OWNS THE MONTH WINDOW AND THE SCOPE OPTIONS. `data.months` is the
 * period window, `data.options` is what the Class and Student selects may offer,
 * and the student list is already filtered to the selected class's RESOLVABLE
 * roster. No `new Date()` appears in any Reports UI file — a browser clock is
 * not this application's clock — and no roster is resolved here, because a
 * browser cannot read Student documents and approximating it would be a second
 * roster interpretation.
 *
 * THE FIRST REQUEST. `CURRENT_MONTH` is the app clock the rest of the server
 * already uses, and it seeds the period so the first request is well-formed;
 * the payload's own `months` replaces it as the authority the moment that first
 * response lands, exactly as the Finance screen does. It is not a second clock —
 * it is the same constant the server reads.
 *
 * THE SELECTION IS SCREEN STATE. It is not persisted, not in the URL and not
 * read back, exactly as the Finance tab and the Reviews composer's stage are.
 * There is no saved report, no history and no id, because a report is generated
 * and thrown away.
 *
 * READ-ONLY, AND NOTHING ELSE EXISTS TO CALL. There is one endpoint, it is a
 * GET, and there is no mutation anywhere in Reports.
 */

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { CURRENT_MONTH } from "@/lib/constants";
import { REPORT_TYPES, type ReportType } from "@/lib/reports";
import { fetchReport, reportKeys } from "@/components/reports/api";
import { ReportControls } from "@/components/reports/report-controls";
import { ReportSheet } from "@/components/reports/report-sheet";
import {
  ALL, nextClassValue, nextStudentValue, snapPeriod,
} from "@/components/reports/reports-ui";

/** The first report offered, and the one the screen opens on. `REPORT_TYPES[0]`
 * rather than a literal, so the default follows the domain's own ordering
 * instead of becoming a second place the list is written down. */
const DEFAULT_TYPE: ReportType = REPORT_TYPES[0];

export default function ReportsPage() {
  const { t } = useSettings();

  const [type, setType] = useState<ReportType>(DEFAULT_TYPE);
  const [period, setPeriod] = useState<string>(CURRENT_MONTH);
  const [classId, setClassId] = useState<string>(ALL);
  const [studentId, setStudentId] = useState<string>(ALL);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: reportKeys.one(type, period, classId, studentId),
    queryFn: () => fetchReport(type, period, classId, studentId),
    /* THE PREVIEW HOLDS THE LAST GOOD REPORT WHILE THE NEXT ONE LOADS. Changing
     * a filter is a navigation between two documents, not a destruction of the
     * one on screen; without this the sheet would blank on every keystroke of
     * the rail. `isFetching` drives the quiet in-flight cue instead. */
    placeholderData: keepPreviousData,
  });

  const months = data?.months ?? [period];

  /* A report-type change keeps the period — a period is never invalidated by a
   * type — and clears only the scope values that have become meaningless for
   * the new type. Both decisions live in the pure helpers, not here. */
  const onType = (next: ReportType) => {
    setType(next);
    const nextClass = nextClassValue(next, classId);
    setClassId(nextClass);
    setStudentId(nextStudentValue(next, studentId, data?.options.students ?? []));
  };

  /* A year change resolves through the snap rule, so the period the server is
   * asked for is always one it offered. */
  const onYear = (year: string) => setPeriod(snapPeriod(months, period, year));

  /* Choosing a class narrows the student list, so a student who is not on the
   * new class's roster returns to the sentinel rather than being sent as a
   * scope the server would refuse. The next payload carries the new list. */
  const onClass = (id: string) => {
    setClassId(id);
    if (id !== classId) setStudentId(ALL);
  };

  return (
    <div data-screen-label="Reports" style={{ animation: "fadeUp .3s ease both" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>
          {t("Reports")}
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>
          {t("Generate, preview and export financial & academic reports.")}
        </p>
      </div>

      {/* THE GRID IS A CLASS, NOT AN INLINE STYLE. Gate 4.4D proved an inline
        * layout declaration beats a media query and leaves apparently correct
        * responsive CSS inert — so every layout property that has to change with
        * width lives in globals.css and nothing here competes with it. */}
      <div className="rp-grid">
        <ReportControls
          type={type}
          period={period}
          classId={classId}
          studentId={studentId}
          months={months}
          options={data?.options ?? { classes: [], students: [] }}
          onType={onType}
          onPeriod={setPeriod}
          onYear={onYear}
          onClass={onClass}
          onStudent={setStudentId}
        />

        <div className="rp-preview" aria-busy={isFetching || undefined}>
          {isLoading && <ReportSkeleton />}

          {!isLoading && isError && (
            <div className="rp-state">
              <div className="rp-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load report")}</div>
              <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
                {t("Something went wrong while fetching the list. Check your connection and try again.")}
              </p>
              {/* A read that failed is retried by reading again. Nothing is
                * written, nothing is regenerated, and there is no side effect to
                * undo first. */}
              <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
                {t("Try again")}
              </button>
            </div>
          )}

          {!isLoading && !isError && data && <ReportSheet data={data} />}
        </div>
      </div>
    </div>
  );
}

/** The waiting state, shaped like the sheet it precedes.
 *
 * IT SAYS "LOADING", NOT "GENERATING". Nothing is being produced and nothing is
 * being written — a report is derived from data that already exists, and copy
 * suggesting otherwise would describe an operation this screen does not perform.
 */
function ReportSkeleton() {
  const { t } = useSettings();
  return (
    <div className="report-sheet rp-sheet" aria-live="polite">
      <div className="rp-head">
        <div style={{ minWidth: 0 }}>
          <div className="rp-sk" style={{ width: 200, height: 18 }} />
          <div className="rp-sk" style={{ width: 140, height: 12, marginTop: 8 }} />
        </div>
      </div>
      <div className="rp-block rp-stats">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rp-stat">
            <div className="rp-sk" style={{ width: 70, height: 10 }} />
            <div className="rp-sk" style={{ width: 100, height: 16, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="rp-block">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="rp-sk" style={{ height: 14, marginBottom: 10 }} />
        ))}
      </div>
      <div className="rp-foot"><span>{t("Loading report…")}</span></div>
    </div>
  );
}
