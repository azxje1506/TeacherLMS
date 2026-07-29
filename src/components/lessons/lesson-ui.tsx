/* Shared Lessons presentation helpers.
 *
 * The design comp computes each lesson's status / type pills and calendar chip
 * styles at runtime (that logic isn't in the exported markup), so they're
 * reproduced here once in the comp's own pill language — mirroring how
 * class-ui.tsx does it for Classes — and consumed by the list, the calendar and
 * the drawer. Generic helpers (cardStyle, chipStyle, scheduleLabel, durationLabel)
 * are reused from class-ui rather than duplicated. */

import type { LessonStatus, LessonType, Lang } from "@/lib/types";
import { translate, dow as dowNames, months as monthNames } from "@/lib/i18n";

/* ---- status pill (Upcoming / Completed / Cancelled) ---- */

const STATUS_COLORS: Record<LessonStatus, { soft: string; color: string }> = {
  Upcoming: { soft: "var(--sky-soft)", color: "var(--sky)" },
  Completed: { soft: "var(--green-soft)", color: "var(--green)" },
  Cancelled: { soft: "var(--accent-soft)", color: "var(--accent)" },
};

export function lessonStatusBadgeStyle(status: LessonStatus): React.CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.Upcoming;
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
    background: c.soft, color: c.color, whiteSpace: "nowrap",
  };
}

/* ---- lesson-type pill (Regular / Makeup / Extra) ---- */

const TYPE_META: Record<LessonType, { soft: string; color: string; label: string }> = {
  regular: { soft: "var(--card-2)", color: "var(--muted)", label: "Regular" },
  makeup: { soft: "var(--amber-soft)", color: "var(--amber)", label: "Makeup" },
  extra: { soft: "color-mix(in srgb, #7c3aed 13%, var(--card))", color: "#7c3aed", label: "Extra" },
};

export function lessonTypeLabel(type: LessonType): string {
  return TYPE_META[type]?.label ?? "Regular";
}

export function lessonTypeBadgeStyle(type: LessonType): React.CSSProperties {
  const m = TYPE_META[type] ?? TYPE_META.regular;
  return {
    display: "inline-flex", alignItems: "center",
    fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
    background: m.soft, color: m.color, whiteSpace: "nowrap",
    // Design renders the lesson-type badge uppercase (REGULAR / MAKEUP / EXTRA);
    // transform in CSS so the underlying label stays title-case for other uses.
    textTransform: "uppercase", letterSpacing: ".04em",
  };
}

/* ---- date cell (the small stacked day/number/month block on a lesson row) ---- */

export interface DateCell { dayLabel: string; dateNum: number; monLabel: string }

/** Localized day-of-week (short), day number and month (short) for an ISO date. */
export function dateCell(iso: string, lang: Lang): DateCell {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return { dayLabel: "", dateNum: 0, monLabel: "" };
  return {
    dayLabel: dowNames(lang, "short")[d.getDay()] ?? "",
    dateNum: d.getDate(),
    monLabel: monthNames(lang, "short")[d.getMonth()] ?? "",
  };
}

/** Human duration, e.g. 60 -> "60 min" (localized unit). */
export function lessonDurationLabel(minutes: number, lang: Lang): string {
  return `${minutes} ${translate("min", lang)}`;
}

/* ---- calendar chips ---- */

/** Month-grid event chip — a compact button tinted by the class colour. */
export function calMonthChipStyle(classColor: string): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 3, width: "100%", textAlign: "left",
    border: "none", borderLeft: `3px solid ${classColor}`, borderRadius: 5,
    padding: "2px 5px", marginTop: 3, background: "var(--card-2)", color: "var(--fg)",
    fontSize: 10.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };
}

/** Week-column event card — a fuller button tinted by the class colour. */
export function calWeekEventStyle(classColor: string): React.CSSProperties {
  return {
    display: "block", width: "100%", textAlign: "left",
    border: "1px solid var(--border)", borderLeft: `3px solid ${classColor}`,
    borderRadius: 9, padding: "8px 10px", background: "var(--card)",
    cursor: "pointer", fontFamily: "inherit",
  };
}
