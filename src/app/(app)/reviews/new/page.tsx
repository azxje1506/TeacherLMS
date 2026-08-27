"use client";

/* Write a monthly review — the dedicated CREATE route.
 *
 *   /reviews/new?studentId={studentId}
 *
 * A ROUTE, NOT A PANEL. Gate 4.4D replaces the drawer for the normal Reviews
 * flow: writing a review is now a page, because it shows a live report of the
 * month beside the form and a 460px panel cannot hold a document. It can be
 * linked to, reloaded and navigated back from, exactly as taking a register can.
 *
 * THE STUDENT COMES FROM THE URL AND IS RESOLVED BY THE SERVER. The card or
 * profile that linked here is not trusted for anything beyond the id: eligibility
 * (Active / Trial / Paused, never Archived), whether the student exists at all,
 * the twelve selectable months, which of them are taken, and the default month
 * are all the server's answers. A page opened from a card drawn before the
 * student was archived shows a refusal, not a form the API would reject.
 *
 * THE REVIEWS-OWNED ROUTE SHAPE. This lives under /reviews rather than under the
 * student, because the Review owns the relationship — and the record it creates
 * lives at /reviews/{reviewId}, with no student id nested in it.
 *
 * THIS FILE HOLDS NO REVIEW RULE. It resolves the query parameter, runs one
 * query, and hands the payload to `ReviewComposer`. Every field, every default,
 * every validation and every save belongs to that component and to the modules
 * beneath it.
 */

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { ReviewComposer } from "@/components/reviews/review-composer";
import { ComposerFailure, ComposerSkeleton } from "@/components/reviews/composer-states";
import { fetchComposerForStudent, reviewKeys } from "@/components/reviews/api";

export default function NewReviewPage() {
  const params = useSearchParams();
  const studentId = params.get("studentId") ?? "";
  const { t } = useSettings();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: reviewKeys.composerForStudent(studentId),
    queryFn: () => fetchComposerForStudent(studentId),
    /* A create with no student in the URL is not a request worth making. The
     * empty state below says so, and the server would answer the same way. */
    enabled: studentId !== "",
    retry: false,
  });

  if (studentId === "") {
    return <ComposerFailure message={t("Student not found")} onRetry={null} />;
  }
  if (isLoading) return <ComposerSkeleton />;
  if (isError || !data) {
    /* THE SERVER'S OWN SENTENCE, not a generic one: an Archived student and a
     * student who does not exist are different refusals and the API says which.
     * Retrying an eligibility refusal cannot help, but retrying a dropped
     * connection can, so the action is offered either way and costs one read. */
    return <ComposerFailure message={t(error?.message ?? "Couldn't load reviews")} onRetry={() => refetch()} />;
  }

  /* KEYED ON THE STUDENT, for the reason the Edit route is keyed on the review:
   * the form is seeded once per mount, so a different subject must be a
   * different mount. */
  return <ReviewComposer key={studentId} data={data} />;
}
