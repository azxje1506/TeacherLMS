/* Notifications — the server boundary.
 *
 * WHY THERE IS NO `/api/notifications`. The contract forbids "an API whose only
 * purpose is duplicating state the application already owns", and that is exactly
 * what such a route would be: notifications are DERIVED from Billing, Lesson and
 * Review, all of which the server already reads. So the derivation runs where the
 * authenticated shell is already assembled — `(app)/layout.tsx`, an async server
 * component that runs for every authenticated route and already hands `AppShell`
 * server-owned values. One boundary, no new endpoint, and no client fetch
 * waterfall pulling five collections into the browser to compute a badge.
 *
 * WHAT CROSSES THE BOUNDARY, AND WHY IT IS THE DERIVED LIST. The alternative was
 * shipping the five source collections to the client and deriving there, which
 * would put every student, lesson and bill in the page payload to render at most
 * twenty rows. The active set is the smaller, narrower thing, and it carries no
 * field a notification does not need.
 *
 * WHAT DOES NOT CROSS IT. Device-local read and dismiss state, which the server
 * cannot know and must not guess — it lives in `localStorage` and is applied by
 * `presentNotifications` in the browser. The split is exactly the one Gate 2
 * designed: `deriveNotifications` here, `presentNotifications` there.
 *
 * THIS READS AND NEVER WRITES. `getAll` is the application's existing read-only
 * accessor and derivation is a pure function over what it returns; no notification
 * interaction reaches this module at all.
 */

import "server-only";

import { deriveNotifications } from "./notifications";
import type { AppNotification } from "./notifications";
import { getAll } from "./repo";

/** The whole active set, ordered and deduped — uncapped, and with no
 * acknowledgement applied.
 *
 * IT REUSES `getAll` RATHER THAN ADDING A SIXTH QUERY. `getAll` reads four
 * collections this does not need (parents, attendance, homework, activity), and
 * that over-read is the deliberate price of adding no second copy of the
 * application's domain fetching — which is what a hand-rolled five-collection
 * projection here would be. The dataset is small, the layout runs once per full
 * page load rather than per client-side navigation, and a narrower reader can be
 * introduced the day that stops being true without changing anything above. */
export async function getActiveNotifications(): Promise<AppNotification[]> {
  const { students, classes, lessons, billing, reviews } = await getAll();
  return deriveNotifications({ students, classes, lessons, billing, reviews });
}
