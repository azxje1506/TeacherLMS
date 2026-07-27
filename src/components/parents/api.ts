/* Parents — client-side fetchers and React Query keys. Mirrors the Students
 * client so the roster's data layer reads the same way. */

import type { Parent } from "@/lib/types";
import type { ParentInput } from "@/lib/schemas";

/** A parent row plus its live linked-student count (from /api/parents). */
export interface ParentRow extends Parent {
  childCount: number;
}

export interface ParentListResponse {
  rows: ParentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListParams {
  q: string;
}

/** Query keys — mutations invalidate `["parents"]` to refresh every view. */
export const parentKeys = {
  all: ["parents"] as const,
  list: (p: ListParams) => ["parents", "list", p] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export async function fetchParents(p: ListParams): Promise<ParentListResponse> {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  const res = await fetch(`/api/parents?${qs.toString()}`);
  if (!res.ok) await readError(res, "Couldn't load parents");
  return res.json();
}

export async function createParent(input: ParentInput): Promise<Parent> {
  const res = await fetch("/api/parents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save parent");
  return res.json();
}

export async function updateParent(id: string, input: ParentInput): Promise<Parent> {
  const res = await fetch(`/api/parents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save parent");
  return res.json();
}

export async function deleteParent(id: string): Promise<void> {
  const res = await fetch(`/api/parents/${id}`, { method: "DELETE" });
  if (!res.ok) await readError(res, "Couldn't delete parent");
}
