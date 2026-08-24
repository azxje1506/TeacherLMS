/* Shared Reviews presentation helpers.
 *
 * PRESENTATION ONLY. The average, the ranking, the eligibility rule and the
 * month window live in src/lib/reviews.ts and are not restated, re-derived or
 * re-thresholded here. What this file owns is how a value LOOKS: the card
 * surface, the rating segment, and the one guarded place where a score becomes
 * a number, a colour and a word.
 */

import { perfColor, perfLabel } from "@/lib/reviews";

/** A card's score block, or `null` when the student has no review yet.
 *
 * THIS IS THE ONLY PLACE `perfLabel` AND `perfColor` ARE CALLED in the Reviews
 * UI, and the guard is the reason. Both take a number; a student with no review
 * has no average at all, and `null` coerces to 0 — which would silently render
 * "0.0", "Needs support" and the accent colour for somebody nobody has assessed
 * yet. That is not a low score, it is the absence of one, so this function
 * returns `null` and the card renders its own "no review yet" state instead.
 *
 * The thresholds behind the label and the colour stay in src/lib/calc.ts, stated
 * once, exactly as Gate 4.1 left them. */
export interface ReviewScore {
  /** The average at one decimal, e.g. "4.2". */
  value: string;
  /** The existing performance colour band for that average. */
  color: string;
  /** The existing performance label for that average. */
  label: string;
}

export function reviewScore(latestAverage: number | null | undefined): ReviewScore | null {
  if (typeof latestAverage !== "number" || !Number.isFinite(latestAverage)) return null;
  return {
    value: latestAverage.toFixed(1),
    color: perfColor(latestAverage),
    label: perfLabel(latestAverage),
  };
}

/** The dictionary key for a review count's noun. Both entries — " review" and
 * " reviews", leading space included — are the design's own, and have been in
 * the dictionary since S1. */
export function reviewCountKey(count: number): string {
  return count === 1 ? " review" : " reviews";
}

/** The card surface — the comp's Reviews card: --card over --border, the shared
 * radius and shadow, 18px padding, a 14px column.
 *
 * `minWidth: 0` because this is a GRID ITEM, and a grid item defaults to
 * `min-width: auto` — it refuses to shrink below its own content. Without it a
 * long student name would push the card wider than its track and give the page
 * horizontal overflow on a narrow screen. The same line, for the same reason, is
 * in homeworkCardStyle. */
export function reviewCardStyle(): React.CSSProperties {
  return {
    minWidth: 0,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r)",
    boxShadow: "var(--sh)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };
}

/** The card's inner summary strip — the comp's --card-2 panel under the header. */
export function reviewSummaryStyle(): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 11,
    padding: "9px 12px", minWidth: 0,
  };
}

/** One of the five segments of a skill's rating control.
 *
 * The selected segment reuses the app's EXISTING performance colour semantics —
 * `perfColor` on the same 1–5 scale it already grades an average on — rather
 * than a rating palette invented for this control. No new token, no new
 * threshold, no literal hex.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. The selected segment also takes a heavier
 * weight, a coloured border and a tinted surface, and the control publishes
 * `aria-checked`, so the state survives a colourblind reader, a high-contrast
 * theme and a screen reader alike. */
export function ratingSegmentStyle(rating: number, active: boolean): React.CSSProperties {
  const color = perfColor(rating);
  return {
    flex: 1, minWidth: 0, height: 34, padding: "0 4px", borderRadius: 8,
    fontSize: 12.5, fontWeight: active ? 700 : 500, fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    border: `1px solid ${active ? color : "var(--border)"}`,
    background: active ? "var(--card-2)" : "var(--card)",
    color: active ? color : "var(--muted)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  };
}

/** The compact "no linked parent" pill.
 *
 * Amber, which is this app's existing token for "this needs the teacher" — the
 * same band the attendance indicator uses for a register nobody has taken. It is
 * information, not a failure: a student may legitimately have no parent on file
 * (PROJECT_RULES, Student & Parents), and reviews are one of the features
 * required to say so clearly. */
export function noParentPillStyle(): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
    background: "var(--amber-soft)", color: "var(--amber)",
    whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
  };
}
