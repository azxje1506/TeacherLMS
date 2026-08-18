/* Classes — server-side data access and derivation.
 *
 * The Class record carries the same derived display field the imported design's
 * seed does (`color`), computed here on write so every card renders without a
 * join. A Class owns its own data — name, type, level, fee, classroom, status,
 * schedule, notes and the `studentIds` enrolment array. Enrolment (assign /
 * remove) is a LATER sprint: this module never mutates `studentIds` through the
 * form (updates preserve the existing array untouched) and never writes the
 * legacy `Student.classes` count (PROJECT_RULES: data ownership).
 *
 * Identifier: new classes use a MongoDB ObjectId as their identity — the `id`
 * field is populated from `_id.toString()`, exactly as Parents do. Seeded `c1…`
 * records keep their string ids untouched. Ids are never sequential.
 *
 * Querying (search / sort / paginate) lives here too so the Route Handler stays
 * thin. The design's list has no pager and no sortable headers, so the screen
 * renders one page at the default sort and adds no chrome of its own.
 */

import "server-only";
import { dbConnect } from "./db";
import { ClassModel, StudentModel, mongoose } from "./models";
import {
  CLASS_PALETTE, DOW_FULL, SUGGESTION_MAX, SUGGESTION_STEP_MINUTES,
  TEACHING_DAY_END, TEACHING_DAY_START,
} from "./constants";
import { fromMinutes, hash, overlaps, toMinutes } from "./calc";
import { createFormat } from "./format";
import {
  formatReconcileReport, hasTeachingHistory, readTeachingHistory, reconcileClass,
  type ReconcileReport, type TeachingHistory,
} from "./reconciler";
import { isTeachingClass, TEACHING_CLASS_STATUSES } from "./recurrence";
import { advanceLessonLifecycle } from "./lifecycle";
import type { Klass, ScheduleAvailability, ScheduleConflict, Student } from "./types";
import { SLOT_MAX_MINUTES, SLOT_MIN_MINUTES, type ClassInput } from "./schemas";

const clean = "-_id -__v";

/** Sort keys the API accepts. `name` is the default the list renders at. */
export const CLASS_SORT_KEYS = ["name", "type", "status", "fee"] as const;
export type ClassSortKey = (typeof CLASS_SORT_KEYS)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/* ---------------------------------------------------------------- derivation */

/** Stable card tint derived from the id, so a class keeps one colour. */
function colorFor(id: string): string {
  return CLASS_PALETTE[hash(id) % CLASS_PALETTE.length];
}

/** Canonical form of a free-text classroom name, applied on every write so
 * " room a ", "ROOM A" and "Room  A" cannot become three different rooms:
 *
 *  - trim, then collapse runs of whitespace to a single space;
 *  - title-case each purely alphabetic word (so "ROOM"/"room" → "Room").
 *
 * Words that are not purely letters are left exactly as typed — "1B", "A2" and
 * "B1" are identifiers, and lower-casing their tail would corrupt them. There is
 * deliberately no Room entity: a classroom is a Class-owned string, and the
 * drawer's suggestions are derived from the classes that already use one. */
export function normalizeClassroom(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .map((w) => (/^\p{L}+$/u.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Fold a validated form payload into a full Class record.
 *
 * `studentIds` is enrolment data owned by a later sprint: on create it starts
 * empty; on update it is carried over from the existing record and never taken
 * from the form (the create/edit drawer has no student picker by design). */
function applyInput(input: ClassInput, id: string, color: string, base: Partial<Klass>): Klass {
  return {
    id,
    name: input.name.trim(),
    type: input.type,
    level: (input.level ?? "").trim(),
    fee: input.fee,
    classroom: normalizeClassroom(input.classroom),
    status: input.status,
    studentIds: base.studentIds ?? [],
    notes: (input.notes ?? "").trim(),
    schedule: input.schedule.map((s) => ({ day: s.day, start: s.start, duration: s.duration })),
    color,
  };
}

/* -------------------------------------------------------------------- queries */

export interface ClassQuery {
  q?: string;
  status?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

/** A class row plus its enrolled-student count (the length of the class-owned
 * `studentIds` array — no Student lookup, so no cross-entity read). */
export interface ClassRow extends Klass {
  studentCount: number;
}

export interface ClassListResult {
  rows: ClassRow[];
  total: number;
  page: number;
  pageSize: number;
}

function collator() {
  return new Intl.Collator("en", { sensitivity: "base", numeric: true });
}

/** Read the class list, filtered / sorted / paginated. */
export async function listClasses(query: ClassQuery = {}): Promise<ClassListResult> {
  await dbConnect();
  const all = await ClassModel.find().select(clean).lean<Klass[]>();

  // ---- search: class name, level, classroom and enrolled student names ----
  // Student is the owner of its own name (PROJECT_RULES: data ownership), so a
  // student match is resolved by reading Students and intersecting the class's
  // `studentIds` — never by copying names onto the Class record.
  const q = (query.q ?? "").trim().toLowerCase();
  let rows = all.slice();
  if (q) {
    const matchedStudents = new Set(
      (await StudentModel.find().select("id name first last -_id")
        .lean<Array<Pick<Student, "id" | "name" | "first" | "last">>>())
        .filter((s) => [s.name, s.first, s.last].some((f) => String(f ?? "").toLowerCase().includes(q)))
        .map((s) => s.id)
    );
    rows = all.filter(
      (c) =>
        [c.name, c.level, c.classroom].some((f) => String(f ?? "").toLowerCase().includes(q)) ||
        (c.studentIds ?? []).some((id) => matchedStudents.has(id))
    );
  }

  // ---- filter: status chip (All / Active / Ended / Archived) ----
  // Compared as data against whatever the chip sent, so the set of statuses lives
  // in CLASS_STATUSES alone and this line never needed changing to gain one.
  const status = query.status ?? "";
  if (status && status !== "All") rows = rows.filter((c) => c.status === status);

  // ---- sort ----
  const sort = (CLASS_SORT_KEYS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as ClassSortKey)
    : "name";
  const dir = query.dir === "desc" ? -1 : 1;
  const cmp = collator();
  rows.sort((a, b) => {
    let r: number;
    if (sort === "fee") r = Number(a.fee) - Number(b.fee);
    else r = cmp.compare(String(a[sort] ?? ""), String(b[sort] ?? ""));
    // Stable, predictable tiebreak so paging never repeats or drops a row.
    return (r || cmp.compare(a.name, b.name) || cmp.compare(a.id, b.id)) * dir;
  });

  // ---- paginate ----
  const total = rows.length;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize).map((c) => ({ ...c, studentCount: c.studentIds?.length ?? 0 })),
    total,
    page,
    pageSize,
  };
}

/** Every classroom already in use, normalized and de-duplicated — the source
 * behind the drawer's classroom suggestions. Derived from the Class records
 * themselves, so no Room entity exists and nothing has to be maintained: a name
 * appears as soon as one class uses it and disappears when the last one stops. */
export async function listClassrooms(): Promise<string[]> {
  await dbConnect();
  const rows = await ClassModel.find().select("classroom -_id").lean<Array<{ classroom?: string }>>();
  const byKey = new Map<string, string>();
  for (const r of rows) {
    const name = normalizeClassroom(r.classroom);
    if (name) byKey.set(name.toLowerCase(), name);
  }
  const cmp = collator();
  return [...byKey.values()].sort((a, b) => cmp.compare(a, b));
}

export async function getClass(id: string): Promise<Klass | null> {
  await dbConnect();
  return (await ClassModel.findOne({ id }).select(clean).lean<Klass>()) ?? null;
}

/* --------------------------------------------------- schedule conflicts */

/** Thrown when a class's Active schedule overlaps another Active class's. The
 * Route Handlers map this to HTTP 409.
 *
 * `conflict` carries the clash as data (which class, which weekday, which times)
 * so the client can render the message in the user's language through the i18n
 * dictionary. `message` stays a readable English sentence for API consumers and
 * logs — it is a fallback, never what the UI shows. */
export class ScheduleConflictError extends Error {
  readonly conflict: ScheduleConflict;

  constructor(message: string, conflict: ScheduleConflict) {
    super(message);
    this.name = "ScheduleConflictError";
    this.conflict = conflict;
  }
}

/** Single-teacher rule: no two **teaching** classes may share an overlapping
 * weekly slot (same weekday + overlapping time range). Rejects the create/update
 * when the incoming schedule clashes with any OTHER teaching class.
 *
 * - Only classes that are TEACHING participate (`TEACHING_CLASS_STATUSES` —
 *   Active alone). Ending or archiving a class therefore RELEASES its slots: it
 *   can no longer conflict with anything, and nothing conflicts with it. That is
 *   deliberate for both, and for the same reason — a class that is not teaching
 *   has no claim on the teacher's Tuesday evening — but the consequence is worth
 *   naming: reopening an Ended class, or restoring an Archived one, is re-checked
 *   against everything that moved in meanwhile and can be rejected with 409.
 * - The class being updated is excluded by id.
 * - Overlap reuses calc.overlaps (the interval test `startA < endB && endA >
 *   startB`), so back-to-back slots (end === next start) do NOT conflict.
 * - O(other teaching classes × slots); per-class slot counts are tiny. */
async function assertNoScheduleConflict(id: string | null, input: ClassInput): Promise<void> {
  if (!isTeachingClass(input.status)) return; // a class that isn't teaching can't conflict
  await dbConnect();
  const others = await ClassModel.find({
    status: { $in: [...TEACHING_CLASS_STATUSES] },
    ...(id ? { id: { $ne: id } } : {}),
  })
    .select("id name level schedule -_id")
    .lean<Array<Pick<Klass, "id" | "name" | "level" | "schedule">>>();

  const fmt = createFormat();
  for (const other of others) {
    for (const a of input.schedule) {
      for (const b of other.schedule ?? []) {
        if (a.day === b.day && overlaps(a.start, a.duration, b.start, b.duration)) {
          const end = fromMinutes(toMinutes(b.start) + b.duration);
          // The English sentence is the API/log fallback; the UI re-renders this
          // from `conflict` in the user's language (see class-ui.conflictMessage).
          throw new ScheduleConflictError(
            `Schedule conflicts with class '${other.name}' (${DOW_FULL[b.day]} ${fmt.range(b.start, end)}).`,
            {
              classId: other.id,
              name: other.name,
              level: other.level ?? "",
              day: b.day,
              start: b.start,
              end,
            }
          );
        }
      }
    }
  }
}

/* ------------------------------------------------ schedule availability */

/** Query behind the drawer's "Suggested available times". Everything arrives as
 * a raw query string and is sanitised here, so the Route Handler stays thin. */
export interface AvailabilityQuery {
  /** Weekdays to check, comma separated, e.g. "1,3,5". */
  days?: string;
  /** The proposed start ("HH:MM"). Omit to skip the conflict check. */
  start?: string;
  /** The proposed length in minutes (To − From). */
  duration?: string;
  /** The class being edited — excluded from its own conflict check. */
  excludeId?: string;
}

/** Read-only scheduling aid for the create/edit drawer. Answers two questions
 * for a proposed set of weekdays at one time range:
 *
 * - `conflicts` — which OTHER teaching classes already occupy that range. This is
 *   a preview of assertNoScheduleConflict (same `overlaps` test, same
 *   teaching-only rule), never a replacement: the API still rejects a clashing
 *   save with 409. An Ended or Archived class is not shown as a conflict because
 *   it does not hold its slot.
 * - `suggestions` — free windows of the same length, shared by EVERY requested
 *   weekday, inside the teaching-day window. Candidates are the earliest and the
 *   latest start of each free run, ranked by nearness to what the teacher typed. */
export async function scheduleAvailability(q: AvailabilityQuery = {}): Promise<ScheduleAvailability> {
  const empty: ScheduleAvailability = { conflicts: [], suggestions: [] };

  const days = [...new Set(
    String(q.days ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d !== "") // an empty param means "no weekdays", not Sunday
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  )];
  const duration = Number(q.duration);
  if (days.length === 0) return empty;
  if (!Number.isFinite(duration) || duration < SLOT_MIN_MINUTES || duration > SLOT_MAX_MINUTES) return empty;

  await dbConnect();
  const others = await ClassModel.find({
    status: { $in: [...TEACHING_CLASS_STATUSES] },
    ...(q.excludeId ? { id: { $ne: q.excludeId } } : {}),
  })
    .select("id name level schedule -_id")
    .lean<Array<Pick<Klass, "id" | "name" | "level" | "schedule">>>();

  // ---- what is already taught on each requested weekday ----
  const start = String(q.start ?? "");
  const busy = new Map<number, Array<[number, number]>>(days.map((d) => [d, []]));
  const conflicts: ScheduleConflict[] = [];
  for (const other of others) {
    for (const s of other.schedule ?? []) {
      const day = busy.get(s.day);
      if (!day) continue;
      const from = toMinutes(s.start);
      day.push([from, from + s.duration]);
      if (start && overlaps(start, duration, s.start, s.duration)) {
        conflicts.push({
          classId: other.id,
          name: other.name,
          level: other.level ?? "",
          day: s.day,
          start: s.start,
          end: fromMinutes(from + s.duration),
        });
      }
    }
  }
  conflicts.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

  // ---- free runs shared by every requested weekday ----
  const open = toMinutes(TEACHING_DAY_START);
  const close = toMinutes(TEACHING_DAY_END);
  const step = SUGGESTION_STEP_MINUTES;
  const taken = (at: number) =>
    days.some((d) => (busy.get(d) ?? []).some(([s, e]) => at < e && s < at + duration));

  const candidates: number[] = [];
  let runFirst: number | null = null;
  let runLast: number | null = null;
  const closeRun = () => {
    if (runFirst !== null) candidates.push(runFirst);
    if (runLast !== null && runLast !== runFirst) candidates.push(runLast);
    runFirst = null;
    runLast = null;
  };
  for (let at = Math.ceil(open / step) * step; at + duration <= close; at += step) {
    if (taken(at)) { closeRun(); continue; }
    if (runFirst === null) runFirst = at;
    runLast = at;
  }
  closeRun();

  const proposed = start ? toMinutes(start) : NaN;
  const ranked = [...new Set(candidates)]
    .filter((at) => at !== proposed)
    .sort((a, b) =>
      Number.isFinite(proposed) ? Math.abs(a - proposed) - Math.abs(b - proposed) || a - b : a - b
    )
    .slice(0, SUGGESTION_MAX)
    .sort((a, b) => a - b);

  return {
    conflicts,
    suggestions: ranked.map((at) => ({ start: fromMinutes(at), end: fromMinutes(at + duration) })),
  };
}

/* ---------------------------------------------------------------------- CRUD */

export async function createClass(input: ClassInput): Promise<Klass> {
  await dbConnect();
  await assertNoScheduleConflict(null, input);
  // Identity is a MongoDB ObjectId; the string `id` mirrors it (id =
  // _id.toString()), exactly as Parents do. Never sequential.
  const _id = new mongoose.Types.ObjectId();
  const id = _id.toString();
  const doc = applyInput(input, id, colorFor(id), {});
  await ClassModel.create({ _id, ...doc });
  return doc;
}

/** Update in place; returns null when the id is unknown. Preserves the class's
 * `studentIds` (enrolment is a later sprint) and its stable colour.
 *
 * SCHEDULE RECONCILIATION (RECURRENCE_DESIGN §5.7, ADR-002 decision 5). This is
 * the one and only write-side reconciliation trigger: editing the schedule is
 * where the teacher's INTENT changes, so it is where the future lessons derived
 * from that intent are corrected. Before this existed, a schedule edit forked the
 * series and the old one was never reachable again (§1.4).
 *
 * NO STATUS CHANGE IS A SEPARATE TRIGGER — archive, restore, end and reopen all
 * arrive here as ordinary updates with `status` swapped, and the reconciler's own
 * rules settle every one of them:
 *
 *  - **Archive** plans nothing and destroys nothing: an Archived class is outside
 *    reconciliation entirely (§5.8, ADR-002), so its future lessons stay put.
 *  - **Restore** makes the class Active again, so the same pass that corrects a
 *    schedule edit refills its window.
 *  - **End** (Active → Ended) is planned against an empty schedule, so every
 *    future reconcilable Regular lesson FROM NEXT MONTH ON comes back as a retire
 *    and is executed here — the one-shot clearing of the class's future, done by
 *    the reconciler rather than by a second delete path bolted onto this function.
 *    The current calendar month is out of scope on purpose (see `planClass`):
 *    deleting its lessons would inflate what that month reports as revenue.
 *    Nothing already taught is in scope either — the past cannot enter a plan
 *    (§4), and cancelled, attended, homeworked and rescheduled lessons are frozen.
 *    A lesson carrying teacher's notes is STRANDED rather than retired (§5.9) — it
 *    survives the transition on purpose, and is reported for a person to resolve.
 *  - **Reopen** (Ended → Active) restores live intent; the next read-side top-up
 *    and this same pass regenerate the window from the current schedule. Retired
 *    lessons are not resurrected individually — they are re-derived, which is what
 *    makes the round trip work without storing a tombstone for every deletion.
 *
 * This is why the transition needs no dedicated endpoint: the status is data, and
 * the consequences of changing it are already expressed as reconciliation.
 *
 * SEPARATELY FROM RECONCILIATION, and BEFORE the new status is written, this
 * function resolves the lesson lifecycle (`advanceLessonLifecycle`,
 * src/lib/lifecycle.ts). That is what makes Archive → Restore deterministic: a
 * lesson whose date passed while the class was Archived is settled as `Cancelled`
 * while that status is still stored, so restoring can never turn it into
 * recognised revenue. See the comment at the call site for why the order is
 * load-bearing.
 *
 * The class write is authoritative and already committed when reconciliation
 * runs. A reconciliation that ABORTS (§6 Phase 4 — the plan disagreed with the
 * stored data) therefore must not fail the request: the schedule the teacher
 * typed is saved either way, the lessons are simply left as they were, and the
 * violations are logged for a person to read. Failing the PATCH would report a
 * lost edit that was not lost, and would offer the teacher no way forward. */
export async function updateClass(id: string, input: ClassInput): Promise<Klass | null> {
  await dbConnect();
  const existing = await ClassModel.findOne({ id }).select(clean).lean<Klass>();
  if (!existing) return null;
  await assertNoScheduleConflict(id, input);
  const doc = applyInput(input, id, existing.color, existing);

  // RESOLVE THE LESSON LIFECYCLE FIRST, WHILE THE OLD STATUS IS STILL STORED.
  //
  // `advanceLessonLifecycle` reads the class's status when it RUNS, not when the
  // lesson's date passed. Archive a class, let one of its lesson dates go by, and
  // open the app for the first time only after a Restore: that lesson would be
  // judged against an Active class and become `Completed`, recognising revenue for
  // a session nobody taught. Resolving here — before the status is overwritten —
  // removes the window without needing an `archivedAt` field, because the only
  // thing that can change the answer is a status change and every status change
  // resolves first. This function is the sole writer of `Class.status`, so the one
  // hook is total.
  //
  // It runs on every update, not only on a status change: an update that leaves
  // the status alone resolves the same lessons to the same values, so the extra
  // pass is a no-op rather than a special case someone has to remember to trigger.
  //
  // Failure is logged and the update proceeds, matching how a failed
  // reconciliation is handled below: the class write is what the teacher asked for
  // and is authoritative, and refusing it would report a lost edit that was not
  // lost. The log names the consequence so the failure is never silent.
  try {
    await advanceLessonLifecycle(id);
  } catch (e) {
    console.error(
      `[lifecycle] failed for class ${id} before a ${existing.status} -> ${input.status} change;` +
      " past Upcoming lessons will be resolved against the NEW status on the next pass",
      e
    );
  }

  await ClassModel.updateOne({ id }, { $set: doc });

  let report: ReconcileReport | null = null;
  try {
    report = await reconcileClass(id);
  } catch (e) {
    console.error("[reconcile] failed for class", id, e);
  }
  if (report?.outcome === "aborted") console.error(formatReconcileReport(report));
  else if (report && report.summary.update + report.summary.insert +
      report.summary.retire + report.summary.strand > 0) {
    console.log(formatReconcileReport(report));
  }

  return doc;
}

/** Patch only the free-text notes (the detail's Teacher notes card). */
export async function updateClassNotes(id: string, notes: string): Promise<Klass | null> {
  await dbConnect();
  const res = await ClassModel.findOneAndUpdate({ id }, { $set: { notes } }, { returnDocument: "after" })
    .select(clean)
    .lean<Klass>();
  return res ?? null;
}

/** Why a delete was refused, so the Route Handler can map it to a status. */
export type ClassDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_history"; history: TeachingHistory };

/** Delete the Class record only — and only when the class has never taught.
 *
 * BLOCKED whenever the class holds any past lesson, attendance record or billing
 * record (RECURRENCE_DESIGN §2, "Delete entire class"). **Ending or archiving is
 * the only supported way to retire a class that has taught anything** — End when
 * the teaching is genuinely over, Archive to get it out of the working list.
 *
 * The reason is that this delete has no cascade and never will: it removes the
 * Class row and leaves every lesson behind, orphaned. Those lessons then render
 * `className: "—"` and drop out of revenue *silently*, because `computeRevenue`
 * iterates classes and a lesson whose class is gone is never visited — history
 * that was already shown to a teacher or a parent changes with nothing written to
 * explain it. 18 such lessons already exist in the live data; the guard prevents
 * new ones and deliberately does nothing about those (§6, "Not in scope").
 *
 * Hard delete survives for a class that has never taught: no lessons at all, or
 * future Upcoming ones only. Students, Lessons, Attendance and Finance records
 * are still never touched (PROJECT_RULES / Sprint 4 scope). */
export async function deleteClass(id: string): Promise<ClassDeleteResult> {
  await dbConnect();
  const existing = await ClassModel.findOne({ id }).select("id -_id").lean();
  if (!existing) return { ok: false, reason: "not_found" };

  const history = await readTeachingHistory(id);
  if (hasTeachingHistory(history)) return { ok: false, reason: "has_history", history };

  const res = await ClassModel.deleteOne({ id });
  if (res.deletedCount === 0) return { ok: false, reason: "not_found" };
  return { ok: true };
}
