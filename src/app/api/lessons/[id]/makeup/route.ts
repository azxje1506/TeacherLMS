/* POST /api/lessons/:id/makeup -> create a Makeup lesson that replaces the given
 * cancelled Regular lesson (:id). Single responsibility; group classes only, and
 * the original must be a cancelled regular (enforced in the service). */

import { createMakeupLesson, LESSON_ERROR } from "@/lib/lessons";
import { makeupLessonSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = makeupLessonSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await createMakeupLesson(id, parsed.data);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json(res.lesson, 201);
  });
}
