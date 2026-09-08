"use client";

/* The Reports options rail — the comp's own filter panel.
 *
 * FIVE CONTROLS, EXACTLY AS DESIGNED: report type, then Month and Year side by
 * side, then Class, then Student. All five are the app's shared `Select`, so
 * the trigger geometry, the popover, the focus ring and the disabled treatment
 * are the ones every other screen already uses. Nothing new is invented.
 *
 * THE PERIOD IS ONE VALUE BEHIND TWO CONTROLS. `period` is a canonical
 * "YYYY-MM"; Month and Year are two views of it and neither holds state. Their
 * options come from the payload's server-owned `months` and from nowhere else —
 * no `new Date()`, no year range, no `FINANCE_MONTHS`. A month outside the
 * window for the selected year stays in the list, disabled, because a value a
 * teacher expects to see and cannot find is worse than one they can see is
 * unavailable.
 *
 * A CONTROL A REPORT DOES NOT USE IS DISABLED, NEVER HIDDEN. The designed layout
 * does not change because a filter does not apply, and the disabled control
 * shows its sentinel so the rail and the sheet's scope line always agree. That
 * is deliberately unlike the ACTION controls: a disabled button suggests a
 * working feature, while a disabled field whose value is context does not
 * (PROJECT_RULES, Reports and Billing).
 *
 * NO GENERATE BUTTON. The design draws none, and a valid selection derives a
 * preview on its own. The rail's foot carries the two real action controls —
 * Export PDF and Print — and the note in page.tsx explains why there are two
 * where the reference draws three.
 */

import { useSettings } from "@/lib/settings-context";
import { Select, type SelectOption } from "@/components/ui/select";
import { REPORT_TITLE, REPORT_TYPES, type ReportOptions, type ReportType } from "@/lib/reports";
import {
  ALL, monthChoices, reportYears, scopeSupport, yearOf,
} from "@/components/reports/reports-ui";

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 6,
};

export function ReportControls({
  type, period, classId, studentId, months, options,
  onType, onPeriod, onYear, onClass, onStudent,
  canAct, exporting, onExport, onPrint,
}: {
  type: ReportType;
  /** The one canonical period. Month and Year are views of it. */
  period: string;
  classId: string;
  studentId: string;
  /** The server-owned window. The client derives every period option from it. */
  months: string[];
  options: ReportOptions;
  onType: (t: ReportType) => void;
  /** A month choice — already a canonical period. */
  onPeriod: (month: string) => void;
  /** A year choice. The page applies the snap rule and settles the period. */
  onYear: (year: string) => void;
  onClass: (id: string) => void;
  onStudent: (id: string) => void;
  /** Is there a report the CURRENT selection can be said to have produced?
   *
   * False before the first payload lands, while an error is on screen, and —
   * the case that matters — while `keepPreviousData` is still showing the
   * PREVIOUS selection's report because this one has not resolved yet. The rail
   * itself decides nothing: `canActOnReport` is the single condition and the
   * page hands down its answer. */
  canAct: boolean;
  /** An export is being drawn. Guards against a second file from a double press. */
  exporting: boolean;
  onExport: () => void;
  onPrint: () => void;
}) {
  const { t, fmt } = useSettings();
  const support = scopeSupport(type);

  const typeOptions: SelectOption[] = REPORT_TYPES.map((k) => ({
    value: k, label: t(REPORT_TITLE[k]),
  }));

  const year = yearOf(period);
  const yearOptions: SelectOption[] = reportYears(months).map((y) => ({ value: y, label: y }));
  const monthOptions: SelectOption[] = monthChoices(months, year).map((c) => ({
    value: c.value,
    // The app's own month names, translated — `monthLabel` carries the year too,
    // which this control must not, because the Year select owns that half.
    label: fmt.monthShort(c.value),
    disabled: c.disabled,
  }));

  const classOptions: SelectOption[] = [
    { value: ALL, label: t("All classes") },
    ...options.classes.map((c) => ({ value: c.id, label: c.name })),
  ];
  const studentOptions: SelectOption[] = [
    { value: ALL, label: t("All students") },
    ...options.students.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="rp-rail no-print">
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>{t("Report options")}</div>

      <label style={labelStyle}>{t("Report type")}</label>
      <div style={{ marginBottom: 14 }}>
        <Select
          value={type}
          ariaLabel={t("Report type")}
          onChange={(v) => onType(v as ReportType)}
          options={typeOptions}
        />
      </div>

      <div className="rp-period">
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle}>{t("Month")}</label>
          <Select value={period} ariaLabel={t("Month")} onChange={onPeriod} options={monthOptions} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle}>{t("Year")}</label>
          {/* The Year select sends a YEAR; the page applies the snap rule and
            * hands back a canonical period. */}
          <Select value={year} ariaLabel={t("Year")} onChange={onYear} options={yearOptions} />
        </div>
      </div>

      <label style={labelStyle}>{t("Class")}</label>
      <div style={{ marginBottom: 14 }}>
        <Select
          value={support.class ? classId : ALL}
          ariaLabel={t("Class")}
          onChange={onClass}
          options={classOptions}
          disabled={!support.class}
        />
      </div>

      <label style={labelStyle}>{t("Student")}</label>
      <div>
        <Select
          value={support.student ? studentId : ALL}
          ariaLabel={t("Student")}
          onChange={onStudent}
          options={studentOptions}
          disabled={!support.student}
        />
      </div>

      {/* THE ACTION BLOCK — the design's own separated foot of the rail.
        *
        * TWO CONTROLS WHERE THE REFERENCE DRAWS THREE. Excel is deferred to its
        * own gate and is not drawn, not even disabled: a disabled button
        * suggests a working feature, which PROJECT_RULES rules out more firmly
        * than it rules out a gap. Print therefore takes the full width the
        * reference gives its two-up row, rather than sitting beside an absence.
        *
        * BOTH ARE REAL. Neither is a placeholder, and neither is drawn before it
        * works — Gate 4 shipped this rail with no action block at all for
        * exactly that reason.
        *
        * DISABLED WHENEVER THERE IS NOTHING THE CURRENT SELECTION CAN ACT ON:
        * no payload yet, a failed read, an export already in flight — and while
        * a newer selection is still unresolved. That last case is the one worth
        * spelling out: `keepPreviousData` leaves the PREVIOUS report on screen
        * while the next loads, so the sheet and these controls describe
        * different selections for a moment. The sheet stays, because blanking it
        * would be worse; the two actions do not, because a document that has
        * been exported or printed cannot correct itself when the payload lands.
        *
        * THE SHARED DISABLED TREATMENT AND NOTHING ELSE. No badge, no warning,
        * no dialog, no extra loading UI — the only visible change is that two
        * buttons are briefly unavailable. */}
      <div className="rp-actions">
        <button
          type="button"
          onClick={onExport}
          disabled={!canAct || exporting}
          className="rp-action-primary"
        >
          {iconDownload}
          {t(exporting ? "Exporting…" : "Export PDF")}
        </button>
        <button
          type="button"
          onClick={onPrint}
          disabled={!canAct}
          className="rp-action-ghost"
        >
          {iconPrint}
          {t("Print")}
        </button>
      </div>
    </div>
  );
}

/* The comp's own two glyphs, at its own 15px. */
const iconDownload = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
);

const iconPrint = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
  </svg>
);
