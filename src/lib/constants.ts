/* English Tutor LMS — shared constants.
 * Ported from design-reference/lib/etlms-constants.js. */

import type { Appearance, RegionalConfig } from "./types";

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
/** How many notifications the bell dropdown draws. A PRESENTATION cap and not a
 * limit on the derived set: item 21 still exists, still counts toward the unread
 * badge and is still marked by "Mark all read" — it is only not rendered. */
export const NOTIFICATION_MAX = 20;

/** localStorage keys, namespaced so persisted prefs are easy to find/clear. */
export const storageKeys = {
  theme: "etlms.theme", accent: "etlms.accent", surface: "etlms.surface",
  spacing: "etlms.spacing", notifDismissed: "etlms.notifDismissed", notifRead: "etlms.notifRead",
  lang: "etlms.lang", dateFormat: "etlms.dateFormat", timeFormat: "etlms.timeFormat",
  currency: "etlms.currency", numberFormat: "etlms.numberFormat",
} as const;

/* ---------------------------------------------- the authorised preferences */

/** Every value each persisted preference may hold, in the order Settings draws
 * them.
 *
 * TWO JOBS, ONE LIST, and that is the point. The Settings page renders these to
 * build its controls, and `settings-context` validates what came out of the
 * browser against the same arrays — so a control can never offer a value the
 * store would reject, and the store can never accept one no control can show.
 * Before Sprint 11 there was no list at all: the reader cast whatever string it
 * found, so a stale or hand-edited key reached `<html data-accent>` as an accent
 * with no matching token block and the screen lost its palette.
 *
 * `satisfies` rather than a bare annotation: the arrays keep their literal
 * tuple types (so `(typeof ACCENTS)[number]` is the union, not `string`) while
 * still failing to compile if a value here is not a legal member. The other
 * direction — a union member missing from its array — is covered by the total
 * label Records in `components/settings/settings-ui.ts` and asserted both ways
 * in tests/settings.test.ts.
 *
 * ORDER IS THE DESIGN'S. These are display order, not validation order, for the
 * same reason `ATTENDANCE_DISPLAY_ORDER` is kept apart from the schema's status
 * list: bending one to the other makes a change to either look like a change to
 * both. */
export const THEMES = ["light", "dark"] as const satisfies readonly Appearance["theme"][];
export const ACCENTS = ["crimson", "indigo", "emerald", "slate"] as const satisfies readonly Appearance["accent"][];
export const SURFACES = ["soft", "flat", "elevated"] as const satisfies readonly Appearance["surface"][];
export const DENSITIES = ["cozy", "airy", "tight"] as const satisfies readonly Appearance["spacing"][];

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD"] as const satisfies readonly RegionalConfig["dateFormat"][];
export const TIME_FORMATS = ["12h", "24h"] as const satisfies readonly RegionalConfig["timeFormat"][];
export const CURRENCIES = ["VND", "USD"] as const satisfies readonly RegionalConfig["currency"][];
export const NUMBER_FORMATS = ["comma", "dot"] as const satisfies readonly RegionalConfig["numberFormat"][];
