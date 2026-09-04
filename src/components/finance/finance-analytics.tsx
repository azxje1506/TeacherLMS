"use client";

/* Finance — the Revenue analytics tab, ported from the design comp.
 *
 * READS `revenue` AND NOTHING ELSE. Every figure on this tab is lesson-derived:
 * the trend, the distribution, the per-class list and the lesson-type split all
 * come from `computeRevenue`, and no bill is consulted anywhere on this surface.
 * That is why this is the one tab whose name carries the word — the split the
 * comp draws with its dashed "Lesson revenue · informational" tile on Overview
 * is the same split, stated here as a whole screen.
 *
 * NOTHING IS RECOMPUTED IN THE BROWSER. `byType` already sums exactly to `total`
 * — Gate 3 made that an invariant of the engine by counting shares and
 * allocating whole đồng once — so the three bars are rendered, never re-derived.
 * The only arithmetic here is display geometry: bar widths and arc lengths.
 *
 * NOTHING IS NORMALISED. If one class dominates the distribution because the
 * stored data says so, the chart says so. Correcting stored data is a separate,
 * explicitly authorised act, never a side effect of drawing it.
 */

import { useSettings } from "@/lib/settings-context";
import type { FinanceMonthPayload } from "@/lib/finance-service";
import { RevenueDonut, RevenueTrend } from "./finance-charts";
import { barWidth } from "./finance-ui";

const cardStyle: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
};

const TYPE_COLORS: Record<string, string> = {
  regular: "var(--accent)",
  makeup: "var(--sky)",
  extra: "var(--green)",
};
const TYPE_LABELS: Record<string, string> = {
  regular: "Regular", makeup: "Makeup", extra: "Extra",
};

export function FinanceAnalytics({ data }: { data: FinanceMonthPayload }) {
  const { t, fmt } = useSettings();
  const monthLabel = fmt.monthLabel(data.month);
  const { revenue } = data;

  /* The comp's own empty state for a month that earned nothing. A read stays a
   * read: no lifecycle is advanced to make a figure appear. */
  if (revenue.total <= 0) {
    return (
      <div data-testid="fin-revenue-empty" style={{ border: "1px dashed var(--border)", borderRadius: 16, background: "var(--card)", padding: "56px 24px", textAlign: "center" }}>
        <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: "var(--r)", background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "var(--muted)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No revenue recorded for")} {monthLabel}</div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 400, margin: "8px auto 0" }}>
          {t("Complete lessons to start tracking revenue for this month.")}
        </p>
      </div>
    );
  }

  const peak = Math.max(...revenue.trend.map((p) => p.total), 0);
  const slices = revenue.perClass.map((c) => ({
    key: c.classId, label: c.name, color: c.color || "var(--accent)", value: c.amount,
  }));
  const topClass = Math.max(...revenue.perClass.map((c) => c.amount), 0);

  return (
    <>
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start", marginBottom: "var(--gap)" }}>
        <div style={{ ...cardStyle, padding: "18px 20px", minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>{t("Monthly revenue trend")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>
            {t("Last 6 months")} · {t("peak")} {fmt.vnd(peak)}
          </div>
          <RevenueTrend
            trend={revenue.trend}
            monthShort={(m) => fmt.monthShort(m)}
            formatAmount={(a) => fmt.vnd(a)}
          />
        </div>

        <div style={{ ...cardStyle, padding: "18px 20px", minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>{t("Revenue distribution")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>{t("Share by class")}</div>
          <RevenueDonut
            slices={slices}
            totalLabel={t("Total")}
            formatAmount={(a) => fmt.vnd(a)}
            emptyLabel={t("No data")}
          />
        </div>
      </div>

      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start" }}>
        {/* LESSON-DERIVED revenue by class. Deliberately NOT the Overview tab's
          * bill-derived per-class block: same words, different question. */}
        <div style={{ ...cardStyle, padding: "18px 20px 14px", minWidth: 0 }} data-testid="fin-revenue-by-class">
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>{t("Revenue by class")}</div>
          {revenue.perClass.map((c) => (
            <div key={c.classId} style={{ padding: "9px 0", borderTop: "1px solid var(--border-2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.color || "var(--accent)" }} />
                  <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", flex: "none" }}>{fmt.vnd(c.amount)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--card-2)", overflow: "hidden" }}>
                <div style={{ height: "100%", background: c.color || "var(--accent)", width: barWidth(c.amount, topClass) ?? "0%" }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...cardStyle, padding: "18px 20px", minWidth: 0 }} data-testid="fin-by-type">
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>{t("By lesson type")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>{t("Regular, makeup & extra")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(["regular", "makeup", "extra"] as const).map((key) => (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: TYPE_COLORS[key] }} />
                    <span style={{ fontSize: 13 }}>{t(TYPE_LABELS[key])}</span>
                  </div>
                  {/* Rendered, never recomputed: these three sum exactly to
                    * revenue.total by construction (Gate 3). */}
                  <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", flex: "none" }}>
                    {fmt.vnd(revenue.byType[key])}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: "var(--card-2)", overflow: "hidden" }}>
                  <div style={{ height: "100%", background: TYPE_COLORS[key], width: barWidth(revenue.byType[key], revenue.total) ?? "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
