/* Single student endpoint.
 *
 * GET    /api/students/:id -> { student, parent, parents }
 * PATCH  /api/students/:id -> the updated Student. A body of only { notes }
 *        saves the profile's Notes card without revalidating the whole form.
 * DELETE /api/students/:id -> { ok: true }
 */

import { getStudent, updateStudent, updateStudentNotes, deleteStudent } from "@/lib/students";
import { studentSchema, studentNotesSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const found = await getStudent(id);
    if (!found) return error("Student not found", 404);
    return json(found);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);

    // Notes-only save from the profile card.
    if (body && typeof body === "object" && Object.keys(body).length === 1 && "notes" in body) {
      const notes = studentNotesSchema.safeParse(body);
      if (!notes.success) return error("Invalid input", 422);
      const saved = await updateStudentNotes(id, notes.data.notes);
      if (!saved) return error("Student not found", 404);
      return json(saved);
    }

    const parsed = studentSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const updated = await updateStudent(id, parsed.data);
    if (!updated) return error("Student not found", 404);
    return json(updated);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const ok = await deleteStudent(id);
    if (!ok) return error("Student not found", 404);
    return json({ ok: true });
  });
}
