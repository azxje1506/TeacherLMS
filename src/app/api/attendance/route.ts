/* Attendance index endpoint.
 *
 * GET /api/attendance -> the whole index screen's payload (this month's summary,
 *     attendance by class, Today's cards, Recent lessons). Server-shaped: the
 *     client is never handed raw collections to re-derive the screen from.
 *
 * There is no collection-level POST, PUT or DELETE. A register belongs to a
 * lesson and is saved at POST /api/attendance/:lessonId; there is no such thing
 * as "attendance" independent of one.
 */

import { listAttendanceIndex } from "@/lib/attendance-service";
import { advanceLessonLifecycle } from "@/lib/lifecycle";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    // THE LIFECYCLE MUST RUN BEFORE A STATUS-DERIVED READ, for exactly the reason
    // spelled out in the dashboard route: almost everything below is derived from
    // `Completed`, and a lesson whose date has passed but whose status was never
    // resolved would be missing from Recent, missing from the month's rate, and
    // stuck on the Today section it has outgrown.
    //
    // `ensureRegularLessons()` is deliberately NOT called. Generation belongs to
    // the Lessons module and is forward-only; Attendance reports on the timetable
    // that exists rather than extending it as a side effect of being looked at.
    await advanceLessonLifecycle();
    return json(await listAttendanceIndex());
  });
}
