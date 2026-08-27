/* The dedicated Review composer's read, for CREATE.
 *
 * GET /api/reviews/composer?studentId=... -> everything the Create page needs
 *     that a teacher cannot type: the student, the parent the report is
 *     addressed to, the twelve selectable months with which of them are taken,
 *     the Attendance and Homework figures for each of those months, and this
 *     student's own review history as month + ratings + comment.
 *
 * NO REVIEW ID, DELIBERATELY. A create previews before it persists, so the page
 * that needs this has no record to address. That is the entire reason this
 * endpoint is keyed on a STUDENT and lives beside `/api/reviews` rather than
 * under `/api/reviews/:id`.
 *
 * ELIGIBILITY IS THE SERVER'S ANSWER. An Archived student is refused with the
 * same 422 the create endpoint gives, and a student who does not resolve is a
 * 404 — so a page opened from a card drawn before the student was archived
 * cannot show a form the API would refuse to save.
 *
 * READ ONLY, AND ONLY READ. No POST, PATCH, PUT or DELETE at this path; a review
 * is created through `/api/reviews` and corrected through `/api/reviews/:id`.
 * Nothing here advances a lesson lifecycle, reconciles, generates or calls the
 * Dashboard.
 */

import { getReviewComposerForStudent } from "@/lib/reviews-service";
import { REVIEW_ERROR } from "@/lib/reviews";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const studentId = new URL(req.url).searchParams.get("studentId") ?? "";
    // An absent or empty id is the same answer a nonexistent one gets: there is
    // no student to compose a review for, and the reason discloses nothing.
    if (studentId === "") {
      return error(REVIEW_ERROR.student_not_found.message, REVIEW_ERROR.student_not_found.status);
    }
    const res = await getReviewComposerForStudent(studentId);
    if (!res.ok) return error(REVIEW_ERROR[res.reason].message, REVIEW_ERROR[res.reason].status);
    return json(res.payload);
  });
}
