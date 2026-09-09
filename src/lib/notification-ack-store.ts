"use client";

/* Notifications — the React binding for device-local acknowledgement.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `lib/notification-state` is pure: parsing,
 * transitions and the view, all driven with plain values and testable with no
 * browser. This is the small stateful shell around it — the cached snapshot and
 * the listener set React needs — kept apart so the pure half stays pure.
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT. Acknowledgement is owned by the
 * browser, not by React, which is the same situation `SettingsProvider` is in and
 * this mirrors its solution deliberately. Seeding from `localStorage` in a
 * `useState` initialiser renders the stored value DURING hydration and mismatches
 * the server's HTML — here that is the unread badge, which the server always
 * renders as "everything unread". Assigning it in an effect instead is the
 * cascading-render pattern React now warns about. `useSyncExternalStore` is the
 * one answer that is neither: the server and the hydrating render both see
 * `EMPTY_ACKNOWLEDGEMENT`, React re-reads the store immediately afterwards, and
 * the badge settles in the following commit.
 *
 * NOTHING FLASHES VISIBLY. The panel is closed on that first render, so the only
 * thing that can change is the badge count, and it settles before it can be read.
 * The alternative — hiding the bell until storage is readable — would be a second
 * readiness gate beside `AppShell`'s, for a number.
 *
 * THIS IS NOT A GLOBAL APP STORE. It holds one value for one component, and the
 * business transitions all still live in `lib/notification-state`; this only
 * caches, publishes and persists. It is deliberately NOT part of
 * `SettingsProvider` — acknowledgement is per-item state, not a preference, and
 * putting it there would have made it a tenth setting by accident.
 */

import {
  EMPTY_ACKNOWLEDGEMENT,
  persistAcknowledgement,
  readStoredAcknowledgement,
} from "./notification-state";
import type { AcknowledgementState } from "./notification-state";

const listeners = new Set<() => void>();

/** Client-only cache. `useSyncExternalStore` compares snapshots by reference, so
 * the same object must come back until a setter replaces it. */
let cached: AcknowledgementState | null = null;

export function subscribeAcknowledgement(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => { listeners.delete(onStoreChange); };
}

export function getAcknowledgementSnapshot(): AcknowledgementState {
  if (!cached) cached = readStoredAcknowledgement();
  return cached;
}

/** The server — and the hydrating render — see nothing acknowledged, because the
 * server genuinely cannot know. THE object, not a copy, so the reference test in
 * `SettingsProvider`'s style would work here too if a caller ever needed it. */
export function getAcknowledgementServerSnapshot(): AcknowledgementState {
  return EMPTY_ACKNOWLEDGEMENT;
}

/** Persist a new state and publish it. The one writer, so a caller can never
 * update the snapshot and forget the browser, or the reverse. */
export function commitAcknowledgement(next: AcknowledgementState): void {
  persistAcknowledgement(next);
  cached = next;
  for (const notify of listeners) notify();
}
