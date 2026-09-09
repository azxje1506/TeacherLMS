/* Notifications — device-local acknowledgement, and the view the panel reads.
 *
 * Run with:  npm test
 *
 * NO BROWSER. `resolveAcknowledgement` takes its reader as an argument exactly as
 * `resolveSettings` does, so every parsing rule below is driven with a plain
 * object and no storage shim. The one browser-backed path is covered by proving
 * it degrades to the empty state when there is no `window`, which is the state
 * Node is already in.
 *
 * THE HARDEST RULES HERE ARE THE ONES ABOUT WHAT MUST *NOT* HAPPEN: read is not
 * dismiss, the badge counts past the presentation cap, a stale acknowledgement
 * cannot resurrect anything, and no transition edits the state it was handed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EMPTY_ACKNOWLEDGEMENT,
  dismiss,
  isDismissed,
  isRead,
  markAllRead,
  markRead,
  markableIds,
  parseIdList,
  persistAcknowledgement,
  presentNotifications,
  readStoredAcknowledgement,
  resolveAcknowledgement,
  serializeIdList,
} from "../src/lib/notification-state";
import type { AcknowledgementState } from "../src/lib/notification-state";
import { NOTIFICATION_MAX, storageKeys } from "../src/lib/constants";
import type { AppNotification } from "../src/lib/notifications";

/* --------------------------------------------------------------- fixtures */

/** A notification stub. Only `id` matters to this layer — which is itself the
 * point: acknowledgement knows ids and nothing else about a notification. */
const note = (id: string): AppNotification => ({ id } as AppNotification);

const list = (n: number, prefix = "n") =>
  Array.from({ length: n }, (_, i) => note(`${prefix}${String(i).padStart(3, "0")}`));

/** A reader over a plain object, in the shape `resolveAcknowledgement` wants. */
const reader = (store: Record<string, string | null>) => (key: string) => store[key] ?? null;

const state = (read: string[] = [], dismissed: string[] = []): AcknowledgementState => ({
  read: new Set(read),
  dismissed: new Set(dismissed),
});

/** The module's own source, for the containment assertions at the end. Read by
 * path the way every other source-scanning suite here does. */
const STATE_SRC = readFileSync(path.join(process.cwd(), "src", "lib", "notification-state.ts"), "utf8");

/* ================================================================= parsing */

describe("Notification storage · a value out of a browser is not trusted", () => {
  it("1. a well-formed list round-trips", () => {
    assert.deepEqual(parseIdList('["a","b"]'), ["a", "b"]);
  });

  it("2. null, undefined and the empty string are all 'nothing stored'", () => {
    assert.deepEqual(parseIdList(null), []);
    assert.deepEqual(parseIdList(undefined), []);
    assert.deepEqual(parseIdList(""), []);
  });

  it("3. invalid JSON falls back rather than throwing", () => {
    for (const raw of ["[", "{", "not json", '["a",', "   ", "\t"]) {
      assert.deepEqual(parseIdList(raw), [], JSON.stringify(raw));
    }
  });

  it("4. valid JSON that is not an array falls back", () => {
    for (const raw of ['{"a":1}', '"a"', "42", "true", "null"]) {
      assert.deepEqual(parseIdList(raw), [], raw);
    }
  });

  it("5. non-string members are dropped, never coerced", () => {
    /* `String(null)` is the id "null", and a junk id that survives is worse than
     * one that does not — it would mark a real notification read one day. */
    assert.deepEqual(parseIdList('["a",1,null,true,{"b":2},["c"],"d"]'), ["a", "d"]);
  });

  it("6. the empty string is not an id", () => {
    assert.deepEqual(parseIdList('["","a"]'), ["a"]);
  });

  it("7. duplicates collapse", () => {
    assert.deepEqual(parseIdList('["a","a","b","a"]'), ["a", "b"]);
  });

  it("8. the result is sorted, so the same set always reads back the same way", () => {
    assert.deepEqual(parseIdList('["c","a","b"]'), ["a", "b", "c"]);
  });

  it("9. every failure is the SAME failure, and it fails safe", () => {
    /* An unreadable store makes items look UNREAD rather than silently hidden:
     * showing something already dealt with is recoverable, hiding something never
     * seen is not. */
    for (const raw of ["broken", "{}", "null", ""]) {
      assert.deepEqual(parseIdList(raw), [], raw);
    }
  });

  it("10. serialization is canonical — sorted and de-duplicated", () => {
    assert.equal(serializeIdList(["c", "a", "b", "a"]), '["a","b","c"]');
    assert.equal(serializeIdList([]), "[]");
  });

  it("11. serialize and parse are inverse over any set", () => {
    const ids = ["review:s2:2026-01", "tuition:B1", "makeup:L1:2026-07-12"];
    assert.deepEqual(parseIdList(serializeIdList(ids)), [...ids].sort());
  });
});

/* ================================================================ resolving */

describe("Notification storage · resolving both keys", () => {
  it("12. it reads exactly the two reserved keys and no others", () => {
    const seen: string[] = [];
    resolveAcknowledgement((key) => { seen.push(key); return null; });
    assert.deepEqual(seen.sort(), [storageKeys.notifDismissed, storageKeys.notifRead].sort());
  });

  it("13. the keys it reads are the ones the design reserved, unrenamed", () => {
    assert.equal(storageKeys.notifRead, "etlms.notifRead");
    assert.equal(storageKeys.notifDismissed, "etlms.notifDismissed");
  });

  it("14. read and dismissed are kept apart", () => {
    const got = resolveAcknowledgement(reader({
      [storageKeys.notifRead]: '["a"]',
      [storageKeys.notifDismissed]: '["b"]',
    }));
    assert.deepEqual([...got.read], ["a"]);
    assert.deepEqual([...got.dismissed], ["b"]);
  });

  it("15. one corrupt key does not poison the other", () => {
    const got = resolveAcknowledgement(reader({
      [storageKeys.notifRead]: "{{{",
      [storageKeys.notifDismissed]: '["b"]',
    }));
    assert.equal(got.read.size, 0);
    assert.deepEqual([...got.dismissed], ["b"]);
  });

  it("16. an empty store resolves to the empty state", () => {
    const got = resolveAcknowledgement(() => null);
    assert.equal(got.read.size, 0);
    assert.equal(got.dismissed.size, 0);
  });

  it("17. the browser path degrades to empty where there is no window", () => {
    /* Node has no `window`, which is the same branch a server render takes. */
    const got = readStoredAcknowledgement();
    assert.equal(got.read.size, 0);
    assert.equal(got.dismissed.size, 0);
  });

  it("18. persisting without a window is a no-op rather than a throw", () => {
    assert.doesNotThrow(() => persistAcknowledgement(state(["a"], ["b"])));
  });
});

/* ==================================================================== read */

describe("Notification acknowledgement · read", () => {
  it("19. everything is unread until its id is stored", () => {
    assert.equal(isRead(EMPTY_ACKNOWLEDGEMENT, "a"), false);
    assert.equal(isRead(state(["a"]), "a"), true);
  });

  it("20. marking one marks only that one", () => {
    const got = markRead(state([], []), "a");
    assert.deepEqual([...got.read], ["a"]);
    assert.equal(isRead(got, "b"), false);
  });

  it("21. reading does not dismiss", () => {
    const got = markRead(state([], ["d"]), "a");
    assert.deepEqual([...got.dismissed], ["d"], "the dismissed set is carried through untouched");
    assert.equal(isDismissed(got, "a"), false);
  });

  it("22. mark-all marks every id it is given", () => {
    const got = markAllRead(EMPTY_ACKNOWLEDGEMENT, ["a", "b", "c"]);
    assert.deepEqual([...got.read].sort(), ["a", "b", "c"]);
  });

  it("23. mark-all reaches PAST the presentation cap", () => {
    /* The badge counts the whole live set, so mark-all has to reach the whole
     * live set — otherwise the teacher clears the panel and is left with a number
     * no action can clear. Item 21+ is the case that proves it. */
    const active = list(25);
    const view = presentNotifications(active, EMPTY_ACKNOWLEDGEMENT);
    assert.equal(view.visible.length, NOTIFICATION_MAX);
    assert.equal(view.unreadCount, 25);

    const after = markAllRead(EMPTY_ACKNOWLEDGEMENT, markableIds(view));
    assert.equal(after.read.size, 25, "all 25, not the visible 20");
    assert.equal(isRead(after, "n024"), true, "the 25th is read");
    assert.equal(presentNotifications(active, after).unreadCount, 0);
  });

  it("24. marking only the VISIBLE ids would leave an unclearable badge", () => {
    /* The mistake this API exists to prevent, stated as a test so nobody 'fixes'
     * markableIds into returning view.visible. */
    const active = list(25);
    const view = presentNotifications(active);
    const wrong = markAllRead(EMPTY_ACKNOWLEDGEMENT, view.visible.map((n) => n.id));
    assert.equal(presentNotifications(active, wrong).unreadCount, 5, "five would survive");
  });

  it("25. a genuinely new id is unread after a mark-all", () => {
    const active = list(3);
    const after = markAllRead(EMPTY_ACKNOWLEDGEMENT, markableIds(presentNotifications(active)));
    const grown = [...active, note("n999")];
    assert.equal(presentNotifications(grown, after).unreadCount, 1);
    assert.equal(isRead(after, "n999"), false);
  });

  it("26. read state survives a serialization round-trip", () => {
    const after = markAllRead(EMPTY_ACKNOWLEDGEMENT, ["a", "b"]);
    const reloaded = resolveAcknowledgement(reader({ [storageKeys.notifRead]: serializeIdList(after.read) }));
    assert.deepEqual([...reloaded.read].sort(), ["a", "b"]);
  });

  it("27. marking an already-read id changes nothing and allocates nothing", () => {
    const before = state(["a"]);
    assert.equal(markRead(before, "a"), before, "the same object is returned");
    assert.equal(markAllRead(before, ["a"]), before);
  });
});

/* ================================================================= dismiss */

describe("Notification acknowledgement · dismiss", () => {
  it("28. dismissing hides only that id", () => {
    const active = list(3);
    const view = presentNotifications(active, dismiss(EMPTY_ACKNOWLEDGEMENT, "n001"));
    assert.deepEqual(view.undismissed.map((n) => n.id), ["n000", "n002"]);
  });

  it("29. dismissing does not mark read", () => {
    const got = dismiss(state(["r"]), "a");
    assert.deepEqual([...got.read], ["r"], "the read set is carried through untouched");
    assert.equal(isRead(got, "a"), false);
  });

  it("30. a dismissed item stops counting toward the badge", () => {
    /* A badge that counts something the panel no longer shows is a badge the
     * teacher can never clear. */
    const active = list(3);
    assert.equal(presentNotifications(active).unreadCount, 3);
    assert.equal(presentNotifications(active, dismiss(EMPTY_ACKNOWLEDGEMENT, "n000")).unreadCount, 2);
  });

  it("31. dismiss survives a serialization round-trip", () => {
    const after = dismiss(EMPTY_ACKNOWLEDGEMENT, "n001");
    const reloaded = resolveAcknowledgement(reader({ [storageKeys.notifDismissed]: serializeIdList(after.dismissed) }));
    assert.equal(isDismissed(reloaded, "n001"), true);
  });

  it("32. a stale dismissed id is harmless and creates nothing", () => {
    /* THE RULE THAT MATTERS MOST: acknowledgement can only ever REMOVE, never
     * add. An id for a source that stopped qualifying is not in the active set,
     * so it cannot come back — and cannot conjure a notification of its own. */
    const stale = state(["gone:1", "gone:2"], ["gone:3", "gone:4"]);
    const view = presentNotifications([], stale);
    assert.deepEqual(view.active, []);
    assert.deepEqual(view.undismissed, []);
    assert.deepEqual(view.visible, []);
    assert.equal(view.unreadCount, 0);
  });

  it("33. a genuinely new identity is NOT suppressed by an old dismissal", () => {
    /* A makeup dismissed on the 12th, then moved to the 14th: the new date is a
     * new id, so the teacher sees the change they have not seen. */
    const after = dismiss(EMPTY_ACKNOWLEDGEMENT, "makeup:L1:2026-07-12");
    const moved = [note("makeup:L1:2026-07-14")];
    assert.equal(presentNotifications(moved, after).visible.length, 1);
  });

  it("34. dismissing an already-dismissed id changes nothing", () => {
    const before = state([], ["a"]);
    assert.equal(dismiss(before, "a"), before);
  });
});

/* ============================================================ immutability */

describe("Notification acknowledgement · every transition is a new value", () => {
  it("35. no transition edits the state it was handed", () => {
    const before = state(["r1"], ["d1"]);
    const snapshot = { read: [...before.read], dismissed: [...before.dismissed] };
    markRead(before, "new");
    markAllRead(before, ["a", "b"]);
    dismiss(before, "new");
    assert.deepEqual([...before.read], snapshot.read);
    assert.deepEqual([...before.dismissed], snapshot.dismissed);
  });

  it("36. presenting does not edit the notifications it was given", () => {
    const active = Object.freeze(list(3));
    const before = JSON.stringify(active);
    presentNotifications(active, state(["n000"], ["n001"]));
    assert.equal(JSON.stringify(active), before);
  });

  it("37. the same active set can be presented against two states independently", () => {
    const active = list(4);
    const a = presentNotifications(active, state([], ["n000"]));
    const b = presentNotifications(active, state([], ["n003"]));
    assert.deepEqual(a.undismissed.map((n) => n.id), ["n001", "n002", "n003"]);
    assert.deepEqual(b.undismissed.map((n) => n.id), ["n000", "n001", "n002"]);
  });
});

/* ===================================================== active vs visible cap */

describe("Notification view · the active set and the visible twenty", () => {
  it("38. the cap is twenty", () => {
    assert.equal(NOTIFICATION_MAX, 20);
  });

  it("39. nineteen: everything is visible and nothing overflows", () => {
    const view = presentNotifications(list(19));
    assert.equal(view.active.length, 19);
    assert.equal(view.visible.length, 19);
    assert.equal(view.overflow, 0);
    assert.equal(view.unreadCount, 19);
  });

  it("40. twenty: exactly full, still no overflow", () => {
    const view = presentNotifications(list(20));
    assert.equal(view.visible.length, 20);
    assert.equal(view.overflow, 0);
    assert.equal(view.unreadCount, 20);
  });

  it("41. twenty-one: one held back, and it still counts", () => {
    const view = presentNotifications(list(21));
    assert.equal(view.active.length, 21, "the active set keeps all 21");
    assert.equal(view.visible.length, 20);
    assert.equal(view.overflow, 1);
    assert.equal(view.unreadCount, 21, "the badge counts past the cap");
  });

  it("42. far past the cap, the active set is still whole", () => {
    const view = presentNotifications(list(57));
    assert.equal(view.active.length, 57);
    assert.equal(view.undismissed.length, 57);
    assert.equal(view.visible.length, 20);
    assert.equal(view.overflow, 37);
    assert.equal(view.unreadCount, 57);
  });

  it("43. item 21+ is not mutated, dismissed or marked by being over the cap", () => {
    /* The contract's exact words: the cap is presentation only. */
    const active = list(25);
    const view = presentNotifications(active);
    assert.equal(view.active.length, 25);
    assert.deepEqual(view.active[24], note("n024"), "the 25th is untouched");
    assert.equal(view.unreadCount, 25, "and unread");
    assert.equal(markableIds(view).length, 25, "and reachable by mark-all");
  });

  it("44. the cap applies AFTER dismissal, so dismissing promotes item 21", () => {
    const active = list(21);
    const view = presentNotifications(active, state([], ["n000"]));
    assert.equal(view.undismissed.length, 20);
    assert.equal(view.visible.length, 20);
    assert.equal(view.overflow, 0);
    assert.equal(view.visible.at(-1)!.id, "n020", "the 21st is now on screen");
  });

  it("45. unread counts the LIVE set — neither the visible twenty nor the dismissed", () => {
    const active = list(30);
    const view = presentNotifications(active, state(["n000", "n001"], ["n002"]));
    assert.equal(view.undismissed.length, 29);
    assert.equal(view.unreadCount, 27, "29 live minus 2 read");
    assert.equal(view.visible.length, 20);
  });

  it("46. an empty active set is an empty view, not an error", () => {
    const view = presentNotifications([]);
    assert.deepEqual(view.visible, []);
    assert.equal(view.unreadCount, 0);
    assert.equal(view.overflow, 0);
    assert.deepEqual(markableIds(view), []);
  });

  it("47. a caller may state its own cap, and a nonsensical one cannot go negative", () => {
    assert.equal(presentNotifications(list(5), EMPTY_ACKNOWLEDGEMENT, 2).visible.length, 2);
    assert.equal(presentNotifications(list(5), EMPTY_ACKNOWLEDGEMENT, -3).visible.length, 0);
    assert.equal(presentNotifications(list(5), EMPTY_ACKNOWLEDGEMENT, -3).overflow, 5);
  });
});

/* ============================================================= containment */

describe("Notifications · acknowledgement touches nothing but its two keys", () => {
  it("48. no source entity is reachable from this layer at all", () => {
    /* The module imports only its own types, the constants and nothing else —
     * there is no Billing, Lesson, Review, model or database import to mutate
     * through. Asserted on the source, because 'did not write' is otherwise only
     * provable by not having a database here. */
    const imports = [...STATE_SRC.matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ["./constants", "./notifications"]);
    for (const banned of ["models", "mongoose", "dbConnect", "fetch(", "BillingModel", "LessonModel", "ReviewModel"]) {
      assert.ok(!STATE_SRC.includes(banned), `acknowledgement must not reach ${banned}`);
    }
  });

  it("49. it names no storage key but the two reserved ones", () => {
    const keys = [...STATE_SRC.matchAll(/storageKeys\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(keys)].sort(), ["notifDismissed", "notifRead"]);
    /* And it reaches them THROUGH `storageKeys`, never by writing the literal
     * out — a hand-typed "etlms.notifRead" is how a key silently drifts. */
    assert.ok(!/"etlms\./.test(STATE_SRC), "no raw key literal is written out");
  });
});
