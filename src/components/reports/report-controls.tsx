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
 * preview on its own. NO ACTION BLOCK AT ALL IN THIS GATE — see the note in
 * page.tsx.
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
    </div>
  );
}
