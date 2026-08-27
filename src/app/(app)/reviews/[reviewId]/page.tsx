"use client";

/* One monthly review — the dedicated EDIT route.
 *
 *   /reviews/{reviewId}
 *
 * ADDRESSED BY REVIEW, NOT BY STUDENT. The student id is deliberately not in
 * this path: the Review owns the relationship, and a URL that carried both could
 * be made to disagree with the record. Whoever the persisted review belongs to
 * is who this page is about, and nothing in the address can override it.
 *
 * THE READ IS GUARDED, AND THE GUARD IS THE WRITE'S OWN. The page fetches
 * `/api/reviews/:id/report`, which passes the same interactable check PATCH
 * does: a review that does not exist and a review left behind by a deleted
 * student are ONE answer, 404. No id space is probed, and no deleted student's
 * identity is disclosed by the difference between two error messages.
 *
 * AN ARCHIVED STUDENT'S REVIEW OPENS AND SAVES. Their record describes a month
 * that happened; archiving them afterwards does not make it uncorrectable.
 * Eligibility gates creating a NEW review, and only that.
 *
 * THE STUDENT AND THE MONTH ARE NOT EDITABLE HERE, and not because this page
 * declines to draw the controls: `toUpdateBody` names six fields and the server
 * refuses any seventh, so a review cannot be moved to another student or another
 * month by any request this client can make.
 *
 * THIS FILE HOLDS NO REVIEW RULE — one query, then `ReviewComposer`.
 */

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { ReviewComposer } from "@/components/reviews/review-composer";
import { ComposerFailure, ComposerSkeleton } from "@/components/reviews/composer-states";
import { fetchComposerForReview, reviewKeys } from "@/components/reviews/api";

export default function ReviewPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const { t } = useSettings();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: reviewKeys.composerForReview(reviewId),
    queryFn: () => fetchComposerForReview(reviewId),
    retry: false,
  });

  if (isLoading) return <ComposerSkeleton />;
  if (isError || !data) {
    return <ComposerFailure message={t(error?.message ?? "Couldn't load reviews")} onRetry={() => refetch()} />;
  }

  /* KEYED ON THE REVIEW. The composer seeds its form from `defaultValues`,
   * which React Hook Form reads once per mount — so pointing this page at a
   * different review must REMOUNT it. Edit's month chips navigate between a
   * student's reviews, and when the destination is already cached the swap
   * happens with no loading state to unmount anything: without this key the
   * form would keep showing the previous review's ratings and words under the
   * new one's header. */
  return <ReviewComposer key={reviewId} data={data} />;
}
