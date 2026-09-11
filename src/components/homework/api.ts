/* Homework — client-side fetchers and React Query keys. Shared by the index and
 * the drawer so a request is never defined twice.
 *
 * Same pattern as Students / Parents / Classes / Lessons / Attendance: mutate ->
 * invalidate -> refetch, with no optimistic update. This is the first runtime
 * Homework writer in the application's history, and guessing at the server's
 * answer before it has given one is the wrong place to start.
 *
 * The payload TYPES come from the server modules rather than being restated here,
 * so the server cannot change the shape of a response without the client failing
 * to compile.
 *
 * NO DETAIL FETCHER. There is no GET /api/homework/:id — the list payload already
 * carries every field the edit form needs — so the drawer opens from the row the
 * teacher clicked rather than from a second request for what the client holds.
 *
 * NO SUBMISSION MUTATION. Sprint 7 records no outcomes, so there is nothing here
 * that could write one.
 */

import type { HomeworkListPayload } from "@/lib/homework-service";
import type { HomeworkListItem } from "@/lib/homework";
import type { HomeworkCreateBody, HomeworkUpdateBody } from "@/lib/schemas";
import type { StudentHomeworkPayload } from "@/lib/student-profile";

/** Query keys — mutations invalidate `["homework"]` to refresh every view.
 * No per-record key, because no per-record endpoint exists to fill one.
 *
 * `student` sits UNDER `["homework"]` deliberately, so the one
 * `invalidateQueries({ queryKey: homeworkKeys.all })` every mutation already
 * issues also refreshes an open profile tab. It is NOT under `["students"]`:
 * renaming a student must not refetch their whole homework history, and setting
 * or deleting an assignment must. The key follows the data's owner, not the
 * screen's — the same rule `attendanceKeys.student` follows. */
export const homeworkKeys = {
  all: ["homework"] as const,
  list: ["homework", "list"] as const,
  student: (studentId: string) => ["homework", "student", studentId] as const,
};

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export async function fetchHomework(): Promise<HomeworkListPayload> {
  const res = await fetch("/api/homework");
  if (!res.ok) await readError(res, "Couldn't load homework");
  return res.json();
}

/** One student's whole homework record, for the Student Profile tab.
 *
 * READ ONLY, and the payload is consumed AS-IS. The completion rate, the four
 * counts, this student's outcome on each assignment, and all three lists are the
 * server's answers; the tab formats them and derives none of them again.
 *
 * THE SUBMISSIONS MAP NEVER CROSSES THIS BOUNDARY. The server resolved each
 * assignment to THIS student's own status, so the browser is handed an outcome
 * rather than a map it could read someone else's key out of. */
export async function fetchStudentHomework(studentId: string): Promise<StudentHomeworkPayload> {
  const res = await fetch(`/api/homework/student/${studentId}`);
  if (!res.ok) await readError(res, "Couldn't load homework");
  return res.json();
}

export async function createHomework(input: HomeworkCreateBody): Promise<HomeworkListItem> {
  const res = await fetch("/api/homework", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save homework");
  return res.json();
}

export async function updateHomework(id: string, input: HomeworkUpdateBody): Promise<HomeworkListItem> {
  const res = await fetch(`/api/homework/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save homework");
  return res.json();
}

/** Delete carries no body. The server refuses a settled assignment with 409 and
 * that refusal — not the disabled button — is the guard; the message it returns
 * is surfaced through the ordinary error toast rather than restated here. */
export async function deleteHomework(id: string): Promise<void> {
  const res = await fetch(`/api/homework/${id}`, { method: "DELETE" });
  if (!res.ok) await readError(res, "Couldn't delete homework");
}
