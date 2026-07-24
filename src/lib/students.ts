/* Students — server-side data access and derivation.
 *
 * The Student record stored in Mongo carries derived display fields (name,
 * initials, age, gradeLabel, parentName, avatarColor) exactly as the imported
 * design's seed does, so every screen can render a row without joining. This
 * module is the single place those fields are computed on write.
 *
 * Querying (search / filter / sort / paginate) happens here too so the Route
 * Handler stays thin. Sort and pagination are API-level capabilities: the
 * imported design's roster has no pager and no sortable headers, so the list
 * screen renders one page at the default sort and adds no chrome of its own.
 */

import "server-only";
import { dbConnect } from "./db";
import { StudentModel, ParentModel } from "./models";
import { AVATAR_PALETTE, TODAY_ISO } from "./constants";
import type { Parent, Student, StudentStatus } from "./types";
import type { StudentInput } from "./schemas";

const clean = "-_id -__v";

export const STUDENT_STATUSES: StudentStatus[] = ["Active", "Trial", "Paused", "Archived"];

/** Sort keys the API accepts. `name` is the default the roster renders at. */
export const STUDENT_SORT_KEYS = ["name", "grade", "status", "joined", "school", "parentName"] as const;
export type StudentSortKey = (typeof STUDENT_SORT_KEYS)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/* ---------------------------------------------------------------- derivation */

/** Whole years between an ISO birthday and the app clock (see CLAUDE.md). */
export function ageFrom(birthday: string, todayIso: string = TODAY_ISO): number {
  if (!birthday) return 0;
  const b = new Date(birthday + "T00:00:00");
  const t = new Date(todayIso + "T00:00:00");
  if (isNaN(b.getTime()) || isNaN(t.getTime())) return 0;
  let age = t.getFullYear() - b.getFullYear();
  const before = t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate());
  if (before) age--;
  return Math.max(0, age);
}

/** 0 is Kindergarten; every other grade reads "Grade N" (matches the seed). */
export function gradeLabelFor(grade: number): string {
  return Number(grade) === 0 ? "Kindergarten" : `Grade ${grade}`;
}

export function initialsFor(first: string, last: string): string {
  return ((first[0] || "") + (last[0] || "")).toUpperCase();
}

/** Stable avatar tint, assigned by the numeric part of the id as in the seed. */
function avatarColorFor(id: string): string {
  const n = Number(String(id).replace(/\D/g, "")) || 1;
  return AVATAR_PALETTE[(n - 1) % AVATAR_PALETTE.length];
}

/** Next free `sN` id. */
async function nextStudentId(): Promise<string> {
  const ids = await StudentModel.find().select("id -_id").lean<{ id: string }[]>();
  const max = ids.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/\D/g, "")) || 0), 0);
  return `s${max + 1}`;
}

/** Fold a validated form payload into a full Student record. */
function applyInput(input: StudentInput, parent: Parent | null, base: Partial<Student>, id: string): Student {
  const first = input.first.trim();
  const last = input.last.trim();
  return {
    id,
    first,
    last,
    name: `${first} ${last}`.trim(),
    initials: initialsFor(first, last),
    birthday: input.birthday,
    age: ageFrom(input.birthday),
    school: input.school.trim(),
    grade: input.grade,
    gradeLabel: gradeLabelFor(input.grade),
    parentId: input.parentId,
    parentName: parent?.name ?? "",
    // Independent field — never copied or synced from the parent. Blank stays
    // blank; read Parent.phone directly wherever the parent's number is needed.
    phone: input.phone,
    status: input.status,
    notes: input.notes,
    joined: base.joined ?? TODAY_ISO,
    // Owned by the Classes / Attendance / Finance modules — preserved, never
    // invented here.
    classes: base.classes ?? 0,
    attendance: base.attendance ?? 0,
    balance: base.balance ?? 0,
    avatar: input.avatar ?? base.avatar ?? null,
    avatarColor: base.avatarColor ?? avatarColorFor(id),
  };
}

/* -------------------------------------------------------------------- queries */

export interface StudentQuery {
  q?: string;
  status?: string;
  grade?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

export interface StudentListResult {
  rows: Student[];
  total: number;
  page: number;
  pageSize: number;
  /** Parent options for the student form — the roster owns no Parents UI. */
  parents: Pick<Parent, "id" | "name" | "relationship">[];
}

function collator() {
  return new Intl.Collator("en", { sensitivity: "base", numeric: true });
}

/** Read the roster, filtered / sorted / paginated. */
export async function listStudents(query: StudentQuery = {}): Promise<StudentListResult> {
  await dbConnect();
  const [all, parents] = await Promise.all([
    StudentModel.find().select(clean).lean<Student[]>(),
    ParentModel.find().select(clean).lean<Parent[]>(),
  ]);

  // ---- search: name, school, parent (matches the design's placeholder) ----
  const q = (query.q ?? "").trim().toLowerCase();
  let rows = q
    ? all.filter((s) =>
        [s.name, s.school, s.parentName].some((f) => String(f ?? "").toLowerCase().includes(q))
      )
    : all.slice();

  // ---- filters ----
  const status = query.status ?? "";
  if (status && status !== "All") rows = rows.filter((s) => s.status === status);

  const grade = query.grade ?? "";
  if (grade !== "" && grade !== "all") {
    const g = Number(grade);
    if (Number.isFinite(g)) rows = rows.filter((s) => Number(s.grade) === g);
  }

  // ---- sort ----
  const sort = (STUDENT_SORT_KEYS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as StudentSortKey)
    : "name";
  const dir = query.dir === "desc" ? -1 : 1;
  const cmp = collator();
  rows.sort((a, b) => {
    let r: number;
    if (sort === "grade") r = Number(a.grade) - Number(b.grade);
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
    rows: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    parents: parents
      .map((p) => ({ id: p.id, name: p.name, relationship: p.relationship }))
      .sort((a, b) => cmp.compare(a.name, b.name)),
  };
}

export interface StudentDetailResult {
  student: Student;
  parent: Parent | null;
  parents: Pick<Parent, "id" | "name" | "relationship">[];
}

export async function getStudent(id: string): Promise<StudentDetailResult | null> {
  await dbConnect();
  const student = await StudentModel.findOne({ id }).select(clean).lean<Student>();
  if (!student) return null;
  const [parent, parents] = await Promise.all([
    student.parentId
      ? ParentModel.findOne({ id: student.parentId }).select(clean).lean<Parent>()
      : Promise.resolve(null),
    ParentModel.find().select(clean).lean<Parent[]>(),
  ]);
  const cmp = collator();
  return {
    student,
    parent: parent ?? null,
    parents: parents
      .map((p) => ({ id: p.id, name: p.name, relationship: p.relationship }))
      .sort((a, b) => cmp.compare(a.name, b.name)),
  };
}

/* ---------------------------------------------------------------------- CRUD */

async function parentFor(parentId: string): Promise<Parent | null> {
  if (!parentId) return null;
  return (await ParentModel.findOne({ id: parentId }).select(clean).lean<Parent>()) ?? null;
}

export async function createStudent(input: StudentInput): Promise<Student> {
  await dbConnect();
  const id = await nextStudentId();
  const doc = applyInput(input, await parentFor(input.parentId), {}, id);
  await StudentModel.create(doc);
  return doc;
}

/** Update in place; returns null when the id is unknown. */
export async function updateStudent(id: string, input: StudentInput): Promise<Student | null> {
  await dbConnect();
  const existing = await StudentModel.findOne({ id }).select(clean).lean<Student>();
  if (!existing) return null;
  const doc = applyInput(input, await parentFor(input.parentId), existing, id);
  await StudentModel.updateOne({ id }, { $set: doc });
  return doc;
}

/** Patch only the free-text notes (the profile's Notes card). */
export async function updateStudentNotes(id: string, notes: string): Promise<Student | null> {
  await dbConnect();
  const res = await StudentModel.findOneAndUpdate({ id }, { $set: { notes } }, { returnDocument: "after" })
    .select(clean)
    .lean<Student>();
  return res ?? null;
}

export async function deleteStudent(id: string): Promise<boolean> {
  await dbConnect();
  const res = await StudentModel.deleteOne({ id });
  return res.deletedCount > 0;
}
