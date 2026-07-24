/* English Tutor LMS — shared constants (RC2)
 *
 * Single source of truth for colour palettes, domain enumerations and the
 * calendar labels used across the app. Previously these literals were copied
 * inline in several places (avatar/class palettes, month & weekday arrays,
 * the skill list, the app clock). Centralising them removes that duplication
 * and makes the demo's fixed "today" easy to find.
 *
 * Loaded as a classic script; it only augments the global ETLMS namespace so
 * load order between the lib modules does not matter.
 */
(function (root) {
  var ETLMS = (root.ETLMS = root.ETLMS || {});

  ETLMS.constants = {
    // Deterministic palettes used to tint student avatars and class chips.
    AVATAR_PALETTE: ['#d14242', '#0284c7', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#059669'],
    CLASS_PALETTE:  ['#d14242', '#0284c7', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777'],

    // Calendar labels.
    MONTHS_SHORT: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    MONTHS_FULL:  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    DOW_SHORT: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    DOW_FULL:  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

    // Skill dimensions scored in a monthly review: [key, label].
    SKILLS: [
      ['listening', 'Listening'], ['speaking', 'Speaking'], ['reading', 'Reading'],
      ['writing', 'Writing'], ['grammar', 'Grammar'], ['vocabulary', 'Vocabulary'],
      ['pronunciation', 'Pronunciation'], ['confidence', 'Confidence'],
      ['participation', 'Participation'], ['homework', 'Homework']
    ],

    // App clock (see CLAUDE.md) plus the window of months finance/reporting spans.
    TODAY_ISO: '2026-07-10',
    NOW_STAMP: '2026-07-10T09:41:00',
    CURRENT_MONTH: '2026-07',
    FINANCE_MONTHS: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'],

    // Behavioural tuning values (were magic numbers scattered through the component).
    TOAST_MS: 2600,          // how long a toast stays on screen
    LOGIN_DELAY_MS: 700,     // simulated sign-in latency
    ACTIVITY_MAX: 40,        // capped length of the activity feed
    RECENT_SEARCH_MAX: 6,    // recent command-palette searches kept
    CMD_RESULT_MAX: 40       // command-palette results shown at once
  };

  // localStorage keys, namespaced so persisted prefs are easy to find/clear.
  ETLMS.storageKeys = {
    theme: 'etlms.theme', accent: 'etlms.accent', surface: 'etlms.surface',
    spacing: 'etlms.spacing', notifDismissed: 'etlms.notifDismissed', notifRead: 'etlms.notifRead'
  };
})(window);
