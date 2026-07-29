/* POST /api/lessons/extra -> create an Extra session on a one-on-one class (the
 * class is named in the body). Single responsibility; one-on-one only (enforced
 * in the service). */

import { createExtraLesson, LESSON_ERROR } from "@/lib/lessons";
import { extraLessonSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = extraLessonSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await createExtraLesson(parsed.data);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json(res.lesson, 201);
  });
}
