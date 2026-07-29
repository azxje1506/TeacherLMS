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
import { ClassModel, mongoose } from "./models";
import {
  CLASS_PALETTE, DOW_FULL, SUGGESTION_MAX, SUGGESTION_STEP_MINUTES,
  TEACHING_DAY_END, TEACHING_DAY_START,
} from "./constants";
import { fromMinutes, hash, overlaps, toMinutes } from "./calc";
import { createFormat } from "./format";
import type { Klass, ScheduleAvailability, ScheduleConflict } from "./types";
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
    classroom: (input.classroom ?? "").trim(),
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

  // ---- search: name, level, classroom (matches the design's placeholder) ----
  const q = (query.q ?? "").trim().toLowerCase();
  let rows = q
    ? all.filter((c) =>
        [c.name, c.level, c.classroom].some((f) => String(f ?? "").toLowerCase().includes(q))
      )
    : all.slice();

  // ---- filter: status chip (All / Active / Archived) ----
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

/** Single-teacher rule: no two **Active** classes may share an overlapping
 * weekly slot (same weekday + overlapping time range). Rejects the create/update
 * when the incoming schedule clashes with any OTHER Active class.
 *
 * - Only Active classes participate — archiving a class never conflicts, and
 *   archived classes are ignored as candidates.
 * - The class being updated is excluded by id.
 * - Overlap reuses calc.overlaps (the interval test `startA < endB && endA >
 *   startB`), so back-to-back slots (end === next start) do NOT conflict.
 * - O(other Active classes × slots); per-class slot counts are tiny. */
async function assertNoScheduleConflict(id: string | null, input: ClassInput): Promise<void> {
  if (input.status !== "Active") return; // an archived class can't conflict
  await dbConnect();
  const others = await ClassModel.find({
    status: "Active",
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
            `Schedule conflicts with class '${other.name}' (${DOW_FULL[b.day]} ${fmt.time12(b.start)} – ${fmt.time12(end)}).`,
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
 * - `conflicts` — which OTHER Active classes already occupy that range. This is
 *   a preview of assertNoScheduleConflict (same `overlaps` test, same Active-only
 *   rule), never a replacement: the API still rejects a clashing save with 409.
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
    status: "Active",
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
 * `studentIds` (enrolment is a later sprint) and its stable colour. */
export async function updateClass(id: string, input: ClassInput): Promise<Klass | null> {
  await dbConnect();
  const existing = await ClassModel.findOne({ id }).select(clean).lean<Klass>();
  if (!existing) return null;
  await assertNoScheduleConflict(id, input);
  const doc = applyInput(input, id, existing.color, existing);
  await ClassModel.updateOne({ id }, { $set: doc });
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

/** Delete the Class record only. Students, Lessons, Attendance and Finance
 * records are never touched (PROJECT_RULES / Sprint 4 scope). */
export async function deleteClass(id: string): Promise<boolean> {
  await dbConnect();
  const res = await ClassModel.deleteOne({ id });
  return res.deletedCount > 0;
}
