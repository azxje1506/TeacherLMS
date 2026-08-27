/* The dedicated Review composer's read, for EDIT.
 *
 * GET /api/reviews/:id/report -> the same composer model the Create read
 *     returns, filled from a persisted review: the student, the parent, the
 *     month chips, the per-month Attendance and Homework figures, this student's
 *     review history, and the six fields the teacher authored.
 *
 * WHY THIS AND NOT `GET /api/reviews/:id`. A generic read of a review by id
 * would expose Review STORAGE, and it would be the one route through which a
 * record left behind by a deleted student could be looked up. This returns a
 * composed read model instead, and it passes the SAME `loadInteractable` gate
 * PATCH does — so a ghost review and a missing review are one answer, 404, with
 * no distinct reason advertising that a record is there and no deleted student's
 * id anywhere in the response.
 *
 * AN ARCHIVED STUDENT'S REVIEW IS READABLE HERE. Their record describes a month
 * that happened; archiving them afterwards does not make it uncorrectable.
 * Eligibility gates create, and only create.
 *
 * READ ONLY. No POST, PATCH, PUT or DELETE at this path, and the handler
 * performs zero writes: no lifecycle advance, no reconciliation, no generation,
 * and no Dashboard call.
 */

import { getReviewComposerForReview } from "@/lib/reviews-service";
import { REVIEW_ERROR } from "@/lib/reviews";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const res = await getReviewComposerForReview(id);
    if (!res.ok) return error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status);
    return json(res.payload);
  });
}
