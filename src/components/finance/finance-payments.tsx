"use client";

/* Finance — the Payments tab, ported from the design comp.
 *
 * READ-ONLY, AND DELIBERATELY INCOMPLETE AGAINST THE COMP. Two things the comp
 * draws are absent, both approved in Sprint 9 Gate 2:
 *
 *  - the METHOD column. `p.methodIcon` / `p.methodLabel` exist in the comp with
 *    no field behind them — not on the Billing model, not in production, not in
 *    PROJECT_RULES and not in the dictionary. Rendering an empty column or a
 *    fabricated value would both be worse than omitting it.
 *  - every ROW ACTION. Mark as unpaid is fully specified, but Manage opens a
 *    form whose markup does not exist anywhere in the comp, and Mark as paid
 *    must set a payment date the comp provides no input for. Two of the three
 *    cannot be honestly shipped, so all three wait for a payment-form design.
 *    PROJECT_RULES: implement the logic and the API, do not invent the UI.
 *
 * The mutation endpoint EXISTS and is complete. Nothing here calls it: no
 * mutation hook, no form, no drawer, no status dropdown, and no disabled button
 * hinting at one. There is a test asserting no Finance UI file so much as
 * mentions the route.
 *
 * FILTERS ARE CLIENT-SIDE OVER THE MONTH'S ROWS. The server already returned
 * every bill the screen may name, so filtering is a view of data in hand rather
 * than a second endpoint. Ghost rows cannot appear in any filter combination
 * because the server never sent them, and there is no "deleted student" option
 * to select.
 *
 * AND THE TABLE IS THE WHOLE OF IT (Gate 5.5). This tab shows current students'
 * bills and says nothing about records it cannot show. A read-only table that
 * ends in "+N more" is read as one that could load more; there is nothing to
 * load, because the records that count are for students who no longer exist.
 * The month's aggregate gap belongs beside the month's aggregate, on Overview.
 */

import { useMemo, useState } from "react";
import { useSettings } from "@/lib/settings-context";
import { Select } from "@/components/ui/select";
import { EM } from "@/lib/format";
import type { FinanceMonthPayload } from "@/lib/finance-service";
import { BILLING_STATUSES } from "@/lib/billing";
import { STATUS_LABEL, statusBadgeStyle } from "./finance-ui";

const ALL = "__all__";

export function FinancePayments({ data }: { data: FinanceMonthPayload }) {
  const { t, fmt } = useSettings();
  const monthLabel = fmt.monthLabel(data.month);
  const rows = data.billing.rows;

  const [status, setStatus] = useState(ALL);
  const [classId, setClassId] = useState(ALL);
  const [studentId, setStudentId] = useState(ALL);

  /* Options come from the rows themselves, so a filter can only ever offer a
   * value that is actually present — and a deleted student is unofferable
   * because no row carries one. */
  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.classId)) seen.set(r.classId, r.className);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const studentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.studentId)) seen.set(r.studentId, r.studentName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) =>
      (status === ALL || r.status === status) &&
      (classId === ALL || r.classId === classId) &&
      (studentId === ALL || r.studentId === studentId)
    ),
    [rows, status, classId, studentId]
  );

  const cols = "minmax(150px,1.6fr) minmax(120px,1.4fr) 120px 110px 130px";

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 150, flex: "0 1 190px" }}>
          <Select
            value={status}
            ariaLabel={t("Payment status")}
            onChange={setStatus}
            options={[
              { value: ALL, label: t("All statuses") },
              ...BILLING_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL[s] ?? s) })),
            ]}
          />
        </div>
        <div style={{ minWidth: 150, flex: "0 1 220px" }}>
          <Select
            value={classId}
            ariaLabel={t("Class")}
            onChange={setClassId}
            options={[{ value: ALL, label: t("All classes") }, ...classOptions]}
          />
        </div>
        <div style={{ minWidth: 150, flex: "0 1 220px" }}>
          <Select
            value={studentId}
            ariaLabel={t("Student")}
            onChange={setStudentId}
            options={[{ value: ALL, label: t("All students") }, ...studentOptions]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div data-testid="fin-payments-empty" style={{ border: "1px dashed var(--border)", borderRadius: 16, background: "var(--card)", padding: "56px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: "var(--r)", background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "var(--muted)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M16 12h3" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No payment records")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 400, margin: "8px auto 0" }}>
            {t("No billing records match these filters for")} {monthLabel}.
          </p>
        </div>
      ) : (
        /* The comp's own overflow-x wrapper. Scrolling stays LOCAL to the table:
         * the page itself never exceeds the viewport. */
        <div className="fin-scroll" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)", overflowX: "auto", overflowY: "hidden" }}>
          <div style={{ minWidth: 700 }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--card-2)" }}>
              {[t("Student"), t("Class"), t("Monthly fee"), t("Status"), t("Paid date")].map((h, i) => (
                <span key={h} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted-2)", textAlign: i === 2 ? "right" : "left" }}>
                  {h}
                </span>
              ))}
            </div>

            {filtered.map((r) => (
              <div key={r.billId} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--border-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ minWidth: 32, width: 32, height: 32, borderRadius: "50%", background: r.avatarColor, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    {r.initials}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.studentName}</div>
                    {!r.parentLinked && (
                      <div data-testid="fin-no-parent" style={{ fontSize: 10.5, color: "var(--muted-2)" }}>{t("No linked parent")}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: r.classColor, flex: "none" }} />
                  <span style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.className}</span>
                </div>

                <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", textAlign: "right" }}>{fmt.vnd(r.fee)}</span>

                <span><span style={statusBadgeStyle(r.status)}>{t(STATUS_LABEL[r.status] ?? r.status)}</span></span>

                {/* An Unpaid bill has no payment date, which is an ABSENCE
                  * rather than an unknown — so it takes the app's own em-dash
                  * placeholder, not `No data`. */}
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {r.paidDate ? fmt.dateLabel(r.paidDate) : EM}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NOTHING FOLLOWS THE TABLE. It used to end with the count of records the
        * month holds that no student can be named for, which under a filtered,
        * read-only table read as "there are more payments here, load them" —
        * a promise this screen cannot keep, since those bills have no student to
        * show. The table is exactly the live students' bills, the filters can
        * only ever offer a live student, and the month's own gap is explained on
        * the Overview tab beside the total it is about. */}
    </>
  );
}
