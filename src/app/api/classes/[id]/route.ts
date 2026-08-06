/* Single class endpoint.
 *
 * GET    /api/classes/:id -> the Class
 * PATCH  /api/classes/:id -> the updated Class. A body of only { notes } saves
 *        the detail's Teacher notes card without revalidating the whole form.
 * DELETE /api/classes/:id -> { ok: true }. Removes ONLY the Class record;
 *        Students, Lessons, Attendance and Finance are never touched. Refused
 *        with 409 when the class has taught anything — archive it instead
 *        (RECURRENCE_DESIGN §2).
 */

import { getClass, updateClass, updateClassNotes, deleteClass, ScheduleConflictError } from "@/lib/classes";
import { classSchema, classNotesSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const found = await getClass(id);
    if (!found) return error("Class not found", 404);
    return json(found);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);

    // Notes-only save from the detail card.
    if (body && typeof body === "object" && Object.keys(body).length === 1 && "notes" in body) {
      const notes = classNotesSchema.safeParse(body);
      if (!notes.success) return error("Invalid input", 422);
      const saved = await updateClassNotes(id, notes.data.notes);
      if (!saved) return error("Class not found", 404);
      return json(saved);
    }

    const parsed = classSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    try {
      const updated = await updateClass(id, parsed.data);
      if (!updated) return error("Class not found", 404);
      return json(updated);
    } catch (e) {
      // 409 carries the clash as data too, so the client can localize it.
      if (e instanceof ScheduleConflictError) {
        return json({ error: e.message, code: "schedule_conflict", conflict: e.conflict }, 409);
      }
      throw e;
    }
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const res = await deleteClass(id);
    if (res.ok) return json({ ok: true });
    if (res.reason === "not_found") return error("Class not found", 404);
    // 409 carries the counts as data too, so a future UI can explain WHAT is
    // holding the class open without re-deriving it (RECURRENCE_DESIGN §2).
    return json(
      {
        error: "This class has teaching history — archive it instead of deleting",
        code: "class_has_history",
        history: res.history,
      },
      409
    );
  });
}
