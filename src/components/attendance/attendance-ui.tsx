/* Shared Attendance presentation helpers.
 *
 * The imported design computes each register segment's style and each card's
 * indicator at runtime (that logic is not in the exported markup), so they are
 * reproduced here once — in the comp's own pill language, using the comp's own
 * semantic tokens — and consumed by both Attendance screens. This mirrors exactly
 * what class-ui.tsx does for Classes and lesson-ui.tsx does for Lessons; generic
 * helpers (cardStyle, timeRange, studentText) are reused from those modules
 * rather than duplicated.
 */

import type { AttendanceStatus, Lang } from "@/lib/types";
import { translate } from "@/lib/i18n";

/** Display order: Present, Late, Absent, Excused — the order the design draws
 * the summary tiles in, and therefore the order the segmented control reads in.
 *
 * Deliberately NOT `ATTENDANCE_STATUSES` from lib/schemas, which is the
 * VALIDATION list and carries a different order. A validation list has no visual
 * meaning; bending one to the other would make a change to either look like a
 * change to both. The two are tied by the type, not by their order. */
export const ATTENDANCE_DISPLAY_ORDER: AttendanceStatus[] = ["Present", "Late", "Absent", "Excused"];

/** Soft/solid colour pair per status, drawn from the design's semantic tokens —
 * green / amber / accent / sky, exactly as the design's five summary tiles use
 * them. Typed as a total Record so a status added to AttendanceStatus without a
 * pair here is a compile error rather than an unstyled control. No literal hex
 * is introduced: every value is a token that already exists and already responds
 * to the theme and accent settings. */
export const ATTENDANCE_COLORS: Record<AttendanceStatus, { soft: string; color: string }> = {
  Present: { soft: "var(--green-soft)", color: "var(--green)" },
  Late: { soft: "var(--amber-soft)", color: "var(--amber)" },
  Absent: { soft: "var(--accent-soft)", color: "var(--accent)" },
  Excused: { soft: "var(--sky-soft)", color: "var(--sky)" },
};

/** One segment of a student row's status control. Selected reads as the status's
 * own soft/solid pair; unselected is the neutral card pill every other control in
 * the app uses when it is off. */
export function segmentStyle(status: AttendanceStatus, active: boolean): React.CSSProperties {
  const c = ATTENDANCE_COLORS[status];
  return {
    height: 34, padding: "0 11px", borderRadius: 8, cursor: "pointer",
    fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
    border: `1px solid ${active ? c.soft : "var(--border)"}`,
    background: active ? c.soft : "var(--card)",
    color: active ? c.color : "var(--muted)",
    display: "flex", alignItems: "center", justifyContent: "center",
    whiteSpace: "nowrap", flex: 1,
  };
}

/** The em dash the whole app uses for "no value" (see lib/format). */
const EM = "—";

/** A lesson card's taken/not-taken indicator.
 *
 * The design gives the indicator a label and a colour but no values — there is no
 * "Taken" string anywhere in the comp, so none is invented. A lesson with no
 * register says so; a lesson with one shows the figure it actually has, which is
 * the register's own rate. The colour answers the same question the label does —
 * is this done? — in the app's existing semantic language: green for settled,
 * amber for still needing the teacher. */
export function attendanceIndicator(
  card: { taken: boolean; rate: number | null },
  lang: Lang
): { label: string; color: string } {
  if (!card.taken) return { label: translate("Not taken", lang), color: "var(--amber)" };
  return { label: card.rate === null ? EM : `${card.rate}%`, color: "var(--green)" };
}

/** The CTA on a lesson card: a register that exists is edited, one that does not
 * is taken. Both strings are the design's own. */
export function attendanceCtaLabel(taken: boolean, lang: Lang): string {
  return translate(taken ? "Edit attendance" : "Take attendance", lang);
}

/** A percentage, or the shared placeholder when there is nothing to rate — an
 * empty register is not 0%. */
export function rateLabel(rate: number | null): string {
  return rate === null ? EM : `${rate}%`;
}

/** Circumference of the design's r=40 progress ring, matching the Dashboard's
 * own ring maths so the two donuts are drawn by the same number. */
export const RING_CIRCUMFERENCE = 251.33;

/** `stroke-dasharray` for a rate on that ring. */
export function ringDash(rate: number): string {
  const filled = Math.max(0, Math.min(100, rate)) / 100 * RING_CIRCUMFERENCE;
  return `${filled} ${RING_CIRCUMFERENCE}`;
}
