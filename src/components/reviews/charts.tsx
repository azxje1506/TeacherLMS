"use client";

/* The Reviews analytics charts — the comp's own SVG, driven by real data.
 *
 * NO CHART LIBRARY, AND NO NEW DEPENDENCY. The design comp draws every one of
 * these by hand in inline SVG — a polygon radar, a `<path>` line, a
 * stroke-dasharray donut and a CSS grid heatmap — so porting it means writing
 * the same elements with the same attributes, not adopting a library whose
 * output would have to be wrestled back into the design. The repository has no
 * charting dependency and this gate adds none.
 *
 * PRESENTATION ONLY. Every number these components draw was computed in
 * src/lib/review-analytics.ts or src/lib/finance.ts and arrives as a prop. There
 * is no average, no ranking, no bucketing and no percentage in this file — a
 * formula inside a component is a formula no test can reach, which is the whole
 * reason the analytics module exists.
 *
 * COLOUR COMES FROM `perfColor`, the app's existing performance band, applied to
 * the same 1-5 scale the rating control in the drawer already applies it to. No
 * new palette, no new threshold, no literal hex.
 *
 * SCALABLE BY CONSTRUCTION. Every SVG is `width:100%` over a `viewBox`, so a
 * chart resizes with its card rather than defining its card's width. Nothing
 * here can give the page horizontal overflow; the heatmap, which genuinely can
 * outgrow a phone, scrolls inside its own container.
 */

import { perfColor, perfLabel } from "@/lib/reviews";
import { useSettings } from "@/lib/settings-context";
import type { DistributionBucket, RadarAxis, ReviewHeatmap, TrendPoint } from "@/lib/review-analytics";

/* ------------------------------------------------------------------- radar */

/* The comp's geometry: a 280x280 viewBox, centred, with the outermost ring at
 * rating 5. The plot radius stops short of the box so the ten labels have room
 * outside it without the SVG needing to clip. */
const R_CENTER = 140;
const R_MAX = 100;
const R_LABEL = 126;
const AXES = 10;

function axisPoint(index: number, radius: number): { x: number; y: number } {
  // First axis at twelve o'clock, then clockwise every 36 degrees.
  const angle = (-90 + (360 / AXES) * index) * (Math.PI / 180);
  return { x: R_CENTER + radius * Math.cos(angle), y: R_CENTER + radius * Math.sin(angle) };
}

/** A rating's distance from the centre. An absent rating sits at the centre so
 * the polygon still closes; the dot for it is not drawn. */
function ratingRadius(rating: number | null): number {
  return rating == null ? 0 : (R_MAX * rating) / 5;
}

function polygonPoints(axes: readonly RadarAxis[]): string {
  return axes
    .map((a, i) => {
      const p = axisPoint(i, ratingRadius(a.rating));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");
}

export interface SkillRadarProps {
  /** Ten axes, canonical order, from `radarAxes`. */
  current: RadarAxis[];
  /** The previous review's ten axes, or null. Only drawn when `compare` is on. */
  previous: RadarAxis[] | null;
  compare: boolean;
}

/** The ten skills as a radar, with an optional previous-review overlay.
 *
 * The current series takes `--green` and the comparison `--sky`, dashed — the
 * comp's own two colours, and the dash means the two series are still
 * distinguishable without colour. */
export function SkillRadar({ current, previous, compare }: SkillRadarProps) {
  const { t } = useSettings();
  const rings = [1, 2, 3, 4, 5];
  const showPrevious = compare && previous !== null;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 224, margin: "10px auto 0", aspectRatio: "1" }}>
      <svg
        viewBox="0 0 280 280"
        role="img"
        aria-label={t("Skill radar")}
        style={{ width: "100%", height: "100%", overflow: "visible", display: "block" }}
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={Array.from({ length: AXES }, (_, i) => {
              const p = axisPoint(i, (R_MAX * ring) / 5);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(" ")}
            fill="none"
            stroke="var(--border-2)"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: AXES }, (_, i) => {
          const p = axisPoint(i, R_MAX);
          return (
            <line key={i} x1={R_CENTER} y1={R_CENTER} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="var(--border)" strokeWidth="1" />
          );
        })}

        {showPrevious && (
          <polygon
            points={polygonPoints(previous)}
            fill="color-mix(in srgb, var(--sky) 12%, transparent)"
            stroke="var(--sky)"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
        )}

        <polygon
          points={polygonPoints(current)}
          fill="color-mix(in srgb, var(--green) 20%, transparent)"
          stroke="var(--green)"
          strokeWidth="2.2"
        />

        {current.map((a, i) => {
          if (a.rating == null) return null;
          const p = axisPoint(i, ratingRadius(a.rating));
          return <circle key={a.key} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="3" fill="var(--green)" />;
        })}
      </svg>

      {/* The axis labels sit outside the SVG so they scale with the page's font
        * rather than with the viewBox, exactly as the comp positions them. */}
      {current.map((a, i) => {
        const p = axisPoint(i, R_LABEL);
        const tx = p.x > R_CENTER + 4 ? "0%" : p.x < R_CENTER - 4 ? "-100%" : "-50%";
        return (
          <div
            key={a.key}
            style={{
              position: "absolute",
              left: `${((p.x / 280) * 100).toFixed(2)}%`,
              top: `${((p.y / 280) * 100).toFixed(2)}%`,
              transform: `translate(${tx},-50%)`,
              fontSize: 9, fontWeight: 600, color: "var(--muted)",
              whiteSpace: "nowrap", pointerEvents: "none",
            }}
          >
            {t(a.key.charAt(0).toUpperCase() + a.key.slice(1))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- trend */

const T_W = 520, T_H = 170, T_LEFT = 14, T_RIGHT = 506, T_TOP = 15, T_BOTTOM = 155;

export interface ScoreTrendProps {
  /** Chronological points from `reviewTrend`, already windowed. */
  points: TrendPoint[];
}

/** The overall-score trend: one point per review, and nothing between them.
 *
 * A SINGLE POINT DRAWS A DOT AND NO LINE. A line needs two months to join, and
 * inventing a second would be drawing a score nobody awarded — the same reason
 * the domain refuses to interpolate a missing month. */
export function ScoreTrend({ points }: ScoreTrendProps) {
  const { t, fmt } = useSettings();

  if (points.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12.5, padding: "24px 0" }}>
        {t("No data")}
      </div>
    );
  }

  /* One point is centred; two or more spread across the plot. The y scale is
   * the rating scale itself, 1 at the floor and 5 at the ceiling, so a chart of
   * a strong month is not visually identical to a chart of a weak one. */
  const x = (i: number) =>
    points.length === 1 ? (T_LEFT + T_RIGHT) / 2 : T_LEFT + ((T_RIGHT - T_LEFT) * i) / (points.length - 1);
  const y = (avg: number) => T_BOTTOM - ((T_BOTTOM - T_TOP) * (Math.min(5, Math.max(1, avg)) - 1)) / 4;

  const coords = points.map((p, i) => ({ ...p, cx: x(i), cy: y(p.average) }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.cx.toFixed(1)} ${c.cy.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].cx.toFixed(1)} ${T_BOTTOM} L${coords[0].cx.toFixed(1)} ${T_BOTTOM} Z`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
      <svg
        viewBox={`0 0 ${T_W} ${T_H}`}
        role="img"
        aria-label={t("Overall score trend")}
        style={{ width: "100%", height: "auto", overflow: "visible", display: "block" }}
      >
        {[1, 2, 3, 4, 5].map((band) => (
          <line key={band} x1={T_LEFT} y1={y(band)} x2={T_RIGHT} y2={y(band)} stroke="var(--border-2)" strokeWidth="1" />
        ))}
        {coords.length > 1 && (
          <>
            <path d={area} fill="color-mix(in srgb, var(--green) 12%, transparent)" stroke="none" />
            <path d={line} fill="none" stroke="var(--green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {coords.map((c) => (
          <circle key={c.month} cx={c.cx.toFixed(1)} cy={c.cy.toFixed(1)} r="4" fill="var(--card)" stroke="var(--green)" strokeWidth="2">
            <title>{`${fmt.monthLabel(c.month)} · ${c.average.toFixed(1)}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ position: "relative", height: 16, marginTop: 6 }}>
        {coords.map((c) => (
          <span
            key={c.month}
            style={{
              position: "absolute",
              left: `${((c.cx / T_W) * 100).toFixed(2)}%`,
              transform: "translateX(-50%)",
              fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap",
            }}
          >
            {fmt.monthShort(c.month)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- distribution */

const D_R = 52, D_C = 2 * Math.PI * D_R;

export interface ScoreDonutProps {
  /** The five buckets from `reviewDistribution`, ascending. */
  buckets: DistributionBucket[];
  /** The review's average, already formatted to one decimal by `reviewScore`. */
  averageLabel: string;
}

/** The latest review's ten ratings, across the five rating buckets.
 *
 * THIS IS A DISTRIBUTION ACROSS SKILLS, NOT ACROSS STUDENTS — the comp's own
 * subtitle says "Across 10 skills this month". Each arc takes `perfColor` of the
 * rating it represents, which is the same colour the drawer's rating control
 * gives that number.
 *
 * ZERO-COUNT BUCKETS DRAW NO ARC AND NO LEGEND ROW. The data keeps all five (see
 * `reviewDistribution`); the chart omits the empty ones because a legend of five
 * rows where two say "0 · 0%" is harder to scan, not easier. */
export function ScoreDonut({ buckets, averageLabel }: ScoreDonutProps) {
  const { t } = useSettings();
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  /* Each arc starts where the previous one ended. Built by folding rather than
   * by advancing a mutable cursor, so nothing is reassigned after render. */
  const arcs = buckets
    .filter((b) => b.count > 0)
    .reduce<Array<{ rating: number; length: number; offset: number }>>((acc, b) => {
      const previous = acc[acc.length - 1];
      const offset = previous ? previous.offset + previous.length : 0;
      const length = total === 0 ? 0 : (D_C * b.count) / total;
      return [...acc, { rating: b.rating, length, offset }];
    }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", minWidth: 0 }}>
      <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
        <svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label={t("Score distribution")}>
          <circle cx="65" cy="65" r={D_R} fill="none" stroke="var(--card-2)" strokeWidth="16" />
          {arcs.map((a) => (
            <circle
              key={a.rating}
              cx="65" cy="65" r={D_R}
              fill="none"
              stroke={perfColor(a.rating)}
              strokeWidth="16"
              strokeDasharray={`${a.length.toFixed(2)} ${(D_C - a.length).toFixed(2)}`}
              strokeDashoffset={(-a.offset).toFixed(2)}
              transform="rotate(-90 65 65)"
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", fontFamily: "'Geist Mono',monospace" }}>
            {averageLabel}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted-2)" }}>{t("avg / 5")}</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 6 }}>
        {buckets.filter((b) => b.count > 0).map((b) => (
          <div key={b.rating} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ minWidth: 10, width: 10, height: 10, borderRadius: 3, background: perfColor(b.rating), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--fg-2)" }}>
              {b.rating} · {t(perfLabel(b.rating))}
            </span>
            <span style={{ flex: "none", fontSize: 11.5, color: "var(--muted)", fontFamily: "'Geist Mono',monospace" }}>
              {b.count} · {b.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- heatmap */

export interface SkillHeatmapProps {
  data: ReviewHeatmap;
}

/** Rating by month, ten rows deep.
 *
 * THE ONLY COLUMNS ARE MONTHS THAT HAVE A REVIEW. A month nobody assessed is
 * absent from the grid — not a blank column and not a column of zeroes — which
 * is `buildReviewHeatmap`'s rule, drawn faithfully.
 *
 * IT SCROLLS INSIDE ITSELF. Twelve months of ten skills cannot fit a 375px
 * phone at a legible size, so the grid gets `overflow-x: auto` and a
 * `min-width: min-content`: the card keeps the column's width and the grid
 * scrolls within it. The page never widens. */
export function SkillHeatmap({ data }: SkillHeatmapProps) {
  const { t, fmt } = useSettings();
  if (data.months.length === 0) return null;

  return (
    <div style={{ overflowX: "auto", minWidth: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `auto repeat(${data.months.length}, minmax(34px, 1fr))`,
          gap: 4,
          minWidth: "min-content",
        }}
      >
        <div />
        {data.months.map((m) => (
          <div key={m} style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", fontWeight: 600, paddingBottom: 2, whiteSpace: "nowrap" }}>
            {fmt.monthShort(m)}
          </div>
        ))}
        {data.rows.map((row) => (
          <HeatRow key={row.key} label={t(row.key.charAt(0).toUpperCase() + row.key.slice(1))} cells={row.cells} months={data.months} />
        ))}
      </div>
    </div>
  );
}

function HeatRow({ label, cells, months }: { label: string; cells: (number | null)[]; months: string[] }) {
  return (
    <>
      <div style={{ fontSize: 11.5, color: "var(--fg-2)", display: "flex", alignItems: "center", whiteSpace: "nowrap", paddingRight: 6 }}>
        {label}
      </div>
      {cells.map((value, i) => (
        <div
          key={months[i]}
          style={{
            height: 26, borderRadius: 6,
            /* The comp's own Low->High ramp: 18% green at rating 1, full green
             * at rating 5, mixed into the card so it works in both themes. */
            background: value == null
              ? "var(--card-2)"
              : `color-mix(in srgb, var(--green) ${(18 + ((value - 1) / 4) * 82).toFixed(0)}%, var(--card))`,
            /* On the darkest cells the card's own background is the contrasting
             * colour in BOTH themes — white on green in light, near-black on
             * bright green in dark — so no literal is needed. */
            color: value != null && value >= 4 ? "var(--card)" : "var(--fg-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 600, fontFamily: "'Geist Mono',monospace",
          }}
        >
          {value ?? ""}
        </div>
      ))}
    </>
  );
}

