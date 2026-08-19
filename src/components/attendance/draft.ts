/* The Take attendance screen's local draft state, as pure functions.
 *
 * WHY THIS IS NOT INLINE IN THE PAGE. The register is the only screen in the app
 * that holds substantial unsaved state, and the rules it follows are real ones:
 * "Mark all present" must not touch notes, editing one row must not touch
 * another, and dirtiness must be measured against what the server last confirmed
 * rather than against whatever was last typed. Rules that matter are rules worth
 * testing, and a reducer buried in a component is reachable only by rendering it.
 * Here they are ordinary functions over ordinary values.
 *
 * Every function returns a NEW draft rather than mutating one, so React sees a
 * changed reference and the page needs no other state discipline.
 */

import type { RegisterRow, SubmittedEntry } from "@/lib/attendance";
import type { AttendanceStatus } from "@/lib/types";

/** One row's editable state. Exactly what the API accepts back. */
export interface DraftEntry {
  status: AttendanceStatus;
  note: string;
}

export type Draft = Record<string, DraftEntry>;

/** The draft a freshly loaded register starts at — the server's rows, verbatim. */
export function draftFrom(rows: readonly RegisterRow[]): Draft {
  const out: Draft = {};
  for (const r of rows) out[r.id] = { status: r.status, note: r.note };
  return out;
}

/** A stable string for "what the server says this register is".
 *
 * The page compares THIS rather than the response object, so a refetch that
 * returns an unchanged register does not discard a teacher's unsaved edits.
 * Only genuinely different server data resets the form. */
export function signatureOf(rows: readonly RegisterRow[]): string {
  return JSON.stringify(rows.map((r) => [r.id, r.status, r.note]));
}

/** Does the draft differ from the baseline the server last confirmed?
 *
 * Measured over the VISIBLE rows only. A key that somehow lingers in the draft
 * for a row the server no longer sends is not a change a teacher can see, and
 * cannot make the save button claim there is something to save. */
export function isDirty(rows: readonly RegisterRow[], draft: Draft, baseline: Draft): boolean {
  return rows.some((r) => {
    const a = draft[r.id];
    const b = baseline[r.id];
    return !a || !b || a.status !== b.status || a.note !== b.note;
  });
}

/** Set one row's status. The row keeps its note; every other row is untouched. */
export function withStatus(draft: Draft, id: string, status: AttendanceStatus): Draft {
  return { ...draft, [id]: { status, note: draft[id]?.note ?? "" } };
}

/** Set one row's note. The row keeps its status; every other row is untouched. */
export function withNote(draft: Draft, id: string, note: string): Draft {
  return { ...draft, [id]: { status: draft[id]?.status ?? "Present", note } };
}

/** "Mark all present" — every VISIBLE row goes Present.
 *
 * NOTES SURVIVE. The button is about who turned up, not about erasing what the
 * teacher wrote; a note explaining why someone was late is still true after the
 * status is corrected, and silently deleting it would be the screen editing a
 * person's words. Hidden entries are not in this state at all, so they cannot be
 * reached from here even in principle. */
export function withAllPresent(draft: Draft, rows: readonly RegisterRow[]): Draft {
  const next: Draft = { ...draft };
  for (const r of rows) next[r.id] = { status: "Present", note: draft[r.id]?.note ?? r.note };
  return next;
}

/** The payload to POST: the COMPLETE visible register, never a diff. A register
 * is a statement about everyone in the room. */
export function submitFrom(rows: readonly RegisterRow[], draft: Draft): Record<string, SubmittedEntry> {
  const entries: Record<string, SubmittedEntry> = {};
  for (const r of rows) entries[r.id] = draft[r.id] ?? { status: r.status, note: r.note };
  return entries;
}
