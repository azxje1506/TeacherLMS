/* Classes — client-side fetchers and React Query keys. Shared by the list and
 * the detail so the two never define the same request twice. */

import type { Klass } from "@/lib/types";
import type { ClassInput } from "@/lib/schemas";

/** A class row plus its class-owned enrolled-student count. */
export interface ClassRow extends Klass {
  studentCount: number;
}

export interface ClassListResponse {
  rows: ClassRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListParams {
  q: string;
  status: string;
}

/** Query keys — mutations invalidate `["classes"]` to refresh every view. */
export const classKeys = {
  all: ["classes"] as const,
  list: (p: ListParams) => ["classes", "list", p] as const,
  detail: (id: string) => ["classes", "detail", id] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export async function fetchClasses(p: ListParams): Promise<ClassListResponse> {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.status && p.status !== "All") qs.set("status", p.status);
  const res = await fetch(`/api/classes?${qs.toString()}`);
  if (!res.ok) await readError(res, "Couldn't load classes");
  return res.json();
}

export async function fetchClass(id: string): Promise<Klass> {
  const res = await fetch(`/api/classes/${id}`);
  if (!res.ok) await readError(res, "Couldn't load class");
  return res.json();
}

export async function createClass(input: ClassInput): Promise<Klass> {
  const res = await fetch("/api/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save class");
  return res.json();
}

export async function updateClass(id: string, input: ClassInput): Promise<Klass> {
  const res = await fetch(`/api/classes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save class");
  return res.json();
}

export async function saveClassNotes(id: string, notes: string): Promise<Klass> {
  const res = await fetch(`/api/classes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) await readError(res, "Couldn't save notes");
  return res.json();
}

export async function deleteClass(id: string): Promise<void> {
  const res = await fetch(`/api/classes/${id}`, { method: "DELETE" });
  if (!res.ok) await readError(res, "Couldn't delete class");
}
