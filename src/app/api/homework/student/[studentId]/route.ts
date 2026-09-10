/* One student's homework history.
 *
 * GET /api/homework/student/:studentId -> the Student Profile Homework tab's
 *     read model: the completion ring's figure, the four counts, the timeline,
 *     and the Missing and Late lists.
 *
 * IT LIVES UNDER HOMEWORK, NOT UNDER STUDENTS, because Homework owns this data —
 * the same shape as the shipped GET /api/reviews/student/:studentId.
 *
 * EVERY STATUS HERE IS THE STUDENT'S OWN. A class-scoped assignment is read
 * through its submissions map, never through its top-level status, and an
 * assignment with no key for this student is not theirs and does not appear.
 *
 * AN ARCHIVED STUDENT IS READABLE. A STUDENT WHO DOES NOT RESOLVE IS A 404,
 * carrying the sentence HOMEWORK_ERROR.student_not_found already uses.
 *
 * READ ONLY. No POST, PATCH, PUT or DELETE. Homework is created through
 * /api/homework, corrected through /api/homework/:id, and this MVP still ships
 * no submission writer — nothing here records an outcome.
 */

import { getStudentHomework } from "@/lib/student-profile-service";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ studentId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { studentId } = await params;
    const payload = await getStudentHomework(studentId);
    if (!payload) return error("Student not found", 404);
    return json(payload);
  });
}
