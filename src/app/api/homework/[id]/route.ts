/* One homework assignment.
 *
 * PATCH  /api/homework/:id -> the updated assignment. Only the four fields a
 *        teacher authored — title, description, dueDate, teacherNotes — may be
 *        sent; the request is refused outright if it names any other.
 * DELETE /api/homework/:id -> { ok: true }. Permitted only while the assignment
 *        is still Assigned. A settled one is refused with 409 and zero writes —
 *        by the API, and not merely by a disabled button.
 *
 * NO GET. There is no Homework detail screen, and the index payload already
 * carries everything the edit form needs, so a per-assignment read would be a
 * second way to fetch what the client already holds. It would also be the one
 * route through which an assignment addressed to a deleted student could be
 * looked up by id.
 *
 * NO SUBMISSIONS ROUTE, here or anywhere. Sprint 7 has no designed surface that
 * records a student's outcome, so it has no endpoint that writes one.
 */

import { deleteHomework, updateHomework } from "@/lib/homework-service";
import { HOMEWORK_ERROR } from "@/lib/homework";
import { homeworkUpdateSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = homeworkUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await updateHomework(id, parsed.data);
    if (!res.ok) return error(HOMEWORK_ERROR[res.reason].message, HOMEWORK_ERROR[res.reason].status);
    return json(res.homework);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const res = await deleteHomework(id);
    if (res.ok) return json({ ok: true });
    // 409 carries a code as well as a sentence, the way a refused class delete
    // does, so a future UI can render its own wording without an API change.
    if (res.reason === "not_deletable") {
      return json(
        { error: HOMEWORK_ERROR.not_deletable.message, code: "homework_not_deletable" },
        HOMEWORK_ERROR.not_deletable.status
      );
    }
    return error(HOMEWORK_ERROR[res.reason].message, HOMEWORK_ERROR[res.reason].status);
  });
}
