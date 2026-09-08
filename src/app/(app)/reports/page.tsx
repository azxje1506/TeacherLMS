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
 * TWO ACTIONS, WHERE THE REFERENCE DRAWS THREE. Export PDF and Print are real
 * and work; Excel is deferred to its own gate and is NOT drawn, not even
 * disabled, because a disabled button suggests a working feature. That is an
 * authorised divergence, recorded in PROJECT_RULES rather than discovered here.
 *
 * BOTH OUTPUTS ARE CLIENT-SIDE AND WRITE NOTHING. The PDF is drawn in the
 * browser from the payload already on screen and handed straight to the
 * downloads folder; the print is the browser's own dialog over a scoped
 * stylesheet. There is no export endpoint, no server-generated file, no stored
 * artefact and no report record — a report is generated and thrown away.
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
import { useToast } from "@/components/ui/toast";
import { CURRENT_MONTH } from "@/lib/constants";
import { REPORT_TYPES, type ReportType } from "@/lib/reports";
import { fetchReport, reportKeys } from "@/components/reports/api";
import { ReportControls } from "@/components/reports/report-controls";
import { ReportSheet } from "@/components/reports/report-sheet";
import { buildReportPdfDocument } from "@/lib/reports-pdf-document";
import { ReportPdfError, exportReportPdf } from "@/lib/reports-pdf";
import {
  ALL, canActOnReport, nextClassValue, nextStudentValue, snapPeriod,
} from "@/components/reports/reports-ui";

/** The first report offered, and the one the screen opens on. `REPORT_TYPES[0]`
 * rather than a literal, so the default follows the domain's own ordering
 * instead of becoming a second place the list is written down. */
const DEFAULT_TYPE: ReportType = REPORT_TYPES[0];

/** Print the Reports document, and put the page back afterwards.
 *
 * MODULE SCOPE ON PURPOSE. It closes over no component state, so it is stable
 * across renders and cannot become a stale dependency.
 *
 * THE CLASS IS SAFE TO LEAVE BEHIND. Every `.print-report` rule lives inside
 * `@media print`, so a class that outlives a print — a browser that never fires
 * `afterprint`, a dialog dismissed in an unusual way — has no effect on screen
 * at all. That is what lets the cleanup be event-driven rather than a guess at
 * how long a print takes. It is still cleaned three ways: on `afterprint`, and
 * synchronously if `window.print()` throws or is unavailable.
 *
 * IT WRITES NOTHING. No cache entry, no request, no report record. */
function printReportSheet(): void {
  const body = document.body;
  body.classList.add("print-report");
  const done = () => {
    body.classList.remove("print-report");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  try {
    window.print();
  } catch {
    /* A browser that refuses the dialog must not leave the class behind — and
     * `afterprint` will never fire for a print that never started. */
    done();
  }
}

export default function ReportsPage() {
  const { t, fmt } = useSettings();
  const { toast } = useToast();

  const [type, setType] = useState<ReportType>(DEFAULT_TYPE);
  const [period, setPeriod] = useState<string>(CURRENT_MONTH);
  const [classId, setClassId] = useState<string>(ALL);
  const [studentId, setStudentId] = useState<string>(ALL);

  const {
    data, isLoading, isError, refetch, isFetching, isPlaceholderData,
  } = useQuery({
    queryKey: reportKeys.one(type, period, classId, studentId),
    queryFn: () => fetchReport(type, period, classId, studentId),
    /* THE PREVIEW HOLDS THE LAST GOOD REPORT WHILE THE NEXT ONE LOADS. Changing
     * a filter is a navigation between two documents, not a destruction of the
     * one on screen; without this the sheet would blank on every keystroke of
     * the rail. `isFetching` drives the quiet in-flight cue instead.
     *
     * IT IS DISPLAY CONTINUITY ONLY. The payload it holds belongs to the
     * PREVIOUS selection, so while it is on screen the rail and the sheet
     * describe different things — and `isPlaceholderData` is React Query's own
     * answer to which of the two the document is. `canActOnReport` reads it, so
     * neither output can act on a report the controls no longer ask for. */
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

  /* ---- the two outputs --------------------------------------------------
   *
   * BOTH ACT ON `data` — the payload the sheet is showing this render. There is
   * no second fetch, no different query and no snapshot taken earlier, because
   * `data` IS the document on screen.
   *
   * BUT A PREVIOUS PAYLOAD IS NOT AN ACTIONABLE ONE. `keepPreviousData` keeps
   * selection A's report rendered while selection B loads, which is right for
   * the screen and wrong for a file: exporting then would hand somebody A's
   * figures under B's filters, and a document that leaves the building wrong
   * stays wrong, where the screen corrects itself a moment later. So the actions
   * wait for the CURRENT selection to resolve. The sheet does not blank, the
   * `aria-busy` cue does not change, and the only visible difference is that two
   * buttons are unavailable for as long as the rail and the sheet disagree.
   *
   * ONE CONDITION, BOTH ACTIONS, AND THE HANDLERS RE-READ IT. The buttons are
   * disabled from `canAct` and each handler checks it again before doing
   * anything, so a programmatic or keyboard call cannot walk past a disabled
   * button into a stale export or a stale print dialog.
   *
   * NEITHER WRITES. No mutation, no invalidation, no cache entry, no report
   * record. A PDF exists only in the viewer's downloads folder, and a print
   * exists only on paper. */
  const canAct = canActOnReport({
    hasReport: !!data,
    isError,
    isFetching,
    isPlaceholderData,
  });

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    // FAIL CLOSED. No payload, a payload belonging to an older selection, or a
    // file already being drawn — nothing is generated. The last of those is the
    // double-press guard: two identical downloads is not what anybody meant.
    if (!canAct || !data || exporting) return;
    setExporting(true);
    try {
      await exportReportPdf(buildReportPdfDocument(data, { t, fmt }));
    } catch (e) {
      /* A BROKEN EXPORT IS SAID SO, NEVER SHIPPED QUIETLY. The commonest cause
       * is the Unicode font failing to load, and a PDF drawn without it would
       * open perfectly while spelling a student's name wrong. Nothing is
       * persisted by the failure and the button is usable again immediately. */
      toast(t(e instanceof ReportPdfError ? e.message : "The report could not be exported."), "error");
    } finally {
      setExporting(false);
    }
  };

  /* THE SAME GUARD, IN FRONT OF THE SAME CONDITION. `printReportSheet` stays at
   * module scope closing over nothing, so the check lives here rather than
   * inside it — and it comes BEFORE `body.print-report` is added, so a blocked
   * print never rewrites the page and never opens a dialog. */
  const onPrint = () => {
    if (!canAct) return;
    printReportSheet();
  };

  return (
    <div data-screen-label="Reports" style={{ animation: "fadeUp .3s ease both" }}>
      {/* THE PAGE HEADING IS SCREEN CHROME, AND PRINT MUST DROP IT. It is a
        * SIBLING of `.rp-grid`, not a descendant, so the print scope's unwrap of
        * the ancestor chain made it visible along with everything else on the
        * page — and it had no class, so no rule could name it. Human
        * verification found "Báo cáo" and its subtitle printed above the
        * document's own masthead. `rp-page-head` is that missing hook; the rule
        * that hides it lives in the Reports print scope and nowhere else, so the
        * screen and a plain Ctrl+P from any other page are both unchanged. */}
      <div className="rp-page-head">
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
          canAct={canAct}
          exporting={exporting}
          onExport={onExport}
          onPrint={onPrint}
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
