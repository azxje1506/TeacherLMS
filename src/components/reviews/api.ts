/* Reviews — client-side fetchers and React Query keys. Shared by the index and
 * the drawer so a request is never defined twice.
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
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

/** Query keys. Mutations invalidate `["reviews"]`, which covers the index and
 * every per-student cache in one call. */
export const reviewKeys = {
  all: ["reviews"] as const,
  list: ["reviews", "list"] as const,
  student: (studentId: string) => ["reviews", "student", studentId] as const,
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
