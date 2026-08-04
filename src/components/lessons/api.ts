/* Lessons — client-side fetchers and React Query keys. Shared by the Lessons list,
 * the Calendar and the read-only drawer so a request is never defined twice.
 *
 * Mutations follow the same pattern as Students / Parents / Classes: mutate ->
 * invalidate -> refetch (no optimistic updates). */

import type { Lesson, LessonType, ScheduleSlot } from "@/lib/types";

/** A lesson row plus the lightweight class fields the list/calendar render.
 * `classLevel` lets the calendar name a drag-time conflict the way every other
 * conflict message does ("Grammar Stars · B1"). */
export interface LessonRow extends Lesson {
  className: string;
  classColor: string;
  classLevel: string;
}

/** A lightweight, read-only enrolled-student view for the drawer's roster. */
export interface LessonStudent {
  id: string;
  name: string;
  initials: string;
  gradeLabel: string;
  avatar: string | null;
  avatarColor: string;
}

/** The single-request payload the drawer renders. */
export interface LessonDetail extends Lesson {
  className: string;
  classColor: string;
  classLevel: string;
  recurringSchedule: ScheduleSlot[];
  studentCount: number;
  students: LessonStudent[];
}

export interface LessonListResponse {
  rows: LessonRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListParams {
  q?: string;
  status?: string;
  type?: string;
  classId?: string;
  from?: string;
  to?: string;
  pageSize?: number;
  /** 1-based. Omit for the first page. The server clamps it to the page count
   * and echoes back the page it actually served, so a stale value can never
   * produce an empty screen. */
  page?: number;
}

/** Query keys — mutations invalidate `["lessons"]` to refresh every view. */
export const lessonKeys = {
  all: ["lessons"] as const,
  list: (p: ListParams) => ["lessons", "list", p] as const,
  detail: (id: string) => ["lessons", "detail", id] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

function qs(p: ListParams): string {
  const s = new URLSearchParams();
  if (p.q) s.set("q", p.q);
  if (p.status && p.status !== "All") s.set("status", p.status);
  if (p.type && p.type !== "All") s.set("type", p.type);
  if (p.classId) s.set("classId", p.classId);
  if (p.from) s.set("from", p.from);
  if (p.to) s.set("to", p.to);
  if (p.pageSize) s.set("pageSize", String(p.pageSize));
  if (p.page && p.page > 1) s.set("page", String(p.page));
  return s.toString();
}

export async function fetchLessons(p: ListParams): Promise<LessonListResponse> {
  const res = await fetch(`/api/lessons?${qs(p)}`);
  if (!res.ok) await readError(res, "Couldn't load lessons");
  return res.json();
}

export async function fetchLesson(id: string): Promise<LessonDetail> {
  const res = await fetch(`/api/lessons/${id}`);
  if (!res.ok) await readError(res, "Couldn't load lesson");
  return res.json();
}

async function post<T>(url: string, body?: unknown, fallback = "Couldn't save lesson"): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await readError(res, fallback);
  return res.json();
}

export interface RescheduleInput { date: string; start?: string; duration?: number }
export function rescheduleLesson(id: string, input: RescheduleInput): Promise<LessonDetail> {
  return post(`/api/lessons/${id}/reschedule`, input, "Couldn't reschedule lesson");
}

export interface CancelInput { chargeable?: boolean }
export function cancelLesson(id: string, input: CancelInput = {}): Promise<LessonDetail> {
  return post(`/api/lessons/${id}/cancel`, input, "Couldn't cancel lesson");
}

export interface ExtraInput { classId: string; date: string; start: string; duration: number; classroom?: string; notes?: string }
export function createExtraLesson(input: ExtraInput): Promise<LessonDetail> {
  return post(`/api/lessons/extra`, input, "Couldn't create extra lesson");
}

export interface MakeupInput { date: string; start?: string; duration?: number; classroom?: string; notes?: string }
export function createMakeupLesson(fromId: string, input: MakeupInput): Promise<LessonDetail> {
  return post(`/api/lessons/${fromId}/makeup`, input, "Couldn't create makeup lesson");
}

export interface LessonEdit { notes?: string; classroom?: string }
export async function updateLesson(id: string, input: LessonEdit): Promise<LessonDetail> {
  const res = await fetch(`/api/lessons/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save lesson");
  return res.json();
}

export async function deleteLesson(id: string): Promise<void> {
  const res = await fetch(`/api/lessons/${id}`, { method: "DELETE" });
  if (!res.ok) await readError(res, "Couldn't delete lesson");
}

export type { LessonType };
