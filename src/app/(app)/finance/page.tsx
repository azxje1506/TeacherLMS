"use client";

/* Finance — ported from the design comp's FINANCE screen: the heading with its
 * month selector, the three-tab strip (Overview / Revenue analytics / Payments)
 * and the sections each tab owns. Data is real, via React Query against
 * /api/finance.
 *
 * TWO KINDS OF MONEY, KEPT APART. The comp itself separates them — three
 * bill-derived KPI cards beside a dashed "Lesson revenue · informational" tile —
 * and this port keeps that separation in the code as well as on the screen. The
 * payload arrives in two branches: `billing` is tuition asked for and received,
 * `revenue` is money earned by teaching. Overview and Payments read the first;
 * Revenue analytics reads the second; no component mixes them, and no
 * bill-derived value is called revenue anywhere in the code.
 *
 * THE SERVER OWNS THE MONTH WINDOW. `data.months` is the list; the client
 * renders it and sends one back. No `new Date()` appears in any Finance UI file
 * — a browser clock is not this application's clock, and the twelve months
 * ending at the application month is a server rule (PROJECT_RULES, Billing).
 *
 * THE TAB IS SCREEN STATE. It is not persisted, not in the URL and not read
 * back, exactly as the Reviews composer's stage is: there is no `/finance/…`
 * address for a tab, and no app pattern to reuse for one.
 *
 * READ-ONLY. `PATCH /api/finance/:billId` exists and is complete; nothing on
 * this screen calls it. The comp has Record and Manage buttons but no payment
 * form anywhere in it, so none is drawn — and none is drawn disabled either.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { Select } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CURRENT_MONTH } from "@/lib/constants";
import { fetchFinanceMonth, financeKeys } from "@/components/finance/api";
import { FinanceOverview } from "@/components/finance/finance-overview";
import { FinanceAnalytics } from "@/components/finance/finance-analytics";
import { FinancePayments } from "@/components/finance/finance-payments";

const TABS = ["Overview", "Revenue analytics", "Payments"] as const;
type Tab = (typeof TABS)[number];

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "10px 16px", border: "none", background: "transparent",
  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
  color: active ? "var(--fg)" : "var(--muted)",
  fontSize: 13.5, fontWeight: active ? 600 : 500,
  fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
  marginBottom: -1,
});

export default function FinancePage() {
  const { t, fmt } = useSettings();

  /* The application month, not a browser month. `CURRENT_MONTH` is the app clock
   * the rest of the server already uses; the payload's `months` replaces it as
   * the authority the moment the first response lands. */
  const [month, setMonth] = useState<string>(CURRENT_MONTH);
  const [tab, setTab] = useState<Tab>("Overview");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: financeKeys.month(month),
    queryFn: () => fetchFinanceMonth(month),
  });

  const months = data?.months ?? [CURRENT_MONTH];
  const monthLabel = fmt.monthLabel(month);

  return (
    <div data-screen-label="Finance" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading. On a phone this becomes two rows — the title, then the month
        * control across the full content width — which is a LAYOUT change and
        * nothing else: the same one Select, over the same server-supplied
        * `data.months`, with the same aria-label. See globals.css's Finance
        * block for the rules; the desktop arrangement above 620px is untouched. */}
      <div className="fin-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Finance")}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>
            {t("Revenue, analytics and student payments for")} {monthLabel}.
          </p>
        </div>

        <div className="fin-head-controls" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          {/* The visible label is the desktop row's; on a phone the control has
            * the width to speak for itself and the Select keeps the same
            * ariaLabel, so hiding it removes a duplicate rather than a name. */}
          <span className="fin-head-month-label" style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>{t("Month")}</span>
          <div className="fin-month" style={{ minWidth: 150 }}>
            <Select
              value={month}
              ariaLabel={t("Month")}
              onChange={setMonth}
              options={months.map((m) => ({ value: m, label: fmt.monthLabel(m) }))}
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => refetch()}
                aria-label={t("Refresh")}
                className="btn-ghost"
                style={{ minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isFetching ? { animation: "spin 1s linear infinite" } : undefined}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("Refresh")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tabs. `.tabstrip` is the app's existing horizontal-scroll strip — the
        * same one the Student profile uses — so three tabs stay reachable at
        * 375px without the page itself scrolling. */}
      <div
        className="tabstrip"
        role="tablist"
        aria-label={t("Finance")}
        style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 22, overflowX: "auto", overflowY: "hidden" }}
      >
        {TABS.map((tb) => (
          <button key={tb} role="tab" aria-selected={tab === tb} onClick={() => setTab(tb)} style={tabStyle(tab === tb)}>
            {t(tb)}
          </button>
        ))}
      </div>

      {isLoading && <FinanceSkeleton />}

      {!isLoading && isError && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load finance")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {tab === "Overview" && <FinanceOverview data={data} />}
          {tab === "Revenue analytics" && <FinanceAnalytics data={data} />}
          {tab === "Payments" && <FinancePayments data={data} />}
        </>
      )}
    </div>
  );
}

/** Loading state, shaped like the Overview tab it most often precedes. */
function FinanceSkeleton() {
  const box: React.CSSProperties = {
    background: "var(--card)", border: "1px solid var(--border)",
    borderRadius: "var(--r)", boxShadow: "var(--sh)",
  };
  return (
    <div aria-busy="true">
      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "var(--gap)", marginBottom: "var(--gap)" }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ ...box, height: 118 }} />)}
      </div>
      <div style={{ ...box, height: 220, marginBottom: "var(--gap)" }} />
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--gap)" }}>
        <div style={{ ...box, height: 260 }} />
        <div style={{ ...box, height: 260 }} />
      </div>
    </div>
  );
}
