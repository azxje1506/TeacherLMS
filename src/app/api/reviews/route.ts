/* Reviews collection endpoint.
 *
 * GET  /api/reviews -> { month, cards } — one card per student who may be given
 *      a review, shaped on the server. Archived students are omitted, and a
 *      review whose student no longer exists raises no card and contributes no
 *      id, so the index cannot disclose a ghost record.
 * POST /api/reviews -> the created review, 201. A duplicate month answers 409
 *      with `code: "review_already_exists"`.
 *
 * There is no PUT (an edit is a PATCH on one review) and no DELETE, at this
 * level or any other: a review is a historical record of a month, and Sprint 8
 * has no designed surface that removes one.
 */

import { createReview, listReviewCards } from "@/lib/reviews-service";
import { REVIEW_ERROR } from "@/lib/reviews";
import { reviewCreateSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    return json(await listReviewCards());
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = reviewCreateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    // Student eligibility, the month window and the one-review-per-month rule are
    // all re-checked inside the service, not here: the card that opened this form
    // may have been drawn before the student was archived, and the month picker's
    // decision to offer a month is not a rule.
    const res = await createReview(parsed.data);
    if (!res.ok) {
      // 409 carries a code as well as a sentence, the way a refused homework
      // delete does, so a client can recognise the duplicate without parsing
      // English and without an API change when the wording is translated.
      if (res.reason === "review_already_exists") {
        return json(
          { error: REVIEW_ERROR.review_already_exists.message, code: "review_already_exists" },
          REVIEW_ERROR.review_already_exists.status
        );
      }
      return error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status);
    }
    return json(res.review, 201);
  });
}
