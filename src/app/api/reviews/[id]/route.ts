/* One monthly review.
 *
 * PATCH /api/reviews/:id -> the updated review. Only the six fields a teacher
 *       authored — skills, comment, strengths, improvements, goals, parentNotes
 *       — may be sent; the request is refused outright if it names any other,
 *       including `studentId` and `month`, which are fixed at creation.
 *
 * NO GET, deliberately. The index payload and the student's Reviews payload
 * already carry everything a form needs, so a per-review read would be a second
 * way to fetch what the client already holds — and it would be the one route
 * through which a review left behind by a deleted student could be looked up by
 * id. PATCH refuses those with the same 404 a missing review gets, so the id
 * space discloses nothing either way.
 *
 * NO DELETE and NO PUT. A review is a historical record of a month; Sprint 8 has
 * no designed surface that removes one, so there is no handler that can.
 */

import { updateReview } from "@/lib/reviews-service";
import { REVIEW_ERROR } from "@/lib/reviews";
import { reviewUpdateSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = reviewUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await updateReview(id, parsed.data);
    if (!res.ok) return error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status);
    return json(res.review);
  });
}
