/* Shared Classes presentation helpers.
 *
 * The design comp computes each class card's badge / type / schedule labels at
 * runtime, so they are reproduced here once — in the comp's own pill language —
 * and consumed by both the list and the detail. Kept in one place so the two
 * screens can never drift.
 */

import type { ClassType, Klass, ScheduleSlot } from "@/lib/types";
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

/** Duration options for a schedule slot, in minutes. */
export const DURATION_OPTIONS = [30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }));

/** Localized short weekday, e.g. day 1 -> "Mon" / "T2". */
function dowShort(day: number, lang: Lang): string {
  return translate(DOW_SHORT[day] ?? "", lang);
}

/** Localized full weekday, e.g. day 1 -> "Monday" / "Thứ Hai". */
export function dowFull(day: number, lang: Lang): string {
  return translate(DOW_FULL[day] ?? "", lang);
}

/** One-line recurring-schedule label: "Mon 09:00 · Wed 14:30", or "No schedule". */
export function scheduleLabel(schedule: ScheduleSlot[] | undefined, fmt: Formatter, lang: Lang): string {
  if (!schedule || schedule.length === 0) return translate("No schedule", lang);
  return schedule
    .slice()
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    .map((s) => `${dowShort(s.day, lang)} ${fmt.time12(s.start)}`)
    .join(" · ");
}

/** "4 students" / "1 student" from the class-owned enrolled count. */
export function studentText(count: number, lang: Lang): string {
  return `${count} ${translate(count === 1 ? "student" : "students", lang)}`;
}

/** Monthly tuition label, e.g. "800,000đ/mo". */
export function feeLabel(fee: number, fmt: Formatter): string {
  return `${fmt.vnd(fee)}/mo`;
}

/** Human duration, e.g. 60 -> "60 min". */
export function durationLabel(minutes: number, lang: Lang): string {
  return `${minutes} ${translate("min", lang)}`;
}
