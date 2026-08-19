/* Attendance — client-side fetchers and React Query keys. Shared by the index
 * screen and the Take attendance screen so a request is never defined twice.
 *
 * Same pattern as Students / Parents / Classes / Lessons: mutate -> invalidate ->
 * refetch, with no optimistic update. The register is the one screen in the app
 * that holds real unsaved local state, and guessing at the server's answer while
 * a teacher is mid-edit is exactly the wrong place to start.
 *
 * The payload TYPES come from the pure core (src/lib/attendance.ts) rather than
 * being restated here, so the server cannot change the shape of a response
 * without the client failing to compile.
 */

import type {
  AttendanceIndexPayload, AttendanceRegisterPayload, SubmittedEntry,
} from "@/lib/attendance";

/** Query keys — mutations invalidate `["attendance"]` to refresh every view. */
export const attendanceKeys = {
  all: ["attendance"] as const,
  index: ["attendance", "index"] as const,
  register: (lessonId: string) => ["attendance", "register", lessonId] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export async function fetchAttendanceIndex(): Promise<AttendanceIndexPayload> {
  const res = await fetch("/api/attendance");
  if (!res.ok) await readError(res, "Couldn't load attendance");
  return res.json();
}

export async function fetchAttendanceRegister(lessonId: string): Promise<AttendanceRegisterPayload> {
  const res = await fetch(`/api/attendance/${lessonId}`);
  if (!res.ok) await readError(res, "Couldn't load attendance");
  return res.json();
}

/** Save the visible register. The complete visible set is sent every time — a
 * register is a statement about everyone in the room, not a diff — and the server
 * writes exactly those students, leaving every other stored entry alone. */
export async function saveAttendanceRegister(
  lessonId: string,
  entries: Record<string, SubmittedEntry>
): Promise<AttendanceRegisterPayload> {
  const res = await fetch(`/api/attendance/${lessonId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) await readError(res, "Couldn't save attendance");
  return res.json();
}
