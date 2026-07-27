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
import { CLASS_PALETTE } from "./constants";
import { hash } from "./calc";
import type { Klass } from "./types";
import type { ClassInput } from "./schemas";

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

/* ---------------------------------------------------------------------- CRUD */

export async function createClass(input: ClassInput): Promise<Klass> {
  await dbConnect();
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
