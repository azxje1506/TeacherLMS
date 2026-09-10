/* One student's attendance history.
 *
 * GET /api/attendance/student/:studentId -> the Student Profile Attendance
 *     tab's read model: the headline rate and its four status counts, six
 *     monthly points, the timeline, and the two "Recent …" lists.
 *
 * IT LIVES UNDER ATTENDANCE, NOT UNDER STUDENTS, because Attendance owns this
 * data. The address mirrors the shipped GET /api/reviews/student/:studentId for
 * the same reason: the owning module answers questions about its own records,
 * and the student is the parameter rather than the owner.
 *
 * AN ARCHIVED STUDENT IS READABLE. Their history is a record of lessons that
 * happened, and filing them away does not delete it — the rule
 * /api/reviews/student/:studentId already follows.
 *
 * A STUDENT WHO DOES NOT RESOLVE IS A 404, with the sentence the Students and
 * Homework endpoints already use. Entries left behind by a deleted student are
 * preserved in the database and reachable through nothing.
 *
 * READ ONLY. No POST, PATCH, PUT or DELETE, and the GET writes nothing — not a
 * register, not a lesson status, not a lifecycle advance. Attendance is recorded
 * through /api/attendance/:lessonId and nowhere else.
 */

import { getStudentAttendance } from "@/lib/student-profile-service";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ studentId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { studentId } = await params;
    const payload = await getStudentAttendance(studentId);
    if (!payload) return error("Student not found", 404);
    return json(payload);
  });
}
