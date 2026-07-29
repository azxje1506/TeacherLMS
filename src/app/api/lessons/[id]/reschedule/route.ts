/* POST /api/lessons/:id/reschedule -> move a lesson to a new date (and optionally
 * a new time/duration). Single responsibility: the calendar's drag-and-drop sends
 * just the new date here. */

import { rescheduleLesson, LESSON_ERROR } from "@/lib/lessons";
import { lessonRescheduleSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = lessonRescheduleSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await rescheduleLesson(id, parsed.data);
    if (!res.ok) return error(LESSON_ERROR[res.reason].message, LESSON_ERROR[res.reason].status);
    return json(res.lesson);
  });
}
