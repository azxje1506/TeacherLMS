/* Shared Lessons presentation helpers.
 *
 * The design comp computes each lesson's status / type pills and calendar chip
 * styles at runtime (that logic isn't in the exported markup), so they're
 * reproduced here once in the comp's own pill language — mirroring how
 * class-ui.tsx does it for Classes — and consumed by the list, the calendar and
 * the drawer. Generic helpers (cardStyle, chipStyle, timeRangeLabel,
 * RecurringSchedule) are reused from class-ui rather than duplicated. */

import type { Lesson, LessonStatus, LessonType, Lang } from "@/lib/types";
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

/* ---- rescheduled ---- */

/** Has this lesson been moved off the slot it was generated into?
 *
 * Answered from the lesson's OWN stored origin (see Lesson.originalDate) — never
 * by comparing against the class's recurring schedule, which changes on its own
 * and would silently re-label historical lessons. `rescheduleLesson` clears the
 * origin when a lesson is moved back, so this needs no equality check of its own. */
export function isRescheduled(l: Pick<Lesson, "originalDate">): boolean {
  return Boolean(l.originalDate);
}

/** Weekday index (0=Sun..6=Sat) of an ISO date, or -1 when unparseable. */
export function isoWeekday(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? -1 : d.getDay();
}

/* ---- calendar "kind" — one dimension covering the legend and the Status filter.
 *
 * The calendar reads a lesson by what it IS at a glance, which is neither its
 * type nor its status alone: a cancelled lesson is cancelled whatever its type,
 * and a moved regular lesson is what the teacher is actually looking for. So the
 * two are folded into one ordered classification, used by the legend, the filter
 * and the event badges alike so the three can never disagree. */

export type LessonKind = "regular" | "rescheduled" | "makeup" | "extra" | "cancelled";

/** Kind precedence: cancelled wins over everything (it is the exception that
 * changes what the row means), then the ad-hoc types, then a move, then plain. */
export function lessonKind(l: Pick<Lesson, "type" | "status" | "originalDate">): LessonKind {
  if (l.status === "Cancelled") return "cancelled";
  if (l.type === "extra") return "extra";
  if (l.type === "makeup") return "makeup";
  return isRescheduled(l) ? "rescheduled" : "regular";
}

/** Legend/filter order — the order the sprint spec lists them in. */
export const LESSON_KINDS: LessonKind[] = ["regular", "rescheduled", "extra", "makeup", "cancelled"];

const KIND_META: Record<LessonKind, { label: string; color: string; soft: string }> = {
  regular: { label: "Regular", color: "var(--muted)", soft: "var(--card-2)" },
  rescheduled: { label: "Rescheduled", color: "var(--sky)", soft: "var(--sky-soft)" },
  extra: { label: "Extra", color: "#7c3aed", soft: "color-mix(in srgb, #7c3aed 13%, var(--card))" },
  makeup: { label: "Makeup", color: "var(--amber)", soft: "var(--amber-soft)" },
  cancelled: { label: "Cancelled", color: "var(--accent)", soft: "var(--accent-soft)" },
};

export function lessonKindLabel(kind: LessonKind): string {
  return KIND_META[kind].label;
}
export function lessonKindColor(kind: LessonKind): string {
  return KIND_META[kind].color;
}

/** The legend / badge glyph for a kind — ● ↺ ＋ ★ ✕, drawn as strokes in the
 * same icon language the rest of the app uses rather than as literal characters,
 * so they inherit weight and colour like every other icon here. */
export function KindGlyph({ kind, size = 11 }: { kind: LessonKind; size?: number }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 2.4,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    style: { flex: "none" as const },
  };
  switch (kind) {
    case "rescheduled": // ↺ — the restore arrow already used for "put this back"
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
    case "extra": // ＋
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "makeup": // ★
      return <svg {...common} strokeWidth={2}><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z" /></svg>;
    case "cancelled": // ✕
      return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case "regular": // ●
    default:
      return <svg {...common} fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5" /></svg>;
  }
}

/** The calendar's compact legend — one muted row naming each glyph. */
export function CalendarLegend({ lang }: { lang: Lang }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 16px", marginBottom: 12 }}>
      {LESSON_KINDS.map((k) => (
        <span
          key={k}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 500, color: "var(--muted)" }}
        >
          <span style={{ display: "flex", color: lessonKindColor(k) }}><KindGlyph kind={k} /></span>
          {translate(lessonKindLabel(k), lang)}
        </span>
      ))}
    </div>
  );
}

/* ---- lesson history (drawer timeline) ---- */

/** One step of the drawer's timeline. `done` marks a step that is neither a type
 * nor an exception — the plain end of an ordinary lesson. The last step is
 * always where the lesson stands now.
 *
 * `date` / `time` are present only when the step HAS a real instant behind it,
 * so nothing is dated by guesswork: a recurring schedule is a weekly pattern
 * rather than a moment, and a day a lesson is taught on is a date without a
 * meaningful clock time. */
export interface LessonStep {
  key: string;
  label: string;
  kind: LessonKind | "done";
  /** ISO "YYYY-MM-DD" — omitted when the step is not tied to a single day. */
  date?: string;
  /** 24h "HH:MM" — only for a step that records a recorded moment. */
  time?: string;
}

type HistoryLesson = Pick<Lesson, "type" | "status" | "date" | "originalDate" | "rescheduledAt">;

/** Local calendar date + wall-clock time of a stored ISO 8601 instant.
 *
 * `rescheduledAt` is written in UTC, so it cannot be string-sliced — that would
 * show a teacher in Vietnam the UTC day, which is the previous one for anything
 * logged before 07:00 local. */
export function splitStamp(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

/** The lesson's life so far, as an ordered list: what it started as, whether it
 * moved and when, and where it stands. Presentation only — every value read here
 * is one the Lesson already stores. */
export function lessonHistory(l: HistoryLesson): LessonStep[] {
  const steps: LessonStep[] = [
    // The opening step names what the lesson IS. None of the three has a
    // recorded moment: a recurring schedule is a pattern, and the Lesson stores
    // no creation time for an ad-hoc session.
    l.type === "extra"
      ? { key: "origin", label: "Extra lesson", kind: "extra" }
      : l.type === "makeup"
        ? { key: "origin", label: "Makeup lesson", kind: "makeup" }
        : { key: "origin", label: "Recurring schedule", kind: "regular" },
  ];

  if (isRescheduled(l)) {
    // Dated by when the move was MADE, which is the only step here that is an
    // action. A lesson moved before rescheduledAt existed has no stamp; the step
    // still shows, undated, rather than borrowing a date that would be a guess.
    const at = l.rescheduledAt ? splitStamp(l.rescheduledAt) : null;
    steps.push({ key: "moved", label: "Rescheduled", kind: "rescheduled", ...(at ?? {}) });
  }

  // The closing step is dated by the day the lesson is taught — a date, with no
  // clock time, because nothing records the moment it was marked complete.
  steps.push(
    l.status === "Cancelled"
      ? { key: "end", label: "Cancelled", kind: "cancelled", date: l.date }
      : { key: "end", label: l.status, kind: "done", date: l.date }
  );
  return steps;
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

/** Week-column event card — a fuller button tinted by the class colour. The
 * padding gives the card's three stacked lines (name / time / classroom) a
 * little more room than the two-line version it replaced. */
export function calWeekEventStyle(classColor: string): React.CSSProperties {
  return {
    display: "block", width: "100%", textAlign: "left",
    border: "1px solid var(--border)", borderLeft: `3px solid ${classColor}`,
    borderRadius: 9, padding: "9px 11px", background: "var(--card)",
    cursor: "pointer", fontFamily: "inherit",
  };
}
