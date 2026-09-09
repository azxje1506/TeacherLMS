/* Notifications — device-local acknowledgement, and the view the panel reads.
 *
 * Run with:  npm test  (tests/notification-state.test.ts)
 *
 * THIS IS THE ONLY MODULE BESIDES `lib/constants` THAT MAY NAME THE RESERVED
 * NOTIFICATION KEYS. Sprint 12's contract authorised `etlms.notifRead` and
 * `etlms.notifDismissed` to acquire a reader for the first time, and confined
 * that reader to Notifications-owned code; `tests/settings.test.ts` walks all of
 * `src/` to enforce it. No third key is added, neither is renamed, and there is
 * no server-side acknowledgement — read and dismiss live on the device that did
 * them, which is exactly what the design's own copy promised.
 *
 * WHY ACKNOWLEDGEMENT IS NOT A SETTING. It is per-item state the bell owns, not a
 * preference: it has no enumeration, no default worth showing and no place on the
 * Settings page, which still has three sections and nine settings and gains no
 * Notifications card. So this store is deliberately NOT the `SettingsProvider` —
 * putting it there would have made it a tenth setting by accident.
 *
 * THE SHAPE IS COPIED FROM SETTINGS ON PURPOSE. `resolveAcknowledgement` takes
 * its reader as an argument exactly as `resolveSettings` does, so the parsing and
 * the fallbacks can be driven with a plain object in a Node test — no browser, no
 * DOM, no storage shim — and `readStoredAcknowledgement` is the one caller that
 * supplies the real `localStorage`.
 *
 * EVERY FUNCTION HERE IS PURE OR A THIN BROWSER WRAPPER. State transitions return
 * a NEW state and never edit the one they were handed, and none of them touches a
 * domain entity: acknowledging a notification writes to `localStorage` and to
 * nothing else, ever. There is no UI in this file.
 */

import { NOTIFICATION_MAX, storageKeys } from "./constants";
import type { AppNotification } from "./notifications";

/* ------------------------------------------------------------------- state */

/** What the device remembers. Two sets of stable notification ids and nothing
 * else — no copy of a notification, no title, no timestamp. Storing anything
 * more would be notification history, which the contract forbids. */
export interface AcknowledgementState {
  readonly read: ReadonlySet<string>;
  readonly dismissed: ReadonlySet<string>;
}

export const EMPTY_ACKNOWLEDGEMENT: AcknowledgementState = {
  read: new Set<string>(),
  dismissed: new Set<string>(),
};

/* ----------------------------------------------------------------- parsing */

/** One stored id list, read DEFENSIVELY.
 *
 * WHY THIS IS NOT `JSON.parse(raw)`. The value comes out of a browser, so it can
 * be absent, empty, truncated mid-write, hand-edited in devtools, left behind by
 * an older build, or simply not an array at all. Any of those reaching the panel
 * as an id set would either throw during a render or quietly mark the wrong items
 * read. Settings hardened its own nine reads for exactly this reason; this is the
 * same rule applied to a list instead of an enumeration.
 *
 * EVERY FAILURE IS THE SAME FAILURE: the empty set. That is deterministic, it
 * never throws, and it fails in the safe direction — an unreadable store makes
 * notifications look UNREAD rather than silently hiding them. Losing a dismissal
 * shows the teacher something they already dealt with; losing a notification does
 * not show them something they have not.
 *
 * Non-string members are dropped rather than coerced, because `String(null)` is
 * the id `"null"` and a junk id that survives is worse than one that does not.
 * Duplicates collapse — the value is a set, and it is only a list because
 * `localStorage` holds text. */
export function parseIdList(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry === "string" && entry !== "") seen.add(entry);
  }
  return [...seen].sort();
}

/** The canonical stored form: a sorted, de-duplicated JSON array of strings.
 *
 * SORTED SO THE SAME SET ALWAYS SERIALISES THE SAME WAY. Two devices that have
 * acknowledged the same things write byte-identical values, and a write that
 * changes nothing produces no textual change — which makes the stored value
 * something a person can read in devtools and compare. */
export function serializeIdList(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

/* ------------------------------------------------------------------ readers */

/** Resolve the acknowledgement state from a raw key reader.
 *
 * PURE, AND EXPORTED FOR THAT REASON — the reader is an argument, so the parsing
 * above can be exercised with a plain object and no browser. */
export function resolveAcknowledgement(read: (key: string) => string | null): AcknowledgementState {
  return {
    read: new Set(parseIdList(read(storageKeys.notifRead))),
    dismissed: new Set(parseIdList(read(storageKeys.notifDismissed))),
  };
}

/** The raw stored string, or null — absent key, no window, or storage that throws
 * (private mode, blocked site data) are all "nothing stored". Lifted from the
 * Settings store, and identical for the same reason: a page that cannot read
 * storage must still render. */
function lsRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsWrite(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Blocked site data: the acknowledgement simply does not persist. Nothing is
     * broken by that, and nothing else in the application depends on it. */
  }
}

/** The state as the real browser reports it. Exported so the BROWSER path — not
 * only the pure resolver — can be exercised, the way Settings exports
 * `readStoredSettings` for the same reason. */
export function readStoredAcknowledgement(): AcknowledgementState {
  return resolveAcknowledgement(lsRead);
}

/** Persist a state to the two reserved keys. THE ONLY WRITER, and it writes
 * nothing but those two keys — no domain collection, no server, no third key. */
export function persistAcknowledgement(state: AcknowledgementState): void {
  lsWrite(storageKeys.notifRead, serializeIdList(state.read));
  lsWrite(storageKeys.notifDismissed, serializeIdList(state.dismissed));
}

/* -------------------------------------------------------------- transitions */

export function isRead(state: AcknowledgementState, id: string): boolean {
  return state.read.has(id);
}

export function isDismissed(state: AcknowledgementState, id: string): boolean {
  return state.dismissed.has(id);
}

/** Mark ONE id read. Reading is not dismissing: `dismissed` is carried through
 * untouched, and the item stays in the list. */
export function markRead(state: AcknowledgementState, id: string): AcknowledgementState {
  if (state.read.has(id)) return state;
  return { read: new Set(state.read).add(id), dismissed: state.dismissed };
}

/** Mark EVERY id it is given read.
 *
 * THE CALLER PASSES THE WHOLE LIVE SET, NOT THE VISIBLE TWENTY. That is the point
 * of the parameter: the badge counts past the presentation cap, so "Mark all
 * read" has to reach past it too, or a teacher could clear the panel and still be
 * left with a number they have no way to clear. `NotificationView.undismissed` is
 * the list to hand it.
 *
 * IT DISMISSES NOTHING. A future notification with a new stable id is not in this
 * list and is therefore still unread when it appears — which is the whole reason
 * ids are derived from source identity rather than generated. */
export function markAllRead(state: AcknowledgementState, ids: Iterable<string>): AcknowledgementState {
  const next = new Set(state.read);
  for (const id of ids) next.add(id);
  return next.size === state.read.size ? state : { read: next, dismissed: state.dismissed };
}

/** Dismiss ONE id. Writes only to the dismissed set, leaves read state alone, and
 * touches no source entity — the Billing record, Lesson or Review it referred to
 * is completely unaware that this happened. */
export function dismiss(state: AcknowledgementState, id: string): AcknowledgementState {
  if (state.dismissed.has(id)) return state;
  return { read: state.read, dismissed: new Set(state.dismissed).add(id) };
}

/* --------------------------------------------------------------------- view */

/** What the panel needs, in one pass over the active set.
 *
 * THREE LISTS BECAUSE THEY ANSWER THREE DIFFERENT QUESTIONS, and collapsing any
 * two of them is how the badge starts lying. */
export interface NotificationView {
  /** Everything currently qualifying, ordered. Dismissals have NOT been applied:
   * this is the derived truth, kept so the cap and the dismissal filter stay
   * visibly separate concerns. */
  readonly active: readonly AppNotification[];
  /** `active` minus what this device dismissed — the list that is live for this
   * teacher, at full length and NOT capped. */
  readonly undismissed: readonly AppNotification[];
  /** The first `NOTIFICATION_MAX` of `undismissed`. The cap is presentation only:
   * item 21 is absent from here and from nowhere else. */
  readonly visible: readonly AppNotification[];
  /** Unread among `undismissed` — across the whole live set, not merely the
   * visible twenty.
   *
   * DISMISSED ITEMS ARE NOT COUNTED, deliberately. A dismissed notification is
   * not in the list any more, so counting it would leave the teacher a badge no
   * action on the panel could ever clear. */
  readonly unreadCount: number;
  /** How many live notifications the cap is holding back. */
  readonly overflow: number;
}

/** Apply device-local acknowledgement to an active set.
 *
 * PURE. It builds new arrays and never edits the notifications it is given, so
 * the same active set can be presented against two different states — which is
 * what a test does, and what a second tab would do. */
export function presentNotifications(
  active: readonly AppNotification[],
  state: AcknowledgementState = EMPTY_ACKNOWLEDGEMENT,
  cap: number = NOTIFICATION_MAX
): NotificationView {
  const undismissed = active.filter((n) => !state.dismissed.has(n.id));
  const visible = undismissed.slice(0, Math.max(0, cap));
  let unreadCount = 0;
  for (const n of undismissed) if (!state.read.has(n.id)) unreadCount++;
  return {
    active,
    undismissed,
    visible,
    unreadCount,
    overflow: undismissed.length - visible.length,
  };
}

/** The ids "Mark all read" should be given for a view: every live notification,
 * cap included, stated here so no caller has to remember to reach past
 * `visible`. */
export function markableIds(view: NotificationView): string[] {
  return view.undismissed.map((n) => n.id);
}
