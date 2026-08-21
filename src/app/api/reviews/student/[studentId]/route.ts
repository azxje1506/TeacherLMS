/* One student's reviews.
 *
 * GET /api/reviews/student/:studentId -> the student's identity, whether a new
 *     review may be written for them, whether their parent actually resolves,
 *     the default and selectable months, and their review history newest first.
 *
 * AN ARCHIVED STUDENT IS READABLE. Their history is a record of months that
 * happened; archiving them does not delete it. `canCreate` is what turns false.
 *
 * A STUDENT WHO DOES NOT RESOLVE IS A 404. Reviews left behind by a deleted
 * student are preserved in the database and reachable through nothing.
 *
 * READ ONLY. No POST, PATCH, PUT or DELETE: a review is created through
 * /api/reviews and corrected through /api/reviews/:id.
 */

import { getStudentReviews } from "@/lib/reviews-service";
import { REVIEW_ERROR } from "@/lib/reviews";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ studentId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { studentId } = await params;
    const res = await getStudentReviews(studentId);
    if (!res.ok) return error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status);
    return json(res.payload);
  });
}
