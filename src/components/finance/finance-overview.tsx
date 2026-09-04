"use client";

/* Finance — the Overview tab, ported from the design comp's FINANCE screen.
 *
 * Three KPI cards, the money summary with its collection bar and four tiles,
 * outstanding students beside top performing classes, and revenue by class with
 * its expandable per-student grid.
 *
 * THE FOURTH TILE IS THE POINT OF THIS SCREEN'S HONESTY. The comp itself draws
 * "Lesson revenue · completed lessons · informational" with a DASHED border,
 * beside three solid bill-derived tiles — the design already separates money
 * asked for from money earned, and this port keeps that separation in the markup
 * and in the code's vocabulary. Everything here reads `billing.*` except that
 * one tile, which reads `revenue.total`.
 *
 * `No data` IS NEVER `0đ`. Every amount that can be unknown goes through
 * `money()`, so a `Partially Paid` bill whose amount was never recorded — and
 * any total containing one — says so instead of claiming nothing was collected.
 * The collection bar renders a neutral unknown state rather than a proportion it
 * cannot compute.
 *
 * GHOSTS ARE COUNTED AND NEVER NAMED. The totals include bills whose student no
 * longer exists; the lists do not, and the difference is shown as the comp's own
 * "+N more". No id, name or placeholder row for a deleted person is rendered.
 *
 * NO PAYMENT CONTROLS. The comp has Record / Manage buttons but no payment form
 * anywhere in it, so none is drawn — PROJECT_RULES forbids inventing missing UI,
 * and a disabled button that suggests a working feature is worse than nothing.
 */

import { useState } from "react";
import { useSettings } from "@/lib/settings-context";
import type { FinanceMonthPayload } from "@/lib/finance-service";
import {
  STATUS_LABEL, barWidth, money, percent, rankByCollected, sortByOutstanding,
  statusBadgeStyle, statusColor,
} from "./finance-ui";

const cardStyle: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
};

const kpiIconStyle = (fg: string, bg: string): React.CSSProperties => ({
  minWidth: 32, width: 32, height: 32, borderRadius: 9, display: "flex",
  alignItems: "center", justifyContent: "center", background: bg, color: fg,
});

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--muted)", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: ".05em",
};

const kpiValueStyle = (color?: string): React.CSSProperties => ({
  fontSize: 18, fontWeight: 600, letterSpacing: "-.03em", marginTop: 13,
  fontFamily: "'Geist Mono',monospace", whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis",
  ...(color ? { color } : {}),
});

function Kpi({ label, icon, iconFg, iconBg, value, valueColor, caption }: {
  label: string; icon: React.ReactNode; iconFg: string; iconBg: string;
  value: string; valueColor?: string; caption: string;
}) {
  return (
    <div style={{ ...cardStyle, padding: "18px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={kpiLabelStyle}>{label}</span>
        <span style={kpiIconStyle(iconFg, iconBg)}>{icon}</span>
      </div>
      <div style={kpiValueStyle(valueColor)}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>{caption}</div>
    </div>
  );
}

const iconWallet = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M16 12h3" /></svg>
);
const iconCheck = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const iconClock = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export function FinanceOverview({ data }: { data: FinanceMonthPayload }) {
  const { t, fmt } = useSettings();
  const noData = t("No data");
  const monthLabel = fmt.monthLabel(data.month);
  const { billing, revenue } = data;

  const [expanded, setExpanded] = useState<string | null>(null);

  const collectedW = barWidth(billing.collected, billing.billed);
  const outstandingW = barWidth(billing.outstanding, billing.billed);
  const proportionKnown = collectedW !== null && outstandingW !== null;

  const { ranked, unknown } = rankByCollected(billing.perClass);
  const byOutstanding = sortByOutstanding(billing.perClass);

  return (
    <>
      {/* ---- Revenue KPIs. `.kpi-grid` is the app's existing escape: three
        * across, two at <=1100 and one at <=620. The comp's raw
        * repeat(3,minmax(0,1fr)) would put a 13,100,000d monospace figure into a
        * ~110px card on a phone. */}
      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "var(--gap)", marginBottom: "var(--gap)" }}>
        <Kpi
          label={t("Expected revenue")}
          icon={iconWallet} iconFg="var(--sky)" iconBg="var(--sky-soft)"
          value={fmt.vnd(billing.billed)}
          caption={`${t("Total billable")} · ${monthLabel}`}
        />
        <Kpi
          label={t("Collected revenue")}
          icon={iconCheck} iconFg="var(--green)" iconBg="var(--green-soft)"
          value={money(billing.collected, fmt, noData)}
          valueColor="var(--green)"
          caption={`${billing.counts.paid} ${t("of")} ${billing.counts.total} ${t("bills paid")}`}
        />
        <Kpi
          label={t("Outstanding balance")}
          icon={iconClock} iconFg="var(--accent)" iconBg="var(--accent-soft)"
          value={money(billing.outstanding, fmt, noData)}
          valueColor="var(--accent)"
          caption={t("Unpaid + partial still due")}
        />
      </div>

      {/* ---- Money summary ---- */}
      <div style={{ ...cardStyle, padding: "20px 22px", marginBottom: "var(--gap)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("Money summary")} · {monthLabel}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
              {t("Expected = Collected + Outstanding · Rate = Collected ÷ Expected")}
            </div>
          </div>
        </div>

        {/* THE BAR IS NOT DRAWN AT ZERO WHEN THE RATIO IS UNKNOWN. A bar at 0%
          * would claim nothing was collected; an unknown proportion gets a
          * neutral track and a sentence saying why. */}
        <div style={{ display: "flex", height: 16, borderRadius: 99, overflow: "hidden", background: "var(--card-2)", marginBottom: 9 }}>
          {proportionKnown && (
            <>
              <div style={{ height: "100%", background: "var(--green)", width: collectedW! }} />
              <div style={{ height: "100%", background: "var(--accent)", width: outstandingW! }} />
            </>
          )}
        </div>
        {!proportionKnown && (
          <div data-testid="fin-bar-unknown" style={{ fontSize: 12, color: "var(--muted-2)", marginBottom: 9 }}>
            {noData} — {billing.unknownAmountBills} {t("bills have no recorded amount")}
          </div>
        )}

        <div className="fin-summary-legend" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: "var(--green)" }} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {t("Collected")} <b style={{ color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>{money(billing.collected, fmt, noData)}</b>
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            <b style={{ color: "var(--fg)" }}>{percent(billing.collectionRate, noData)}</b> {t("of expected collected")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: "var(--accent)" }} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {t("Outstanding")} <b style={{ color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>{money(billing.outstanding, fmt, noData)}</b>
            </span>
          </div>
        </div>

        {/* ---- Four tiles. `.ov-grid` collapses 4 -> 3 -> 2 with the app's own
          * breakpoints rather than the comp's unguarded repeat(4,1fr). */}
        <div className="ov-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
          <Tile dot="var(--green)" label={t("Paid students")} value={String(billing.counts.paid)} />
          <Tile dot="var(--amber)" label={t("Partially paid")} value={String(billing.counts.partiallyPaid)} />
          <Tile dot="var(--accent)" label={t("Unpaid students")} value={String(billing.counts.unpaid)} />

          {/* THE LESSON-REVENUE TILE. Dashed, square dot, its own caption — the
            * comp's own way of saying this one number is not a bill. It is the
            * ONLY value on this tab that comes from `revenue`. */}
          <div data-testid="fin-lesson-revenue" style={{ border: "1px dashed var(--border-2)", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 2, background: "var(--sky)" }} />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("Lesson revenue")}</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, fontFamily: "'Geist Mono',monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
              {fmt.vnd(revenue.total)}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>
              {t("completed lessons · informational")}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Outstanding students + top performing classes ---- */}
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start", marginBottom: "var(--gap)" }}>
        <div style={{ ...cardStyle, padding: "18px 20px 12px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Outstanding students")}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("Who still owes tuition")}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99, background: "var(--accent-soft)", color: "var(--accent)" }}>
              {billing.outstandingStudents.length}
            </span>
          </div>

          {billing.outstandingStudents.length === 0 ? (
            <div style={{ padding: "30px 8px", textAlign: "center", borderTop: "1px solid var(--border-2)" }}>
              <div style={{ minWidth: 44, width: 44, height: 44, borderRadius: 12, background: "var(--green-soft)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("Everyone has paid")}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                {t("No outstanding tuition for")} {monthLabel}.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {billing.outstandingStudents.map((s) => (
                <div key={s.billId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
                  <span style={{ minWidth: 32, width: 32, height: 32, borderRadius: "50%", background: s.avatarColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>
                    {s.initials}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.studentName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.className} · {fmt.monthLabel(s.month)}
                    </div>
                    {/* Informational and never blocking. PROJECT_RULES requires
                      * Finance to say so where a student who owes money has no
                      * parent to talk to about it. */}
                    {!s.parentLinked && (
                      <div data-testid="fin-no-parent" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 1 }}>
                        {t("No linked parent")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flex: "none", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--accent)" }}>
                    {money(s.amount, fmt, noData)}
                  </div>
                </div>
              ))}
              {/* GHOST DISCLOSURE. Records that are inside every total above but
                * cannot be named, because their student no longer exists. The
                * comp's own affordance; never a "Deleted student" row. */}
              {billing.hiddenRecords > 0 && (
                <div data-testid="fin-hidden-more" style={{ padding: "10px 0 4px", textAlign: "center", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
                  +{billing.hiddenRecords} {t("more")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Top performing classes */}
        <div style={{ ...cardStyle, padding: "18px 20px 12px", minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Top performing classes")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
            {t("Highest-value classes by collected revenue")}
          </div>
          {ranked.length === 0 && unknown.length === 0 && (
            <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
              {t("No billing records for")} {monthLabel}.
            </div>
          )}
          {ranked.map((c, i) => (
            <div key={c.classId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
              <span style={{ minWidth: 26, width: 26, height: 26, borderRadius: 8, background: "var(--card-2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>{i + 1}</span>
              <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.classColor }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.className}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {c.counts.total} {t("students")} · {percent(c.collectionRate, noData)} {t("collected")}
                </div>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--green)", flex: "none" }}>
                {money(c.collected, fmt, noData)}
              </div>
            </div>
          ))}
          {/* A class whose collected value is unknown is NOT ranked and NOT given
            * a zero. It is listed after the ranking, saying so. */}
          {unknown.map((c) => (
            <div key={c.classId} data-testid="fin-unrankable-class" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
              <span style={{ minWidth: 26, width: 26, height: 26, borderRadius: 8, background: "var(--card-2)", color: "var(--muted-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5 }}>–</span>
              <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.classColor }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.className}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.counts.total} {t("students")}</div>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--muted-2)", flex: "none" }}>{noData}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Revenue by class, expandable ---- */}
      <div style={{ ...cardStyle, padding: "18px 20px 8px" }}>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Revenue by class")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {t("Sorted by outstanding balance — classes that still owe appear first. Click a row for student detail.")}
          </div>
        </div>

        {byOutstanding.length === 0 && (
          <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
            {t("No billing records for")} {monthLabel}.
          </div>
        )}

        {byOutstanding.map((c) => {
          const open = expanded === c.classId;
          const paidW = barWidth(c.counts.paid, c.counts.total);
          const partialW = barWidth(c.counts.partiallyPaid, c.counts.total);
          const unpaidW = barWidth(c.counts.unpaid, c.counts.total);
          return (
            <div key={c.classId} style={{ borderTop: "1px solid var(--border-2)" }}>
              <button
                onClick={() => setExpanded(open ? null : c.classId)}
                aria-expanded={open}
                className="btn-ghost"
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
                  padding: "14px 0", border: "none", background: "transparent",
                  color: "var(--fg)", font: "inherit", textAlign: "left", cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.classColor, marginTop: 6 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.className}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                    {c.counts.paid} {t("paid")} · {c.counts.partiallyPaid} {t("partial")} · {c.counts.unpaid} {t("unpaid")}
                    {c.hiddenRecords > 0 && <> · +{c.hiddenRecords} {t("more")}</>}
                  </span>
                  <span style={{ display: "flex", height: 8, borderRadius: 99, overflow: "hidden", background: "var(--card-2)", marginTop: 8, maxWidth: 420 }}>
                    {paidW && <span style={{ height: "100%", background: "var(--green)", width: paidW }} />}
                    {partialW && <span style={{ height: "100%", background: "var(--amber)", width: partialW }} />}
                    {unpaidW && <span style={{ height: "100%", background: "var(--accent)", width: unpaidW }} />}
                  </span>
                </span>
                <span style={{ textAlign: "right", minWidth: 88 }}>
                  <span style={{ display: "block", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Collected")}</span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", marginTop: 3, color: "var(--green)" }}>
                    {money(c.collected, fmt, noData)}
                  </span>
                </span>
                <span style={{ textAlign: "right", minWidth: 88 }}>
                  <span style={{ display: "block", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Outstanding")}</span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", marginTop: 3, color: "var(--accent)" }}>
                    {money(c.outstanding, fmt, noData)}
                  </span>
                </span>
              </button>

              {open && <ClassStudentGrid rows={c.rows} hidden={c.hiddenRecords} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Tile({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border-2)", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: "50%", background: dot }} />
        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}

/* The comp's six-column per-student grid.
 *
 * THE COMP DRAWS THIS UNPROTECTED — six tracks including four right-aligned
 * money columns and a status badge, with no `min-width` and no scroll container
 * — which Gate 1 identified as the screen's worst overflow risk: at 375px each
 * track would be about 55px. It is wrapped here in the SAME `overflow-x:auto` +
 * `min-width` container the comp itself uses for its Payments table, so the
 * scrolling is local to the grid and the page never exceeds the viewport. The
 * layout, the column set and the order are unchanged. */
function ClassStudentGrid({ rows, hidden }: { rows: FinanceMonthPayload["billing"]["perClass"][number]["rows"]; hidden: number }) {
  const { t, fmt } = useSettings();
  const noData = t("No data");
  const cols = "minmax(0,1.5fr) 1fr 1fr 1fr 1fr 1fr";

  return (
    <div style={{ paddingBottom: 14 }}>
      <div className="fin-scroll" style={{ overflowX: "auto", overflowY: "hidden", border: "1px solid var(--border-2)", borderRadius: 10 }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "9px 14px", background: "var(--card-2)", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
            <span>{t("Student")}</span>
            <span style={{ textAlign: "right" }}>{t("Monthly fee")}</span>
            <span style={{ textAlign: "right" }}>{t("Paid")}</span>
            <span style={{ textAlign: "right" }}>{t("Remaining")}</span>
            <span>{t("Status")}</span>
            <span style={{ textAlign: "right" }}>{t("Paid date")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.billId} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border-2)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.studentName}</span>
                {!r.parentLinked && (
                  <span data-testid="fin-no-parent" style={{ display: "block", fontSize: 10.5, color: "var(--muted-2)" }}>{t("No linked parent")}</span>
                )}
              </span>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right" }}>{fmt.vnd(r.fee)}</span>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right", color: "var(--green)" }}>
                {money(r.collected, fmt, noData)}
              </span>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right", color: "var(--accent)" }}>
                {money(r.outstanding, fmt, noData)}
              </span>
              <span><span style={statusBadgeStyle(r.status)}>{t(STATUS_LABEL[r.status] ?? r.status)}</span></span>
              <span style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "right" }}>
                {r.paidDate ? fmt.dateLabel(r.paidDate) : "—"}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: "18px 14px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
              {t("No billing records for")} {t("this month")}.
            </div>
          )}
        </div>
      </div>
      {hidden > 0 && (
        <div data-testid="fin-hidden-more" style={{ padding: "8px 2px 0", fontSize: 11.5, color: "var(--muted-2)" }}>
          +{hidden} {t("more")}
        </div>
      )}
    </div>
  );
}

export { statusColor };
