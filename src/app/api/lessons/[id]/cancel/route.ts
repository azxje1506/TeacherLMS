/* POST /api/lessons/:id/cancel -> cancel a lesson (optionally chargeable).
 * Single responsibility: sets status to Cancelled. */

import { cancelLesson, LESSON_ERROR } from "@/lib/lessons";
import { lessonCancelSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = lessonCancelSchema.safeParse(body ?? {});
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await cancelLesson(id, parsed.data.chargeable);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json(res.lesson);
  });
}
