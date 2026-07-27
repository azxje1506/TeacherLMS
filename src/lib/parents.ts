/* Parents — server-side data access and derivation.
 *
 * The Parent record carries the same derived display fields the imported design's
 * seed does (initials, color), computed here on write so every row renders
 * without a join. Parent is the source of truth for parent data; Students only
 * reference it by `parentId` (see PROJECT_RULES.md).
 *
 * Identifier: new parents use a MongoDB ObjectId as their identity — the `id`
 * field is populated from `_id.toString()`. The `id` field is kept only as a
 * compatibility layer for the existing application (seeded `p1…` records and the
 * Student.parentId references remain valid, string-keyed, and untouched).
 *
 * Querying (search / sort / paginate) lives here too so the Route Handler stays
 * thin. The design's roster has no pager and no sortable headers, so the list
 * screen renders one page at the default sort and adds no chrome of its own.
 */

import "server-only";
import { dbConnect } from "./db";
import { ParentModel, StudentModel, mongoose } from "./models";
import { AVATAR_PALETTE } from "./constants";
import type { Parent } from "./types";
import type { ParentInput } from "./schemas";

const clean = "-_id -__v";

/** Sort keys the API accepts. `name` is the default the roster renders at. */
export const PARENT_SORT_KEYS = ["name", "relationship"] as const;
export type ParentSortKey = (typeof PARENT_SORT_KEYS)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/* ---------------------------------------------------------------- derivation */

/** Up to two initials from the full name (e.g. "Jennifer Chen" -> "JC"). */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();
}

/** Stable avatar tint derived from the id, so a parent keeps one colour. */
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

/** Fold a validated form payload into a full Parent record. */
function applyInput(input: ParentInput, id: string, color: string): Parent {
  const name = input.name.trim();
  return {
    id,
    name,
    relationship: input.relationship,
    phone: input.phone.trim(),
    email: (input.email ?? "").trim(),
    notes: (input.notes ?? "").trim(),
    initials: initialsFor(name),
    color,
  };
}

/* -------------------------------------------------------------------- queries */

export interface ParentQuery {
  q?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

/** A parent row plus its live linked-student count (computed, never stored). */
export interface ParentRow extends Parent {
  childCount: number;
}

export interface ParentListResult {
  rows: ParentRow[];
  total: number;
  page: number;
  pageSize: number;
}

function collator() {
  return new Intl.Collator("en", { sensitivity: "base", numeric: true });
}

/** Count of students currently linked to each parent id. */
async function childCounts(): Promise<Map<string, number>> {
  const students = await StudentModel.find().select("parentId -_id").lean<{ parentId?: string | null }[]>();
  const counts = new Map<string, number>();
  for (const s of students) {
    if (s.parentId) counts.set(s.parentId, (counts.get(s.parentId) ?? 0) + 1);
  }
  return counts;
}

/** Read the parents list, filtered / sorted / paginated. */
export async function listParents(query: ParentQuery = {}): Promise<ParentListResult> {
  await dbConnect();
  const [all, counts] = await Promise.all([
    ParentModel.find().select(clean).lean<Parent[]>(),
    childCounts(),
  ]);

  // ---- search: name, email, phone (matches the design's placeholder) ----
  const q = (query.q ?? "").trim().toLowerCase();
  const rows = q
    ? all.filter((p) =>
        [p.name, p.email, p.phone].some((f) => String(f ?? "").toLowerCase().includes(q))
      )
    : all.slice();

  // ---- sort ----
  const sort = (PARENT_SORT_KEYS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as ParentSortKey)
    : "name";
  const dir = query.dir === "desc" ? -1 : 1;
  const cmp = collator();
  rows.sort((a, b) => {
    const r = cmp.compare(String(a[sort] ?? ""), String(b[sort] ?? ""));
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
    rows: rows.slice(start, start + pageSize).map((p) => ({ ...p, childCount: counts.get(p.id) ?? 0 })),
    total,
    page,
    pageSize,
  };
}

export async function getParent(id: string): Promise<Parent | null> {
  await dbConnect();
  return (await ParentModel.findOne({ id }).select(clean).lean<Parent>()) ?? null;
}

/* ---------------------------------------------------------------------- CRUD */

export async function createParent(input: ParentInput): Promise<Parent> {
  await dbConnect();
  // Identity is a MongoDB ObjectId. The string `id` mirrors it (id =
  // _id.toString()) ONLY as a TEMPORARY compatibility layer for the existing
  // Students module, which references parents by the string `id` (e.g. "p1").
  // This mirroring should be removed in a future technical refactor that moves
  // those references onto the ObjectId `_id` directly.
  const _id = new mongoose.Types.ObjectId();
  const id = _id.toString();
  const doc = applyInput(input, id, colorFor(id));
  await ParentModel.create({ _id, ...doc });
  return doc;
}

/** Update in place; returns null when the id is unknown. Never writes to Student
 * records — a rename does NOT propagate into the legacy `parentName` copy. */
export async function updateParent(id: string, input: ParentInput): Promise<Parent | null> {
  await dbConnect();
  const existing = await ParentModel.findOne({ id }).select(clean).lean<Parent>();
  if (!existing) return null;
  const doc = applyInput(input, id, existing.color); // colour stays stable across edits
  await ParentModel.updateOne({ id }, { $set: doc });
  return doc;
}

/** Delete a parent and unassign its students. Students are never deleted; the
 * only legacy synchronisation allowed is clearing their link so the UI shows
 * Unassigned immediately. Both fields are set to "" to match the Students
 * module's existing representation of "no parent" (its schema default), so we
 * never introduce a second empty form (null) alongside it. */
export async function deleteParent(id: string): Promise<boolean> {
  await dbConnect();
  const res = await ParentModel.deleteOne({ id });
  if (res.deletedCount === 0) return false;
  await StudentModel.updateMany({ parentId: id }, { $set: { parentId: "", parentName: "" } });
  return true;
}
