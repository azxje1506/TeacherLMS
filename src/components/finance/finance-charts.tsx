"use client";

/* Finance — the analytics tab's two charts, ported from the design comp.
 *
 * FINANCE-SPECIFIC BY DESIGN. `components/reviews/charts.tsx` has a ScoreTrend
 * and a ScoreDonut, and neither is reused here: they are shaped around a 1-5
 * rating scale and a five-bucket distribution, and generalising them would mean
 * refactoring working Reviews components, which PROJECT_RULES forbids without
 * permission. The comp also draws these two differently from the Reviews pair —
 * a filled area under the trend line, and a donut whose centre carries a total
 * rather than an average. Porting the comp's own markup is the faithful route.
 *
 * GEOMETRY ONLY. Both components receive values and turn them into coordinates.
 * Neither computes a Finance figure, and neither knows what a bill is: the
 * numbers arrive from `revenue`, already derived by src/lib/finance.ts.
 *
 * RESPONSIVE BY CONSTRUCTION. Both SVGs scale to their container — the trend
 * through a 0-100 `viewBox` with `preserveAspectRatio="none"`, the donut through
 * `width:100%` on a fixed-ratio box — so neither can set a width the phone has
 * to meet.
 */

import { useState } from "react";
import { donutArcs, trendGeometry } from "./finance-ui";

export interface TrendChartProps {
  trend: readonly { month: string; total: number }[];
  /** "2026-07" -> "Jul", from the caller's Settings-bound formatter. */
  monthShort: (month: string) => string;
  /** Format one amount for the hover readout. */
  formatAmount: (amount: number) => string;
}

/** Monthly revenue trend — six months ending at the selected one. */
export function RevenueTrend({ trend, monthShort, formatAmount }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { points, line, area } = trendGeometry(trend);

  return (
    <div>
      <div style={{ position: "relative", height: 200 }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <linearGradient id="fin-revgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <polygon points={area} fill="url(#fin-revgrad)" />}
          {line && (
            <polyline
              points={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>

        {points.map((p, i) => (
          <div
            key={p.month}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{
              position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
              transform: "translate(-50%,-50%)", width: 26, height: 26,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: "var(--accent)",
              border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--accent)",
            }} />
            {hover === i && (
              <div
                role="status"
                style={{
                  position: "absolute", bottom: "100%", marginBottom: 6, whiteSpace: "nowrap",
                  background: "var(--fg)", color: "var(--bg)", borderRadius: 6,
                  padding: "4px 8px", fontSize: 11.5, fontWeight: 500, zIndex: 2,
                }}
              >
                {monthShort(p.month)} · {formatAmount(p.total)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* The month axis. Labelled for screen readers as a list of the same
        * figures the dots carry, so the series is not sight-only. */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        {points.map((p) => (
          <div key={p.month} style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{monthShort(p.month)}</div>
            <div style={{ fontSize: 10, color: "var(--muted-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {formatAmount(p.total)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface DistributionProps {
  slices: readonly { key: string; label: string; color: string; value: number }[];
  totalLabel: string;
  formatAmount: (amount: number) => string;
  emptyLabel: string;
}

/** Revenue distribution — share by class. */
export function RevenueDonut({ slices, totalLabel, formatAmount, emptyLabel }: DistributionProps) {
  const { arcs, total } = donutArcs(slices);

  return (
    <div className="fin-donut" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ position: "relative", minWidth: 132, width: 132, height: 132, flex: "none" }}>
        <svg viewBox="0 0 120 120" aria-hidden="true" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          <circle cx="60" cy="60" r="42" fill="none" stroke="var(--card-2)" strokeWidth="16" />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="60" cy="60" r="42" fill="none"
              stroke={a.color} strokeWidth="16"
              strokeDasharray={a.dash} strokeDashoffset={a.offset}
            />
          ))}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 10px",
        }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{totalLabel}</span>
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Geist Mono',monospace", lineHeight: 1.3, wordBreak: "break-all" }}>
            {formatAmount(total)}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, maxHeight: 150, overflowY: "auto" }}>
        {arcs.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{emptyLabel}</div>
        )}
        {arcs.map((a) => (
          <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: a.color, flex: "none" }} />
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {a.label}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "'Geist Mono',monospace", flex: "none" }}>
              {Math.round(a.share * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
