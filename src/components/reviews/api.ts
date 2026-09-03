/* Reviews — client-side fetchers and React Query keys. Shared by the index and
 * the composer so a request is never defined twice.
 *
 * Same pattern as Students / Parents / Classes / Lessons / Attendance /
 * Homework: mutate -> invalidate -> refetch, with no optimistic update. Nothing
 * here guesses at the server's answer before it has given one.
 *
 * The payload TYPES come from the server modules rather than being restated
 * here, so the server cannot change the shape of a response without the client
 * failing to compile. `import type` is erased at build time, so importing from a
 * `server-only` module costs nothing at runtime — the same thing
 * components/homework/api.ts does.
 *
 * NO DELETE. There is no DELETE /api/reviews/:id, because a review is a
 * historical record of a month and Sprint 8 has no surface that removes one, so
 * there is nothing here that could call it.
 *
 * NO FETCH BY REVIEW ID. There is no GET /api/reviews/:id either — deliberately,
 * because that route would be the one place an id could be used to discover
 * whether a review left behind by a deleted student exists. The index payload
 * and the student payload carry every field a form needs.
 */

import type { ReviewCardsPayload, ReviewDetail, StudentReviewsPayload } from "@/lib/reviews-service";
import type { ReviewComposerData } from "@/lib/review-report";
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

/** Query keys. Mutations invalidate `["reviews"]`, which covers the index and
 * every per-student cache in one call. */
export const reviewKeys = {
  all: ["reviews"] as const,
  list: ["reviews", "list"] as const,
  student: (studentId: string) => ["reviews", "student", studentId] as const,
  /* The dedicated composer's two reads. Both sit UNDER ["reviews"], so the one
   * `invalidateQueries({ queryKey: reviewKeys.all })` every mutation already
   * issues refreshes them too — a saved review corrects its own page's month
   * chips and history without a second invalidation rule. */
  composerForStudent: (studentId: string) => ["reviews", "composer", "student", studentId] as const,
  composerForReview: (reviewId: string) => ["reviews", "composer", "review", reviewId] as const,
};

/** An API failure that kept the server's machine-readable code.
 *
 * The message is what the teacher reads; the code is what the caller reasons
 * about. `review_already_exists` is the case that matters: it usually means the
 * client's list is stale, so the page refetches rather than only apologising. */
export class ReviewApiError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ReviewApiError";
    this.code = code;
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  throw new ReviewApiError(data.error || fallback, data.code);
}

/** The Reviews index: one card per student who may be reviewed. */
export async function fetchReviews(): Promise<ReviewCardsPayload> {
  const res = await fetch("/api/reviews");
  if (!res.ok) await readError(res, "Couldn't load reviews");
  return res.json();
}

/** One student's reviews, plus the month metadata the create form needs.
 *
 * The drawer needs this and the index cannot supply it: which months a student
 * has already been reviewed for is a fact about that student, and putting twelve
 * months × every student into the index payload would send the whole collection
 * to draw a grid of cards. */
export async function fetchStudentReviews(studentId: string): Promise<StudentReviewsPayload> {
  const res = await fetch(`/api/reviews/student/${encodeURIComponent(studentId)}`);
  if (!res.ok) await readError(res, "Couldn't load reviews");
  return res.json();
}

/** The Create composer's context for one student.
 *
 * NO REVIEW ID IS INVOLVED, because a create has no record yet — which is the
 * whole reason the dedicated page can preview before it saves. The server
 * refuses an Archived or unresolvable student here, so the page never renders a
 * form the API would reject. */
export async function fetchComposerForStudent(studentId: string): Promise<ReviewComposerData> {
  const res = await fetch(`/api/reviews/composer?studentId=${encodeURIComponent(studentId)}`);
  if (!res.ok) await readError(res, "Couldn't load reviews");
  return res.json();
}

/** The Edit composer's context for one persisted review.
 *
 * ADDRESSED TO `/api/reviews/:id/report`, NOT to a generic read of the record.
 * That route composes a read model and passes the same interactable guard PATCH
 * does, so a review left behind by a deleted student answers 404 exactly as a
 * missing one does. There is still no client for a raw `GET /api/reviews/:id`,
 * because there is still no such route. */
export async function fetchComposerForReview(reviewId: string): Promise<ReviewComposerData> {
  const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/report`);
  if (!res.ok) await readError(res, "Couldn't load reviews");
  return res.json();
}

export async function createReview(input: ReviewCreateBody): Promise<ReviewDetail> {
  const res = await fetch("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save review");
  return res.json();
}

export async function updateReview(id: string, input: ReviewUpdateBody): Promise<ReviewDetail> {
  const res = await fetch(`/api/reviews/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Couldn't save review");
  return res.json();
}
