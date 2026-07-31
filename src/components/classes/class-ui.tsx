/* Shared Classes presentation helpers.
 *
 * The design comp computes each class card's badge / type / schedule labels at
 * runtime, so they are reproduced here once — in the comp's own pill language —
 * and consumed by both the list and the detail. Kept in one place so the two
 * screens can never drift.
 */

import type { ClassType, Klass, ScheduleConflict, ScheduleSlot } from "@/lib/types";
import type { Formatter } from "@/lib/format";
import type { Lang } from "@/lib/types";
import { translate } from "@/lib/i18n";
import { DOW_SHORT, DOW_FULL } from "@/lib/constants";

type ClassStatus = Klass["status"];

/** Soft/solid colour pair per status, drawn from the design's semantic tokens. */
const STATUS_COLORS: Record<ClassStatus, { soft: string; color: string }> = {
  Active: { soft: "var(--green-soft)", color: "var(--green)" },
  Archived: { soft: "var(--card-2)", color: "var(--muted)" },
};

export function classBadgeStyle(status: ClassStatus): React.CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.Archived;
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
    background: c.soft, color: c.color, whiteSpace: "nowrap",
  };
}

/** Toolbar filter chip — the comp's 32px pill, accent-tinted when active. */
export function chipStyle(active: boolean): React.CSSProperties {
  return {
    height: 32, padding: "0 12px", borderRadius: 99, cursor: "pointer",
    fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
    border: `1px solid ${active ? "var(--accent-soft)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--card)",
    color: active ? "var(--accent)" : "var(--muted)",
    display: "flex", alignItems: "center", whiteSpace: "nowrap",
  };
}

export const cardStyle: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
};

/** Short type label used in card subtitles, e.g. "Group" · "One-on-One". */
export function typeLabel(type: ClassType): string {
  return type === "one-on-one" ? "One-on-One" : "Group";
}

/** Type options for the drawer's Type select (labels carry vi translations). */
export const TYPE_OPTIONS: { value: ClassType; label: string }[] = [
  { value: "group", label: "Group class" },
  { value: "one-on-one", label: "One-on-one class" },
];

/** Weekday options for a schedule slot's day select (0=Sun .. 6=Sat). */
export const DAY_OPTIONS = DOW_FULL.map((label, value) => ({ value: String(value), label }));

/* Stored weekdays are 0=Sun..6=Sat, but a timetable reads Monday first, so the
 * schedule editor lists and orders days by WEEK_ORDER. Presentation only —
 * ScheduleSlot.day is untouched.
 *
 * TODO(week-order): the Calendar month/week grid still starts on Sunday
 * (src/app/(app)/calendar/page.tsx `startOfWeek`), so the two surfaces read the
 * week differently. Unify the whole app on one weekday order in a dedicated
 * sprint — it touches the calendar grid, its headers and any day pickers, and is
 * deliberately out of scope here. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Position of a stored weekday within WEEK_ORDER (Monday = 0 … Sunday = 6). */
export function weekIndex(day: number): number {
  const at = WEEK_ORDER.indexOf(day);
  return at === -1 ? WEEK_ORDER.length : at;
}

/** Canonical schedule order: Monday-first weekday, then chronological. The
 * editor keeps its field array in this order so a row's position always matches
 * its index — no display-only sorting. */
export function compareSlots(
  a: { day: number; start: string },
  b: { day: number; start: string }
): number {
  return weekIndex(a.day) - weekIndex(b.day) || a.start.localeCompare(b.start);
}

/** Duration options for a schedule slot, in minutes. */
export const DURATION_OPTIONS = [30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }));

/** Localized short weekday, e.g. day 1 -> "Mon" / "T2". */
export function dowShort(day: number, lang: Lang): string {
  return translate(DOW_SHORT[day] ?? "", lang);
}

/** Localized full weekday, e.g. day 1 -> "Monday" / "Thứ Hai". */
export function dowFull(day: number, lang: Lang): string {
  return translate(DOW_FULL[day] ?? "", lang);
}

/** The class card's schedule summary — the weekdays a class runs, and nothing
 * more: "Mon • Wed • Fri", or "No schedule".
 *
 * A card is a summary, and times are what made it grow: one line per slot (or
 * even a weekday-grouped block) pushed the card taller the more a class taught,
 * so a grid of cards never settled at one height. The weekday set answers the
 * question a card is actually for — "when does this run?" — in a single line
 * that cannot wrap. The full recurring schedule, with every slot as a From – To
 * range, belongs to the screens that present the schedule itself: Class Detail
 * and the Lesson drawer (<RecurringSchedule />) and the Edit Class drawer.
 *
 * Weekdays read Monday-first, matching the schedule editor's own order. A
 * weekday teaching twice is named once — that is the point of a summary. */
export function scheduleDaysLabel(schedule: ScheduleSlot[] | undefined, lang: Lang): string {
  const days = new Set((schedule ?? []).map((s) => s.day));
  if (days.size === 0) return translate("No schedule", lang);
  return WEEK_ORDER.filter((d) => days.has(d)).map((d) => dowShort(d, lang)).join(" • ");
}

/** The save-time schedule clash, in the teacher's language: "Schedule conflicts
 * with Grammar Stars · B1 (Monday 06:00 PM–07:00 PM)". Composed from dictionary
 * fragments plus the shared formatter, so nothing English reaches the UI — the
 * class name and level are user content and stay verbatim. */
export function conflictMessage(
  conflict: ScheduleConflict,
  lang: Lang,
  fmt: Formatter
): string {
  const who = `${conflict.name}${conflict.level ? ` · ${conflict.level}` : ""}`;
  const when = `${dowFull(conflict.day, lang)} ${timeRangeLabel(conflict.start, conflict.end, fmt)}`;
  return `${translate("Schedule conflicts with", lang)} ${who} (${when})`;
}

/** A stored slot's time as a range, e.g. "06:00 PM – 07:30 PM". */
export function slotRangeLabel(slot: ScheduleSlot, fmt: Formatter): string {
  return timeRangeLabel(slot.start, fmt.addMinutes(slot.start, slot.duration), fmt);
}

/** The recurring weekly schedule as a list of weekday rows — the Class Detail
 * card's presentation, extracted so the Lesson drawer (Lessons list and
 * Calendar alike) renders it identically instead of keeping a second layout.
 *
 * One row per weekday: the day is named once and all of its slots stack on the
 * right, so a weekday teaching twice stays grouped under a single heading. */
export function RecurringSchedule({
  schedule, fmt, lang,
}: {
  schedule: ScheduleSlot[] | undefined;
  fmt: Formatter;
  lang: Lang;
}) {
  const slots = (schedule ?? []).slice().sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  if (slots.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--muted)" }}>{translate("No schedule", lang)}</div>;
  }

  const days: { day: number; slots: ScheduleSlot[] }[] = [];
  for (const s of slots) {
    const group = days[days.length - 1];
    if (group && group.day === s.day) group.slots.push(s);
    else days.push({ day: s.day, slots: [s] });
  }

  return (
    <>
      {days.map((group) => (
        <div
          key={group.day}
          style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid var(--border-2)" }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>{dowFull(group.day, lang)}</div>
          <div style={{ textAlign: "right" }}>
            {group.slots.map((s, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "var(--fg-2)", fontFamily: "'Geist Mono',monospace", marginTop: i === 0 ? 0 : 3 }}>
                {slotRangeLabel(s, fmt)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** "4 students" / "1 student" from the class-owned enrolled count. */
export function studentText(count: number, lang: Lang): string {
  return `${count} ${translate(count === 1 ? "student" : "students", lang)}`;
}

/** Monthly tuition label, e.g. "800,000đ/mo". */
export function feeLabel(fee: number, fmt: Formatter): string {
  return `${fmt.vnd(fee)}/mo`;
}

/** A From / To pair in the teacher's time format, e.g. "06:00 PM – 07:30 PM".
 * The one place a time range is composed — spaces around an en dash, everywhere
 * a schedule or lesson time is shown. */
export function timeRangeLabel(start: string, end: string, fmt: Formatter): string {
  return `${fmt.time12(start)} – ${fmt.time12(end)}`;
}

/** Human duration, e.g. 60 -> "60 min". */
export function durationLabel(minutes: number, lang: Lang): string {
  return `${minutes} ${translate("min", lang)}`;
}
