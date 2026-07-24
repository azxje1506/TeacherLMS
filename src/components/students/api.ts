/* Students — client-side fetchers and React Query keys. Shared by the roster and
 * the profile so the two never define the same request twice. */

import type { Student, Parent } from "@/lib/types";
import type { StudentInput } from "@/lib/schemas";

export type ParentOption = Pick<Parent, "id" | "name" | "relationship">;

export interface StudentListResponse {
  rows: Student[];
  total: number;
  page: number;
  pageSize: number;
  parents: ParentOption[];
}

export interface StudentDetailResponse {
  student: Student;
  parent: Parent | null;
  parents: ParentOption[];
}

export interface ListParams {
  q: string;
  status: string;
  grade: string;
}

/** Query keys — mutations invalidate `["students"]` to refresh every view. */
export const studentKeys = {
  all: ["students"] as const,
  list: (p: ListParams) => ["students", "list", p] as const,
  detail: (id: string) => ["students", "detail", id] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export async function fetchStudents(p: ListParams): Promise<StudentListResponse> {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.status && p.status !== "All") qs.set("status", p.status);
  if (p.grade && p.grade !== "all") qs.set("grade", p.grade);
  const res = await fetch(`/api/students?${qs.toString()}`);
  if (!res.ok) await readError(res, "Couldn't load students");
  return res.json();
}

export async function fetchStudent(id: string): Promise<StudentDetailResponse> {
  const res = await fetch(`/api/students/${id}`);
  if (!res.ok) await readError(res, "Couldn't load student");
  return res.json();
}

export async function createStudent(input: StudentInput): Promise<Student> {
  const res = await fetch("/api/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save student");
  return res.json();
}

export async function updateStudent(id: string, input: StudentInput): Promise<Student> {
  const res = await fetch(`/api/students/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save student");
  return res.json();
}

export async function saveStudentNotes(id: string, notes: string): Promise<Student> {
  const res = await fetch(`/api/students/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) await readError(res, "Couldn't save notes");
  return res.json();
}

export async function deleteStudent(id: string): Promise<void> {
  const res = await fetch(`/api/students/${id}`, { method: "DELETE" });
  if (!res.ok) await readError(res, "Couldn't delete student");
}
