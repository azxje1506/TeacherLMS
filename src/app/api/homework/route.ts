/* Homework collection endpoint.
 *
 * GET  /api/homework -> { items } — every assignment a client may see, shaped on
 *      the server. Assignments whose class is gone, and student-scoped
 *      assignments whose student is gone, are omitted; the stored submissions map
 *      is never part of the response.
 * POST /api/homework -> the created assignment, 201.
 *
 * There is no PUT (an edit is a PATCH on one assignment) and no collection-level
 * DELETE (assignments are deleted one at a time, and only while pending).
 */

import { createHomework, listHomework } from "@/lib/homework-service";
import { HOMEWORK_ERROR } from "@/lib/homework";
import { homeworkCreateSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    return json(await listHomework());
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = homeworkCreateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    // Class eligibility and roster membership are re-checked inside the service,
    // not here: the picker that drew this form may have been rendered before the
    // class was archived, and the UI's decision to offer a class is not a rule.
    const res = await createHomework(parsed.data);
    if (!res.ok) return error(HOMEWORK_ERROR[res.reason].message, HOMEWORK_ERROR[res.reason].status);
    return json(res.homework, 201);
  });
}
