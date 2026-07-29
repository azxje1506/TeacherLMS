/* English Tutor LMS — shared constants.
 * Ported from design-reference/lib/etlms-constants.js. */

export const AVATAR_PALETTE = ["#d14242", "#0284c7", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#ca8a04", "#4f46e5", "#059669"];
export const CLASS_PALETTE = ["#d14242", "#0284c7", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Skill dimensions scored in a monthly review: [key, label]. */
export const SKILLS: [string, string][] = [
  ["listening", "Listening"], ["speaking", "Speaking"], ["reading", "Reading"],
  ["writing", "Writing"], ["grammar", "Grammar"], ["vocabulary", "Vocabulary"],
  ["pronunciation", "Pronunciation"], ["confidence", "Confidence"],
  ["participation", "Participation"], ["homework", "Homework"],
];

// App clock (see CLAUDE.md) plus the window of months finance/reporting spans.
export const TODAY_ISO = "2026-07-10";
export const NOW_STAMP = "2026-07-10T09:41:00";
export const CURRENT_MONTH = "2026-07";
export const FINANCE_MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

/** Rolling window the runtime Lessons "ensure" service reconciles Regular lessons
 * across, expressed as a span of whole months around CURRENT_MONTH. Configurable
 * so the service never hardcodes month values (see src/lib/lessons.ts). */
export const LESSON_WINDOW_PREVIOUS_MONTHS = 1;
export const LESSON_WINDOW_NEXT_MONTHS = 2;

/** Window the class drawer's "Suggested available times" searches for free time,
 * plus the grid candidate starts snap to and how many are offered. Suggestions
 * are a scheduling aid only — they never relax the overlap rule the API enforces. */
export const TEACHING_DAY_START = "07:00";
export const TEACHING_DAY_END = "21:30";
export const SUGGESTION_STEP_MINUTES = 15;
export const SUGGESTION_MAX = 4;

/** Which module UIs are live. Modules ship one per sprint (see PROJECT_RULES);
 * routes for not-yet-built modules render a placeholder. Flip a flag to true
 * when that module's sprint lands. Parents is Sprint 3. */
export const MODULE_AVAILABLE = { parents: true } as const;

// Behavioural tuning values.
export const TOAST_MS = 2600;
export const LOGIN_DELAY_MS = 700;
export const ACTIVITY_MAX = 40;
export const RECENT_SEARCH_MAX = 6;
export const CMD_RESULT_MAX = 40;

/** localStorage keys, namespaced so persisted prefs are easy to find/clear. */
export const storageKeys = {
  theme: "etlms.theme", accent: "etlms.accent", surface: "etlms.surface",
  spacing: "etlms.spacing", notifDismissed: "etlms.notifDismissed", notifRead: "etlms.notifRead",
  lang: "etlms.lang", dateFormat: "etlms.dateFormat", timeFormat: "etlms.timeFormat",
  currency: "etlms.currency", numberFormat: "etlms.numberFormat",
} as const;
