/* Single lesson endpoint.
 *
 * GET    /api/lessons/:id -> the enriched LessonDetail (one request for the drawer).
 * PATCH  /api/lessons/:id -> update editable fields only (notes / classroom). This
 *        never drives a business operation — cancel / reschedule / makeup are their
 *        own action endpoints.
 * DELETE /api/lessons/:id -> permanently remove an Extra/Makeup lesson. Regular
 *        lessons are never deletable (409); cancel them instead.
 */

import { getLessonDetail, updateLesson, deleteLesson, LESSON_ERROR } from "@/lib/lessons";
import { lessonUpdateSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const found = await getLessonDetail(id);
    if (!found) return error("Lesson not found", 404);
    return json(found);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = lessonUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await updateLesson(id, parsed.data);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json(res.lesson);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const res = await deleteLesson(id);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json({ ok: true });
  });
}
